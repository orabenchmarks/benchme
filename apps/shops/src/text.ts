/**
 * Text a shopper (or a script) sends the stores, made fit to keep: every form field and query value the
 * routes read goes through here before it is stored, priced or shown back.
 *
 * Postgres refuses U+0000 in TEXT and in JSONB, and JSONB refuses half of a surrogate pair — which a
 * JSON body can carry, and which cutting a string by UTF-16 code units makes out of an emoji. So a NUL is
 * dropped, a lone surrogate becomes U+FFFD, and every limit counts characters (code points), never code
 * units. A form posts each line break of a textarea as CRLF while the browser's own limit counts it as one
 * character: a break is kept, and counted, as one "\n". Nothing here throws.
 */

const NUL = /\u0000/g;
/** A high surrogate not followed by a low one, or a low one not preceded by a high one (code units: no `u` flag). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The string with its NULs dropped and every lone surrogate replaced by U+FFFD: storable as it is. */
export function storableText(s: string): string {
  return s.replace(NUL, "").replace(LONE_SURROGATE, "�");
}

/** Every line break as one "\n" (CRLF and a lone CR included). */
export function oneLineBreak(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/** How many characters (code points) a string holds: what a length limit counts. */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** The first `max` characters (code points) of a string: never half of a surrogate pair. */
export function truncateText(s: string, max: number): string {
  if (s.length <= max) return s; // no more code points than code units
  let out = "";
  let n = 0;
  for (const ch of s) {
    if (n++ === max) break;
    out += ch;
  }
  return out;
}

/** A typed value as the stores keep it: storable, line breaks as "\n", trimmed, at most `max` characters. */
export function cleanText(raw: string, max: number): string {
  return truncateText(oneLineBreak(storableText(raw)).trim(), max);
}
