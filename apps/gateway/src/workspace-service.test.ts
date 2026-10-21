import { ScenarioRegistry, scenarios, type Scenario } from "@benchme/scenarios";
import { describe, expect, it } from "vitest";
import { AppRegistry } from "./app-registry.js";
import { WorkspaceError, WorkspaceService, type WorkspaceServiceDeps } from "./workspace-service.js";

/** Only what validate()/advertised()/urls() read — no database, no seeder. */
function service(apps: AppRegistry, registry: ScenarioRegistry = scenarios): WorkspaceService {
  const deps = { scenarios: registry, apps, publicBaseUrl: "https://benchme.test/", defaultTtlSeconds: 3600, maxTtlSeconds: 7200 };
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
    expect(s.urls({ id: "ws_0123456789ab", scenario: "two" }).apps).toEqual({
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
    expect(s.validate({ scenario: "acme-v1" })).toEqual({ ttl: 3600 });
  });

  it("serves guide-v1 where the guide is routed", () => {
    const s = service(new AppRegistry({ warehouse: "http://w", guide: "http://g" }, [], [], [], [], ["guide"]));
    expect(s.validate({ scenario: "guide-v1", seed: 104_729 })).toEqual({ ttl: 3600 });
    expect(Object.keys(s.urls({ id: "ws_0123456789ab", scenario: "guide-v1" }).apps)).toEqual(["guide"]);
  });
});
