import { esc } from "@benchme/site-kit";

export const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
export const inline = 'style="width:auto;display:inline"';
export const field = (label: string, name: string, value: string | undefined, attrs = "") => `<label>${label}</label><input name="${name}" value="${esc(value ?? "")}" ${attrs}>`;
/** A filter's query string, without the empty values. */
export const qs = (f: Record<string, string | undefined>) => Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join("");
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
