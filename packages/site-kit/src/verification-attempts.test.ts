import { describe, expect, it } from "vitest";
import { CODE_ATTEMPTS } from "./accounts-schema.js";
import { AuthService, type Mailer } from "./auth-service.js";
import { MemoryUsersRepo } from "./users-repo.js";

const WS = "ws_0123456789ab";
const OTHER_WS = "ws_ba9876543210";
const PASSWORD = "correct-horse-9";

class CapturingMailer implements Mailer {
  sent: { ws: string; to: string; body: string }[] = [];
  async deliver(ws: string, msg: { to: string; subject: string; body: string }) {
    this.sent.push({ ws, ...msg });
  }
}

function accounts(now = () => new Date("2027-03-01T10:00:00Z")) {
  const mailer = new CapturingMailer();
  const auth = new AuthService({ users: new MemoryUsersRepo(), mailer, sessionTtlSeconds: 3600, tokenPrefix: "t", verification: { subject: "Your code", body: (code) => `Your code is ${code}.` }, now });
  /** The code last mailed to `email` in `ws`. */
  const code = (email: string, ws = WS) => /code is (\d{6})/.exec(mailer.sent.filter((m) => m.ws === ws && m.to === email).at(-1)!.body)![1]!;
  /** A code that is not `right`: one digit changed. */
  const wrong = (right: string) => `${right.slice(0, 5)}${(Number(right[5]) + 1) % 10}`;
  /** What verifying answered: "ok", or the refusal's code. */
  const verify = (email: string, tried: string, ws = WS) =>
    auth.verify(ws, email, tried).then(
      () => "ok",
      (err: { code: string }) => err.code,
    );
  return { auth, mailer, code, wrong, verify };
}

describe("a verification code's tries", () => {
  it(`takes the right code after ${CODE_ATTEMPTS - 1} wrong ones`, async () => {
    const a = accounts();
    await a.auth.signup(WS, "ilsa@example.com", PASSWORD, "Ilsa");
    const right = a.code("ilsa@example.com");
    for (let i = 1; i < CODE_ATTEMPTS; i++) expect(await a.verify("ilsa@example.com", a.wrong(right))).toBe("BAD_CODE");
    expect(await a.verify("ilsa@example.com", right)).toBe("ok");
    expect((await a.auth.login(WS, "ilsa@example.com", PASSWORD)).token).toMatch(/^[0-9a-f]{48}$/);
  });

  it(`refuses even the right code after ${CODE_ATTEMPTS} wrong ones, with a reason of its own`, async () => {
    const a = accounts();
    await a.auth.signup(WS, "ilsa@example.com", PASSWORD, "Ilsa");
    const right = a.code("ilsa@example.com");
    for (let i = 0; i < CODE_ATTEMPTS; i++) expect(await a.verify("ilsa@example.com", a.wrong(right))).toBe("BAD_CODE");
    expect(await a.verify("ilsa@example.com", right)).toBe("TOO_MANY_ATTEMPTS");
    expect(await a.verify("ilsa@example.com", a.wrong(right))).toBe("TOO_MANY_ATTEMPTS");
    expect(await a.verify("ilsa@example.com", right)).toBe("TOO_MANY_ATTEMPTS");
    await expect(a.auth.login(WS, "ilsa@example.com", PASSWORD)).rejects.toMatchObject({ code: "UNVERIFIED" });
    // It says how to get a new code, and is a refusal in HTTP's terms.
    await expect(a.auth.verify(WS, "ilsa@example.com", right)).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/Sign up again/) });
  });

  it("gives a sign-up made again a new code with every try back, and its new password; the old code no longer works", async () => {
    const a = accounts();
    await a.auth.signup(WS, "ilsa@example.com", PASSWORD, "Ilsa");
    const first = a.code("ilsa@example.com");
    for (let i = 0; i < CODE_ATTEMPTS; i++) await a.verify("ilsa@example.com", a.wrong(first));
    expect(await a.verify("ilsa@example.com", first)).toBe("TOO_MANY_ATTEMPTS");

    const again = await a.auth.signup(WS, " ILSA@example.com ", "another-horse-7", "Ilsa B.");
    expect(again).toMatchObject({ email: "ilsa@example.com", displayName: "Ilsa B.", verifiedAt: null });
    const second = a.code("ilsa@example.com");
    expect(a.mailer.sent.filter((m) => m.to === "ilsa@example.com")).toHaveLength(2);
    if (second !== first) expect(await a.verify("ilsa@example.com", first)).toBe("BAD_CODE");
    for (let i = 2; i < CODE_ATTEMPTS; i++) expect(await a.verify("ilsa@example.com", a.wrong(second))).toBe("BAD_CODE");
    expect(await a.verify("ilsa@example.com", second)).toBe("ok");
    await expect(a.auth.login(WS, "ilsa@example.com", PASSWORD)).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    expect((await a.auth.login(WS, "ilsa@example.com", "another-horse-7")).token).toBeTruthy();
    // Verified, the account is no longer a sign-up to make again.
    await expect(a.auth.signup(WS, "ilsa@example.com", PASSWORD, "Someone")).rejects.toMatchObject({ code: "EXISTS", status: 409 });
  });

  it("counts the tries of one pending sign-up in one workspace, and no other", async () => {
    const a = accounts();
    for (const [ws, email] of [[WS, "ilsa@example.com"], [WS, "mina@example.com"], [OTHER_WS, "ilsa@example.com"]] as const) await a.auth.signup(ws, email, PASSWORD, "Someone");
    const locked = a.code("ilsa@example.com");
    for (let i = 0; i < CODE_ATTEMPTS; i++) await a.verify("ilsa@example.com", a.wrong(locked));
    expect(await a.verify("ilsa@example.com", locked)).toBe("TOO_MANY_ATTEMPTS");
    expect(await a.verify("mina@example.com", a.code("mina@example.com"))).toBe("ok");
    expect(await a.verify("ilsa@example.com", a.code("ilsa@example.com", OTHER_WS), OTHER_WS)).toBe("ok");
  });

  it("answers a code that expired, or that was never sent, as a wrong one, and spends no try on it", async () => {
    let now = new Date("2027-03-01T10:00:00Z");
    const a = accounts(() => now);
    expect(await a.verify("nobody@example.com", "123456")).toBe("BAD_CODE");
    await a.auth.signup(WS, "ilsa@example.com", PASSWORD, "Ilsa");
    const right = a.code("ilsa@example.com");
    now = new Date("2027-03-01T10:31:00Z");
    for (let i = 0; i <= CODE_ATTEMPTS; i++) expect(await a.verify("ilsa@example.com", right)).toBe("BAD_CODE");
  });
});
