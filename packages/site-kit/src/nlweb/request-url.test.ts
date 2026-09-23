import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { defaultPublicBaseUrl } from "./request-url.js";

/** A request is only ever read for its headers + forwarded prefix here. */
const req = (headers: Record<string, string>, prefix = "/w/ws_1/warehouse"): FastifyRequest => ({ headers, prefix }) as unknown as FastifyRequest;

describe("defaultPublicBaseUrl", () => {
  it("falls back to the Host header when nothing is forwarded", () => {
    expect(defaultPublicBaseUrl(req({ host: "gw.test" }))).toBe("http://gw.test/w/ws_1/warehouse");
  });

  // The gateway's reply-from rewrites Host to the INTERNAL target
  // ("warehouse:3000"), so a site that trusted `host` would advertise an
  // unreachable robots.txt/schema map. x-forwarded-host is the public name.
  it("prefers x-forwarded-host over the rewritten Host header", () => {
    expect(defaultPublicBaseUrl(req({ host: "warehouse:3000", "x-forwarded-host": "benchme.test:8090" }))).toBe("http://benchme.test:8090/w/ws_1/warehouse");
  });

  it("takes the FIRST value of a comma-separated x-forwarded-host chain (the original client's)", () => {
    expect(defaultPublicBaseUrl(req({ host: "warehouse:3000", "x-forwarded-host": "benchme.test, inner.proxy" }))).toBe("http://benchme.test/w/ws_1/warehouse");
  });

  it("honours x-forwarded-proto", () => {
    expect(defaultPublicBaseUrl(req({ host: "h", "x-forwarded-host": "benchme.test", "x-forwarded-proto": "https" }))).toBe("https://benchme.test/w/ws_1/warehouse");
  });
});
