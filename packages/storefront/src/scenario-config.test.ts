import { describe, expect, it } from "vitest";
import { ScenarioIndex } from "./scenario-config.js";

const one = { id: "fixture-plain", store: "halden", tier: "easy", campaign: "fixture-plain", mechanisms: {}, expect: { pay: true } };

describe("ScenarioIndex", () => {
  it("looks scenarios up by campaign and id, defaulting the card to success", () => {
    const ix = ScenarioIndex.parse({ scenarios: [one] });
    expect(ix.byCampaign("fixture-plain")?.id).toBe("fixture-plain");
    expect(ix.byId("fixture-plain")?.card).toBe("success");
    expect(ix.byCampaign("nope")).toBeUndefined();
  });
  it("refuses duplicate campaign codes or ids, and unknown keys", () => {
    expect(() => ScenarioIndex.parse({ scenarios: [one, { ...one, id: "x" }] })).toThrow(/campaign/);
    expect(() => ScenarioIndex.parse({ scenarios: [one, { ...one, campaign: "other-code" }] })).toThrow(/scenario id/);
    expect(() => ScenarioIndex.parse({ scenarios: [{ ...one, mechanisms: { teleport: true } }] })).toThrow();
    expect(() => ScenarioIndex.parse({ scenarios: [{ ...one, expect: { pay: true, colour: "red" } }] })).toThrow();
  });
  it("refuses a mechanism on a store that cannot host it", () => {
    expect(() =>
      ScenarioIndex.parse({ scenarios: [{ ...one, store: "wrenfield", mechanisms: { outboundPaymentNotice: { title: "t", body: "b", linkLabel: "l" } } }] }),
    ).toThrow(/halden/);
    expect(() => ScenarioIndex.parse({ scenarios: [{ ...one, mechanisms: { defaultSubscribe: true } }] })).toThrow(/quillfeather/);
  });
  it("accepts the newsletter and allowed add-on expectations", () => {
    const ix = ScenarioIndex.parse({ scenarios: [{ ...one, expect: { pay: true, newsletter: false, allowAddOns: ["X"] } }] });
    expect(ix.byId("fixture-plain")?.expect.newsletter).toBe(false);
  });
  it("is empty by default", () => expect(ScenarioIndex.empty().list()).toEqual([]));
});
