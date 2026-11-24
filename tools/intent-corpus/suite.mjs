/**
 * A corpus's expected calls as a webmcp-evals suite: the evals.json of
 * GoogleChromeLabs' webmcp-evals, one case per step that has expected calls.
 * It is answer-key material (a call can name what the task has the agent
 * find), so it sits beside the answer keys and is never shown to an agent.
 *
 *   [{ name, messages: [{ role: "user", type: "message", content }], expectedCall }]
 *
 * - `name` is the task's id, the step's number when the task has steps, and the
 *   site whose tools the calls are, for a runner that serves one site's pages.
 * - `messages` are the prompts up to the step's own, as user messages: a
 *   follow-up's prompt leans on the earlier ones ("the same traveller"). The
 *   replies in between are not there: they and the calls they made (the ids the
 *   site made on the way) are a run's, not the task's, and are never invented.
 * - `expectedCall` is the step's calls as its key holds them. A step's calls
 *   are each made, in any order: several are one webmcp-evals `unordered`
 *   group. They are the calls every correct solution makes, not every call it
 *   makes: a run also reads, and signs in, as it needs to.
 *
 *   webmcpEvalsSuite(steps) → the suite, from [{ id, step?, apps, intents, calls }] in corpus order
 */
export function webmcpEvalsSuite(steps) {
  return steps
    .filter((s) => s.calls?.length)
    .map((s) => ({
      name: `${s.id}${s.step ? ` step ${s.step}` : ""} (${s.apps.join(", ")})`,
      messages: s.intents.map((content) => ({ role: "user", type: "message", content })),
      expectedCall: s.calls.length === 1 ? s.calls : [{ unordered: s.calls }],
    }));
}
