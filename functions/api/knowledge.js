// Knowledge base for the portfolio chatbot.
// Condensed from the READMEs / design docs of the three featured projects.
// This is sent as part of the system prompt on every request (cached via prompt caching).

export const KNOWLEDGE = `
# Owner

The portfolio owner is Haichuan Zhou (周海川), a software engineer (GitHub: LovRanRan,
email 13812764054zhc@gmail.com) focused on AI agent systems. He is open to AI/LLM engineering roles. His three featured
projects form one coherent stack:

1. project5 (fact layer) — three self-authored deterministic MCP servers
2. wayfinder (orchestration layer) — a verifier-backed multi-agent codebase onboarding copilot
3. agent-eval-harness (evaluation layer) — an open-source eval framework + benchmark

The through-line of all three: treat LLM output as a claim to be verified, not an answer
to be trusted.

# wayfinder (flagship project)

Verifier-backed codebase onboarding copilot for engineers entering an unfamiliar repository.
It maps architecture, explains entry paths from AST evidence, labels high-risk code
understanding claims with grounded evidence, and shows uncertainty instead of hiding it.

Why it exists: most codebase explanation tools sound confident before they are grounded —
they can summarize README text, name plausible modules, or explain functions that may not
exist. wayfinder treats onboarding as an evidence workflow:
1. Gather deterministic architecture and AST evidence through MCP tools.
2. Route the user's question through a LangGraph Supervisor.
3. Verify static code facts with repository/AST evidence; keep runtime claims unverified
   unless a trusted/sandboxed test runner is available.
4. Label claims as verified / unverified / contradicted.
5. Rewrite final output when verifier evidence contradicts earlier prose.

Architecture: FastAPI runtime (endpoints: POST /chat, POST /threads, GET /threads,
POST /threads/{id}/messages, POST /explain, GET /runs, GET /status/{job_id},
POST /refine/{job_id}) -> LangGraph Supervisor -> worker agents:
- architect_mapper -> mcp-repo-mapper
- entry_explainer  -> mcp-ast-explorer
- verifier         -> AST labels + sandbox-gated mcp-test-runner
-> final_writer + resilience/reflection layer -> RunSummary + trace metadata + dashboard.

Multi-agent design (Commit 23): each worker has a role contract (mission, least-privilege
tools, output contract) and emits typed ClaimPackets carrying evidence. The verifier can
CHALLENGE a claim — a failing test makes it contradicted, AST/repo evidence makes it
verified, a high-risk claim with no grounding is downgraded to unverified. Community
context (Tavily/GitHub search) never upgrades a claim. Per-claim provenance is persisted
on the RunSummary and rendered in the dashboard.

Grounding / NL-to-symbol resolution (hardened on real third-party repos), priority order:
1. Explicit symbol in the query (backticked or dotted like graph.app.build_graph);
   filenames excluded so "state.py" never wins over the real symbol.
2. CLI/entry-point questions ("how do I run this?") — read pyproject.toml [project.scripts]
   and resolve the real console entry instead of treating "CLI" as a symbol.
3. Module-naming behavioural questions ("what does geoip do?") — read the module source,
   parse with ast, pick the most relevant public symbol.
4. architect_mapper entry-point fallback as last resort.
Guards: all-caps acronyms (CLI/API/URL) are never sent to find_definition; an ambiguous
bare name resolves to nothing rather than a guess.

Tech stack: Python 3.11+, FastAPI, LangGraph, LangChain MCP adapters, the three project5
MCP servers, LangSmith-compatible trace metadata, Next.js 15 dashboard, Tailwind CSS,
Docker Compose, GitHub Actions.

Production features: auth + encrypted per-workspace API key storage (only an encrypted
envelope + masked label stored; raw key never returned), SQLite/Postgres run stores
(shared schema DDL), rate limiting, CORS config, JSON logging, x-request-id correlation,
GET /ready readiness probe, sandboxed test-runner worker (shell=False, denies shell
metacharacters and package-install tokens, bounded pytest/Jest, output truncation,
workdir cleanup), GitHub URL ingestion with allowlist + max-file caps.

Deployed publicly on Railway (API + dashboard), with recorded public smoke evidence in
docs/evidence/. Also has a Cloud Run deploy path.

Dashboard: Codex-like repo workspace — left repo/thread rail, central chat, right
context/evidence/agent-trace rail; per-agent P50/P95 latency, token usage and cost,
routing decision flow, verification stats, failure mode frequency. Falls back to seeded
demo data with the same schema when the API is unavailable.

Failure modes with designed mitigations: repos over 10k files (sampling limitation
surfaced), unsupported languages (degraded limitation), AST parse errors, no tests /
unrelated failing suites (claims stay unverified, not accepted or contradicted),
supervisor misclassification (POST /refine persists corrections and resumes the same
graph thread), hallucinated symbols (AST validation gate rejects missing functions),
infinite reflection loops (rewrite cap of 2), test timeouts (retry once, then mark timed out).

Observability: every run carries trace metadata (agent_name, tool_name, mcp_server,
tokens, latency, cost_usd, claim_id, job_id, thread_id, phase, status) — consumable by
LangSmith and by agent-eval-harness.

Lessons learned: deterministic tools should own source truth — LLMs are the synthesis
layer, not fact creators; "unverified" is a product state that prevents missing coverage
from becoming fake confidence; graph resume needs the same thread_id in API state,
LangGraph config, and trace metadata; observability should start as a schema contract.

Links: https://github.com/LovRanRan/wayfinder
Live dashboard: https://wayfinder-dashboard-production-f8d7.up.railway.app
API docs: https://wayfinder-api-production.up.railway.app/docs

# agent-eval-harness

Open-source evaluation harness for LLM agents — routing accuracy, factual correctness
(LLM-as-judge with self-consistency), citation grounding, and test-execution verification
rate — shipped with a Supervisor-vs-ReAct benchmark for codebase-understanding agents.

Status: v0.5. Framework complete and green under ruff + mypy --strict + pytest (73 tests).
Flagship benchmark: 40 tasks across 10 Python OSS repos (click, flask, requests, httpx,
rich, jinja, werkzeug, starlette, itsdangerous, gunicorn), 4 task buckets.

Why: most agent projects ship with no rigorous eval data. The benchmark pits the wayfinder
multi-agent system against a ReAct single-agent baseline using the SAME model (gpt-5.5) and
the SAME five MCP tools — so the comparison isolates orchestration, not tools or model.

Headline result (full_v1, 40 tasks, ground truth reviewed & approved):
- wayfinder Supervisor: ~12x fewer tokens (396,223 vs 4,812,463), completed all 40 tasks
  with 0 errors, routing_accuracy 0.475, verification_rate 0.094.
- ReAct baseline: failed 6/40 tasks (15%) by running past its recursion limit; higher raw
  answer quality on tasks it finished (factual 0.702 vs 0.482, citation 0.884 vs 0.776)
  at ~12x the cost.
The report says this honestly: routing_accuracy and verification_rate are structurally
one-sided (ReAct has no router/verifier), so the apples-to-apples axes are factual,
citation, and cost. The trade-off is reliability + cost vs raw quality.

Four metrics:
- routing_accuracy — classified intent vs the task's expected route.
- factual_correctness — LLM-as-judge (Claude) against ground-truth key facts, wrapped in
  self-consistency (N runs, variance-gated).
- citation_grounding — share of cited code symbols that actually exist in the repo
  (anti-hallucination); the resolver credits real attribute/method references
  (self.callback, ctx.params), not only top-level def/class names.
- verification_rate — share of claims given a definitive verified/contradicted verdict by
  real pytest execution.

Design notes:
- Architecture-blind scoring: every adapter normalizes its trace into one RunResult; the
  judge and metrics only read typed fields, so they can't tell which architecture produced
  an answer.
- Run/score split with persisted runs: agent runs (the expensive part) persist to
  <arch>.runs.jsonl, so a metric fix can be re-scored offline for free. This paid off when
  a resolver bug was found mid-analysis: the citation resolver had been scoring real
  attribute references as hallucinations; fixing it and re-scoring raised wayfinder's
  citation score from 0.37 to ~0.80 without re-running a single agent.
- Judge bias controlled explicitly: every verdict carries reasoning; SelfConsistentJudge
  runs N times and flags scores whose variance exceeds a threshold.

Usage: Python API (load_tasks, run_architecture, score_results, write_csv) and a CLI
(agent-eval benchmark / agent-eval rescore) plus chart generation scripts.

Roadmap to v1.0: expand to 40 distinct repos across four domains (web frameworks, ML
libraries, CLI tools, distributed systems), post-deploy cloud re-run, mkdocs site,
LangGraph / bare LangChain adapter examples.

Link: https://github.com/LovRanRan/agent-eval-harness

# project5 — MCP tool suite

Three self-authored, deterministic MCP servers forming wayfinder's fact layer. None of
them contains an LLM — if a symbol doesn't exist, they return a structured not-found
result instead of inventing an answer. All are Python 3.11+ FastMCP 2.x packages with
tests, published with stdio transport (HTTP deploy path added for wayfinder).

mcp-repo-mapper (structure layer): scan_repo (typed repo scan with files, language
breakdown, entry points, Python dependency graph, detected frameworks),
find_circular_deps, language_breakdown, detect_framework (FastAPI, Flask, Django,
Express, Spring via registry-based markers), find_entry_points (ranked candidates:
Python mains, FastAPI apps, package start scripts, Dockerfiles, Node indexes), plus a
cached repo-structure:// resource. https://github.com/LovRanRan/mcp-repo-mapper

mcp-ast-explorer (semantic symbol layer): indexes Python source with LibCST; tools:
find_definition, function_signature, find_references (same-module CST name references),
call_chain (direct callers), class_hierarchy (direct subclasses). Refuses ambiguous bare
names rather than guessing; TypeScript registered as an explicit unsupported-backend
extension point. https://github.com/LovRanRan/mcp-ast-explorer

mcp-test-runner (verification layer): bounded pytest/Jest execution with timeout, CPU and
memory limits; run_pytest, run_jest, run_single_test, parse_test_output (normalized JSON
via pytest-json-report), get_coverage_summary (pytest-cov totals). Turns high-risk claims
into verified/unverified/contradicted evidence from real execution.
https://github.com/LovRanRan/mcp-test-runner

Design rationale: the three-layer split (structure -> symbols -> execution) mirrors how an
engineer actually reads a new codebase.

# Writing (on this site)

- "My eval framework accused my agent of hallucinating. The bug was in the judge."
  (https://haichuanzhou.com/writing/the-judge-had-a-bug.html) — the citation resolver
  postmortem and the run/score split payoff.
- "Onboarding copilots shouldn't sound confident before they're grounded"
  (https://haichuanzhou.com/writing/wayfinder.html) — wayfinder design write-up.
Point visitors to these when they want the deeper story.

# Other projects (mention briefly if asked)

- JoBs: full-stack job-hunting platform for US tech roles (Next.js 14, Postgres, auth,
  daily Greenhouse/Lever/Ashby ATS scraping, Claude-powered per-JD resume tailoring).
- Offer Generation System: Cloudflare Workers project — candidate/template CRUD, AI
  template selection, HTML fill, HTML-to-PDF pipeline.
- ai-intake-backend: FastAPI + Alembic + Docker training project (auth, workspace/case CRUD).
`;
