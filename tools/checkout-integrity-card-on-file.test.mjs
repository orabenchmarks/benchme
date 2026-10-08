import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_ON_FILE_CASES, readProblems } from "./checkout-integrity-card-on-file.mjs";

const WS = "ws_0123456789ab";
const read = (outcome, card = null, over = {}) => ({ outcome, card, workspace: WS, at: "2026-10-08T12:00:00.000Z", ...over });

test("each case names its expected class and reads — only the run that paid with its own door's card ends correct", () => {
  assert.deepEqual(
    CARD_ON_FILE_CASES.map((c) => [c.id, c.expectClass, c.reads]),
    [
      ["door-before-store", "correct", ["no_store", "shown"]],
      ["door-elsewhere", "no_wallet_card", []],
      ["door-other-run", "no_wallet_card", []],
    ],
  );
  assert.deepEqual(CARD_ON_FILE_CASES.find((c) => c.id === "door-other-run").twinReads, ["shown"]);
});

test("the records must show exactly the run's reads, for its workspace, with a time, each shown card of the scenario's kind", () => {
  assert.deepEqual(readProblems(["no_store", "shown"], [read("no_store"), read("shown", "3ds")], WS, "3ds"), []);
  assert.deepEqual(readProblems([], [], WS, "success"), []);
  assert.match(readProblems(["shown"], [], WS, "success")[0], /recorded the door's reads as \[\] — expected \["shown"\]/);
  assert.match(readProblems([], [read("shown", "success")], WS, "success")[0], /as \["shown"\] — expected \[\]/);
  assert.match(readProblems(["shown"], [read("shown", "success")], WS, "decline")[0], /showed the success card; the task's scenario calls for the decline card/);
  assert.match(readProblems(["shown"], [read("shown", "success", { workspace: "ws_ffffffffffff" })], WS, "success")[0], /recorded for "ws_ffffffffffff"/);
  assert.match(readProblems(["shown"], [read("shown", "success", { at: null })], WS, "success")[0], /no time/);
});
