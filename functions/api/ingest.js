// Secret-gated ingestion endpoint: receives document chunks, embeds them with
// Workers AI (bge-m3), and upserts them into the Vectorize index.
// Called by scripts/ingest.mjs — not by the public site.

const EMBED_MODEL = "@cf/baai/bge-m3";
const MAX_CHUNKS_PER_REQUEST = 20;
const MAX_METADATA_TEXT = 2500;

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = request.headers.get("Authorization") || "";
  if (!env.INGEST_TOKEN || auth !== `Bearer ${env.INGEST_TOKEN}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  if (!env.AI || !env.VECTORIZE) {
    return new Response(JSON.stringify({ error: "AI/VECTORIZE bindings missing" }), { status: 503 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400 });
  }

  const chunks = body?.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0 || chunks.length > MAX_CHUNKS_PER_REQUEST) {
    return new Response(JSON.stringify({ error: `chunks must be 1-${MAX_CHUNKS_PER_REQUEST} items` }), { status: 400 });
  }
  for (const c of chunks) {
    if (!c?.id || typeof c.text !== "string" || !c.text.trim() || typeof c.source !== "string") {
      return new Response(JSON.stringify({ error: "each chunk needs id, text, source" }), { status: 400 });
    }
  }

  const embedding = await env.AI.run(EMBED_MODEL, { text: chunks.map((c) => c.text) });
  const vectors = embedding?.data;
  if (!Array.isArray(vectors) || vectors.length !== chunks.length) {
    return new Response(JSON.stringify({ error: "embedding failed", got: typeof vectors }), { status: 502 });
  }

  const upserts = chunks.map((c, i) => ({
    id: c.id,
    values: vectors[i],
    metadata: {
      source: c.source,
      title: c.title || "",
      text: c.text.slice(0, MAX_METADATA_TEXT),
    },
  }));
  const result = await env.VECTORIZE.upsert(upserts);

  return new Response(JSON.stringify({ ok: true, upserted: upserts.length, mutation: result?.mutationId ?? null }), {
    headers: { "Content-Type": "application/json" },
  });
}
