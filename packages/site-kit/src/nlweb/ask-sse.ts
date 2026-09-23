import type { FastifyReply } from "fastify";
import type { AskService } from "./ask-service.js";
import type { AskParams } from "./ask-params.js";
import type { Ranker } from "./types.js";

/**
 * The NLWeb SSE contract. The two header frames go out BEFORE ranking starts,
 * so a client that waits on a paid ranker still sees the stream open and knows
 * the licence/retention terms it is about to receive data under.
 */
const LICENSE = { message_type: "license", content: { license: "benchme synthetic data; no restrictions" } };
const DATA_RETENTION = { message_type: "data_retention", content: { retention: "none" } };

/**
 * Takes over the raw socket (Fastify's reply serialisation cannot emit frames
 * incrementally) and always terminates with a `complete` frame — including on
 * failure, so a client never hangs waiting for an end that is not coming.
 */
export async function streamAsk(reply: FastifyReply, service: AskService, workspaceId: string, params: AskParams, queryId: string, prefix: string, rankerOverride?: Ranker): Promise<void> {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const frame = (payload: unknown): void => {
    raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  frame(LICENSE);
  frame(DATA_RETENTION);
  try {
    const answer = await service.ask(workspaceId, { query: params.query, prev: params.prev, queryId, prefix }, rankerOverride);
    frame({ results: answer.results });
    if (answer.ranker_degraded) frame({ message_type: "ranker", content: { ranker: answer.ranker, degraded: true } });
  } catch (err) {
    // A ranker failure's message carries upstream detail (endpoint, key
    // fragment, provider text). The client gets a stable code it can branch
    // on; the detail goes to the operator's log, where it belongs.
    reply.log.error({ err, queryId }, "ask failed");
    frame({ message_type: "error", content: { error: "ASK_FAILED" } });
  }
  frame({ query_id: queryId, complete: true });
  raw.end();
}
