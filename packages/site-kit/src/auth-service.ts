import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { CODE_ATTEMPTS } from "./accounts-schema.js";
import type { UserRow, UsersRepo } from "./users-repo.js";

const scrypt = promisify(scryptCb);

/** Delivers mail to the workspace inbox (the mail app); one method so tests can capture it. */
export interface Mailer {
  deliver(ws: string, msg: { to: string; subject: string; body: string }): Promise<void>;
}

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** What the verification mail says — each site words its own. */
export type VerificationCopy = { subject: string; body: (code: string) => string };

export type AuthDeps = {
  users: UsersRepo;
  mailer: Mailer;
  sessionTtlSeconds: number;
  verification: VerificationCopy;
  /** Prefix of issued api tokens (e.g. "whk", "hdk") so a token names its site. */
  tokenPrefix: string;
  now?: () => Date;
};

const EXISTS = () => new AuthError("EXISTS", "an account with that email already exists", 409);

/**
 * Signup → verification mail → verify → login → session. Passwords hashed with scrypt. Shared by every site.
 *
 * A pending sign-up's code may be tried CODE_ATTEMPTS times: after that many wrong codes it no longer works, even
 * the right one, so a six-digit code cannot be guessed. Only a new code gives it more tries, and signing up again
 * with an email that is not verified yet is how one gets it: the sign-up is made again, with the password and name
 * it gives, and a new code is mailed.
 */
export class AuthService {
  private readonly now: () => Date;
  constructor(private readonly d: AuthDeps) {
    this.now = d.now ?? (() => new Date());
  }

  async signup(ws: string, email: string, password: string, displayName: string): Promise<UserRow> {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new AuthError("BAD_EMAIL", "enter a valid email address");
    if (password.length < 8) throw new AuthError("WEAK_PASSWORD", "password must be at least 8 characters");
    const existing = await this.d.users.getUser(ws, normalized);
    if (existing?.verifiedAt) throw EXISTS();
    const passwordHash = await hash(password);
    const name = displayName.trim() || normalized;
    const user = existing ? await this.d.users.renewPendingUser(ws, normalized, passwordHash, name) : await this.d.users.createUser(ws, normalized, passwordHash, name);
    if (!user) throw EXISTS();
    await this.sendVerification(ws, normalized);
    return user;
  }

  async sendVerification(ws: string, email: string): Promise<void> {
    const code = String(randomInt(100000, 999999));
    await this.d.users.setVerificationCode(ws, email, code, new Date(this.now().getTime() + 30 * 60_000));
    await this.d.mailer.deliver(ws, { to: email, subject: this.d.verification.subject, body: this.d.verification.body(code) });
  }

  async verify(ws: string, email: string, code: string): Promise<void> {
    const tried = await this.d.users.tryVerificationCode(ws, email.trim().toLowerCase(), code.trim(), this.now(), CODE_ATTEMPTS);
    if (tried === "locked") throw new AuthError("TOO_MANY_ATTEMPTS", `too many wrong codes: after ${CODE_ATTEMPTS} this sign-up's code no longer works. Sign up again with the same email to be sent a new one`, 429);
    if (tried !== "verified") throw new AuthError("BAD_CODE", "that code is wrong or has expired");
  }

  /**
   * `bindTo` stores the session under a token the caller already holds (an MCP
   * session's id) instead of a fresh one, replacing whoever was signed in
   * under it: a client that cannot keep a cookie stays signed in by what it
   * already repeats on every request.
   */
  async login(ws: string, email: string, password: string, bindTo?: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.d.users.getUser(ws, email.trim().toLowerCase());
    if (!user || !(await matches(password, user.passwordHash))) throw new AuthError("BAD_CREDENTIALS", "wrong email or password", 401);
    if (!user.verifiedAt) throw new AuthError("UNVERIFIED", "verify your email before signing in", 403);
    const token = bindTo ?? randomBytes(24).toString("hex");
    const expiresAt = new Date(this.now().getTime() + this.d.sessionTtlSeconds * 1000);
    if (bindTo) await this.d.users.deleteSession(ws, bindTo);
    await this.d.users.createSession(ws, token, user.email, expiresAt);
    return { token, expiresAt };
  }

  async logout(ws: string, token: string): Promise<void> {
    await this.d.users.deleteSession(ws, token);
  }

  async userForSession(ws: string, token: string | undefined): Promise<UserRow | null> {
    if (!token) return null;
    const email = await this.d.users.getSessionEmail(ws, token, this.now());
    if (!email) return null;
    const u = await this.d.users.getUser(ws, email);
    return u ? { email: u.email, displayName: u.displayName, verifiedAt: u.verifiedAt, apiToken: u.apiToken } : null;
  }

  async userForApiToken(ws: string, token: string | undefined): Promise<UserRow | null> {
    if (!token) return null;
    return this.d.users.getUserByApiToken(ws, token);
  }

  async issueApiToken(ws: string, email: string): Promise<string> {
    const token = `${this.d.tokenPrefix}_${randomBytes(18).toString("hex")}`;
    await this.d.users.setApiToken(ws, email, token);
    return token;
  }
}

async function hash(password: string): Promise<string> {
  return hashPassword(password, randomBytes(16).toString("hex"));
}

/** A password as the users table keeps it: `salt:key`, the key scrypt's of the password with that salt. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = (await scrypt(password, salt, 32)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

async function matches(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const key = (await scrypt(password, salt, 32)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
