/**
 * A step's expected calls as a corpus build takes them (./calls.mjs declares
 * them): each checked against the registry of the site it is made on
 * (./site-tools.mjs), and published, or the reason the template is wrong,
 * which refuses the corpus like every other template problem.
 *
 * THE RULE (docs/scenarios/cuj-v1.md § Expected calls): a call is declared
 * only if every correct solution through the tools must make it. A step that
 * changes something declares the writes it makes, or says why no one write is
 * necessary (`noCall`: two tools make the same change); a question declares
 * only reads, each the only way to a fact its answer needs; an impossible step
 * none; and no step a sign-in tool.
 *
 *   stepCalls(calls, { apps, kind, impossible, noCall }) → { problem } | { calls, published }
 *
 * `apps` are the sites the step touches: a call is made on the one there is, or
 * names its own (`call(…, { app })`) when the step touches several.
 */
import { callProblem, publishCall } from "./calls.mjs";
import { SIGN_IN_TOOLS, SITE_TOOLS } from "./site-tools.mjs";

/** A tool that changes what a site holds, by the sites' one naming: every other tool reads. */
export const isWrite = (name) => /^(create|cancel|change|place|request|register|book|reorder)(_|$)/.test(name);

/** The site a call is made on: its own, or the step's one. */
export const siteOf = (c, apps) => c.app ?? (apps.length === 1 ? apps[0] : undefined);

export function stepCalls(calls, { apps, kind, impossible = false, noCall }) {
  if (!Array.isArray(calls)) return { problem: "declares no expected calls (an empty list when no call is necessary)" };
  for (const c of calls) {
    const app = siteOf(c, apps);
    if (!app || !apps.includes(app)) return { problem: `${c.functionName}: a call of a step on ${apps.join(", ")} names which of them it is made on` };
    const tools = SITE_TOOLS.get(app);
    if (!tools) return { problem: `no tool registry for ${app}` };
    const problem = callProblem(c, tools, { signIn: SIGN_IN_TOOLS });
    if (problem) return { problem: `${app}: ${problem}` };
  }
  const writes = calls.filter((c) => isWrite(c.functionName));
  if (impossible && calls.length) return { problem: "an impossible step declares no call: looking is as correct as trying" };
  if (noCall !== undefined && (kind !== "state" || impossible || calls.length || typeof noCall !== "string" || !noCall.trim())) return { problem: "`noCall` says, of a step that changes something and declares no call, why no one write is necessary" };
  if (kind === "state" && !impossible && noCall === undefined && (!writes.length || writes.length !== calls.length)) return { problem: "a step that changes something declares the writes it makes, and only those (or `noCall`: why no one write is necessary)" };
  if (kind === "json" && writes.length) return { problem: "a question declares only reads, each the only way to a fact its answer needs" };
  return { calls, published: calls.map((c) => publishCall(c, SITE_TOOLS.get(siteOf(c, apps)).get(c.functionName))) };
}
