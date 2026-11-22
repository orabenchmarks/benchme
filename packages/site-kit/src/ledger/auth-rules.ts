import type { AuthService } from "../auth-service.js";
import { authStep, unrecorded, type LedgerRules } from "./rules.js";

const email = (address: string) => address.trim().toLowerCase();

/**
 * What a site's ledger keeps of signing up and in, whichever door it was done
 * through (the pages' forms and the sign-in tools both call the one
 * AuthService): each step with the account's email, and a refused one with its
 * reason (`EXISTS`, `BAD_CODE`, `BAD_CREDENTIALS`, `UNVERIFIED`). They are
 * `auth` entries: an account is not a change to what the site sells. Looking a
 * session up, which every request does, is not recorded.
 */
export const AUTH_LEDGER: LedgerRules<AuthService> = {
  signup: authStep("sign_up", ([address]) => email(address)),
  verify: authStep("verify", ([address]) => email(address)),
  login: authStep("sign_in", ([address]) => email(address)),
  logout: authStep("sign_out", () => null),
  issueApiToken: authStep("issue_token", ([address]) => email(address)),
  sendVerification: unrecorded,
  userForSession: unrecorded,
  userForApiToken: unrecorded,
};
