import type { z } from "zod";

/** Parse an env map against a zod schema; fail fast naming every offending key. */
export function loadConfig<T extends z.ZodTypeAny>(schema: T, env: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (parsed.success) return parsed.data as z.infer<T>;
  const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`invalid configuration:\n  ${problems.join("\n  ")}`);
}
