#!/usr/bin/env node
// Ingest project documentation into the portfolio-docs Vectorize index.
//
// Reads markdown docs from the three sibling project repos, chunks them by
// heading, and POSTs batches to the deployed /api/ingest endpoint (which does
// the embedding + upsert with Workers AI / Vectorize bindings).
//
// Usage:
//   INGEST_TOKEN=... node scripts/ingest.mjs
//   INGEST_URL=http://localhost:8788 INGEST_TOKEN=... node scripts/ingest.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INGEST_URL = process.env.INGEST_URL || "https://haichuanzhou.com";
const INGEST_TOKEN = process.env.INGEST_TOKEN;
if (!INGEST_TOKEN) {
  console.error("INGEST_TOKEN env var is required");
  process.exit(1);
}

const EXCLUDE_DIRS = new Set([".git", ".venv", "node_modules", ".pytest_cache", ".wrangler", "runs", "__pycache__", ".next"]);
const MAX_CHUNK_CHARS = 3500;
const MIN_CHUNK_CHARS = 200;
const BATCH_SIZE = 8;
const RETRIES = 4;

// Which docs to ingest, per project (relative to ~/dev).
const SOURCES = [
  { dir: "wayfinder", include: /\.md$/ },
  { dir: "agent-eval-harness", include: /\.md$/ },
  { dir: "project5", include: /README\.md$/ },
];

function walk(dir, include, files = []) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, include, files);
    else if (include.test(name) && st.size > 100 && st.size < 500_000) files.push(full);
  }
  return files;
}

// Split a markdown doc into heading-anchored chunks of bounded size.
function chunkMarkdown(text, sourcePath) {
  const lines = text.split("\n");
  const sections = [];
  let current = { title: "", body: [] };
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      if (current.body.join("\n").trim()) sections.push(current);
      current = { title: h[2].trim(), body: [line] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.join("\n").trim()) sections.push(current);

  // Merge tiny sections forward, split oversized ones by paragraph.
  const chunks = [];
  let buf = { title: "", text: "" };
  const flush = () => {
    if (buf.text.trim().length >= MIN_CHUNK_CHARS) chunks.push({ ...buf });
    buf = { title: "", text: "" };
  };
  for (const s of sections) {
    const body = s.body.join("\n").trim();
    if (buf.text && buf.text.length + body.length > MAX_CHUNK_CHARS) flush();
    if (!buf.title) buf.title = s.title;
    buf.text += (buf.text ? "\n\n" : "") + body;
    while (buf.text.length > MAX_CHUNK_CHARS) {
      const cut = buf.text.lastIndexOf("\n\n", MAX_CHUNK_CHARS);
      const at = cut > MAX_CHUNK_CHARS / 2 ? cut : MAX_CHUNK_CHARS;
      chunks.push({ title: buf.title, text: buf.text.slice(0, at) });
      buf = { title: buf.title + " (cont.)", text: buf.text.slice(at).trim() };
    }
  }
  flush();
  // Vectorize IDs are capped at 64 bytes — hash the stable path#index key.
  return chunks.map((c, i) => ({
    id: createHash("sha1").update(`${sourcePath}#${i}`).digest("hex"),
    source: sourcePath,
    title: c.title,
    text: `[${sourcePath}${c.title ? " — " + c.title : ""}]\n${c.text}`,
  }));
}

async function postBatch(batch) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${INGEST_URL}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${INGEST_TOKEN}` },
      body: JSON.stringify({ chunks: batch }),
    });
    if (res.ok) return res.json();
    const text = (await res.text()).slice(0, 200);
    if (attempt >= RETRIES) throw new Error(`ingest failed after ${RETRIES} tries: HTTP ${res.status} ${text}`);
    console.warn(`\nHTTP ${res.status}, retry ${attempt}/${RETRIES} in ${attempt * 2}s`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

const allChunks = [];
for (const { dir, include } of SOURCES) {
  const base = join(ROOT, dir);
  for (const file of walk(base, include)) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf8");
    const chunks = chunkMarkdown(text, rel);
    allChunks.push(...chunks);
    console.log(`${rel}: ${chunks.length} chunks`);
  }
}
console.log(`\nTotal: ${allChunks.length} chunks. Uploading to ${INGEST_URL} ...`);

let done = 0;
for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
  const batch = allChunks.slice(i, i + BATCH_SIZE);
  await postBatch(batch);
  done += batch.length;
  process.stdout.write(`\r${done}/${allChunks.length} uploaded`);
  await new Promise((r) => setTimeout(r, 300));
}
console.log("\nDone.");
