/*
 * pay.js — the checkout's script, loaded on every checkout step after store.js. Every step works
 * without it (plain form posts). With it, a delivery date field says the chosen date in words as it
 * changes, and the payment step does what a payment form does:
 *
 * - reads #checkout-config (JSON on the page: the mode, the surface, the URLs, and for Stripe the
 *   publishable key, the methods, the Appearance API theme built from the brand's tokens and the
 *   billing details the card fields start from);
 * - before every attempt calls the intent endpoint with the total the page shows, which keeps the
 *   checkout's one PaymentIntent at its current total; an answer with { priceUpdated } means the total
 *   changed since the page was shown: a banner shows the new totals, and the shopper confirms by
 *   paying again;
 * - Stripe: the Payment Element, card only (no wallet inside it: Link there offered a bank account and
 *   Klarna beside the card), and on the express-checkout surface the Express Checkout Element with Link
 *   only, above it; then stripe.confirmPayment with redirect "if_required". A payment is confirmed with
 *   manual capture (cfg.captureMethod): a card that pays is authorized, and the report endpoint takes it —
 *   or declines the card, when the shopper's wallet will not let it pay this much, which is shown like any
 *   decline; a payment taken goes to the store's completion URL, an error is shown under the button;
 * - a card form in the store's own fields has a script of its own, loaded before this one
 *   (window.checkoutCardForm): it is handed the step's shared pieces below and takes the form from there;
 * - the hosted surface's button is disabled once clicked, so a double click starts one session.
 *
 * Data is only ever put into the page with DOM APIs (textContent, setAttribute): never innerHTML.
 */
