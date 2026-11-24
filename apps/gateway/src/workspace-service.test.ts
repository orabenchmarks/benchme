import { DoorSet } from "@benchme/core";
import { ScenarioRegistry, scenarios, type Scenario } from "@benchme/scenarios";
import { describe, expect, it } from "vitest";
import { AppRegistry } from "./app-registry.js";
import { WorkspaceError, WorkspaceService, type WorkspaceServiceDeps } from "./workspace-service.js";

/** Only what validate()/advertised()/urls() read — no database, no seeder. */
function service(apps: AppRegistry, registry: ScenarioRegistry = scenarios, doors?: DoorSet): WorkspaceService {
  const deps = { scenarios: registry, apps, publicBaseUrl: "https://benchme.test/", defaultTtlSeconds: 3600, maxTtlSeconds: 7200, doors };
  return new WorkspaceService(deps as unknown as WorkspaceServiceDeps);
}

const empty = scenarios.get("shops-v1").generate(1);
const named = (key: string, apps: readonly string[]): Scenario => ({ key, description: key, apps, generate: () => empty });

describe("WorkspaceService — the apps a scenario advertises", () => {
  it("advertises a scenario's own apps in its order, unlisted ones included; every listed app otherwise", () => {
    const apps = new AppRegistry({ warehouse: "http://w", guide: "http://g", mail: "http://m" }, [], [], [], [], ["guide", "mail"]);
    const reg = new ScenarioRegistry().register(named("two", ["mail", "guide"])).register({ ...named("plain", []), apps: undefined });
    const s = service(apps, reg);
    expect(s.advertised("two").map((a) => a.name)).toEqual(["mail", "guide"]);
    expect(s.advertised("plain").map((a) => a.name)).toEqual(["warehouse"]);
    expect(s.urls({ id: "ws_0123456789ab", scenario: "two", doors: null }).apps).toEqual({
      mail: "https://benchme.test/w/ws_0123456789ab/mail",
      guide: "https://benchme.test/w/ws_0123456789ab/guide",
    });
  });

  it("refuses to mint a scenario whose apps the deployment does not serve (422 SCENARIO_UNAVAILABLE)", () => {
    const s = service(new AppRegistry({ warehouse: "http://w" }, []));
    let caught: unknown;
    try {
      s.validate({ scenario: "guide-v1" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WorkspaceError);
    expect(caught).toMatchObject({ status: 422, code: "SCENARIO_UNAVAILABLE" });
    expect((caught as Error).message).toContain("guide");
    expect(s.validate({ scenario: "acme-v1" })).toEqual({ ttl: 3600, doors: null });
  });

  it("serves guide-v1 where the guide is routed", () => {
    const s = service(new AppRegistry({ warehouse: "http://w", guide: "http://g" }, [], [], [], [], ["guide"]));
    expect(s.validate({ scenario: "guide-v1", seed: 104_729 })).toEqual({ ttl: 3600, doors: null });
    expect(Object.keys(s.urls({ id: "ws_0123456789ab", scenario: "guide-v1", doors: null }).apps)).toEqual(["guide"]);
  });
});

describe("WorkspaceService — the doors a workspace is served through", () => {
  // warehouse has every capability; mail an MCP server and WebMCP, no NLWeb.
  const apps = new AppRegistry({ warehouse: "http://w", mail: "http://m" }, [], ["warehouse", "mail"], ["warehouse"], ["warehouse", "mail"]);
  const id = "ws_0123456789ab";
  const at = (path: string) => `https://benchme.test/w/${id}/${path}`;

  it("validates the doors a workspace asks for against DOORS, pages always among them (422 UNKNOWN_DOOR)", () => {
    const s = service(apps);
    expect(s.validate({ scenario: "acme-v1", doors: ["webmcp"] }).doors?.list()).toEqual(["page", "webmcp"]);
    expect(s.validate({ scenario: "acme-v1", doors: [] }).doors?.list()).toEqual(["page"]);
    let caught: unknown;
    try {
      s.validate({ scenario: "acme-v1", doors: ["page", "ftp"] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ status: 422, code: "UNKNOWN_DOOR", message: 'unknown door "ftp": the doors are page, rest, mcp, webmcp' });
  });

  it("serves a workspace through its own doors, else the deployment's", () => {
    const s = service(apps, scenarios, DoorSet.parse("page,webmcp"));
    expect(s.doorsOf({ doors: null }).list()).toEqual(["page", "webmcp"]);
    expect(s.doorsOf({ doors: ["page", "rest"] }).list()).toEqual(["page", "rest"]);
    expect(service(apps).doorsOf({ doors: null }).list()).toEqual(["page", "rest", "mcp", "webmcp"]);
  });

  // One open door per case beside the pages: each map is filled only by its own door.
  it.each([
    [[], { mcp: {}, ask: {}, askMcp: {}, webmcp: {} }],
    [["rest"], { mcp: {}, ask: { warehouse: at("warehouse/ask") }, askMcp: {}, webmcp: {} }],
    [["mcp"], { mcp: { warehouse: at("warehouse/mcp"), mail: at("mail/mcp") }, ask: {}, askMcp: { warehouse: at("warehouse/ask/mcp") }, webmcp: {} }],
    [["webmcp"], { mcp: {}, ask: {}, askMcp: {}, webmcp: { warehouse: at("warehouse/"), mail: at("mail/") } }],
  ])("advertises, beside every app's pages, only what is behind the open doors: %j", (open, expected) => {
    const urls = service(apps).urls({ id, scenario: "acme-v1", doors: ["page", ...(open as string[])] as never });
    expect(urls.apps).toEqual({ warehouse: at("warehouse"), mail: at("mail") });
    expect({ mcp: urls.mcp, ask: urls.ask, askMcp: urls.askMcp, webmcp: urls.webmcp }).toEqual(expected);
  });
});
