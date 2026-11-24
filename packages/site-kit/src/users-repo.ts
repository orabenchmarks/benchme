import type { Pool } from "@benchme/core";
import { createHash } from "node:crypto";
import { hashPassword } from "./auth-service.js";

export type UserRow = { email: string; displayName: string; verifiedAt: Date | null; apiToken: string | null };

/**
 * What trying a verification code came to: the account is `verified`; the code was `wrong` (one try spent); the code
 * is `locked`, its tries all spent on wrong codes, and no code works until a new one is set; or there is `none` to
 * try (never sent, already used, or expired).
 */
export type CodeTry = "verified" | "wrong" | "locked" | "none";

/** Signup state per workspace: users, verification codes, sessions, api tokens. */
export interface UsersRepo {
  createUser(ws: string, email: string, passwordHash: string, displayName: string): Promise<UserRow>;
  /** A sign-up again of an account not yet verified: its password and name are the new ones. Null when it is verified (or gone). */
  renewPendingUser(ws: string, email: string, passwordHash: string, displayName: string): Promise<UserRow | null>;
  getUser(ws: string, email: string): Promise<(UserRow & { passwordHash: string }) | null>;
  /** Sets the code a sign-up is verified with, replacing any before it, with every try left. */
  setVerificationCode(ws: string, email: string, code: string, expiresAt: Date): Promise<void>;
  /**
   * Tries `code` against the sign-up's live code, `maxTries` tries in all. A try is spent before the code is
   * compared, in one statement, so tries made at once cannot compare more codes than there are tries; the right code
   * verifies the account and is used up.
   */
  tryVerificationCode(ws: string, email: string, code: string, now: Date, maxTries: number): Promise<CodeTry>;
  createSession(ws: string, token: string, email: string, expiresAt: Date): Promise<void>;
  getSessionEmail(ws: string, token: string, now: Date): Promise<string | null>;
  deleteSession(ws: string, token: string): Promise<void>;
  setApiToken(ws: string, email: string, token: string): Promise<void>;
  getUserByApiToken(ws: string, token: string): Promise<UserRow | null>;
}

type URow = { email: string; display_name: string; verified_at: Date | null; api_token: string | null; password_hash: string };
const toUser = (r: URow): UserRow => ({ email: r.email, displayName: r.display_name, verifiedAt: r.verified_at, apiToken: r.api_token });

const SCHEMA = /^[a-z_][a-z0-9_]*$/;

/**
 * The same four tables (users, verification_codes, sessions + api_token on
 * users) under any app schema — every site owns its signups, none share rows.
 */
export class PgUsersRepo implements UsersRepo {
  private readonly s: string;
  constructor(
    private readonly pool: Pool,
    schema: string,
  ) {
    if (!SCHEMA.test(schema)) throw new Error(`invalid schema name: ${schema}`);
    this.s = schema;
  }

  async createUser(ws: string, email: string, passwordHash: string, displayName: string): Promise<UserRow> {
    const r = await this.pool.query<URow>(
      `INSERT INTO ${this.s}.users (workspace_id, email, password_hash, display_name) VALUES ($1, $2, $3, $4) RETURNING *`,
      [ws, email, passwordHash, displayName],
    );
    return toUser(r.rows[0] as URow);
  }

  async renewPendingUser(ws: string, email: string, passwordHash: string, displayName: string): Promise<UserRow | null> {
    const r = await this.pool.query<URow>(
      `UPDATE ${this.s}.users SET password_hash = $3, display_name = $4 WHERE workspace_id = $1 AND email = $2 AND verified_at IS NULL RETURNING *`,
      [ws, email, passwordHash, displayName],
    );
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }

  async getUser(ws: string, email: string) {
    const r = await this.pool.query<URow>(`SELECT * FROM ${this.s}.users WHERE workspace_id = $1 AND email = $2`, [ws, email]);
    const row = r.rows[0];
    return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
  }

  async setVerificationCode(ws: string, email: string, code: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.s}.verification_codes (workspace_id, email, code, expires_at, attempts) VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (workspace_id, email) DO UPDATE SET code = EXCLUDED.code, expires_at = EXCLUDED.expires_at, attempts = 0`,
      [ws, email, code, expiresAt],
    );
  }

  async tryVerificationCode(ws: string, email: string, code: string, now: Date, maxTries: number): Promise<CodeTry> {
    // The try is spent and the code read in one statement, under the row's lock: no two tries can see one try left.
    const spent = await this.pool.query<{ code: string }>(
      `UPDATE ${this.s}.verification_codes SET attempts = attempts + 1
       WHERE workspace_id = $1 AND email = $2 AND expires_at > $3 AND attempts < $4 RETURNING code`,
      [ws, email, now, maxTries],
    );
    const held = spent.rows[0];
    if (!held) {
      const live = await this.pool.query(`SELECT 1 FROM ${this.s}.verification_codes WHERE workspace_id = $1 AND email = $2 AND expires_at > $3`, [ws, email, now]);
      return live.rowCount ? "locked" : "none";
    }
    if (held.code !== code) return "wrong";
    await this.pool.query(`DELETE FROM ${this.s}.verification_codes WHERE workspace_id = $1 AND email = $2 AND code = $3`, [ws, email, code]);
    await this.pool.query(`UPDATE ${this.s}.users SET verified_at = COALESCE(verified_at, $3) WHERE workspace_id = $1 AND email = $2`, [ws, email, now]);
    return "verified";
  }

  async createSession(ws: string, token: string, email: string, expiresAt: Date): Promise<void> {
    await this.pool.query(`INSERT INTO ${this.s}.sessions (workspace_id, token, email, expires_at) VALUES ($1, $2, $3, $4)`, [ws, token, email, expiresAt]);
  }

  async getSessionEmail(ws: string, token: string, now: Date): Promise<string | null> {
    const r = await this.pool.query<{ email: string }>(
      `SELECT email FROM ${this.s}.sessions WHERE workspace_id = $1 AND token = $2 AND expires_at > $3`,
      [ws, token, now],
    );
    return r.rows[0]?.email ?? null;
  }

  async deleteSession(ws: string, token: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.s}.sessions WHERE workspace_id = $1 AND token = $2`, [ws, token]);
  }

  async setApiToken(ws: string, email: string, token: string): Promise<void> {
    await this.pool.query(`UPDATE ${this.s}.users SET api_token = $3 WHERE workspace_id = $1 AND email = $2`, [ws, email, token]);
  }

  async getUserByApiToken(ws: string, token: string): Promise<UserRow | null> {
    const r = await this.pool.query<URow>(`SELECT * FROM ${this.s}.users WHERE workspace_id = $1 AND api_token = $2`, [ws, token]);
    return r.rows[0] ? toUser(r.rows[0]) : null;
  }
}

