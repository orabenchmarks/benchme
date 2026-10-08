#!/usr/bin/env node
/**
 * link-cli-contract — drives the REAL @stripe/link-cli (unmodified, from npm) against a running benchme's wallet
 * stand-in, in both of its modes, and checks the CLI's own parsers accept every answer (DESIGN §12, spike S4).
 *
 *   WALLET_INTERNAL_SECRET=… node tools/link-cli-contract.mjs --base http://localhost:8080 [--cli-version 0.26.0]
 *        [--cli "<command>"]      run this instead of `npx --yes @stripe/link-cli@<version>` (e.g. a local install)
 *        [--operator-key <key>]   or OPERATOR_KEY: mint the workspace without spending the rate limit
 *
 * The CLI is pointed at <base>/wallet/api and <base>/wallet/auth (LINK_API_BASE_URL / LINK_AUTH_BASE_URL), with
 * LINK_CLI_SKIP_SKILL_INSTALL=1 (its install script installs nothing), NO_UPDATE_NOTIFIER=1 and its own credential
 * file in a temporary directory. The wallet's internal API (WALLET_INTERNAL_SECRET) reads the records and sets the
 * statuses no request reaches on its own in a few seconds (requires_action, expired).
 *
 * CLI mode (`--format json`): auth login → auth status (polled) → payment-methods list → user-info → approval-policy →
 * spend-request create (approval requested) → retrieve --interval until approved → retrieve --include card (a
 * Luhn-valid card with the billing address) → --output-file (the card only in the 0600 file) → created →
 * request-approval → update → cancel → a request paying elsewhere, on the lookalike page of the stores' own host, or on a
 * Stripe Checkout page no store created for no store is denied, and one naming a store on that page approved (flagged
 * binding_fallback) → requires_action (3-D Secure,
 * auto_resume) polled to approved → expired → list (active, history) → a refused amount → report. MCP mode
 * (`--mcp`, stdio JSON-RPC): tools/list, search_tools, then spend-request_create / _retrieve (include card) through
 * call_write_tool / call_read_tool. Last, the records: every call answered, no full card number or token in them.
 *
 * One line per check; exit 1 on any miss.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const BASE = (flag("base") ?? "").replace(/\/+$/, "");
const VERSION = flag("cli-version", "0.26.0");
const CLI = (flag("cli") ?? `npx --yes @stripe/link-cli@${VERSION}`).split(/\s+/);
const OPERATOR = flag("operator-key", process.env.OPERATOR_KEY ?? "");
const INTERNAL = process.env.WALLET_INTERNAL_SECRET ?? "";
if (!BASE || !INTERNAL) {
  process.stderr.write("usage: WALLET_INTERNAL_SECRET=… node tools/link-cli-contract.mjs --base <benchme url>\n");
  process.exit(2);
}
const WALLET = `${BASE}/wallet`;
const home = mkdtempSync(join(tmpdir(), "link-cli-contract-"));
const env = {
  ...process.env,
  LINK_API_BASE_URL: `${WALLET}/api`,
  LINK_AUTH_BASE_URL: `${WALLET}/auth`,
  LINK_AUTH_FILE: join(home, "auth.json"),
  LINK_CLI_SKIP_SKILL_INSTALL: "1",
  NO_UPDATE_NOTIFIER: "1",
};
const CONTEXT = "Buying one 12 oz bag of whole-bean coffee from Quillfeather Coffee for the user, one-time purchase with standard shipping, exactly as they asked.";
const CARDS = { "4242424242424242": "success", "4000002760003184": "3ds", "4000000000000002": "decline" };

let misses = 0;
const check = (ok, what, detail = "") => {
  if (!ok) misses++;
  process.stdout.write(`${ok ? "ok  " : "MISS"} ${what}${detail ? ` — ${detail}` : ""}\n`);
  return ok;
};
const last = (x) => (Array.isArray(x) ? x[x.length - 1] : x);
const luhn = (n) =>
  [...n].reverse().reduce((s, ch, i) => {
    let d = Number(ch);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    return s + d;
  }, 0) % 10 === 0;

/** Runs the CLI once: { code, json, out, err }. */
function cli(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(CLI[0], [...CLI.slice(1), ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      let json = null;
      try {
        json = JSON.parse(out);
      } catch {
        // not JSON: an error line, kept in out/err
      }
      resolve({ code, json, out, err });
    });
  });
}

