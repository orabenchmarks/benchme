/**
 * Guards the one thing ask-eval cannot get wrong quietly: an arm whose answers
 * came from a DIFFERENT ranker than it asked for (the deployment booted
 * without ASK_RANKER_OVERRIDE, so every X-Ask-Ranker header was ignored).
 * Those numbers are real, but LABELLED with a ranker that did not produce
 * them — a mislabelled measurement is worse than a missing one, so the run
 * must fail rather than publish.
 *
 * Not part of the vitest workspace (that covers packages/* and apps/* only):
 *   node --test tools/ask-eval.test.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { after, test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const { evaluateArm } = await import("./ask-eval.mjs");

const QUERIES = [
  { query: "products in the fasteners category", relevant: ["/w/ws_1/warehouse/products/A"] },
  { query: "which products are low on stock", relevant: ["/w/ws_1/warehouse/products/B"] },
];

/** One /ask answer, attributed to `ranker` regardless of what was asked for. */
function askBody(ranker, url) {
  return { ranker, results: [{ url, score: 0.9, description: "x" }], usage: { costUsd: 0 } };
}

test("evaluateArm counts answers attributed to a different ranker than the arm asked for", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(askBody("lexical", QUERIES[0].relevant[0])), { headers: { "content-type": "application/json" } });
  try {
    const honest = await evaluateArm("http://stub/ask", "lexical", QUERIES);
    assert.equal(honest.rankerMismatch, undefined, "an arm answered by the ranker it asked for has no mismatch");
    assert.equal(honest.metrics.mismatch, 0);

    const ignored = await evaluateArm("http://stub/ask", "jev", QUERIES);
    assert.equal(ignored.rankerMismatch, QUERIES.length, "every jev answer actually came from lexical");
    assert.equal(ignored.metrics.mismatch, QUERIES.length);
  } finally {
    globalThis.fetch = original;
  }
});

/** A gateway stub that mints a workspace and always answers as `lexical`. */
async function stubGateway() {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/api/workspaces") {
      const apps = { warehouse: "", helpdesk: "", vaultdocs: "" };
      return res.end(JSON.stringify({ id: "ws_0123456789ab", seed: 4242, urls: { apps, ask: apps } }));
    }
    res.end(JSON.stringify(askBody("lexical", "/nope")));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const stub = await stubGateway();
after(() => stub.server.close());

test("the CLI exits non-zero when an arm's answers came from another ranker", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "ask-eval-")), "report");
  const child = spawn(process.execPath, [join(here, "ask-eval.mjs"), "--base", stub.base, "--rankers", "jev", "--out", out], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 1, `expected a failing exit, got ${code}\n${stderr}`);
  assert.match(stderr, /came back from a different ranker/);
});
