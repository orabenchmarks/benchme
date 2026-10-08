/*
 * store.js — the storefront's progressive JavaScript. Every page works without it (links, plain form
 * posts); with it: the cookie banner, the newsletter pop-up, the cart drawer (and, when cart.json carries one,
 * the order the store just recorded for a payment whose return page never loaded), add-to-cart without a page
 * load, live prices for options, search suggestions, the phone menu, the gallery, the delivery check and
 * recently viewed products. Data is only ever put into the page with DOM APIs (textContent, setAttribute):
 * never innerHTML.
 *
 * localStorage keys (shared by the stores on one host): "cookie-consent" ("accepted", or the saved
 * choices), "newsletter-dismissed" ("1"), "page-views", "recently-viewed:<site>".
 */
(function () {
  "use strict";

  var body = document.body;
  var PREFIX = body.getAttribute("data-prefix") || "";
  var SITE = body.getAttribute("data-site") || "";
  var FREE_OVER = Number(body.getAttribute("data-free-shipping-cents") || 0);
  var usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  var money = function (cents) { return usd.format(cents / 100); };

  /* ------------------------------------------------------------ helpers */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function getItem(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function setItem(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ } }

  /** el("a", { class: "x", href: "/y" }, ["text", node]) — attributes via setAttribute, text via text nodes. */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        node.setAttribute(k, v === true ? "" : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  /** A same-site path from the server, or the fallback: never another origin, never a javascript: URL. */
  function safePath(u, fallback) {
    return typeof u === "string" && u.charAt(0) === "/" && u.charAt(1) !== "/" ? u : fallback;
  }

  function postForm(url, data) {
    var params = new URLSearchParams();
    Object.keys(data).forEach(function (k) { params.append(k, String(data[k])); });
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  }

  function readJson(res) {
    var type = res.headers.get("content-type") || "";
    return type.indexOf("application/json") >= 0 ? res.json() : Promise.resolve(null);
  }

  /** Submits a form the old way (a page load), skipping our own submit handler. */
  function plainSubmit(form) { HTMLFormElement.prototype.submit.call(form); }

  /* ------------------------------------------------------------ overlays: pop-up, drawer, phone menu */

  var overlays = [];
  var lastFocus = null;

  function focusable(root) {
    return $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])', root)
      .filter(function (n) { return n.offsetParent !== null; });
  }

  function openOverlay(node, onClose, focusTarget) {
    if (!node || overlays.some(function (o) { return o.node === node; })) return;
    if (!overlays.length) lastFocus = document.activeElement;
    node.hidden = false;
    overlays.push({ node: node, onClose: onClose });
    body.classList.add("has-overlay");
    var target = focusTarget || focusable(node)[0];
    if (target) target.focus();
  }

  function closeOverlay(node) {
    var i = -1;
    overlays.forEach(function (o, j) { if (o.node === node) i = j; });
    if (i < 0) return;
    var o = overlays.splice(i, 1)[0];
    node.hidden = true;
    if (o.onClose) o.onClose();
    if (!overlays.length) {
      body.classList.remove("has-overlay");
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
  }

  document.addEventListener("keydown", function (e) {
    var top = overlays[overlays.length - 1];
    if (!top) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeOverlay(top.node);
    } else if (e.key === "Tab") {
      var items = focusable(top.node);
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ------------------------------------------------------------ cookie banner */

  var banner = $("[data-cookie-banner]");
  if (banner) {
    if (!getItem("cookie-consent")) banner.hidden = false;
    var prefs = $("[data-cookie-prefs]", banner);
    var manage = $("[data-cookie-manage]", banner);
    var accept = $("[data-cookie-accept]", banner);
    if (accept) accept.addEventListener("click", function () { setItem("cookie-consent", "accepted"); banner.hidden = true; });
    if (manage && prefs) {
      manage.addEventListener("click", function () {
        prefs.hidden = !prefs.hidden;
        manage.setAttribute("aria-expanded", String(!prefs.hidden));
        if (!prefs.hidden) { var box = $("input[name=analytics]", prefs); if (box) box.focus(); }
      });
      prefs.addEventListener("submit", function (e) {
        e.preventDefault();
        var a = $("input[name=analytics]", prefs);
        var m = $("input[name=marketing]", prefs);
        setItem("cookie-consent", "custom:analytics=" + (a && a.checked ? 1 : 0) + ",marketing=" + (m && m.checked ? 1 : 0));
        banner.hidden = true;
      });
    }
  }

  /* ------------------------------------------------------------ newsletter: forms and the pop-up */

  var modal = $("[data-newsletter-modal]");

  function newsletterSuccess(code) {
    var copy = el("button", { type: "button", class: "btn btn--secondary", "data-copy-code": code }, ["Copy code"]);
    return el("div", { class: "newsletter-success" }, [
      el("p", { class: "newsletter-success__title" }, ["You're on the list."]),
      el("p", null, ["Use this code at checkout for 10% off your first order:"]),
      el("div", { class: "code-box" }, [el("p", { class: "code-box__code" }, [code]), copy]),
    ]);
  }

  $$("[data-newsletter-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("input[name=email]", form);
      var msg = $("[data-newsletter-msg]", form);
      var email = input ? input.value.trim() : "";
      if (msg) msg.textContent = "";
      if (!email || email.indexOf("@") < 1) {
        if (msg) msg.textContent = "Enter a valid email address, like name@example.com.";
        if (input) input.focus();
        return;
      }
      var button = $("button[type=submit]", form);
      if (button) button.disabled = true;
      postForm(form.getAttribute("action"), { email: email })
        .then(function (res) {
          return readJson(res).then(function (data) {
            if (res.ok && data && data.ok && typeof data.code === "string") {
              setItem("newsletter-dismissed", "1");
              var success = newsletterSuccess(data.code);
              var slot = form.parentNode && $("[data-newsletter-success]", form.parentNode);
              if (slot) {
                // In the pop-up: the code replaces the pitch, and "No thanks" becomes a way back to the shop.
                clear(slot); slot.appendChild(success); slot.hidden = false; form.hidden = true;
                var intro = $(".modal__text", form.parentNode);
                if (intro) intro.hidden = true;
                $$(".link-btn[data-modal-close]", form.parentNode).forEach(function (b) { b.textContent = "Continue shopping"; });
              } else form.parentNode.replaceChild(success, form);
              return;
            }
            if (data && data.message && msg) { msg.textContent = data.message; if (button) button.disabled = false; return; }
            plainSubmit(form);
          });
        })
        .catch(function () { plainSubmit(form); });
    });
  });

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-copy-code]");
    if (!b) return;
    var code = b.getAttribute("data-copy-code") || "";
    var done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy code"; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, done);
    else done();
  });

  if (modal) {
    var views = Number(getItem("page-views") || "0") + 1;
    setItem("page-views", String(views));
    $$("[data-modal-close]", modal).forEach(function (b) { b.addEventListener("click", function () { closeOverlay(modal); }); });
    if (views >= 2 && getItem("newsletter-dismissed") !== "1") {
      setTimeout(function () {
        if (overlays.length || getItem("newsletter-dismissed") === "1") return;
        openOverlay(modal, function () { setItem("newsletter-dismissed", "1"); }, $("input[name=email]", modal));
      }, 8000);
    }
  }

  /* ------------------------------------------------------------ the cart drawer */

  var drawer = $("[data-cart-drawer]");
  var lines = drawer && $("[data-cart-lines]", drawer);
  var foot = drawer && $("[data-cart-foot]", drawer);
  var notice = drawer && $("[data-cart-notice]", drawer);

  function setCount(n) {
    $$("[data-cart-count]").forEach(function (c) {
      c.textContent = String(n);
      if (n > 0) c.removeAttribute("data-empty"); else c.setAttribute("data-empty", "");
    });
    $$("[data-cart-open]").forEach(function (a) { a.setAttribute("aria-label", "Cart, " + n + (n === 1 ? " item" : " items")); });
  }

  function isCart(data) { return data && Array.isArray(data.lines) && typeof data.subtotalCents === "number"; }

  function renderFallback() {
    clear(lines);
    lines.appendChild(el("div", { class: "drawer-empty" }, [
      el("p", null, ["Your cart is waiting on the cart page."]),
      el("a", { class: "btn btn--primary", href: PREFIX + "/cart" }, ["Go to your cart"]),
    ]));
    foot.hidden = true;
  }

  function cartUpdate(path, data) {
    postForm(PREFIX + path, data)
      .then(function (res) {
        return readJson(res).then(function (json) {
          if (!(res.ok && isCart(json))) { renderFallback(); return; }
          // A line held at its most (the stock left, or ten) says so; any other change leaves nothing to say.
          if (notice) notice.textContent = typeof json.notice === "string" ? json.notice : "";
          renderCart(json);
          showRecovered(json.recovered);
        });
      })
      .catch(renderFallback);
  }

  /**
   * An order the store has just recorded for a payment whose return page never loaded (the cart's `recovered`): said
   * above the cart as it now stands, with a link to the order — never a cart silently emptied of what was paid for.
   */
  function showRecovered(r) {
    if (!notice || !r || typeof r.orderNo !== "string" || !r.orderNo) return;
    var url = safePath(r.url, PREFIX + "/orders/" + encodeURIComponent(r.orderNo) + "?recovered=1");
    clear(notice);
    notice.appendChild(el("p", null, [typeof r.message === "string" && r.message ? r.message : "Your earlier payment went through \u2014 here is your order."]));
    notice.appendChild(el("p", null, [el("a", { href: url }, ["View order " + r.orderNo])]));
  }

  function renderLine(l) {
    var key = String(l.key);
    var qty = Number(l.qty) || 0;
    var url = safePath(l.url, PREFIX + "/cart");
    var minus = el("button", { type: "button", "aria-label": "Decrease quantity" }, ["−"]);
    var plus = el("button", { type: "button", "aria-label": "Increase quantity" }, ["+"]);
    var remove = el("button", { type: "button", class: "link-btn" }, ["Remove"]);
    minus.addEventListener("click", function () { cartUpdate("/cart/update", { key: key, qty: qty - 1 }); });
    plus.addEventListener("click", function () { cartUpdate("/cart/update", { key: key, qty: qty + 1 }); });
    remove.addEventListener("click", function () { cartUpdate("/cart/remove", { key: key }); });
    var image = safePath(l.image, "");
    return el("div", { class: "drawer-line" }, [
      image ? el("img", { src: image, alt: "", loading: "lazy" }) : el("span"),
      el("div", { class: "drawer-line__info" }, [
        el("a", { class: "drawer-line__name", href: url }, [String(l.name || "")]),
        l.optionsLabel ? el("span", { class: "drawer-line__opts" }, [String(l.optionsLabel)]) : null,
        el("div", { class: "drawer-line__controls" }, [
          el("span", { class: "drawer-line__qty" }, [minus, el("span", { "aria-live": "polite" }, [String(qty)]), plus]),
          remove,
        ]),
      ]),
      el("span", { class: "drawer-line__total" }, [money(Number(l.totalCents) || 0)]),
    ]);
  }

  function renderCart(cart) {
    clear(lines);
    var n = typeof cart.count === "number" ? cart.count : cart.lines.reduce(function (a, l) { return a + (Number(l.qty) || 0); }, 0);
    setCount(n);
    if (!cart.lines.length) {
      lines.appendChild(el("div", { class: "drawer-empty" }, [
        el("p", null, ["Your cart is empty."]),
        el("a", { class: "btn btn--secondary", href: PREFIX + "/collections/all" }, ["Continue shopping"]),
      ]));
      foot.hidden = true;
      return;
    }
    if (FREE_OVER > 0) {
      var left = FREE_OVER - cart.subtotalCents;
      var pct = Math.max(0, Math.min(100, Math.round((cart.subtotalCents / FREE_OVER) * 100)));
      lines.appendChild(el("div", { class: "free-ship" }, [
        left > 0 ? "You're " + money(left) + " away from free standard shipping." : "Your order ships free with standard shipping.",
        el("div", { class: "free-ship__bar", "aria-hidden": "true" }, [el("span", { style: "width:" + pct + "%" })]),
      ]));
    }
    cart.lines.forEach(function (l) { lines.appendChild(renderLine(l)); });
    $("[data-cart-subtotal]", drawer).textContent = money(cart.subtotalCents);
    foot.hidden = false;
  }

  function openDrawer(cart, message) {
    if (!drawer) return;
    if (notice) notice.textContent = message || "";
    openOverlay(drawer, null, $(".drawer__panel", drawer));
    if (cart) { renderCart(cart); showRecovered(cart.recovered); return; }
    clear(lines);
    lines.appendChild(el("p", { class: "drawer__note" }, ["Loading your cart…"]));
    fetch(PREFIX + "/cart.json", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (res) {
        return readJson(res).then(function (json) {
          if (!(res.ok && isCart(json))) { renderFallback(); return; }
          renderCart(json);
          showRecovered(json.recovered);
        });
      })
      .catch(renderFallback);
  }

  if (drawer) {
    $$("[data-drawer-close]", drawer).forEach(function (b) { b.addEventListener("click", function () { closeOverlay(drawer); }); });
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-cart-open]");
      if (!a) return;
      e.preventDefault();
      openDrawer(null, "");
    });
  }

  /* ------------------------------------------------------------ the product page */

  var product = $("[data-product]");
  if (product) {
    var form = $("[data-add-to-cart]", product);
    var base = Number(product.getAttribute("data-base-cents") || 0);
    var compareBase = Number(product.getAttribute("data-compare-cents") || 0);
    var savePct = Number(product.getAttribute("data-save-pct") || 0);

    var updatePrice = function () {
      if (!form) return;
      var delta = 0;
      $$("[data-option-group]", form).forEach(function (g) {
        var picked = $("input:checked", g);
        if (!picked) return;
        delta += Number(picked.getAttribute("data-delta") || 0);
        var label = $("[data-option-value]", g);
        if (label) label.textContent = picked.getAttribute("data-label") || "";
      });
      var once = base + delta;
      var sub = savePct ? Math.round((once * (100 - savePct)) / 100) : once;
      var modeInput = $("input[name=mode]:checked", form);
      var subscribed = !!modeInput && modeInput.value === "subscribe";
      var was = subscribed ? once : compareBase > base ? compareBase + delta : 0;
      // Every price on the page follows the choice: the buy box's and any other (a bar that stays on screen).
      $$("[data-price]").forEach(function (price) { price.textContent = money(subscribed ? sub : once); });
      $$("[data-compare]").forEach(function (compare) {
        compare.hidden = !was;
        compare.textContent = was ? money(was) : "";
      });
      var oncePrice = $("[data-once-price]", form);
      var subPrice = $("[data-sub-price]", form);
      if (oncePrice) oncePrice.textContent = money(once);
      if (subPrice) subPrice.textContent = money(sub);
      var interval = $("[data-interval]", form);
      if (interval) { if (subscribed) interval.removeAttribute("data-inactive"); else interval.setAttribute("data-inactive", ""); }
    };

    if (form) {
      form.addEventListener("change", updatePrice);
      updatePrice();

      $$("[data-qty-step]", form).forEach(function (b) {
        b.addEventListener("click", function () {
          var input = $("input[name=qty]", form);
          if (!input) return;
          var min = Number(input.min || 1);
          var max = Number(input.max || 10);
          var next = (Number(input.value) || min) + Number(b.getAttribute("data-qty-step"));
          input.value = String(Math.max(min, Math.min(max, next)));
        });
      });

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var error = $("[data-form-error]", form);
        // The form's own button and any outside it that submit it (form="buy-form").
        var buttons = Array.prototype.filter.call(form.elements, function (n) { return n.type === "submit" && !n.disabled; });
        var labels = buttons.map(function (b) { return b.textContent; });
        if (error) { error.hidden = true; error.textContent = ""; }
        var data = {};
        new FormData(form).forEach(function (v, k) { data[k] = v; });
        buttons.forEach(function (b) { b.disabled = true; b.textContent = "Adding…"; });
        var restore = function () { buttons.forEach(function (b, i) { b.disabled = false; b.textContent = labels[i]; }); };
        postForm(form.getAttribute("action"), data)
          .then(function (res) {
            return readJson(res).then(function (json) {
              restore();
              if (res.ok && isCart(json)) { openDrawer(json, typeof json.notice === "string" ? json.notice : "Added to your cart."); return; }
              if (json && error) {
                // A 4xx with a sentence for the shopper (sold out, unknown option) is shown as is.
                var said = res.status >= 400 && res.status < 500 && res.status !== 404 && typeof json.message === "string";
                error.textContent = said ? json.message : "Sorry, we couldn't add this to your cart. Please try again.";
                error.hidden = false;
                return;
              }
              plainSubmit(form);
            });
          })
          .catch(function () { restore(); plainSubmit(form); });
      });
    }

    /* the gallery's thumbnails */
    var main = $("[data-gallery] .gallery__img", product);
    $$("[data-gallery-thumb]", product).forEach(function (t) {
      t.addEventListener("click", function () {
        var src = safePath(t.getAttribute("data-full"), "");
        if (main && src) main.setAttribute("src", src);
        $$("[data-gallery-thumb]", product).forEach(function (o) { o.classList.toggle("is-active", o === t); o.setAttribute("aria-pressed", String(o === t)); });
      });
    });

    /* recently viewed, per store */
    var key = "recently-viewed:" + SITE;
    var current = {
      slug: product.getAttribute("data-recent-slug") || "",
      name: product.getAttribute("data-recent-name") || "",
      url: product.getAttribute("data-recent-url") || "",
      image: product.getAttribute("data-recent-image") || "",
      price: product.getAttribute("data-recent-price") || "",
    };
    var seen = [];
    try { seen = JSON.parse(getItem(key) || "[]"); } catch (err) { seen = []; }
    if (!Array.isArray(seen)) seen = [];
    seen = seen.filter(function (x) {
      return x && typeof x.slug === "string" && typeof x.name === "string" && typeof x.url === "string" && x.url.indexOf(PREFIX + "/") === 0;
    });
    var others = seen.filter(function (x) { return x.slug !== current.slug; }).slice(0, 4);
    var section = $("[data-recent]");
    var list = section && $("[data-recent-list]", section);
    if (list && others.length) {
      others.forEach(function (x) {
        list.appendChild(el("li", { class: "recent-item" }, [
          el("a", { href: safePath(x.url, PREFIX + "/") }, [
            safePath(x.image, "") ? el("img", { src: x.image, alt: "", loading: "lazy" }) : null,
            el("span", { class: "recent-item__name" }, [x.name]),
            el("span", { class: "recent-item__price" }, [String(x.price || "")]),
          ]),
        ]));
      });
      section.hidden = false;
    }
    if (current.slug && current.url.indexOf(PREFIX + "/") === 0) {
      setItem(key, JSON.stringify([current].concat(seen.filter(function (x) { return x.slug !== current.slug; })).slice(0, 8)));
    }
  }

  /* ------------------------------------------------------------ search suggestions */

  $$("[data-search]").forEach(function (searchForm) {
    var input = $("[data-search-input]", searchForm);
    var box = $("[data-search-results]", searchForm);
    if (!input || !box) return;
    var timer = null;
    var seq = 0;
    var active = -1;

    var options = function () { return $$("[role=option]", box); };
    var close = function () { box.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
    var mark = function (i) {
      var opts = options();
      opts.forEach(function (o, j) { o.setAttribute("aria-selected", String(j === i)); });
      active = i;
      if (opts[i]) input.setAttribute("aria-activedescendant", opts[i].id);
    };

    var show = function (q, items) {
      clear(box);
      if (!items.length) {
        box.appendChild(el("p", { class: "suggest-empty" }, ["No products match “" + q + "”."]));
      } else {
        items.forEach(function (it, i) {
          box.appendChild(el("a", { class: "suggest-item", role: "option", id: input.id + "-opt-" + i, href: safePath(it.url, PREFIX + "/"), "aria-selected": "false" }, [
            safePath(it.image, "") ? el("img", { src: it.image, alt: "" }) : el("span"),
            el("span", { class: "suggest-item__name" }, [String(it.name || "")]),
            el("span", { class: "suggest-item__price" }, [money(Number(it.priceCents) || 0)]),
          ]));
        });
      }
      box.appendChild(el("a", { class: "suggest-all", href: PREFIX + "/search?q=" + encodeURIComponent(q) }, ["See all results for “" + q + "”"]));
      box.hidden = false;
      input.setAttribute("aria-expanded", "true");
      active = -1;
    };

    input.addEventListener("input", function () {
      var q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 2) { close(); return; }
      timer = setTimeout(function () {
        var mine = ++seq;
        fetch(PREFIX + "/search/suggest?q=" + encodeURIComponent(q), { credentials: "same-origin", headers: { Accept: "application/json" } })
          .then(function (res) { return readJson(res); })
          .then(function (data) { if (mine === seq && data && Array.isArray(data.items)) show(q, data.items); })
          .catch(close);
      }, 160);
    });

    input.addEventListener("keydown", function (e) {
      var opts = options();
      if (box.hidden || !opts.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); mark(Math.min(opts.length - 1, active + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); mark(Math.max(0, active - 1)); }
      else if (e.key === "Enter" && active >= 0 && opts[active]) { e.preventDefault(); window.location.href = opts[active].getAttribute("href"); }
      else if (e.key === "Escape") { e.stopPropagation(); close(); }
    });

    document.addEventListener("click", function (e) { if (!searchForm.contains(e.target)) close(); });
  });

  /* ------------------------------------------------------------ the phone menu */

  var nav = $("[data-mobile-nav]");
  if (nav) {
    $$("[data-menu-open]").forEach(function (b) {
      b.addEventListener("click", function () {
        b.setAttribute("aria-expanded", "true");
        openOverlay(nav, function () { b.setAttribute("aria-expanded", "false"); });
      });
    });
    $$("[data-menu-close]", nav).forEach(function (b) { b.addEventListener("click", function () { closeOverlay(nav); }); });
    // A link followed from the menu closes it: one to a section of this page would otherwise land behind it.
    nav.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a[href]")) closeOverlay(nav);
    });
  }

  /* ------------------------------------------------------------ the delivery check (Wrenfield) */

  $$("[data-delivery-check]").forEach(function (f) {
    var out = $("[data-delivery-result]", f);
    if (!out) return;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var zip = ($("input[name=zip]", f) || { value: "" }).value;
      fetch(f.getAttribute("action") + "?zip=" + encodeURIComponent(zip), { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then(function (res) { return readJson(res); })
        .then(function (data) {
          if (!data || typeof data.message !== "string") { plainSubmit(f); return; }
          out.textContent = data.message;
          out.classList.toggle("is-ok", !!data.ok);
          out.classList.toggle("is-error", !data.ok);
        })
        .catch(function () { plainSubmit(f); });
    });
  });

  /* ------------------------------------------------------------ collection pages */

  $$("[data-autosubmit]").forEach(function (s) {
    s.addEventListener("change", function () { if (s.form) plainSubmit(s.form); });
  });
  var filters = $("[data-filters]");
  if (filters && window.matchMedia && window.matchMedia("(max-width: 1023px)").matches) filters.open = false;
})();
