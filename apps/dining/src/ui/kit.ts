import { esc } from "@benchme/site-kit";
import type { FastifyReply, FastifyRequest } from "fastify";

/** The site's identity and the small helpers its pages share. */
export const SESSION_COOKIE = "dn_session";
export const SITE = "Thistlecombe Tables";
export const ACCENT = "#8c2f39";
export const NAV = [
  { href: "/", label: "Find a table" },
  { href: "/restaurants", label: "Restaurants" },
  { href: "/reservations", label: "Reservations" },
];

export type Form = Record<string, string | string[] | undefined>;
export const formOf = (req: FastifyRequest): Form => ((req.method === "GET" ? req.query : req.body) ?? {}) as Form;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Every field as one string (a repeated checkbox keeps its array), for re-filling a form. */
export const flat = (f: Form): Record<string, string | undefined> => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, one(v)]));
export const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type("text/html; charset=utf-8").send(body);

export const inline = 'style="width:auto;display:inline"';
export const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
export const field = (label: string, name: string, value: string | number | undefined, attrs = "") => `<label>${label}</label><input name="${name}" value="${esc(value ?? "")}" ${attrs}>`;
export const select = (label: string, name: string, options: readonly (string | [string, string])[], chosen: string | undefined) =>
  `<label>${label}</label><select name="${name}">${options
    .map((o) => {
      const [value, text] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(value)}"${chosen === value ? " selected" : ""}>${esc(text)}</option>`;
    })
    .join("")}</select>`;
export const AREA_NAMES: Record<string, string> = { indoor: "Indoor", terrace: "Terrace", bar: "Bar", private: "Private room" };
export const price = (level: number) => "$".repeat(level);
export const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
