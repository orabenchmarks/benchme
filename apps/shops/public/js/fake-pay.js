/*
 * The payment step's card form, where the store takes the card in its own fields. Loaded before pay.js,
 * which hands it the step's shared pieces (window.checkoutCardForm):
 *
 * - the card number and the expiry are formatted as they are typed;
 * - Pay starts the attempt through pay.js (the intent call, with the total the page shows), then posts the
 *   card to the form's confirm endpoint, with that total again;
 * - a card whose issuer asks for confirmation opens a "Confirm it's you" step over the page, whose buttons
 *   complete or fail it; Escape closes it, and the payment can be tried again.
 *
 * Data is only ever put into the page with DOM APIs (textContent, setAttribute): never innerHTML. The card
 * number is read from its field and posted; it is never stored, logged or put anywhere else.
 */
(function () {
  "use strict";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function digitsOf(v) { return String(v || "").replace(/\D/g, ""); }

  var UNREACHABLE = "We couldn't reach the payment service. Check your connection and try again.";

  window.checkoutCardForm = function (pay) {
    var cfg = pay.config;
    var form = pay.form;
    var el = pay.el;
    var number = $("input[name=number]", form);
    var expiry = $("input[name=expiry]", form);

    if (number) number.addEventListener("input", function () {
      var d = digitsOf(number.value).slice(0, 19);
      number.value = d.replace(/(\d{4})(?=\d)/g, "$1 ");
    });
    if (expiry) expiry.addEventListener("input", function () {
      var d = digitsOf(expiry.value).slice(0, 4);
      expiry.value = d.length > 2 ? d.slice(0, 2) + " / " + d.slice(2) : d;
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (pay.isBusy()) return;
      pay.clearError();
      pay.setBusy(true);
      var card = {
        number: number ? number.value : "",
        expiry: expiry ? expiry.value : "",
        cvc: ($("input[name=cvc]", form) || { value: "" }).value,
        zip: ($("input[name=zip]", form) || { value: "" }).value,
      };
      pay.startAttempt()
        .then(function (intent) {
          if (!intent) { pay.setBusy(false); return; }
          card.shownCents = cfg.amountCents;
          return pay.post(cfg.urls.confirm, card).then(function (r) {
            var j = r.json || {};
            if (j.status === "succeeded" && j.redirect) { pay.setBusy(true, "Payment complete…"); pay.go(j.redirect); return; }
            if (j.priceUpdated) { pay.showPriceUpdate(j.priceUpdated, j.totals); pay.setBusy(false); return; }
            if (r.status === 409 && j.redirect) { pay.go(j.redirect); return; }
            if (j.status === "requires_action") { openAuthentication(j.amountCents || cfg.amountCents); return; }
            pay.setBusy(false);
            pay.showError(j.error || j.message);
          });
        })
        .catch(function () { pay.setBusy(false); pay.showError(UNREACHABLE); });
    });

    /** The card issuer's step: a dialog whose buttons complete or fail the confirmation. */
    function openAuthentication(amountCents) {
      var lastFocus = document.activeElement;
      var complete = el("button", { type: "button", class: "btn btn--primary btn--lg btn--block" }, ["Complete authentication"]);
      var fail = el("button", { type: "button", class: "btn btn--secondary btn--block" }, ["Fail authentication"]);
      var panel = el("div", { class: "pay-dialog__panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "pay-dialog-title" }, [
        el("p", { class: "auth-card__head" }, [el("span", null, ["Card verification"]), el("span", { class: "test-badge" }, ["Test payment"])]),
        el("h2", { class: "auth-card__title", id: "pay-dialog-title" }, ["Confirm it's you"]),
        el("p", null, ["Your card issuer asks you to confirm this payment of ", el("strong", null, [pay.money(amountCents)]), " to " + (cfg.store || "this store") + "."]),
        el("div", { class: "auth-card__actions" }, [complete, fail]),
      ]);
      var dialog = el("div", { class: "pay-dialog" }, [el("div", { class: "pay-dialog__backdrop" }, []), panel]);
      document.body.appendChild(dialog);
      document.body.classList.add("has-overlay");
      complete.focus();

      function close() {
        document.removeEventListener("keydown", onKey);
        if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        document.body.classList.remove("has-overlay");
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      }
      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
          pay.setBusy(false);
          pay.showError("The payment needs your confirmation. Pay again to retry.");
        } else if (e.key === "Tab") {
          var first = complete, last = fail;
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener("keydown", onKey);

      function answer(result) {
        complete.disabled = true;
        fail.disabled = true;
        pay.post(cfg.urls.authenticate, { result: result })
          .then(function (r) {
            var j = r.json || {};
            close();
            if (j.status === "succeeded" && j.redirect) { pay.setBusy(true, "Payment complete…"); pay.go(j.redirect); return; }
            pay.setBusy(false);
            pay.showError(j.error || j.message);
          })
          .catch(function () { close(); pay.setBusy(false); pay.showError("We couldn't reach the payment service. Please try again."); });
      }
      complete.addEventListener("click", function () { answer("complete"); });
      fail.addEventListener("click", function () { answer("fail"); });
    }
  };
})();
