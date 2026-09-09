import { HmacReceiptSigner, WORKSPACE_HEADER, WORKSPACE_SIG_HEADER, createPool, migrate, newWorkspaceId, parseReceipt, signWorkspaceHeader, type Pool } from "@benchme/core";
import ExcelJS from "exceljs";
import type { FastifyInstance, InjectOptions } from "fastify";
import JSZip from "jszip";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildVerify } from "./build-app.js";
import type { JobRunner, RunnerReport } from "./oracles/patch-oracle.js";
import { MemorySpecRegistry } from "./specs/spec.js";

const DB = process.env.DATABASE_URL;
const SECRET = "gateway-secret-for-tests";
const here = dirname(fileURLToPath(import.meta.url));

/** A stand-in runner: applies iff the patch mentions "fix", passes tests named in it. */
class StubRunner implements JobRunner {
  calls = 0;
  async run({ patch }: Parameters<JobRunner["run"]>[0]): Promise<RunnerReport> {
    this.calls++;
    const text = patch.toString("utf8");
    if (text.includes("BROKEN")) return { applied: false, tests: [], error: "hunk failed" };
    return { applied: true, tests: [{ id: "pagination", ok: text.includes("+  page") }, { id: "status", ok: true }], lint: !text.includes("var "), typecheck: true };
  }
}

const specs = new MemorySpecRegistry([
  { id: "calc-easy-01", blind: false, oracle: { kind: "json", expect: { answer: { value: 500500, tolerance: 0 }, unit: "count" } } },
  { id: "doc-xlsx-01", blind: false, oracle: { kind: "xlsx", sheets: [{ name: "Sales", headerRow: ["Region", "Amount"], cells: { B4: { formula: "SUM(" }, A1: "Region" }, frozenHeader: true }] } },
  { id: "doc-docx-01", blind: false, oracle: { kind: "docx", contains: ["quarterly summary"], headings: ["Results"], minTables: 1, minParagraphs: 3 } },
  { id: "code-easy-01", blind: false, oracle: { kind: "patch", runnerImage: "stub", baseSha: "abc", requiredTests: ["pagination", "status"], lint: true, typecheck: true, timeoutSeconds: 60 } },
  { id: "code-hard-01", blind: true, oracle: { kind: "patch", runnerImage: "stub", baseSha: "abc", requiredTests: [], lint: true, typecheck: true, timeoutSeconds: 60 } },
]);

let pool: Pool;
let app: FastifyInstance;
let ws: string;
const runner = new StubRunner();
const signer = new HmacReceiptSigner("receipt-secret-for-tests");
const scoped = (o: InjectOptions & { url: string }): InjectOptions => ({
  ...o,
  headers: { ...(o.headers ?? {}), [WORKSPACE_HEADER]: ws, [WORKSPACE_SIG_HEADER]: signWorkspaceHeader(SECRET, ws), "x-forwarded-prefix": `/w/${ws}/verify` },
});
const submit = (taskId: string, body: Buffer | string, contentType = "application/octet-stream") =>
  app.inject(scoped({ method: "POST", url: `/v1/submit/${taskId}`, payload: body, headers: { "content-type": contentType } }));

