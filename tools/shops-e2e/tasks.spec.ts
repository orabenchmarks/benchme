/**
 * Every hidden store task, end to end in a real browser: one test per task (benchme-hidden/shops/<ID>/)
 * mints its own shops-v1 workspace, opens the store with the task's campaign code, takes the run's steps
 * through the pages as a shopper would (lib/shopper.ts), and reads the outcome where a shopper reads it:
 * the confirmation page's order number — its prefix the store's, its suffix the one the stores' key gives
 * the class the run expects — or, when the run must end without an order, no order page and a page that
 * says why. A full-page screenshot of where each test ended goes to $OUT_DIR/shots/<ID>.png.
 *
 * With STRIPE=1 the stack pays with Stripe test keys and the runs pay through Stripe's own surfaces: the
 * Payment Element's frame, the hosted page on checkout.stripe.com, Stripe's 3D Secure test page. Each test
 * attaches run.json (its workspace, cards and orders) for stripe-ledger.mjs, which looks the payments up in Stripe.
 *
 * With WALLET=1 every card comes from the stack's wallet stand-in through the real @stripe/link-cli (lib/link-wallet.ts):
 * approved for what the run pays, or — a run that keeps its approval — for less.
 *
 * Environment: HIDDEN_DIR, BASE_URL, OPERATOR_KEY, SUFFIX_KEY; optional ONLY=ID,ID, RUN=wrong, ENTRY=slash,
 * STRIPE=1, WALLET=1 (WALLET_CLI), OUT_DIR, WORKERS (README.md). Nothing a task holds is written into this repository: the tasks are
 * read at run time, and every output goes to OUT_DIR.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { STORES } from "./lib/benchme.js";
import { OUT_DIR, readEnv } from "./lib/env.js";
import { loadTasks, type Run, type Task } from "./lib/hidden.js";
import { LinkWallet } from "./lib/link-wallet.js";
import { describeStep, Shopper } from "./lib/shopper.js";
import { runRecord } from "./lib/stripe.js";
import { mintWorkspace, type Workspace } from "./lib/workspace.js";

const env = readEnv();
const all = loadTasks(env.hiddenDir);
const unknown = (env.only ?? []).filter((id) => !all.some((t) => t.id === id));
if (unknown.length) throw new Error(`ONLY names no task: ${unknown.join(", ")} (tasks: ${all.map((t) => t.id).join(", ")})`);
const tasks = env.only ? all.filter((t) => env.only?.includes(t.id)) : all;

const SHOTS = join(OUT_DIR, "shots");
mkdirSync(SHOTS, { recursive: true });
const shotOf = (id: string) => join(SHOTS, `${id}${env.run === "wrong" ? "-wrong" : ""}.png`);

/** The run to take and the class its order must have ("none": no order may exist). */
function planOf(task: Task): { run: Run; cls: string } {
  if (env.run === "reference") return { run: task.reference, cls: task.reference.expectClass };
  // A mistake that only the wallet can see (paying more than was approved) is graded by the store alone like the
  // reference — unless WALLET=1, where the store reads the approval the run kept.
  const walletOnly = task.wrong.deferred !== undefined || (!env.wallet && task.wrong.steps.some((st) => "pay" in st && st.pay.keepApproval === true));
  return { run: task.wrong, cls: walletOnly ? task.reference.expectClass : task.wrong.expectClass };
}

test.describe.configure({ mode: "parallel" });

test.afterEach(async ({ page }, info) => {
  const id = info.title.split(" ")[0] as string;
  const path = shotOf(id);
  try {
    await page.screenshot({ path, fullPage: true, timeout: 30_000 });
    await info.attach("where the test ended", { path, contentType: "image/png" });
  } catch (err) {
    console.error(`${id}: no screenshot (${(err as Error).message.split("\n")[0]})`);
  }
});

for (const task of tasks) {
  const { run, cls } = planOf(task);
  const s = task.scenario;
  test(`${task.id} ${s.store} ${s.tier}${env.run === "wrong" ? " (wrong run)" : ""}${env.stripe ? " [Stripe]" : ""}${env.wallet ? " [wallet]" : ""}`, async ({ page }, info) => {
    const store = STORES[s.store];
    if (!store) throw new Error(`no catalogue for ${s.store}`);
    const log: string[] = [];
    // A script that throws or a page that answers 5xx is a store bug even when the run still gets through
    // (the stack's pages only: Stripe's own pages and frames are not the store's).
    const stack = new URL(env.baseUrl).origin;
    const ours = (url: string) => URL.canParse(url) && new URL(url).origin === stack;
    const broken: string[] = [];
    page.on("pageerror", (err) => {
      if (ours(page.url())) broken.push(`uncaught error on ${page.url()}: ${err.message}`);
      else log.push(`uncaught error on ${page.url()} (not the store's page): ${err.message}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 500 && ours(res.url())) broken.push(`${res.status()} from ${res.request().method()} ${res.url()}`);
    });
    page.on("console", (m) => {
      if (m.type() === "error") log.push(`console error on ${page.url()}: ${m.text()}`);
    });
    let ws: Workspace | null = null;
    let shopper: Shopper | null = null;
    const wallet = env.wallet ? new LinkWallet({ walletUrl: `${env.baseUrl}/wallet`, cli: env.walletCli, log: (line) => log.push(line) }) : null;
    try {
      ws = await mintWorkspace(env.baseUrl, env.operatorKey);
      const storeUrl = ws.apps[s.store];
      if (!storeUrl) throw new Error(`workspace ${ws.id} lists no ${s.store} in urls.apps (${Object.keys(ws.apps).join(", ")})`);
      log.push(`workspace ${ws.id}`);
      const sh = new Shopper(page, { scenario: s, store, storeUrl, stripe: env.stripe, wallet, log: (line) => log.push(line) });
      shopper = sh;
      // As the prompt says: urls.apps.<store>, as the gateway gave it, with ?utm_campaign=<code> appended
      // (ENTRY=slash: with exactly one "/" before the "?").
      const at = env.entry === "slash" ? `${storeUrl.replace(/\/+$/, "")}/` : storeUrl;
      const entry = `${at}?utm_campaign=${encodeURIComponent(s.campaign)}`;
      await test.step("open the store with the campaign code", () => sh.enter(entry));
      for (const [i, step] of run.steps.entries()) {
        await test.step(`${i + 1}. ${describeStep(step)}`, () => sh.step(step));
      }
      if (cls === "none") await test.step("no order, and the page says why", () => sh.expectNoOrder());
      else await test.step(`an order of class ${cls}`, () => sh.expectOrder(cls, env.suffixKey));
      expect(broken, "the store's pages threw an error or answered 5xx").toEqual([]);
      expect(sh.problems, "the store's payment surfaces offer only what the store takes").toEqual([]);
    } finally {
      wallet?.close();
      log.push(...broken, ...(shopper?.problems ?? []).map((p) => `store problem: ${p}`));
      await info.attach("shopper.log", { body: log.join("\n"), contentType: "text/plain" });
      // For stripe-ledger.mjs (it reads results.json): where this run's payments are, never a card number or a key.
      const record = runRecord({
        task: task.id,
        run: env.run,
        stripe: env.stripe,
        store: s.store,
        workspace: ws?.id ?? null,
        storeUrl: ws?.apps[s.store] ?? null,
        expectClass: cls,
        cards: shopper?.cards ?? [],
        orders: shopper?.orders ?? [],
      });
      await info.attach("run.json", { body: JSON.stringify(record), contentType: "application/json" });
    }
  });
}
