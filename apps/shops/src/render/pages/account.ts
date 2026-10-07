import { breadcrumb, esc, href } from "../components.js";
import { layout, type StoreCtx } from "../layout.js";

/**
 * /account — the sign-in page the header's account link opens, with the nudge real stores make:
 * no account is needed to order, guest checkout is the default.
 */
export function accountPage(ctx: StoreCtx, s: { error?: string; email?: string } = {}): string {
  const body = `<div class="container">${breadcrumb(ctx, [{ label: "Account" }])}</div>
<div class="container account">
<section class="account__panel" aria-labelledby="sign-in-title">
<h1 class="account__title" id="sign-in-title">Sign in</h1>
${s.error ? `<p class="form-error" role="alert">${esc(s.error)}</p>` : ""}
<form class="form" method="post" action="${esc(href(ctx, "/account/sign-in"))}">
<label class="field"><span class="field__label">Email</span><input type="email" name="email" autocomplete="email" required value="${esc(s.email ?? "")}"></label>
<label class="field"><span class="field__label">Password</span><input type="password" name="password" autocomplete="current-password" required></label>
<button class="btn btn--primary btn--block" type="submit">Sign in</button>
</form>
</section>
<section class="account__panel account__panel--guest" aria-labelledby="guest-title">
<h2 class="account__title" id="guest-title">New here?</h2>
<p>You don't need an account to order. Check out as a guest and we'll email your order confirmation and updates.</p>
<p><a class="btn btn--secondary btn--block" href="${esc(href(ctx, "/cart"))}">Go to your cart</a></p>
<p><a class="link" href="${esc(href(ctx, "/collections/all"))}">Continue shopping</a></p>
</section>
</div>`;
  return layout(ctx, "Sign in", body, { bodyClass: "page-account" });
}
