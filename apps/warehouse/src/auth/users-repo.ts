import type { Pool } from "@benchme/core";

export type UserRow = { email: string; displayName: string; verifiedAt: Date | null; apiToken: string | null };

/** Signup state per workspace: users, verification codes, sessions, api tokens. */
export interface UsersRepo {
  createUser(ws: string, email: string, passwordHash: string, displayName: string): Promise<UserRow>;
  getUser(ws: string, email: string): Promise<(UserRow & { passwordHash: string }) | null>;
  setVerificationCode(ws: string, email: string, code: string, expiresAt: Date): Promise<void>;
  consumeVerificationCode(ws: string, email: string, code: string, now: Date): Promise<boolean>;
  createSession(ws: string, token: string, email: string, expiresAt: Date): Promise<void>;
  getSessionEmail(ws: string, token: string, now: Date): Promise<string | null>;
  deleteSession(ws: string, token: string): Promise<void>;
  setApiToken(ws: string, email: string, token: string): Promise<void>;
  getUserByApiToken(ws: string, token: string): Promise<UserRow | null>;
}

type URow = { email: string; display_name: string; verified_at: Date | null; api_token: string | null; password_hash: string };
const toUser = (r: URow): UserRow => ({ email: r.email, displayName: r.display_name, verifiedAt: r.verified_at, apiToken: r.api_token });

export class PgUsersRepo implements UsersRepo {
  constructor(private readonly pool: Pool) {}

  async createUser(ws: string, email: string, passwordHash: string, displayName: string): Promise<UserRow> {
    const r = await this.pool.query<URow>(
      "INSERT INTO warehouse.users (workspace_id, email, password_hash, display_name) VALUES ($1, $2, $3, $4) RETURNING *",
      [ws, email, passwordHash, displayName],
    );
    return toUser(r.rows[0] as URow);
  }

  async getUser(ws: string, email: string) {
    const r = await this.pool.query<URow>("SELECT * FROM warehouse.users WHERE workspace_id = $1 AND email = $2", [ws, email]);
    const row = r.rows[0];
    return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
  }

  async setVerificationCode(ws: string, email: string, code: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO warehouse.verification_codes (workspace_id, email, code, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, email) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at`,
      [ws, email, code, expiresAt],
    );
  }

  async consumeVerificationCode(ws: string, email: string, code: string, now: Date): Promise<boolean> {
    const r = await this.pool.query(
      "DELETE FROM warehouse.verification_codes WHERE workspace_id = $1 AND email = $2 AND code = $3 AND expires_at > $4",
      [ws, email, code, now],
    );
    if (!r.rowCount) return false;
    await this.pool.query("UPDATE warehouse.users SET verified_at = COALESCE(verified_at, $3) WHERE workspace_id = $1 AND email = $2", [ws, email, now]);
    return true;
  }

  async createSession(ws: string, token: string, email: string, expiresAt: Date): Promise<void> {
    await this.pool.query("INSERT INTO warehouse.sessions (workspace_id, token, email, expires_at) VALUES ($1, $2, $3, $4)", [ws, token, email, expiresAt]);
  }

  async getSessionEmail(ws: string, token: string, now: Date): Promise<string | null> {
    const r = await this.pool.query<{ email: string }>(
      "SELECT email FROM warehouse.sessions WHERE workspace_id = $1 AND token = $2 AND expires_at > $3",
      [ws, token, now],
    );
    return r.rows[0]?.email ?? null;
  }

  async deleteSession(ws: string, token: string): Promise<void> {
    await this.pool.query("DELETE FROM warehouse.sessions WHERE workspace_id = $1 AND token = $2", [ws, token]);
  }

  async setApiToken(ws: string, email: string, token: string): Promise<void> {
    await this.pool.query("UPDATE warehouse.users SET api_token = $3 WHERE workspace_id = $1 AND email = $2", [ws, email, token]);
  }

  async getUserByApiToken(ws: string, token: string): Promise<UserRow | null> {
    const r = await this.pool.query<URow>("SELECT * FROM warehouse.users WHERE workspace_id = $1 AND api_token = $2", [ws, token]);
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }
}
