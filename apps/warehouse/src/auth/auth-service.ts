import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
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

export type AuthDeps = { users: UsersRepo; mailer: Mailer; sessionTtlSeconds: number; now?: () => Date };

/** Signup → verification mail → verify → login → session. Passwords hashed with scrypt. */
export class AuthService {
  private readonly now: () => Date;
  constructor(private readonly d: AuthDeps) {
    this.now = d.now ?? (() => new Date());
  }

  async signup(ws: string, email: string, password: string, displayName: string): Promise<UserRow> {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new AuthError("BAD_EMAIL", "enter a valid email address");
    if (password.length < 8) throw new AuthError("WEAK_PASSWORD", "password must be at least 8 characters");
    if (await this.d.users.getUser(ws, normalized)) throw new AuthError("EXISTS", "an account with that email already exists", 409);
    const user = await this.d.users.createUser(ws, normalized, await hash(password), displayName.trim() || normalized);
    await this.sendVerification(ws, normalized);
    return user;
  }

  async sendVerification(ws: string, email: string): Promise<void> {
    const code = String(randomInt(100000, 999999));
    await this.d.users.setVerificationCode(ws, email, code, new Date(this.now().getTime() + 30 * 60_000));
    await this.d.mailer.deliver(ws, {
      to: email,
      subject: "Your warehouse verification code",
      body: `Welcome to the warehouse portal.\n\nYour verification code is ${code}. It expires in 30 minutes.\n\nIf you did not sign up, ignore this message.`,
    });
  }

  async verify(ws: string, email: string, code: string): Promise<void> {
    const ok = await this.d.users.consumeVerificationCode(ws, email.trim().toLowerCase(), code.trim(), this.now());
    if (!ok) throw new AuthError("BAD_CODE", "that code is wrong or has expired");
  }

  async login(ws: string, email: string, password: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.d.users.getUser(ws, email.trim().toLowerCase());
    if (!user || !(await matches(password, user.passwordHash))) throw new AuthError("BAD_CREDENTIALS", "wrong email or password", 401);
    if (!user.verifiedAt) throw new AuthError("UNVERIFIED", "verify your email before signing in", 403);
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(this.now().getTime() + this.d.sessionTtlSeconds * 1000);
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
    const token = `whk_${randomBytes(18).toString("hex")}`;
    await this.d.users.setApiToken(ws, email, token);
    return token;
  }
}

async function hash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
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
