import type { z } from "zod";

/**
 * Parse an env map against a zod schema; fail fast naming every offending key.
 *
 * An EMPTY value is an unset one: compose's `${X:-}` and a chart's `""` are how
 * deployment tools say "not set", so a default applies and an optional stays
 * absent — rather than an empty URL failing its check or an empty number
 * coercing to 0. A required key left empty still fails, by name.
 */
export function loadConfig<T extends z.ZodTypeAny>(schema: T, env: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const parsed = schema.safeParse(withoutEmptyValues(env));
  if (parsed.success) return parsed.data as z.infer<T>;
  const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`invalid configuration:\n  ${problems.join("\n  ")}`);
}

function withoutEmptyValues(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
}
