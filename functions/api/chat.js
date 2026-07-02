import Anthropic from "@anthropic-ai/sdk";
import { KNOWLEDGE } from "./knowledge.js";

const SYSTEM_PROMPT = `You are the assistant on a software engineer's portfolio website.
Visitors (often recruiters or fellow engineers) chat with you to understand the owner's
work in depth. Answer questions about his projects using the knowledge base below.

Guidelines:
- Be accurate: everything you claim about the projects must come from the knowledge base.
  If something isn't covered there, say you don't know and point to the GitHub repos —
  never invent details. (Fitting, since his projects are all about verified claims.)
- Be concrete: prefer specific numbers, design decisions, and trade-offs over generic praise.
- Keep answers conversational and reasonably short; offer to go deeper rather than dumping
  everything at once.
- Reply in the language the visitor writes in (English or Chinese).
- If asked about contacting or hiring him, share the email and GitHub from the knowledge base.
- Politely decline requests unrelated to the portfolio (homework, general coding help, etc.).
- Some replies include "Retrieved documentation excerpts" pulled from the projects' real
  design docs. When you use them, cite the source file inline, e.g.
  (source: wayfinder/docs/design_notes/021_routing_grounding_fanout_fix.md).
  If the excerpts are irrelevant to the question, ignore them silently.

${KNOWLEDGE}`;

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;
const EMBED_MODEL = "@cf/baai/bge-m3";
const RETRIEVAL_TOP_K = 5;
const RETRIEVAL_MIN_SCORE = 0.3;

// RAG lookup: embed the visitor's question, pull the most relevant chunks from
// the projects' real design docs. Fails open — chat still works without it.
async function retrieveContext(env, query) {
  if (!env.AI || !env.VECTORIZE) return null;
  try {
    const embedding = await env.AI.run(EMBED_MODEL, { text: [query] });
    const vector = embedding?.data?.[0];
    if (!vector) return null;
    const result = await env.VECTORIZE.query(vector, {
      topK: RETRIEVAL_TOP_K,
      returnMetadata: "all",
    });
    const matches = (result?.matches || []).filter(
      (m) => m.score >= RETRIEVAL_MIN_SCORE && m.metadata?.text
    );
    if (matches.length === 0) return null;
    const excerpts = matches
      .map((m) => `[source: ${m.metadata.source}${m.metadata.title ? " — " + m.metadata.title : ""}]\n${m.metadata.text}`)
      .join("\n\n---\n\n");
    return `# Retrieved documentation excerpts (real project docs — cite sources when used)\n\n${excerpts}`;
  } catch (err) {
    console.error("retrieval failed:", err);
    return null;
  }
}

function badRequest(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array";
  if (messages.length > MAX_MESSAGES) return "conversation too long";
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return "invalid message role";
    if (typeof m.content !== "string" || m.content.length === 0) return "invalid message content";
    if (m.content.length > MAX_MESSAGE_CHARS) return "message too long";
  }
  if (messages[0].role !== "user") return "first message must be from user";
  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "Chat is not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON body");
  }

  const messages = body?.messages?.map((m) => ({ role: m?.role, content: m?.content }));
  const validationError = validateMessages(messages);
  if (validationError) return badRequest(validationError);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Retrieve doc excerpts for the latest question. The retrieved block goes in
  // a second system block AFTER the cache breakpoint, so the cached core prompt
  // stays byte-identical across requests.
  const lastUserMessage = messages[messages.length - 1];
  const retrieved =
    lastUserMessage.role === "user" ? await retrieveContext(env, lastUserMessage.content) : null;

  const system = [
    {
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (retrieved) system.push({ type: "text", text: retrieved });

  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    system,
    messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        stream.on("text", (delta) => controller.enqueue(encoder.encode(delta)));
        await stream.finalMessage();
      } catch (err) {
        console.error("chat stream error:", err);
        controller.enqueue(encoder.encode("\n\n[Sorry, something went wrong — please try again.]"));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
