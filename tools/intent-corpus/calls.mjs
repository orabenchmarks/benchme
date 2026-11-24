/**
 * Expected tool calls (docs/scenarios/cuj-v1.md § Expected calls): the site
 * tool calls every correct solution through a site's tools makes, declared by
 * each template beside its reference solution, published in the answer key in
 * the shape of GoogleChromeLabs' webmcp-evals suites
 * (`{ "functionName": "…", "arguments": { … } }`).
 *
 * A template declares ONE call: the concrete arguments a run sends (what
 * tools/intent-integrity.mjs sends, to prove the calls alone make the task
 * pass) and how each is published. The published `arguments` are a partial
 * match, derived from the concrete ones, so the published form and what is
 * proven are one declaration:
 *
 *   - a value is published as it is: what the task fixes (a code, a date, a
 *     party, an email, a time);
 *   - a field whose value is its tool's default is left out: a run may leave it
 *     to the default (no checked bags, no children, pickup);
 *   - a field marked `free` is left out: a run may write it its own way (a
 *     name, a note) or the site does not need it (a hotel code beside the room
 *     code that names the hotel);
 *   - a field given a constraint is published as that constraint, in
 *     webmcp-evals' vocabulary (`pattern`, `contains`, `atMost`, `atLeast`,
 *     `below`, `above`, `ofType`, `present`);
 *   - a value the run makes (`made`: the number of a booking an earlier call
 *     made) is resolved from the results of the calls before it, and published
 *     as its constraint;
 *   - a value inside a field (a pizza line's toppings) is published as a
 *     constraint with `published(value, constraint)`: sent as the value.
 *
 *   call(functionName, args, as?) → a declaration
 *   publishCall(declaration, input) → { functionName, arguments }   (input: the tool's zod input shape)
 *   concreteArgs(args, run) → the arguments a run sends
 *   callProblem(declaration, tools) → why it is no call of those tools, or null
 */

const MADE = Symbol("made by the run");
const SHOWN = Symbol("published as a constraint");
const FREE = Object.freeze({ [Symbol.for("benchme.free")]: true });

/**
 * One call every correct solution makes: `args` are concrete, `as` says how a field is published when not as given.
 * `app` names the site whose tool it is, which only a step on several sites needs (both sell `create_booking`).
 */
export const call = (functionName, args = {}, as = {}, { app } = {}) => ({ functionName, args, as, ...(app ? { app } : {}) });

/** Left out of the published arguments: a run may write it its own way, or need not give it. */
export const free = FREE;
/** webmcp-evals' constraints: a regular expression (plain JavaScript, no inline flags), a substring, a bound, a type, presence. */
export const pattern = (source) => ({ $pattern: source });
export const contains = (text) => ({ $contains: text });
export const atMost = (n) => ({ $lte: n });
export const atLeast = (n) => ({ $gte: n });
export const below = (n) => ({ $lt: n });
export const above = (n) => ({ $gt: n });
export const ofType = (type) => ({ $type: type });
export const present = Object.freeze({ $any: true });
/** `n` array elements that may be anything of one type, in any order: two passengers, whatever their names. */
export const someOf = (n, constraint) => Array.from({ length: n }, () => ({ ...constraint }));
const escape = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Exactly one of these values. */
export const oneOf = (values) => pattern(`^(?:${values.map(escape).join("|")})$`);
/** An array of exactly these values, in any order (seats, guests): webmcp-evals matches an array element by element. */
export const anyOrder = (values) => values.map(() => oneOf(values));

/**
 * A value an earlier call of the run makes (a booking number), so no task can hold it: `pick(run)` gives it to the
 * integrity tool from the results of the calls the run made before (`run.last(functionName)` is the latest
 * result of that tool), and `constraint` is what the key publishes in its place.
 */
