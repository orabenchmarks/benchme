import { esc, money, sessionUser, webmcpScript, type AuthService, type ShellCtx, type ToolRegistry } from "@benchme/site-kit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ToolContext } from "../mcp/tools.js";

export const SITE = "Calvenor Clinics";
export const ACCENT = "#3a6ea5";
export const SESSION_COOKIE = "cl_session";
const NAV = [
  { href: "/", label: "Find a doctor" },
  { href: "/clinics", label: "Clinics" },
  { href: "/plans", label: "Plans & coverage" },
  { href: "/medications", label: "Prescription prices" },
  { href: "/appointments", label: "Appointments" },
  { href: "/prescriptions", label: "Prescriptions" },
];

/** On every page, the auth pages included (the shell renders `scripts` verbatim before </body>). */
const FOOTER = `<footer style="max-width:64rem;margin:2rem auto;padding:0 1rem" class="muted"><p>${esc(SITE)} is a fictional demo site: every clinic, doctor, insurance plan, procedure and medication on it is invented. It books appointments, shows prices and coverage, and takes refill requests. It gives no medical advice. In an emergency, call your local emergency number.</p></footer>`;

export type Ctx = (req: FastifyRequest, flash?: string) => Promise<ShellCtx>;

export function shellCtx(auth: AuthService, tools: ToolRegistry<ToolContext>): Ctx {
  const user = sessionUser(auth, SESSION_COOKIE);
  return async (req, flash) => ({ site: SITE, accent: ACCENT, prefix: req.prefix, nav: NAV, user: await user(req), flash, scripts: [FOOTER, webmcpScript(tools, req.prefix)] });
}

export const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type("text/html; charset=utf-8").send(body);

type Q = Record<string, string | string[] | undefined>;
export const query = (req: FastifyRequest): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries((req.query ?? {}) as Q).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
export const form = (req: FastifyRequest): Record<string, string | undefined> => (req.body ?? {}) as Record<string, string | undefined>;

// Small render helpers every page file shares.
export const tag = (s: string) => `<span class="tag">${esc(s)}</span>`;
export const inline = 'style="width:auto;display:inline"';
export const field = (label: string, name: string, value: string | undefined, attrs = "") => `<label>${label}</label><input name="${name}" value="${esc(value ?? "")}" ${attrs}>`;
export const select = (label: string, name: string, options: { value: string; text: string }[], chosen: string | undefined) =>
  `<label>${label}</label><select name="${name}">${options.map((o) => `<option value="${esc(o.value)}"${o.value === chosen ? " selected" : ""}>${esc(o.text)}</option>`).join("")}</select>`;
export const cents = (c: number | null) => (c === null ? "—" : money(c));
export const qs = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
export const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const visitText = (v: string) => (v === "video" ? "video" : "in-person");