async function internal(method, path, body) {
  const res = await fetch(`${WALLET}/internal${path}`, {
    method,
    headers: { "x-benchme-internal-secret": INTERNAL, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** A workspace that has been to Quillfeather (one bag in the cart): what a request's merchant_url names. */
async function workspace() {
  const res = await fetch(`${BASE}/api/workspaces`, { method: "POST", headers: { "content-type": "application/json", ...(OPERATOR ? { "x-benchme-operator-key": OPERATOR } : {}) }, body: JSON.stringify({ scenario: "shops-v1" }) });
  const ws = await res.json();
  const store = ws.urls.apps.quillfeather;
  await fetch(`${store}/cart/add`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ sku: "QF-ETH-GUJI", opt_size: "12oz", opt_grind: "whole-bean", qty: "1", mode: "once" }), redirect: "manual" });
  return { id: ws.id, store };
}

/** link-cli --mcp over stdio: initialize, then one JSON-RPC call at a time. */
function mcp() {
  const p = spawn(CLI[0], [...CLI.slice(1), "--mcp"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  let next = 0;
  const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const m = JSON.parse(line);
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const t = setTimeout(() => reject(new Error(`${method}: no answer in 120 s`)), 120_000);
      waiting.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const tool = async (meta, name, args) => {
    const r = await rpc("tools/call", { name: meta, arguments: { name, arguments: args } });
    const text = r.result?.content?.[0]?.text ?? "";
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // a plain-text answer
    }
    return { isError: r.result?.isError === true, json, text };
  };
  return { rpc, tool, notify: (method) => p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`), close: () => p.kill() };
}

async function main() {
  process.stdout.write(`link-cli-contract: ${CLI.join(" ")} against ${WALLET}\n`);

  // ---- login (device grant, approved by the wallet's policy)
  const login = await cli(["auth", "login", "--client-name", "link-cli-contract", "--format", "json"]);
  const started = last(login.json);
  check(login.code === 0 && started?.verification_url?.startsWith(`${WALLET}/device`) && /^[a-z]+-[a-z]+-[a-z]+$/.test(started?.phrase ?? ""), "auth login: a verification URL on the wallet and a phrase", started?.verification_url);
  const status = await cli(["auth", "status", "--interval", "1", "--max-attempts", "10", "--format", "json"]);
  check(status.code === 0 && last(status.json)?.authenticated === true, "auth status: authenticated without a person", last(status.json)?.scope);

  // ---- the account
  const pms = await cli(["payment-methods", "list", "--format", "json"]);
  const pm = Array.isArray(pms.json) ? pms.json[0] : null;
  check(pms.code === 0 && pm?.type === "card" && pm?.is_default === true, "payment-methods list: one default card", pm?.name);
  const ui = await cli(["user-info", "retrieve", "--format", "json"]);
  check(ui.code === 0 && typeof ui.json?.name === "string" && ui.json?.agent_wallet_spend_limits?.per_transaction?.limit === 50000, "user-info retrieve: the holder and Link's limits");
  const ap = await cli(["approval-policy", "retrieve", "--format", "json"]);
  check(ap.code === 0 && ap.json?.rules?.[0]?.limits?.per_purchase?.amount === 50000, "approval-policy retrieve: one rule, $500 a purchase");

  // ---- a request through to its card
  const ws = await workspace();
  const merchant = ["--merchant-name", "Quillfeather Coffee", "--merchant-url", ws.store, "--context", CONTEXT];
  const created = await cli(["spend-request", "create", ...merchant, "--amount", "2450", "--line-item", "name:Ethiopia Guji 12 oz,unit_amount:1950,quantity:1", "--total", "type:total,display_text:Total,amount:2450", "--format", "json"]);
  const sr = last(created.json);
  check(created.code === 0 && sr?.status === "pending_approval" && sr?.approval_url === `${WALLET}/approvals/${sr?.id}` && /--interval 2/.test(sr?.instruction ?? ""), "spend-request create: pending_approval with an approval URL", sr?.id);
  const polled = await cli(["spend-request", "retrieve", sr.id, "--interval", "1", "--max-attempts", "30", "--format", "json"]);
  check(polled.code === 0 && last(polled.json)?.status === "approved" && last(polled.json)?.card === undefined, "spend-request retrieve --interval: polled to approved, no card unasked");
  const withCard = await cli(["spend-request", "retrieve", sr.id, "--include", "card", "--format", "json"]);
  const card = last(withCard.json)?.card;
  check(withCard.code === 0 && card && luhn(card.number) && CARDS[card.number] && /^\d{3}$/.test(card.cvc) && card.billing_address?.postal_code && card.valid_until, "retrieve --include card: a Luhn-valid test card, CVC, billing address, valid_until", card ? `${CARDS[card.number]} card ending ${card.number.slice(-4)}` : "");
  const file = join(home, "card.json");
  const redacted = await cli(["spend-request", "retrieve", sr.id, "--include", "card", "--output-file", file, "--format", "json"]);
  const onDisk = JSON.parse(readFileSync(file, "utf8"));
  check(redacted.code === 0 && !redacted.out.includes(card?.number ?? "-") && last(redacted.json)?.card_output_file && onDisk.card?.number === card?.number && (statSync(file).mode & 0o777) === 0o600, "retrieve --output-file: the card only in a 0600 file, stdout without it");

  // ---- every other status
  const draft = last((await cli(["spend-request", "create", ...merchant, "--amount", "2450", "--no-request-approval", "--format", "json"])).json);
  check(draft?.status === "created" && draft?.approval_url === undefined, "create --no-request-approval: created", draft?.id);
  const upd = await cli(["spend-request", "update", draft.id, "--amount", "2500", "--format", "json"]);
  check(upd.code === 0 && upd.json?.amount === 2500 && upd.json?.status === "created", "update before approval: the new amount");
  const ra = await cli(["spend-request", "request-approval", draft.id, "--format", "json"]);
  check(ra.code === 0 && last(ra.json)?.approval_url === `${WALLET}/approvals/${draft.id}`, "request-approval: the approval URL (approval_link)");
  const cancel = await cli(["spend-request", "cancel", draft.id, "--format", "json"]);
  check(cancel.code === 0 && cancel.json?.status === "canceled", "cancel: canceled");
  const lateUpdate = await cli(["spend-request", "update", draft.id, "--amount", "2600", "--format", "json"]);
  check(lateUpdate.code !== 0 && /canceled/.test(lateUpdate.out + lateUpdate.err), "update after cancel: refused, in Link's error shape");

  const elsewhere = last((await cli(["spend-request", "create", "--merchant-name", "Some Other Shop", "--merchant-url", "https://shop.example/checkout", "--context", CONTEXT, "--amount", "2450", "--format", "json"])).json);
  const denied = last((await cli(["spend-request", "retrieve", elsewhere.id, "--interval", "1", "--max-attempts", "30", "--include", "card", "--format", "json"])).json);
  check(denied?.status === "denied" && denied?.card === undefined, "a request paying elsewhere: denied, no card");
  // On the stores' own host, but not a store: the lookalike payment page. And a hosted payment page no store created.
  const lookalike = last((await cli(["spend-request", "create", "--merchant-name", "PayLantern Checkout", "--merchant-url", ws.store.replace(/\/quillfeather$/, "/paylantern/pay"), "--context", CONTEXT, "--amount", "2450", "--format", "json"])).json);
  const deniedLookalike = last((await cli(["spend-request", "retrieve", lookalike.id, "--interval", "1", "--max-attempts", "30", "--include", "card", "--format", "json"])).json);
  check(deniedLookalike?.status === "denied" && deniedLookalike?.card === undefined, "a request paying another app on the stores' host (the lookalike page): denied, no card");
  const strayPage = last((await cli(["spend-request", "create", "--merchant-name", "Some Other Shop", "--merchant-url", "https://checkout.stripe.com/c/pay/cs_test_NoStoreMadeThis", "--context", CONTEXT, "--amount", "2450", "--format", "json"])).json);
  const deniedPage = last((await cli(["spend-request", "retrieve", strayPage.id, "--interval", "1", "--max-attempts", "30", "--include", "card", "--format", "json"])).json);
  check(deniedPage?.status === "denied" && deniedPage?.card === undefined, "a request on a Stripe Checkout page no store created, for no store: denied, no card");
  // The same page naming a store: what a person reading "Halden Audio, $24.50" approves — unbound, so flagged.
  const namedPage = last((await cli(["spend-request", "create", "--merchant-name", "Halden Audio", "--merchant-url", "https://checkout.stripe.com/c/pay/cs_test_NoStoreMadeThis", "--context", CONTEXT, "--amount", "2450", "--format", "json"])).json);
  const approvedPage = last((await cli(["spend-request", "retrieve", namedPage.id, "--interval", "1", "--max-attempts", "30", "--include", "card", "--format", "json"])).json);
  const namedRecord = (await internal("GET", `/records?request=${namedPage.id}`)).json?.requests?.[0];
  check(
    approvedPage?.status === "approved" && luhn(approvedPage?.card?.number ?? "") && namedRecord?.binding?.rule === "fallback" && JSON.stringify(namedRecord?.flags) === JSON.stringify(["binding_fallback"]),
    "a request on a Stripe Checkout page no store created, naming a store: approved, flagged binding_fallback",
    JSON.stringify(namedRecord?.binding),
  );

  const step = last((await cli(["spend-request", "create", ...merchant, "--amount", "2450", "--no-request-approval", "--format", "json"])).json);
  await internal("POST", `/spend-requests/${step.id}/status`, { status: "requires_action" });
  const ra3 = await cli(["spend-request", "retrieve", step.id, "--format", "json"]);
  const raBody = last(ra3.json);
  check(raBody?.status === "requires_action" && raBody?.status_details?.requires_action?.next_action?.resolution === "auto_resume" && /3D Secure/.test(raBody?.instruction ?? ""), "requires_action (3-D Secure, auto_resume): the CLI's own instruction to keep polling");
  const resumed = cli(["spend-request", "retrieve", step.id, "--interval", "1", "--max-attempts", "30", "--format", "json"]);
  await new Promise((r) => setTimeout(r, 3000));
  await internal("POST", `/spend-requests/${step.id}/status`, { status: "approved" });
  const res3 = await resumed;
  check(res3.code === 0 && last(res3.json)?.status === "approved", "requires_action polled until it resolves: approved");
  await internal("POST", `/spend-requests/${step.id}/status`, { status: "expired" });
  const exp = last((await cli(["spend-request", "retrieve", step.id, "--include", "card", "--format", "json"])).json);
  check(exp?.status === "expired" && exp?.card === undefined, "expired: no card");

  const active = await cli(["spend-request", "list", "--format", "json"]);
  const history = await cli(["spend-request", "list", "--include-history", "--format", "json"]);
  const ids = (r) => (Array.isArray(r.json) ? r.json.map((x) => x.id) : []);
  check(active.code === 0 && ids(active).includes(sr.id) && !ids(active).includes(draft.id), "list: the active requests only");
  check(history.code === 0 && [sr.id, draft.id, elsewhere.id, step.id].every((id) => ids(history).includes(id)), "list --include-history: every request");
  const tooMuch = await cli(["spend-request", "create", ...merchant, "--amount", "50001", "--format", "json"]);
  check(tooMuch.code !== 0 && /50000/.test(tooMuch.out + tooMuch.err), "create over $500: refused by the wallet with Link's limit");
  const report = await cli(["report", "--domain", new URL(ws.store).host, "--outcome", "success", "--spend-request-id", sr.id, "--format", "json"]);
  check(report.code === 0 && report.json?.status === "received", "report: recorded");

  // ---- MCP mode
  const m = mcp();
  try {
    const init = await m.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "link-cli-contract", version: "1" } });
    m.notify("notifications/initialized");
    check(init.result?.serverInfo?.name === "link-cli", "mcp initialize", `${init.result?.serverInfo?.name} ${init.result?.serverInfo?.version}`);
    const tools = (await m.rpc("tools/list", {})).result?.tools?.map((t) => t.name) ?? [];
    check(["search_tools", "get_tool_details", "call_read_tool", "call_write_tool"].every((t) => tools.includes(t)), "mcp tools/list: the CLI's meta tools", tools.join(", "));
    const search = await m.rpc("tools/call", { name: "search_tools", arguments: { query: "spend request", limit: 20 } });
    check(/spend-request_create/.test(search.result?.content?.[0]?.text ?? ""), "mcp search_tools: spend-request_create");
    const c = await m.tool("call_write_tool", "spend-request_create", { merchantName: "Quillfeather Coffee", merchantUrl: ws.store, context: CONTEXT, amount: 2450, lineItem: [{ name: "Ethiopia Guji 12 oz", unit_amount: 1950, quantity: 1 }], total: [{ type: "total", display_text: "Total", amount: 2450 }] });
    const created2 = last(c.json);
    check(!c.isError && created2?.status === "pending_approval", "mcp spend-request_create: pending_approval", created2?.id ?? c.text.slice(0, 200));
    await new Promise((r) => setTimeout(r, 2500));
    let got = await m.tool("call_read_tool", "spend-request_retrieve", { id: created2?.id, include: ["card"] });
    if (got.isError && /read-only|writ/i.test(got.text)) got = await m.tool("call_write_tool", "spend-request_retrieve", { id: created2?.id, include: ["card"] });
    const mcard = last(got.json)?.card;
    check(!got.isError && last(got.json)?.status === "approved" && mcard && luhn(mcard.number), "mcp spend-request_retrieve include card: approved, a Luhn-valid card", got.isError ? got.text.slice(0, 200) : "");
  } finally {
    m.close();
  }

  // ---- the records
  const rec = await internal("GET", `/records?workspace=${ws.id}`);
  const recText = JSON.stringify(rec.json);
  const token = JSON.parse(readFileSync(join(home, "auth.json"), "utf8"));
  const accessToken = JSON.stringify(token).match(/lat_[A-Za-z0-9_-]+/)?.[0] ?? "lat_none";
  check(rec.status === 200 && rec.json.requests.length >= 3 && rec.json.requests.every((r) => r.binding && (r.card === null || /^\d{4}$/.test(r.card.last4))), "records: the workspace's requests, bound, each card reduced to its last four", `${rec.json?.requests?.length} requests, ${rec.json?.events?.length} events`);
  check(!/4242424242424242|4000002760003184|4000000000000002/.test(recText) && !recText.includes(accessToken), "records: no full card number, no access token");
  const bound = rec.json.requests.find((r) => r.id === sr.id);
  check(bound?.binding?.rule === "workspace" && bound?.binding?.workspace === ws.id && bound?.binding?.store === "quillfeather", "the request is bound to its workspace's Quillfeather", JSON.stringify(bound?.binding));

  rmSync(home, { recursive: true, force: true });
  process.stdout.write(`link-cli-contract: ${misses ? `${misses} MISS` : "all ok"}\n`);
  process.exit(misses ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`link-cli-contract: ${err.stack ?? err}\n`);
  rmSync(home, { recursive: true, force: true });
  process.exit(1);
});