export const made = (pick, constraint) => ({ [MADE]: pick, constraint });
/** A value the task fixes, sent as it is and published as `constraint`: where a top-level `as` cannot reach (inside a line). */
export const published = (value, constraint) => ({ [SHOWN]: value, constraint });
/** The `field` of the latest result of `functionName` (on `app`, in a task on several sites), published as `constraint`. */
export const madeBy = (functionName, field, constraint, app) => made((run) => run.last(functionName, app)[field], constraint);

// ─── The published form ────────────────────────────────────────────────────────────────────────────────────────────

const OPERATORS = { $pattern: "string", $contains: "string", $lte: "number", $gte: "number", $lt: "number", $gt: "number", $type: "type", $any: "any" };
const TYPES = ["string", "number", "boolean", "array", "object", "null"];
const isMade = (v) => v !== null && typeof v === "object" && MADE in v;
const isShown = (v) => v !== null && typeof v === "object" && SHOWN in v;
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
/** webmcp-evals' constraint object: a non-empty object every key of which starts with `$`. */
export const isConstraint = (v) => isPlain(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k.startsWith("$"));

/** The schema under its wrappers (optional, default, nullable, a refinement or a transform), and its default if it has one. */
function peel(schema) {
  let s = schema;
  let fallback;
  for (let guard = 0; s && guard < 20; guard++) {
    const t = s._def?.typeName;
    if (t === "ZodDefault") {
      if (fallback === undefined) fallback = { value: s._def.defaultValue() };
      s = s._def.innerType;
    } else if (t === "ZodOptional" || t === "ZodNullable" || t === "ZodReadonly" || t === "ZodBranded" || t === "ZodCatch") s = s._def.innerType;
    else if (t === "ZodEffects") s = s._def.schema;
    else if (t === "ZodPipeline") s = s._def.in;
    else if (t === "ZodLazy") s = s._def.getter();
    else break;
  }
  return { core: s, fallback, optional: schema.isOptional?.() ?? false };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function publishValue(value, schema) {
  if (isMade(value) || isShown(value)) return value.constraint;
  const { core } = schema ? peel(schema) : { core: null };
  if (Array.isArray(value)) return value.map((v) => publishValue(v, core?._def?.typeName === "ZodArray" ? core._def.type : null));
  if (isPlain(value) && !isConstraint(value)) return publishFields(value, core?._def?.typeName === "ZodObject" ? core.shape : null);
  return value;
}

function publishFields(args, shape, as = {}) {
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (k in as) {
      if (as[k] !== FREE) out[k] = as[k];
      continue;
    }
    const field = shape?.[k];
    if (field && !isMade(v) && !isShown(v)) {
      const { fallback } = peel(field);
      if (fallback && same(fallback.value, v)) continue;
    }
    out[k] = publishValue(v, field);
  }
  return out;
}

/** The call as the key publishes it: webmcp-evals' `{ functionName, arguments }`, the arguments a partial match. */
export const publishCall = (c, input) => ({ functionName: c.functionName, arguments: publishFields(c.args, input, c.as) });

/** The arguments a run sends: every value as declared, a value the run makes read from the run so far. */
export function concreteArgs(value, run) {
  if (isMade(value)) return value[MADE](run);
  if (isShown(value)) return concreteArgs(value[SHOWN], run);
  if (Array.isArray(value)) return value.map((v) => concreteArgs(v, run));
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, concreteArgs(v, run)]));
  return value;
}

// ─── The static proof ──────────────────────────────────────────────────────────────────────────────────────────────

