import { organization } from "@benchme/site-kit";
import { layout, type StoreCtx } from "../layout.js";
import type { HomeData } from "../skins/index.js";

/** The home page: the skin's hero, then its sections in its order. JSON-LD: Organization and WebSite (with search). */
export function homePage(ctx: StoreCtx, data: HomeData): string {
  const { skin, store } = ctx;
  const body = [skin.hero(ctx, data), ...skin.homeSections(ctx).map((section) => section(ctx, data))].join("\n");
  const org = {
    ...organization({ id: `${ctx.publicBase}/#organization`, url: `${ctx.publicBase}/`, name: store.brand.name, description: store.brand.tagline }),
    email: store.brand.supportEmail,
    telephone: store.brand.supportPhone,
  };
  const site = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${ctx.publicBase}/#website`,
    url: `${ctx.publicBase}/`,
    name: store.brand.name,
    potentialAction: { "@type": "SearchAction", target: `${ctx.publicBase}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
  };
  return layout(ctx, skin.homeTitle(ctx), body, {
    jsonLd: [org, site],
    og: { description: store.brand.tagline, ...(store.brand.heroImage ? { image: store.brand.heroImage } : {}) },
    bodyClass: "page-home",
  });
}
