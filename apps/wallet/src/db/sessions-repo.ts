import type { Pool } from "@benchme/core";
import { createHash } from "node:crypto";
import type { Session } from "../domain/types.js";

/** Codes and tokens are kept as SHA-256 digests: a leaked table logs no one in. */
export const digest = (secret: string) => createHash("sha256").update(secret).digest("hex");

export type DeviceCode = { userCode: string; clientName: string; connectionLabel: string | null; scope: string; createdAt: Date; expiresAt: Date; sessionId: string | null };

type DeviceRow = { user_code: string; client_name: string; connection_label: string | null; scope: string; created_at: Date; expires_at: Date; session_id: string | null };
type SessionRow = { id: string; client_name: string; connection_label: string | null; scope: string; created_at: Date };

const session = (r: SessionRow): Session => ({ id: r.id, clientName: r.client_name, connectionLabel: r.connection_label, scope: r.scope, createdAt: r.created_at });

/** wallet.device_codes and wallet.sessions: link-cli's device login and the sessions it yields. */
export class SessionsRepo {
  constructor(private readonly pool: Pool) {}

  /** `createdAt` is the service's clock — the one the login delay is counted on — never the database's. */
  async createDeviceCode(deviceCode: string, d: Omit<DeviceCode, "sessionId">): Promise<void> {
    await this.pool.query(
      "INSERT INTO wallet.device_codes (device_code_hash, user_code, client_name, connection_label, scope, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [digest(deviceCode), d.userCode, d.clientName, d.connectionLabel, d.scope, d.createdAt, d.expiresAt],
    );
  }

  async deviceCode(deviceCode: string): Promise<DeviceCode | null> {
    const r = await this.pool.query<DeviceRow>(
      "SELECT user_code, client_name, connection_label, scope, created_at, expires_at, session_id FROM wallet.device_codes WHERE device_code_hash = $1",
      [digest(deviceCode)],
    );
    const row = r.rows[0];
    return row
      ? { userCode: row.user_code, clientName: row.client_name, connectionLabel: row.connection_label, scope: row.scope, createdAt: row.created_at, expiresAt: row.expires_at, sessionId: row.session_id }
      : null;
  }

  /** The device code's one exchange for a session; false when it was exchanged already (by a concurrent poll too). */
  async exchange(deviceCode: string, s: { id: string; accessToken: string; refreshToken: string; accessExpiresAt: Date }, d: DeviceCode): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query("UPDATE wallet.device_codes SET session_id = $2 WHERE device_code_hash = $1 AND session_id IS NULL", [digest(deviceCode), s.id]);
      if (!claimed.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        "INSERT INTO wallet.sessions (id, client_name, connection_label, scope, access_hash, refresh_hash, access_expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [s.id, d.clientName, d.connectionLabel, d.scope, digest(s.accessToken), digest(s.refreshToken), s.accessExpiresAt],
      );
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** The live session an access token opens, or null (unknown, revoked or expired). */
  async byAccessToken(token: string, now: Date): Promise<Session | null> {
    const r = await this.pool.query<SessionRow>(
      "SELECT id, client_name, connection_label, scope, created_at FROM wallet.sessions WHERE access_hash = $1 AND revoked_at IS NULL AND access_expires_at > $2",
      [digest(token), now],
    );
    return r.rows[0] ? session(r.rows[0]) : null;
  }

  /** Swaps a live refresh token for new tokens (both rotate); null when the refresh token is unknown or revoked. */
  async rotate(refreshToken: string, next: { accessToken: string; refreshToken: string; accessExpiresAt: Date }): Promise<Session | null> {
    const r = await this.pool.query<SessionRow>(
      `UPDATE wallet.sessions SET access_hash = $2, refresh_hash = $3, access_expires_at = $4
       WHERE refresh_hash = $1 AND revoked_at IS NULL
       RETURNING id, client_name, connection_label, scope, created_at`,
      [digest(refreshToken), digest(next.accessToken), digest(next.refreshToken), next.accessExpiresAt],
    );
    return r.rows[0] ? session(r.rows[0]) : null;
  }

  /** Revokes the session a token (access or refresh) belongs to; false when none matched. */
  async revoke(token: string): Promise<boolean> {
    const h = digest(token);
    const r = await this.pool.query("UPDATE wallet.sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE access_hash = $1 OR refresh_hash = $1", [h]);
    return (r.rowCount ?? 0) > 0;
  }
}