async function xlsx(opts: { sum: boolean; frozen: boolean }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet("Sales", opts.frozen ? { views: [{ state: "frozen", ySplit: 1 }] } : {});
  s.addRow(["Region", "Amount"]);
  s.addRow(["North", 10]);
  s.addRow(["South", 32]);
  s.getCell("B4").value = opts.sum ? { formula: "SUM(B2:B3)", result: 42 } : 42;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function docx(opts: { heading: boolean; table: boolean }): Promise<Buffer> {
  const p = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const body = [p("Results", opts.heading ? "Heading1" : undefined), p("This is the quarterly summary for the board."), p("Revenue grew."), opts.table ? "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" : "", p("Regards.")].join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

beforeAll(async () => {
  if (!DB) return;
  pool = createPool(DB, 4);
  await migrate(pool, "core", join(here, "..", "..", "gateway", "migrations"));
  await migrate(pool, "verify", join(here, "..", "migrations"));
  app = (await buildVerify({ pool, specs, receipts: signer, runner, gatewaySecret: SECRET, maxAttemptsPerTask: 3, maxArtifactBytes: 1024 * 1024, logLevel: "silent" })).app;
  ws = newWorkspaceId();
  await pool.query("INSERT INTO core.workspaces (id, scenario, seed, expires_at) VALUES ($1, 'acme-v1', 1, now() + interval '1 hour')", [ws]);
});
afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe.skipIf(!DB)("verifier (real Postgres, real xlsx/docx)", () => {
  it("json: right answer → OK receipt that verifies against the log; wrong → FAIL naming the field", async () => {
    const ok = await submit("calc-easy-01", JSON.stringify({ answer: 500500, unit: "Count" }), "application/json");
    expect(ok.statusCode).toBe(200);
    expect(ok.json().verdict).toBe("OK");
    expect(ok.json().receipt).toMatch(/^RCPT-calc-easy-01-OK-[0-9a-f]{12}$/);
    const row = (await pool.query("SELECT nonce, ts FROM core.receipts WHERE receipt = $1", [ok.json().receipt])).rows[0] as { nonce: string; ts: string };
    expect(signer.verify(ok.json().receipt, row.nonce, Number(row.ts))).toBe(true);
    const bad = await submit("calc-easy-01", JSON.stringify({ answer: 500501, unit: "count" }), "application/json");
    expect(bad.json().verdict).toBe("FAIL");
    expect(bad.json().details.find((d: { name: string }) => d.name === "answer").ok).toBe(false);
    expect(parseReceipt(bad.json().receipt)?.verdict).toBe("FAIL");
    expect((await submit("nope-01", "{}", "application/json")).statusCode).toBe(404);
  });

  it("xlsx: real workbook parsing — formula, header, frozen pane; each defect names its check", async () => {
    const good = await submit("doc-xlsx-01", await xlsx({ sum: true, frozen: true }));
    expect(good.json().verdict).toBe("OK");
    const noFormula = await submit("doc-xlsx-01", await xlsx({ sum: false, frozen: true }));
    expect(noFormula.json().verdict).toBe("FAIL");
    expect(noFormula.json().details.filter((d: { ok: boolean }) => !d.ok).map((d: { name: string }) => d.name)).toEqual(["sheet:Sales:B4"]);
    const notFrozen = await submit("doc-xlsx-01", await xlsx({ sum: true, frozen: false }));
    expect(notFrozen.json().details.filter((d: { ok: boolean }) => !d.ok).map((d: { name: string }) => d.name)).toEqual(["sheet:Sales:frozenHeader"]);
    // 3 attempts used → the 4th is refused
    expect((await submit("doc-xlsx-01", await xlsx({ sum: true, frozen: true }))).statusCode).toBe(429);
  });

  it("docx: headings, text and tables from the OOXML body", async () => {
    expect((await submit("doc-docx-01", await docx({ heading: true, table: true }))).json().verdict).toBe("OK");
    const noHeading = await submit("doc-docx-01", await docx({ heading: false, table: true }));
    expect(noHeading.json().details.filter((d: { ok: boolean }) => !d.ok).map((d: { name: string }) => d.name)).toEqual(["heading:Results"]);
    const garbage = await submit("doc-docx-01", Buffer.from("not a zip"));
    expect(garbage.json().verdict).toBe("FAIL");
    expect(garbage.json().details[0].name).toBe("parse");
  });

  it("patch: runs the runner, requires the named tests + lint + typecheck; blind specs report counts only", async () => {
    const goodPatch = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-  page = 0\n+  page = 1 // fix\n";
    const ok = await submit("code-easy-01", goodPatch, "text/x-diff");
    expect(ok.json().verdict).toBe("OK");
    expect(ok.json().details.map((d: { name: string }) => d.name)).toEqual(["applied", "test:pagination", "test:status", "lint", "typecheck"]);
    const lintFail = await submit("code-easy-01", goodPatch.replace("page = 1", "var page = 1"), "text/x-diff");
    expect(lintFail.json().verdict).toBe("FAIL");
    expect(lintFail.json().details.find((d: { name: string }) => d.name === "lint").ok).toBe(false);
    const broken = await submit("code-easy-01", "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-BROKEN\n+BROKEN\n", "text/x-diff");
    expect(broken.json().details[0]).toMatchObject({ name: "applied", ok: false });
    const notDiff = await submit("code-easy-01", "hello", "text/plain");
    expect(notDiff.statusCode).toBe(429); // attempts exhausted for this task (3)
    const blind = await submit("code-hard-01", goodPatch.replace("+  page = 1", "+  nope"), "text/x-diff");
    expect(blind.json().verdict).toBe("FAIL");
    expect(blind.json().details).toEqual([{ passed: 4, failed: 1 }]);
    expect(runner.calls).toBeGreaterThanOrEqual(4);
    const attempts = (await app.inject(scoped({ url: "/v1/attempts/code-easy-01" }))).json();
    expect(attempts).toHaveLength(3);
  });
});
