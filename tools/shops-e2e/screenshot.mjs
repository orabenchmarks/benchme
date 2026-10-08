#!/usr/bin/env node
/**
 * screenshot — one page, one PNG, for design review.
 *
 *   node tools/shops-e2e/screenshot.mjs <url> <out.png> [--width 1440] [--height 900] [--full] [--wait 800]
 *       [--click "<css selector>"]... [--dismiss]
 *
 * --full captures the whole page; --wait adds a settle delay (ms) after load;
 * --click clicks selectors in order before the shot (open a drawer, a menu);
 * --dismiss pre-accepts the cookie banner and suppresses the newsletter pop-up
 * (sets the localStorage keys the stores read) so the page itself is visible.
 */
import { chromium } from "@playwright/test";

const argv = process.argv.slice(2);
const [url, out] = argv;
if (!url || !out) {
  console.error("usage: screenshot.mjs <url> <out.png> [--width N] [--height N] [--full] [--wait ms] [--click sel]... [--dismiss]");
  process.exit(2);
}
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const clicks = argv.flatMap((a, i) => (a === "--click" ? [argv[i + 1]] : []));
const width = Number(flag("width", "1440"));
const height = Number(flag("height", "900"));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
if (argv.includes("--dismiss")) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("cookie-consent", "accepted");
      localStorage.setItem("newsletter-dismissed", "1");
    } catch {}
  });
}
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
for (const sel of clicks) await page.click(sel, { timeout: 10000 });
await page.waitForTimeout(Number(flag("wait", "800")));
await page.screenshot({ path: out, fullPage: argv.includes("--full") });
const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
console.log(JSON.stringify({ url, out, status: res?.status() ?? null, title: await page.title(), horizontalOverflow: scrollW > width, consoleErrors: errors }));
await browser.close();
