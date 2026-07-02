# Evidence: AST index cache — production run timings

Supporting data for ["The timeout wasn't the bug"](../the-timeout-was-not-the-bug.html).
Raw API records (verbatim `GET /runs` snapshot, including per-agent summaries):
[`ast-cache-production-runs.json`](ast-cache-production-runs.json).

All runs executed against the public wayfinder deployment
(`wayfinder-api-production.up.railway.app`), workspace `lovranran-portfolio-demo`,
repo `pallets/click`, `answer_mode=evidence`, on 2026-07-02 (UTC).

## Timeline

| Time (UTC) | Query | Duration | verified/unverified | Config state |
|---|---|---:|---|---|
| 22:38 | `BaseCommand.invoke` (symbol removed upstream) | 16.8s | 0 / 0 | timeout 8s, no cache — AST tool timed out |
| 22:57 | `Command.invoke` | 49.0s | 3 / 1 | timeout 30s, retry 2 — **no cache** (index rebuilt per tool call) |
| 23:12 | `Context.invoke` | 47.3s | 3 / 1 | timeout 30s — no cache |
| 23:13 | `Group.command` | 44.7s | 3 / 1 | timeout 30s — no cache |
| ~23:19 | *(wayfinder-api redeployed: mcp-ast-explorer pinned to `8126b9f`, v0.2.0 index cache)* | | | |
| 23:30 | `Group.add_command` | **18.7s** | 3 / 1 | **cache, cold container** — index built once per run |
| 23:31 | `Context.forward` | **5.2s** | 3 / 1 | **cache, warm** |

## Config and code references

- Pre-fix deploy config: `WAYFINDER_MCP_TOOL_TIMEOUT_SECONDS=8`, `WAYFINDER_MCP_MAX_ATTEMPTS=1`
- Stopgap: raised to `30` / `2`, `WAYFINDER_GRAPH_NODE_TIMEOUT_SECONDS=90`
- Cache implementation: [`mcp-ast-explorer@8126b9f`](https://github.com/LovRanRan/mcp-ast-explorer/commit/8126b9f) (v0.2.0)
- Dockerfile SHA pin: [`wayfinder@b3e9b4b`](https://github.com/LovRanRan/wayfinder/commit/b3e9b4b)
- Local reproduction: `build_cst_index` on the click clone ≈ 5.4–5.6s per call (M-series);
  warm cache hit ≈ 4ms (`mcp_ast_explorer.cache.get_cst_index`)

Durations are `updated_at − created_at` from the run records. The trace line quoted in
the article appears verbatim in the `entry_explainer` partial summary of run
`52bf78bb-5a62-4fcc-8360-e905b4c74bf8` (see the JSON snapshot).