/** An account a scenario's workspace starts with: signed up and verified already. */
export type SeedAccount = { email: string; name: string; password: string };
/** When a seeded account was verified: one fixed moment, so two workspaces of one seed hold the same rows. */
const SEEDED_AT = "2027-01-01T00:00:00Z";

/**
 * Signs a scenario's accounts up on a site, verified, as if each owner had
 * signed up and read their code. The salt comes from the schema and the
 * email, so the same seed gives byte-identical rows in every workspace; the
 * password still only matches through scrypt, as any other account's does.
 * An account already there is left as it is.
 */
export async function seedAccounts(pool: Pool, schema: string, ws: string, accounts: readonly SeedAccount[]): Promise<void> {
  if (!SCHEMA.test(schema)) throw new Error(`invalid schema name: ${schema}`);
  for (const a of accounts) {
    const email = a.email.trim().toLowerCase();
    const salt = createHash("sha256").update(`${schema}:${email}`).digest("hex").slice(0, 32);
    await pool.query(
      `INSERT INTO ${schema}.users (workspace_id, email, password_hash, display_name, verified_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, email) DO NOTHING`,
      [ws, email, await hashPassword(a.password, salt), a.name, SEEDED_AT],
    );
  }
}

/** The same contract in memory, for tests of what signs people up and in. */
export class MemoryUsersRepo implements UsersRepo {
  private readonly users = new Map<string, UserRow & { passwordHash: string }>();
  private readonly codes = new Map<string, { code: string; expiresAt: Date; attempts: number }>();
  private readonly sessions = new Map<string, { email: string; expiresAt: Date }>();
  private readonly key = (ws: string, id: string) => `${ws} ${id}`;

  async createUser(ws: string, email: string, passwordHash: string, displayName: string): Promise<UserRow> {
    const user = { email, displayName, verifiedAt: null, apiToken: null, passwordHash };
    this.users.set(this.key(ws, email), user);
    return { email, displayName, verifiedAt: null, apiToken: null };
  }

  async renewPendingUser(ws: string, email: string, passwordHash: string, displayName: string): Promise<UserRow | null> {
    const user = this.users.get(this.key(ws, email));
    if (!user || user.verifiedAt) return null;
    Object.assign(user, { passwordHash, displayName });
    return { email, displayName, verifiedAt: null, apiToken: user.apiToken };
  }

  async getUser(ws: string, email: string) {
    return this.users.get(this.key(ws, email)) ?? null;
  }

  async setVerificationCode(ws: string, email: string, code: string, expiresAt: Date): Promise<void> {
    this.codes.set(this.key(ws, email), { code, expiresAt, attempts: 0 });
  }

  async tryVerificationCode(ws: string, email: string, code: string, now: Date, maxTries: number): Promise<CodeTry> {
    const held = this.codes.get(this.key(ws, email));
    if (!held || held.expiresAt <= now) return "none";
    if (held.attempts >= maxTries) return "locked";
    held.attempts += 1;
    if (held.code !== code) return "wrong";
    this.codes.delete(this.key(ws, email));
    const user = this.users.get(this.key(ws, email));
    if (user) user.verifiedAt ??= now;
    return "verified";
  }

  async createSession(ws: string, token: string, email: string, expiresAt: Date): Promise<void> {
    this.sessions.set(this.key(ws, token), { email, expiresAt });
  }

  async getSessionEmail(ws: string, token: string, now: Date): Promise<string | null> {
    const s = this.sessions.get(this.key(ws, token));
    return s && s.expiresAt > now ? s.email : null;
  }

  async deleteSession(ws: string, token: string): Promise<void> {
    this.sessions.delete(this.key(ws, token));
  }

  async setApiToken(ws: string, email: string, token: string): Promise<void> {
    const user = this.users.get(this.key(ws, email));
    if (user) user.apiToken = token;
  }

  async getUserByApiToken(ws: string, token: string): Promise<UserRow | null> {
    for (const [k, u] of this.users) if (k.startsWith(`${ws} `) && u.apiToken === token) return { email: u.email, displayName: u.displayName, verifiedAt: u.verifiedAt, apiToken: u.apiToken };
    return null;
  }
}
