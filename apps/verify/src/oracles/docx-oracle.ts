import JSZip from "jszip";
import type { z } from "zod";
import type { docxSpec } from "../specs/spec.js";
import { verdictOf, type CheckResult, type Oracle, type OracleResult } from "./oracle.js";

type Spec = z.infer<typeof docxSpec>;

type Paragraph = { text: string; style: string | null };

/** Minimal OOXML reading: paragraphs with their style ids, and table count, from word/document.xml. */
export function parseDocument(xml: string): { paragraphs: Paragraph[]; tables: number } {
  const paragraphs: Paragraph[] = [];
  const pRe = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  for (const m of xml.match(pRe) ?? []) {
    const style = /<w:pStyle w:val="([^"]+)"/.exec(m)?.[1] ?? null;
    const text = (m.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? [])
      .map((t) => t.replace(/<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>/, ""))
      .join("")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    paragraphs.push({ text, style });
  }
  const tables = (xml.match(/<w:tbl[\s>]/g) ?? []).length;
  return { paragraphs, tables };
}

const isHeading = (style: string | null) => !!style && /^heading\d$/i.test(style.replace(/\s+/g, ""));

export class DocxOracle implements Oracle<Spec> {
  readonly kind = "docx" as const;

  async check(artifact: Buffer, spec: Spec): Promise<OracleResult> {
    let xml: string;
    try {
      const zip = await JSZip.loadAsync(artifact);
      const doc = zip.file("word/document.xml");
      if (!doc) throw new Error("word/document.xml missing");
      xml = await doc.async("string");
    } catch (err) {
      return { verdict: "FAIL", checks: [{ name: "parse", ok: false, note: `not a readable docx: ${(err as Error).message}` }] };
    }
    const { paragraphs, tables } = parseDocument(xml);
    const checks: CheckResult[] = [{ name: "parse", ok: true }];
    const nonEmpty = paragraphs.filter((p) => p.text.trim().length > 0);
    checks.push({ name: "paragraphs", ok: nonEmpty.length >= spec.minParagraphs, note: `${nonEmpty.length} non-empty paragraphs, need ${spec.minParagraphs}` });
    checks.push({ name: "tables", ok: tables >= spec.minTables, note: `${tables} tables, need ${spec.minTables}` });
    for (const needle of spec.contains) {
      const ok = nonEmpty.some((p) => p.text.toLowerCase().includes(needle.toLowerCase()));
      checks.push({ name: `contains:${needle}`, ok, note: ok ? undefined : "text not found" });
    }
    for (const h of spec.headings) {
      const ok = nonEmpty.some((p) => isHeading(p.style) && p.text.toLowerCase().includes(h.toLowerCase()));
      checks.push({ name: `heading:${h}`, ok, note: ok ? undefined : "no heading-styled paragraph with that text" });
    }
    return { verdict: verdictOf(checks), checks };
  }
}
