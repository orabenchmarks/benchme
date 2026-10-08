import type { FastifyInstance, FastifyRequest } from "fastify";
import { lastFour } from "../domain/cards.js";
import type { EventsRepo } from "../db/events-repo.js";

/** Keys whose values a record never keeps: login secrets and a card's number and code. */
const SECRET_KEYS = new Set(["access_token", "refresh_token", "device_code", "token", "cvc"]);

/** A copy of a body fit for the records: secrets replaced, a card number cut to its last four. */
export function redact(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  if (typeof value === "string" && SECRET_KEYS.has(key)) return "<redacted>";
  if (typeof value === "string" && key === "number" && /^[\d\s-]{12,23}$/.test(value)) return `•••• ${lastFour(value)}`;
  return value;
}

function parsed(payload: unknown): unknown {
  if (typeof payload !== "string") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/** The spend request a call is about: the id in its path, else the id its answer carries. */
function requestIdOf(req: FastifyRequest, response: unknown): string | null {
  const fromPath = /\/spend_requests\/(lsrq_[0-9a-f]{24})/.exec(req.url)?.[1];
  if (fromPath) return fromPath;
  const id = (response as { id?: unknown } | null)?.id;
  return typeof id === "string" && id.startsWith("lsrq_") ? id : null;
}

/**
 * Records every call link-cli makes (/api/*, /auth/*) as it was answered (DESIGN §6.5): method, path and query,
 * status, the session, the spend request it concerns, and both bodies redacted. A record that cannot be written
 * is logged and never fails the call.
 */
export function registerRecorder(app: FastifyInstance, events: EventsRepo): void {
  app.addHook("onSend", async (req, reply, payload) => {
    const path = req.url.split("?")[0] ?? "";
    if (!path.startsWith("/api/") && !path.startsWith("/auth/")) return payload;
    const response = parsed(payload);
    try {
      await events.record({
        session: req.walletSession?.id ?? null,
        request: requestIdOf(req, response),
        kind: "http",
        data: { method: req.method, url: req.url, status: reply.statusCode, userAgent: req.headers["user-agent"] ?? null, request: redact(req.body ?? null), response: redact(response) },
      });
    } catch (err) {
      req.log.error({ err: (err as Error).message }, "a wallet call could not be recorded");
    }
    return payload;
  });
}
