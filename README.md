# Portfolio — Haichuan Zhou

Personal portfolio site featuring three AI-agent projects (wayfinder, agent-eval-harness,
project5 MCP suite), with an embedded AI chatbot that answers visitors' questions about
the work in depth.

## Architecture

- `index.html` — the entire site: a dependency-free static page (no build step) plus the
  chat widget UI.
- `functions/api/chat.js` — Cloudflare Pages Function. Streams responses from the Claude
  API (`claude-opus-4-8`) with the project knowledge base in a cached system prompt.
- `functions/api/knowledge.js` — condensed knowledge base about the featured projects.

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

## Cost note

The chatbot calls `claude-opus-4-8`. For a public site you may prefer to switch the model
in `functions/api/chat.js` to `claude-haiku-4-5` to cut cost — the knowledge base is
small enough that Haiku answers well. Output is capped at 2,048 tokens per reply and the
conversation is capped at 40 messages.
