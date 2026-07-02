# Portfolio — Haichuan Zhou

Personal portfolio site featuring three AI-agent projects (wayfinder, agent-eval-harness,
project5 MCP suite), with an embedded AI chatbot that answers visitors' questions about
the work in depth.

## Architecture

- `index.html` — the entire site: a dependency-free static page (no build step) plus the
  chat widget UI.
- `functions/api/chat.js` — Cloudflare Pages Function. Streams responses from the Claude
  API (`claude-opus-4-8`). Hybrid RAG: a condensed knowledge base lives in a cached
  system prompt, and each question additionally retrieves top-5 excerpts from the
  projects' real design docs via Workers AI (`bge-m3` embeddings) + Vectorize
  (`portfolio-docs` index, 1024-dim cosine). Answers cite their source files.
  Retrieval fails open — chat works even if the index is unavailable.
- `functions/api/knowledge.js` — condensed knowledge base about the featured projects.
- `functions/api/ingest.js` — secret-gated (Bearer `INGEST_TOKEN`) endpoint that embeds
  and upserts document chunks into Vectorize.
- `scripts/ingest.mjs` — reads markdown docs from the sibling project repos
  (`../wayfinder`, `../agent-eval-harness`, `../project5`), chunks by heading
  (≤3,500 chars), and POSTs them to `/api/ingest`. Re-run after docs change:

  ```bash
  INGEST_TOKEN=$(cat .ingest-token) node scripts/ingest.mjs
  ```

The API key lives only in Cloudflare (or `.dev.vars` locally) — it is never exposed to
the browser. If the key isn't configured, the endpoint returns 503 and the widget shows a
graceful fallback message.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # put your real ANTHROPIC_API_KEY in it
npm run dev                      # wrangler pages dev on http://localhost:8788
```

## Deploy (Cloudflare Pages)

```bash
npx wrangler login
npm run deploy
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name portfolio
```

Or connect the GitHub repo in the Cloudflare Pages dashboard (build command: none,
output directory: `.`) and add `ANTHROPIC_API_KEY` as an encrypted variable.

## Cost & abuse controls

The chatbot calls `claude-haiku-4-5` (switch the model in `functions/api/chat.js` to
`claude-opus-4-8` for maximum answer quality at ~5x the cost). Output is capped at 2,048
tokens per reply, conversations at 40 messages, and each IP is limited to 10 requests per
minute (KV-backed sliding window, fails open).
