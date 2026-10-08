import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { OUT_DIR, STRIPE, traceFor } from "./lib/env.js";

/**
 * The hidden store tasks in Chromium (tasks.spec.ts). Everything Playwright writes goes under OUT_DIR
 * (default <tmp>/shops-e2e): report/ (HTML), results.json (the same, for scripts; each test's run.json is in
 * it), results/ (traces of failed tests, fake mode only), shots/ (one PNG per task). STRIPE=1 runs wait on Stripe's
 * servers (its frames, its hosted page, its 3D Secure page): a test gets four minutes instead of two. They keep no
 * trace either: a trace records Stripe's frames and requests, and those carry the publishable key.
 */
export default defineConfig({
  testDir: ".",
  testMatch: ["tasks.spec.ts"],
  fullyParallel: true,
  workers: Number(process.env.WORKERS) || 4,
  retries: 0,
  timeout: STRIPE ? 240_000 : 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  outputDir: join(OUT_DIR, "results"),
  reporter: [
    ["list"],
    ["html", { outputFolder: join(OUT_DIR, "report"), open: "never" }],
    ["json", { outputFile: join(OUT_DIR, "results.json") }],
  ],
  use: {
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: traceFor(STRIPE),
    screenshot: "off",
    video: "off",
  },
});
