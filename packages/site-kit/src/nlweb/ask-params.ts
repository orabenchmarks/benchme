/**
 * NLWeb clients are not uniform: the flat query-string form
 * (`?query=…&streaming=0&mode=list`) and the v0.55 nested JSON body
 * (`{query:{text},context:{prev},prefer:{mode,streaming}}`) are both in the
 * wild. Parsing lives here, as one pure function, so the route handlers never
 * branch on shape and the accepted surface is testable without HTTP.
 */

export type AskParams = {
  query: string;
  prev: string[];
  streaming: boolean;
  /** Only "list" is answerable here; anything else is rejected rather than silently down-graded. */
  mode: string;
  queryId?: string;
};

export type AskParamError = "VALIDATION" | "UNSUPPORTED_MODE";
export type AskParamResult = { ok: true; params: AskParams } | { ok: false; error: AskParamError };

const SUPPORTED_MODES = new Set(["list"]);
/** Everything else means "stream": NLWeb's default is streaming, so only an explicit opt-out turns it off. */
const STREAMING_OFF = new Set(["false", "0", "no", "off"]);

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function text(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  const nested = record(v)["text"];
  return typeof nested === "string" ? nested : undefined;
}

function strings(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v !== "string" || v.length === 0) return [];
  if (v.startsWith("[")) {
    try {
      return strings(JSON.parse(v));
    } catch {
      return [v];
    }
  }
  return [v];
}

function streaming(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "boolean") return v;
  return !STREAMING_OFF.has(String(v).toLowerCase());
}

/** Parse either accepted shape; a GET query object and a POST body go through the same path. */
export function parseAskParams(source: unknown): AskParamResult {
  const src = record(source);
  const context = record(src["context"]);
  const prefer = record(src["prefer"]);

  const query = (text(src["query"]) ?? "").trim();
  if (query.length === 0) return { ok: false, error: "VALIDATION" };

  const mode = String(src["mode"] ?? prefer["mode"] ?? "list");
  if (!SUPPORTED_MODES.has(mode)) return { ok: false, error: "UNSUPPORTED_MODE" };

  const queryId = text(src["query_id"]) ?? text(src["queryId"]);
  return {
    ok: true,
    params: {
      query,
      prev: strings(src["prev"] ?? context["prev"]),
      streaming: streaming(src["streaming"] ?? prefer["streaming"]),
      mode,
      ...(queryId ? { queryId } : {}),
    },
  };
}
