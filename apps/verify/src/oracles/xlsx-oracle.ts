import ExcelJS from "exceljs";
import type { z } from "zod";
import type { xlsxSpec } from "../specs/spec.js";
import { verdictOf, type CheckResult, type Oracle, type OracleResult } from "./oracle.js";

type Spec = z.infer<typeof xlsxSpec>;

function cellValue(cell: ExcelJS.Cell): { value: unknown; formula: string | null } {
  const v = cell.value;
  if (v && typeof v === "object" && "formula" in v) {
    const f = v as ExcelJS.CellFormulaValue;
    return { value: f.result ?? null, formula: f.formula };
  }
  if (v && typeof v === "object" && "sharedFormula" in v) {
    const f = v as ExcelJS.CellSharedFormulaValue;
    return { value: f.result ?? null, formula: f.sharedFormula };
  }
  if (v && typeof v === "object" && "richText" in v) return { value: (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join(""), formula: null };
  return { value: v, formula: null };
}

/** Real workbook parsing: sheets, cells, formulas, header rows, frozen panes. */
export class XlsxOracle implements Oracle<Spec> {
  readonly kind = "xlsx" as const;

  async check(artifact: Buffer, spec: Spec): Promise<OracleResult> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(artifact as unknown as ExcelJS.Buffer);
    } catch (err) {
      return { verdict: "FAIL", checks: [{ name: "parse", ok: false, note: `not a readable xlsx: ${(err as Error).message}` }] };
    }
    const checks: CheckResult[] = [{ name: "parse", ok: true }];
    for (const s of spec.sheets) {
      const ws = wb.getWorksheet(s.name);
      checks.push({ name: `sheet:${s.name}`, ok: !!ws, note: ws ? undefined : `missing sheet (have: ${wb.worksheets.map((w) => w.name).join(", ")})` });
      if (!ws) continue;
      if (s.headerRow) {
        const row = ws.getRow(1);
        const actual = s.headerRow.map((_, i) => String(cellValue(row.getCell(i + 1)).value ?? "").trim());
        const ok = actual.every((h, i) => h.toLowerCase() === (s.headerRow?.[i] ?? "").toLowerCase());
        checks.push({ name: `sheet:${s.name}:header`, ok, note: ok ? undefined : `expected ${JSON.stringify(s.headerRow)}, got ${JSON.stringify(actual)}` });
      }
      if (s.frozenHeader !== undefined) {
        const frozen = (ws.views ?? []).some((v) => v.state === "frozen" && (v.ySplit ?? 0) >= 1);
        checks.push({ name: `sheet:${s.name}:frozenHeader`, ok: frozen === s.frozenHeader, note: `frozen=${frozen}` });
      }
      for (const [addr, expected] of Object.entries(s.cells)) {
        const c = cellValue(ws.getCell(addr));
        const name = `sheet:${s.name}:${addr}`;
        if (typeof expected === "object" && "formula" in expected) {
          const ok = !!c.formula && c.formula.toUpperCase().includes(expected.formula.toUpperCase());
          checks.push({ name, ok, note: ok ? undefined : `expected a formula containing ${expected.formula}, got ${c.formula ?? "no formula"}` });
        } else if (typeof expected === "object") {
          const n = typeof c.value === "number" ? c.value : Number(c.value);
          const ok = Number.isFinite(n) && Math.abs(n - expected.value) <= expected.tolerance;
          checks.push({ name, ok, note: ok ? undefined : `expected ${expected.value}±${expected.tolerance}, got ${JSON.stringify(c.value)}` });
        } else if (typeof expected === "number") {
          const n = typeof c.value === "number" ? c.value : Number(c.value);
          const ok = Number.isFinite(n) && n === expected;
          checks.push({ name, ok, note: ok ? undefined : `expected ${expected}, got ${JSON.stringify(c.value)}` });
        } else {
          const ok = String(c.value ?? "").trim().toLowerCase() === expected.trim().toLowerCase();
          checks.push({ name, ok, note: ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(c.value)}` });
        }
      }
    }
    return { verdict: verdictOf(checks), checks };
  }
}
