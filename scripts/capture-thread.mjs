#!/usr/bin/env node
// Capture the completed-run answer area of an existing wayfinder thread.
import { chromium } from "playwright-core";

const BASE = "https://wayfinder-dashboard-production-f8d7.up.railway.app";
const THREAD = process.env.WF_THREAD;
const WORKSPACE = "lovranran-portfolio-demo";
const PASSWORD = process.env.WF_PASSWORD;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByPlaceholder("github-handle-or-team").fill(WORKSPACE);
await page.getByPlaceholder("8+ characters").fill(PASSWORD);
await page.getByRole("button", { name: "Login", exact: true }).last().click();
await page.waitForTimeout(5000);

await page.goto(`${BASE}/?thread=${THREAD}`, { waitUntil: "networkidle" });
await page.waitForTimeout(6000);

// Optionally send a follow-up question (e.g. a symbol question that produces
// verified file:line evidence) and wait for the run to complete.
if (process.env.WF_QUESTION) {
  // Force the evidence answer mode so the turn starts a grounded run.
  await page.getByRole("button", { name: "evidence", exact: true }).click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByPlaceholder(/Ask naturally/).fill(process.env.WF_QUESTION);
  await page.getByRole("button", { name: /send/i }).last().click();
  console.log("follow-up sent, waiting…");
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(15_000);
    const running = await page.getByText("running").first().isVisible().catch(() => false);
    if (!running) break;
    process.stdout.write(".");
  }
  console.log("");
  await page.waitForTimeout(5000);
}

// Scroll every scrollable container to the bottom so the final assistant
// answer (with verifier labels + evidence chips) is in view.
await page.evaluate(() => {
  for (const el of document.querySelectorAll("*")) {
    if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight;
  }
});
await page.waitForTimeout(2000);
await page.screenshot({ path: "assets/wayfinder-run-verified.png" });
console.log("captured");
await browser.close();
