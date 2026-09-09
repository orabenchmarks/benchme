import type { Pool, Verdict } from "@benchme/core";
import { randomBytes } from "node:crypto";

export type Attempt = { id: string; taskId: string; kind: string; verdict: Verdict; receipt: string; details: unknown[]; artifactSize: number; createdAt: string };

export interface AttemptsRepo {
  record(ws: string, a: { taskId: string; kind: string; verdict: Verdict; receipt: string; details: unknown[]; artifact: Buffer }): Promise<Attempt>;
  listForTask(ws: string, taskId: string): Promise<Attempt[]>;
  countForTask(ws: string, taskId: string): Promise<number>;
}

type Row = { id: string; task_id: string; kind: string; verdict: Verdict; receipt: string; details: unknown[]; artifact_size: number; created_at: Date };
const toAttempt = (r: Row): Attempt => ({ id: r.id, taskId: r.task_id, kind: r.kind, verdict: r.verdict, receipt: r.receipt, details: r.details, artifactSize: r.artifact_size, createdAt: r.created_at.toISOString() });

export class PgAttemptsRepo implements AttemptsRepo {
  constructor(private readonly pool: Pool) {}

  async record(ws: string, a: { taskId: string; kind: string; verdict: Verdict; receipt: string; details: unknown[]; artifact: Buffer }): Promise<Attempt> {
    const id = `at_${randomBytes(6).toString("hex")}`;
    const r = await this.pool.query<Row>(
      `INSERT INTO verify.attempts (workspace_id, id, task_id, kind, verdict, receipt, details, artifact, artifact_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) RETURNING id, task_id, kind, verdict, receipt, details, artifact_size, created_at`,
      [ws, id, a.taskId, a.kind, a.verdict, a.receipt, JSON.stringify(a.details), a.artifact, a.artifact.length],
    );
    return toAttempt(r.rows[0] as Row);
  }

  async listForTask(ws: string, taskId: string): Promise<Attempt[]> {
    const r = await this.pool.query<Row>(
      "SELECT id, task_id, kind, verdict, receipt, details, artifact_size, created_at FROM verify.attempts WHERE workspace_id = $1 AND task_id = $2 ORDER BY created_at",
      [ws, taskId],
    );
    return r.rows.map(toAttempt);
  }

  async countForTask(ws: string, taskId: string): Promise<number> {
    const r = await this.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM verify.attempts WHERE workspace_id = $1 AND task_id = $2", [ws, taskId]);
    return Number(r.rows[0]?.n ?? 0);
  }
}