/** Why a constraint object is not one webmcp-evals reads as meant, or would never match a field of this schema. */
function constraintProblem(c, core, at) {
  const kind = core?._def?.typeName;
  const stringy = ["ZodString", "ZodEnum", "ZodLiteral", "ZodNativeEnum"].includes(kind);
  for (const [op, v] of Object.entries(c)) {
    const want = OPERATORS[op];
    if (!want) return `${at}: ${op} is no webmcp-evals constraint (it would match anything)`;
    if (want === "string" && typeof v !== "string") return `${at}: ${op} takes a string`;
    if (want === "number" && typeof v !== "number") return `${at}: ${op} takes a number`;
    if (want === "type" && !TYPES.includes(v)) return `${at}: $type is one of ${TYPES.join(", ")}`;
    if (want === "any" && v !== true) return `${at}: $any is true`;
    if (op === "$pattern") {
      try {
        new RegExp(v);
      } catch {
        return `${at}: $pattern ${JSON.stringify(v)} is no plain JavaScript regular expression`;
      }
    }
    if (kind && want === "string" && !stringy) return `${at}: ${op} on a field that takes no string`;
    if (kind && want === "number" && kind !== "ZodNumber") return `${at}: ${op} on a field that takes no number`;
  }
  return null;
}

/**
 * Why `value` is not what `schema` takes, with constraint objects (and values the run makes) set aside: an
 * object's fields are each named by its shape and each checked against its own schema (every field it needs
 * given, unless `partial`, as the published arguments are), an array's elements against the element schema,
 * anything else parsed as it is.
 */
function valueProblem(value, schema, at, partial) {
  if (isMade(value)) return null;
  if (isShown(value)) return valueProblem(value[SHOWN], schema, at, partial) ?? valueProblem(value.constraint, schema, at, true);
  if (isConstraint(value)) return constraintProblem(value, peel(schema).core, at);
  const { core } = peel(schema);
  const kind = core?._def?.typeName;
  if (kind === "ZodObject" && isPlain(value)) return fieldsProblem(value, core.shape, at, { partial });
  if (kind === "ZodArray" && Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const p = valueProblem(v, core._def.type, `${at}[${i}]`, partial);
      if (p) return p;
    }
    return null;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? null : `${at}: ${JSON.stringify(value)} is not what the tool takes (${parsed.error.issues.map((i) => i.message).join("; ")})`;
}

function fieldsProblem(args, shape, at, { partial }) {
  for (const k of Object.keys(args)) if (!(k in shape)) return `${at ? `${at}.` : ""}${k}: the tool takes no such argument (it takes ${Object.keys(shape).join(", ") || "none"})`;
  for (const [k, v] of Object.entries(args)) {
    const p = valueProblem(v, shape[k], at ? `${at}.${k}` : k, partial);
    if (p) return p;
  }
  if (!partial) for (const [k, field] of Object.entries(shape)) if (!(k in args) && !field.isOptional()) return `${at ? `${at}.` : ""}${k}: the tool needs it, and the call does not send it`;
  return null;
}

/**
 * Why a declared call is no call of a site's tools, or null. `tools` maps each tool the site's registry registers
 * to its input shape; `signIn` names the sign-in tools, which a key never declares (every door signs in the same
 * way, so they say nothing about the task). The concrete call must be one the tool takes, every field it needs
 * given; the published one must name only its fields, each value of its type, constraint objects set aside.
 */
export function callProblem(c, tools, { signIn = [] } = {}) {
  if (signIn.includes(c.functionName)) return `${c.functionName} is a sign-in tool, which no key declares`;
  const input = tools.get(c.functionName);
  if (!input) return `${c.functionName}: the site has no such tool (it has ${[...tools.keys()].join(", ")})`;
  for (const [k, v] of Object.entries(c.as)) {
    if (!(k in c.args)) return `${c.functionName}: publishes ${k}, which the call does not send`;
    // `free`, a constraint, or an array of them (a variable of the template's that shadows `free` is neither).
    const shape = (x) => x === FREE || isConstraint(x) || (Array.isArray(x) && x.every(shape));
    if (!shape(v)) return `${c.functionName}: publishes ${k} as ${JSON.stringify(v)}, which is neither free nor a constraint`;
  }
  const concrete = fieldsProblem(c.args, input, "", { partial: false });
  if (concrete) return `${c.functionName}: ${concrete}`;
  const published = fieldsProblem(publishCall(c, input).arguments, input, "", { partial: true });
  return published ? `${c.functionName}, as published: ${published}` : null;
}
