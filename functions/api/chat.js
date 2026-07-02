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

${KNOWLEDGE}`;

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;

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

  const stream = client.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
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
