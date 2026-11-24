import type { Door } from "./door.js";

/**
 * The one reason code a write gets, through any door, when nobody is signed
 * in. It is the code the REST door has always answered with, so nothing a REST
 * caller reads changed when the other doors started asking the same.
 */
export const SIGN_IN_REQUIRED_CODE = "UNAUTHORIZED";

/** What each door tells a caller it refused, in that door's own terms. */
const HOW_TO_SIGN_IN: Record<Door, string> = {
  page: "sign in to do that",
  rest: "sign in or send Authorization: Bearer <api token>",
  mcp: "sign in first: call sign_up (the workspace inbox shows the code mailed to an address new to the workspace), then verify_email, then sign_in (or connect with Authorization: Bearer <api token>)",
  webmcp: "sign in first: on the site's sign-in page, or call sign_up (the workspace inbox shows the code mailed to an address new to the workspace), then verify_email, then sign_in",
};

/**
 * A write by nobody. Thrown by the site's rules (see `ledgered`), which is
 * where every door ends up, and answered by the door it came through: REST
 * with a 401, a page by sending the visitor to sign in, a tool with an error
 * result. Not a DomainError on purpose: a page's own handler re-renders a
 * rule's refusal in place, and this one is the door's to answer.
 */
export class SignInRequired extends Error {
  readonly code = SIGN_IN_REQUIRED_CODE;
  readonly status = 401;
  constructor(readonly door: Door) {
    super(HOW_TO_SIGN_IN[door]);
    this.name = "SignInRequired";
  }
}