(function () {
  "use strict";

  var usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  var money = function (cents) { return usd.format(cents / 100); };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      node.setAttribute(k, v === true ? "" : String(v));
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  /** A same-site path from the server, or null: never another origin, never a javascript: URL. */
  function safePath(u) {
    return typeof u === "string" && u.charAt(0) === "/" && u.charAt(1) !== "/" ? u : null;
  }

  function go(path) {
    var p = safePath(path);
    if (p) window.location.assign(p);
  }

  /** POST a form-encoded body, asking for JSON: resolves { status, ok, json }. */
  function post(url, data) {
    var params = new URLSearchParams();
    Object.keys(data || {}).forEach(function (k) { params.append(k, String(data[k])); });
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }).then(function (res) {
      var type = res.headers.get("content-type") || "";
      var body = type.indexOf("application/json") >= 0 ? res.json() : Promise.resolve(null);
      return body.then(function (json) { return { status: res.status, ok: res.ok, json: json }; });
    });
  }

  /* ------------------------------------------------------------ the payment step */

  var cfgNode = document.getElementById("checkout-config");
  var cfg = null;
  try { cfg = cfgNode ? JSON.parse(cfgNode.textContent || "null") : null; } catch (e) { cfg = null; }

  var hosted = $(".payment-block--hosted");
  if (hosted) {
    hosted.addEventListener("submit", function () {
      var b = $("[data-pay-button]", hosted);
      if (b) { b.disabled = true; b.textContent = "Redirecting to secure payment…"; }
    });
  }
  // Coming back with the browser's back button: buttons work again.
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    $$("[data-pay-button]").forEach(function (b) { b.disabled = false; });
  });

  /* ------------------------------------------------------------ a delivery date, in words */

  // The chosen date as a shopper says it ("Tomorrow, Thursday, October 8"), counted from the store's own
  // today (data-today), which a shopper's clock in another time zone may already have left.
  var DAY_MS = 86400000;
  function dayOf(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
    var d = new Date(iso + "T12:00:00Z");
    return isNaN(d.getTime()) ? null : d;
  }
  $$("input[type=date][data-today]").forEach(function (input) {
    var status = document.getElementById(input.id + "-status");
    var today = dayOf(input.getAttribute("data-today"));
    if (!status || !today) return;
    function say() {
      var d = dayOf(input.value);
      if (!d) { status.textContent = ""; return; }
      var ahead = Math.round((d.getTime() - today.getTime()) / DAY_MS);
      var words = d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
      status.textContent = (ahead === 0 ? "Today, " : ahead === 1 ? "Tomorrow, " : "") + words;
    }
    input.addEventListener("input", say);
    input.addEventListener("change", say);
  });

  if (!cfg || !cfg.urls) return;

  var block = $("[data-surface]");
  var button = block && $("[data-pay-button]", block);
  var errorBox = block && $("[data-payment-error]", block);
  if (!block || !button) return;
  var buttonContent = Array.prototype.slice.call(button.childNodes).map(function (n) { return n.cloneNode(true); });
  var busy = false;

  function setBusy(on, label) {
    busy = on;
    button.disabled = on;
    while (button.firstChild) button.removeChild(button.firstChild);
    if (on) button.appendChild(el("span", { class: "pay-button__spinner", "aria-hidden": "true" }, []));
    if (on) button.appendChild(document.createTextNode(label || "Processing…"));
    else buttonContent.forEach(function (n) { button.appendChild(n.cloneNode(true)); });
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || "Something went wrong. Please try again.";
    errorBox.hidden = false;
  }
  function clearError() {
    if (!errorBox) return;
    errorBox.textContent = "";
    errorBox.hidden = true;
    var banner = $("[data-error-banner]");
    if (banner) banner.hidden = true;
  }

  /** The order summary and the button follow a new total. */
  function setAmounts(totals) {
    if (!totals) return;
    cfg.amountCents = totals.totalCents;
    $$("[data-summary-total], [data-summary-total-toggle], [data-pay-amount]").forEach(function (n) { n.textContent = money(totals.totalCents); });
    buttonContent.forEach(function (n) {
      if (n.querySelector) { var a = n.querySelector("[data-pay-amount]"); if (a) a.textContent = money(totals.totalCents); }
    });
    var ship = $("[data-summary-shipping] dd");
    if (ship && typeof totals.shippingCents === "number") ship.textContent = totals.shippingCents === 0 ? "Free" : money(totals.shippingCents);
    if (typeof totals.shippingCents === "number") {
      $$("[data-review-shipping]").forEach(function (n) {
        n.textContent = n.getAttribute("data-review-shipping") + " · " + (totals.shippingCents === 0 ? "Free" : money(totals.shippingCents));
      });
    }
    var tax = $("[data-summary-tax] dd");
    if (tax && typeof totals.taxCents === "number") tax.textContent = money(totals.taxCents);
  }

  /** A changed total an attempt was answered with: a banner, the new totals, and a second click to pay. */
  function showPriceUpdate(update, totals) {
    setAmounts(totals || { totalCents: update.newCents });
    var banner = $("[data-price-banner]");
    if (!banner) return;
    while (banner.firstChild) banner.removeChild(banner.firstChild);
    banner.appendChild(el("p", null, [
      el("strong", null, [String(update.label || "Price updated") + ":"]),
      " your total is now ",
      el("strong", null, [money(update.newCents)]),
      " (was " + money(update.oldCents) + "). Review it, then pay again to confirm.",
    ]));
    banner.hidden = false;
    banner.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /**
   * The intent call every attempt starts with. It says which total the page shows, so a page opened before
   * a price update (another tab, a page left open) is answered with the update instead of a payment.
   * Resolves the intent's answer, or null when it already handled the outcome (a price update shown, a
   * redirect taken, an error shown).
   */
  function startAttempt() {
    return post(cfg.urls.intent, { shownCents: cfg.amountCents }).then(function (r) {
      var j = r.json || {};
      if (r.status === 409 && j.redirect) { go(j.redirect); return null; }
      if (r.ok && j.priceUpdated) { showPriceUpdate(j.priceUpdated, j.totals); return null; }
      if (!r.ok || !j.clientSecret) { showError(j.message || "We couldn't start the payment. Please try again."); return null; }
      if (typeof j.amountCents === "number" && j.amountCents !== cfg.amountCents) setAmounts({ totalCents: j.amountCents });
      return j;
    });
  }

  /* ------------------------------------------------------------ Stripe mode: Elements */

  function stripeFlow() {
    var mount = $("[data-payment-element]", block);
    if (typeof window.Stripe !== "function" || !mount) {
      showError("We couldn't load the secure card form. Check your connection and reload the page.");
      return;
    }
    var stripe = window.Stripe(cfg.publishableKey);
    // The methods the store takes, by Stripe.js's current name for the option (as the server's
    // allowed_payment_method_types): card, plus Link on the express surface — for its Express Checkout Element.
    var elements = stripe.elements({
      mode: "payment",
      amount: cfg.amountCents,
      currency: "usd",
      allowedPaymentMethodTypes: cfg.methods,
      captureMethod: cfg.captureMethod || "automatic",
      appearance: cfg.appearance,
      fonts: cfg.fonts || [],
    });
    // Whom the card's billing details start from: the page says (at a florist, the sender, never the recipient).
    var billing = cfg.billing || {};
    // The card form alone: no wallet inside the Payment Element. Link there brought its own ways to pay
    // (a bank account, Klarna) beside the card; the express surface offers Link on its own element above.
    var payment = elements.create("payment", {
      layout: "tabs",
      wallets: { link: "never", applePay: "never", googlePay: "never" },
      defaultValues: { billingDetails: { name: billing.name || "", email: billing.email || "", address: { postal_code: billing.postalCode || "", country: "US" } } },
    });
    payment.on("ready", function () {
      var loading = $(".payment-loading", mount);
      if (loading && loading.parentNode) loading.parentNode.removeChild(loading);
      button.disabled = false;
    });
    payment.on("loaderror", function (e) { showError((e && e.error && e.error.message) || "We couldn't load the secure card form. Please reload the page."); });
    payment.mount(mount);

    /**
     * A confirmation that failed, needs action or was authorized, for the store (it reads the payment back itself, and
     * takes an authorized one or declines its card). Resolves the store's answer, or null. Never fails.
     */
    function report(id) {
      if (!cfg.urls.report || !id) return Promise.resolve(null);
      return post(cfg.urls.report, { payment_intent: id }).catch(function () { return null; });
    }

    function pay(expressEvent) {
      if (busy) return;
      clearError();
      setBusy(true);
      var fail = function (message) {
        setBusy(false);
        showError(message);
        if (expressEvent && typeof expressEvent.paymentFailed === "function") expressEvent.paymentFailed({ reason: "fail" });
      };
      elements
        .submit()
        .then(function (submitted) {
          if (submitted && submitted.error) { fail(submitted.error.message); return; }
          return startAttempt().then(function (intent) {
            if (!intent) {
              // A price update (or a redirect, or an error) took this attempt: the element shows the new amount.
              elements.update({ amount: cfg.amountCents });
              setBusy(false);
              if (expressEvent && typeof expressEvent.paymentFailed === "function") expressEvent.paymentFailed({ reason: "fail" });
              return;
            }
            elements.update({ amount: intent.amountCents });
            var intentId = String(intent.clientSecret).split("_secret_")[0];
            return stripe
              .confirmPayment({ elements: elements, clientSecret: intent.clientSecret, redirect: "if_required", confirmParams: { return_url: cfg.urls.returnUrl } })
              .then(function (result) {
                if (result.error) {
                  // A form the card fields refused never reached the processor: nothing to record.
                  if (result.error.type !== "validation_error") report((result.error.payment_intent && result.error.payment_intent.id) || intentId);
                  fail(result.error.message);
                  return;
                }
                var pi = result.paymentIntent;
                var to = cfg.urls.complete + "?payment_intent=" + encodeURIComponent(pi && pi.id ? pi.id : intentId);
                if (pi && pi.status !== "succeeded" && pi.status !== "processing") {
                  // Authorized, or not through yet: the store takes it (or declines the card — shown here, as a
                  // decline is) and records the attempt; otherwise the completion page says what is needed. The
                  // button keeps the label it had while the card was confirmed: an issuer's answer shows no step
                  // of its own.
                  return report(pi.id || intentId).then(function (r) {
                    var j = (r && r.json) || {};
                    if (j.redirect) { go(j.redirect); return; }
                    if (j.status === "requires_payment_method" && j.error) { fail(j.error); return; }
                    go(to);
                  });
                }
                setBusy(true, "Payment complete…");
                go(to);
              });
          });
        })
        .catch(function () { fail("We couldn't reach the payment service. Check your connection and try again."); });
    }

    if (cfg.surface === "express-checkout") {
      var expressMount = $("[data-express-checkout]", block);
      var wrap = $("[data-express-wrap]", block);
      if (expressMount) {
        var express = elements.create("expressCheckout", { paymentMethods: { link: "auto", applePay: "never", googlePay: "never" } });
        express.on("ready", function (e) {
          var methods = e && e.availablePaymentMethods;
          if (!methods && wrap) wrap.hidden = true;
        });
        express.on("click", function (event) { event.resolve(); });
        express.on("confirm", function (event) { pay(event); });
        express.mount(expressMount);
      }
    }
    button.addEventListener("click", function () { pay(null); });
  }

  /* ------------------------------------------------------------ a card form of the store's own */

  /** What a card form's own script is handed: the step's config and form, and the pieces every way to pay shares. */
  function cardFormFlow(form) {
    if (typeof window.checkoutCardForm !== "function") return;
    window.checkoutCardForm({
      config: cfg,
      form: form,
      isBusy: function () { return busy; },
      setBusy: setBusy,
      showError: showError,
      clearError: clearError,
      startAttempt: startAttempt,
      showPriceUpdate: showPriceUpdate,
      post: post,
      go: go,
      el: el,
      money: money,
    });
  }

  if (cfg.mode === "stripe") {
    if (block.hasAttribute("data-stripe-payment")) stripeFlow();
  } else if (block.tagName === "FORM" && block.classList.contains("card-form")) {
    cardFormFlow(block);
  }
})();
