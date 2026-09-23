/**
 * decision-eval model adapters — each answers ONE item and reports what it
 * cost and how long the caller waited (wall clock). Same contract for every
 * model so the runner never branches on which one it holds:
 *
 *   answer(item) → { answer?: string, probability?: number, confidence: number|null,
 *                    latencyMs, costUsd, invalid?: string }
 *
 * jev answers natively (typed questions over a state). An LLM gets the same
 * state, question and options as a prompt and must reply with strict JSON —
 * no tools, no thinking, one short answer: the baseline jev replaces.
 */

const ANTHROPIC_VERSION = "2023-06-01";

async function timed(fn) {
  const t0 = performance.now();
  const value = await fn();
  return { value, latencyMs: Math.round(performance.now() - t0) };
}

export function jevModel({ baseUrl, apiKey, model, inputUsdPerMTok = 0.042, timeoutMs = 30_000 }) {
  return {
    name: model,
    kind: "jev",
    async answer(item) {
      const question =
        item.kind === "choice"
          ? { type: "choice", instructions: item.instructions, criteria: item.options }
          : { type: "noul", instructions: item.instructions };
      const { value: res, latencyMs } = await timed(() =>
        fetch(`${baseUrl}/v1/systemone`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model, state: item.state, questions: { q: question } }),
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
      if (!res.ok) return { invalid: `HTTP ${res.status}`, latencyMs, costUsd: 0, confidence: null };
      const body = await res.json();
      const a = body.answers?.q;
      const costUsd = ((body.usage?.input_tokens ?? 0) * inputUsdPerMTok) / 1e6;
      if (item.kind === "choice") {
        if (a?.type !== "choice") return { invalid: "no choice answer", latencyMs, costUsd, confidence: null };
        return { answer: a.choice, confidence: a.probabilities?.[a.choice] ?? a.confidence ?? null, latencyMs, costUsd, answeredBy: body.model };
      }
      if (a?.type !== "noul" || typeof a.noul !== "number") return { invalid: "no noul answer", latencyMs, costUsd, confidence: null };
      return { probability: a.noul, confidence: Math.max(a.noul, 1 - a.noul), latencyMs, costUsd, answeredBy: body.model };
    },
  };
}

const SYSTEM = [
  "You are a decision component inside a software system. You receive a JSON state and ONE closed-set question.",
  "Decide using only the state. Reply with ONLY a JSON object, no prose, no code fence.",
].join(" ");

function promptFor(item) {
  const format =
    item.kind === "choice"
      ? `Reply {"answer": "<one option id>", "confidence": <probability 0..1 that your answer is right>}.`
      : `Reply {"probability": <probability 0..1 that the statement is true>}.`;
  const payload = { state: item.state, question: item.instructions, ...(item.kind === "choice" ? { options: item.options } : {}) };
  return `${JSON.stringify(payload, null, 1)}\n\n${format}`;
}

function firstJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function anthropicModel({ baseUrl, apiKey, model, inputUsdPerMTok, outputUsdPerMTok, temperature = 0, timeoutMs = 60_000 }) {
  return {
    name: model,
    kind: "llm",
    async answer(item) {
      const { value: res, latencyMs } = await timed(() =>
        fetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 80, ...(temperature === null ? {} : { temperature }), system: SYSTEM, messages: [{ role: "user", content: promptFor(item) }] }),
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
      if (!res.ok) return { invalid: `HTTP ${res.status}`, latencyMs, costUsd: 0, confidence: null };
      const body = await res.json();
      const u = body.usage ?? {};
      const costUsd = ((u.input_tokens ?? 0) * inputUsdPerMTok + (u.output_tokens ?? 0) * outputUsdPerMTok) / 1e6;
      const parsed = firstJson((body.content ?? []).map((c) => c.text ?? "").join(""));
      if (item.kind === "choice") {
        if (!parsed || typeof parsed.answer !== "string" || !(parsed.answer in item.options)) return { invalid: "unparseable answer", latencyMs, costUsd, confidence: null };
        return { answer: parsed.answer, confidence: typeof parsed.confidence === "number" ? parsed.confidence : null, latencyMs, costUsd };
      }
      if (!parsed || typeof parsed.probability !== "number") return { invalid: "unparseable probability", latencyMs, costUsd, confidence: null };
      return { probability: parsed.probability, confidence: Math.max(parsed.probability, 1 - parsed.probability), latencyMs, costUsd };
    },
  };
}
