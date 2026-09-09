/**
 * Kubernetes-style resource quantities ("2", "500m", "2Gi", "512M") → numbers,
 * so one RUNNER_CPU / RUNNER_MEMORY setting drives every runner backend.
 */
const BINARY: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40 };
const DECIMAL: Record<string, number> = { K: 1e3, M: 1e6, G: 1e9, T: 1e12, k: 1e3 };

export function parseCpus(q: string): number {
  const m = /^(\d+(?:\.\d+)?)(m?)$/.exec(q.trim());
  if (!m) throw new Error(`invalid cpu quantity "${q}"`);
  const n = Number(m[1]);
  return m[2] === "m" ? n / 1000 : n;
}

export function parseBytes(q: string): number {
  const m = /^(\d+(?:\.\d+)?)([KMGT]i|[kKMGT])?$/.exec(q.trim());
  if (!m) throw new Error(`invalid memory quantity "${q}"`);
  const unit = m[2];
  const mult = unit ? (BINARY[unit] ?? DECIMAL[unit]) : 1;
  if (!mult) throw new Error(`invalid memory quantity "${q}"`);
  return Math.round(Number(m[1]) * mult);
}
