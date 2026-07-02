#!/usr/bin/env node
// Capture logged-in screenshots of the public wayfinder dashboard for the
// portfolio. Registers (or logs into) a demo workspace, then screenshots the
// main workspace and the metrics page.
//
// Usage: WF_PASSWORD=... node scripts/capture-wayfinder.mjs

import { chromium } from "playwright-core";

const BASE = "https://wayfinder-dashboard-production-f8d7.up.railway.app";
const WORKSPACE = "lovranran-portfolio-demo";
const PASSWORD = process.env.WF_PASSWORD;
if (!PASSWORD) {
  console.error("WF_PASSWORD required");
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.goto(BASE, { waitUntil: "networkidle" });

async function auth(mode) {
  await page.getByRole("button", { name: mode === "register" ? "Register" : "Login", exact: true }).first().click();
  await page.getByPlaceholder("github-handle-or-team").fill(WORKSPACE);
  if (mode === "register") await page.getByPlaceholder("Haichuan").fill("Portfolio Demo");
  await page.getByPlaceholder("8+ characters").fill(PASSWORD);
  await page.getByRole("button", { name: mode === "register" ? "Create workspace" : "Login", exact: true }).last().click();
  await page.waitForTimeout(5000);
}

// Try Register first; if the workspace already exists, fall back to Login.
await auth("register");
if (await page.getByPlaceholder("github-handle-or-team").isVisible().catch(() => false)) {
  console.log("register failed (probably exists), trying login…");
  await auth("login");
}

// Kick off a real grounded run so the screenshot shows live data (or reuse the
// existing thread from a previous capture), then wait for evidence to arrive.
// One-time: store the workspace OpenAI key via the product's own encrypted
// key flow, so grounded runs can complete with LLM synthesis.
if (process.env.WF_OPENAI_KEY) {
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByPlaceholder(/sk-/).fill(process.env.WF_OPENAI_KEY);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(4000);
  console.log("workspace OpenAI key saved");
  await page.goto(BASE, { waitUntil: "networkidle" });
}

// Start a fresh thread so the capture shows an active run, not stale state.
const newBtn = page.getByRole("button", { name: /new/i }).first();
if (await newBtn.isVisible().catch(() => false)) {
  await newBtn.click();
  await page.waitForTimeout(2000);
}
const suggestion = page.getByText("Open https://github.com/pallets/click and map the architecture");
if (await suggestion.isVisible().catch(() => false)) {
  await suggestion.click();
  const sendBtn = page.getByRole("button", { name: /send/i }).last();
  if (await sendBtn.isEnabled().catch(() => false)) await sendBtn.click();
  console.log("run started, waiting for completion…");
  // Poll with refreshes until the run leaves the running state (max ~4 min).
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(15_000);
    const running = await page.getByText("running").first().isVisible().catch(() => false);
    if (!running) break;
    process.stdout.write(".");
  }
  console.log("");
}

await page.screenshot({ path: "assets/wayfinder-run-verified.png" });
console.log("workspace captured:", page.url());

await page.goto(`${BASE}/metrics`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.screenshot({ path: "assets/wayfinder-metrics.png" });
console.log("metrics captured:", page.url());

await browser.close();
