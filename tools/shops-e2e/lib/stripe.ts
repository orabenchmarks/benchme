/**
 * Stripe's own surfaces, as a shopper meets them when the stack pays with Stripe test keys (STRIPE=1): the Payment
 * Element and the Express Checkout Element (Stripe's iframes inside the store's payment step), the hosted Checkout page
 * on checkout.stripe.com, and the 3D Secure test page Stripe shows for 4000 0027 6000 3184. Frames are found by the
 * titles Stripe gives their <iframe> elements, fields and buttons by role and accessible name, like everything else
 * the suite touches.
 *
 * Also the run record every test attaches as run.json: what stripe-ledger.mjs needs to look a run's payments up in
 * Stripe (the workspace and its store, the cards the run used, the orders it reached) — never a card number or a key.
 */
import type { Frame, FrameLocator, Locator, Page } from "@playwright/test";

/** The titles of Stripe's frames: the Payment Element's fields, the Express Checkout Element's buttons, the 3D Secure test page. */
export const PAYMENT_FRAME = "Secure payment input frame";
export const EXPRESS_FRAME = "Secure express checkout frame";
export const CHALLENGE_FRAME = "3DS Challenge";

/** Stripe's hosted payment page. */
export const CHECKOUT_HOST = "checkout.stripe.com";

/**
 * A declined card in Stripe's words: the API's "Your card was declined.", Stripe.js's "Your card has been declined.", and
 * Stripe Checkout's hosted page, which names the kind of card and may suggest another ("Your credit card was declined.
 * Try paying with a debit card instead.").
 */
export const DECLINED = /\bYour (?:(?:credit|debit|prepaid) )?card (?:was|has been) declined\b/;

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** The Payment Element's tabs other than its card form ("$5 back Bank", "Klarna"): what a store that takes cards only must not offer. */
export function extraMethods(tabs: readonly string[]): string[] {
  return tabs.map(oneLine).filter((t) => t !== "" && t !== "Card");
}

/** The hosted page's US-dollar price among its currency choices ("US $349.56"), in cents; null when it offers none. */
export function usdChoice(names: readonly string[]): { name: string; cents: number } | null {
  for (const name of names) {
    const m = /^US \$([\d,]+\.\d{2})$/.exec(oneLine(name));
    if (m) return { name, cents: Math.round(Number((m[1] as string).replace(/,/g, "")) * 100) };
  }
  return null;
}

/** What a test leaves for stripe-ledger.mjs (attached as run.json, so it lands in results.json). */
export type RunRecord = {
  /** The task's directory name. */
  task: string;
  run: "reference" | "wrong";
  /** How the stack paid: only a Stripe run has anything in Stripe to look up. */
  payments: "stripe" | "fake";
  store: string;
  /** The workspace the test minted (null when minting failed). */
  workspace: string | null;
  /** urls.apps.<store> of that workspace, no trailing slash: its /internal/state lists the orders. */
  storeUrl: string | null;
  /** The class the run's last order must have ("none": no order). */
  expectClass: string;
  /** Every card the run paid with, in order (success, decline, 3ds). */
  cards: string[];
  /** Every order number the shopper reached a confirmation page of, in order. */
  orders: string[];
};

export function runRecord(r: Omit<RunRecord, "payments"> & { stripe: boolean }): RunRecord {
  return {
    task: r.task,
    run: r.run,
    payments: r.stripe ? "stripe" : "fake",
    store: r.store,
    workspace: r.workspace,
    storeUrl: r.storeUrl ? r.storeUrl.replace(/\/+$/, "") : null,
    expectClass: r.expectClass,
    cards: [...r.cards],
    orders: [...r.orders],
  };
}

/* ------------------------------------------------------------------ in the browser */

/**
 * The frame whose <iframe> element carries `title` and is on screen, wherever Stripe nests it (the 3D Secure page is a
 * frame inside one of Stripe's frames); null when there is none.
 */
export async function frameTitled(page: Page, title: string): Promise<Frame | null> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.isDetached()) continue;
    const el = await frame.frameElement().catch(() => null);
    if (!el) continue;
    const found = (await el.getAttribute("title").catch(() => null)) === title && (await el.isVisible().catch(() => false));
    await el.dispose().catch(() => undefined);
    if (found) return frame;
  }
  return null;
}

/** The Payment Element's fields: its frame inside the store's mount point (Stripe adds hidden helper frames under the same title). */
export function paymentFields(mount: Locator): FrameLocator {
  return mount.locator(`iframe[title="${PAYMENT_FRAME}"]:not([aria-hidden="true"])`).first().contentFrame();
}

/** The Express Checkout Element's buttons (Link's, on the express surface). */
export function expressButtons(mount: Locator): FrameLocator {
  return mount.locator(`iframe[title="${EXPRESS_FRAME}"]`).first().contentFrame();
}

/**
 * Waits for a frame to stop moving on the page (Stripe's 3D Secure modal slides in): a click aimed while its frame is
 * still moving lands where the button was, not where it is.
 */
export async function frameAtRest(frame: Frame, page: Page): Promise<void> {
  const el = await frame.frameElement();
  try {
    let last = "";
    for (let i = 0; i < 25; i++) {
      const box = JSON.stringify(await el.boundingBox());
      if (box !== "null" && box === last) return;
      last = box;
      await page.waitForTimeout(200);
    }
  } finally {
    await el.dispose().catch(() => undefined);
  }
}

/**
 * Lets the page paint twice. A click dispatched right after the page scrolled can be routed by where things were
 * before the scroll — onto Stripe's card field instead of the store's Pay button below it.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}
