import type { Brand } from "@benchme/storefront";

/**
 * The `paylantern` site's brand: the stand-alone payment page a store's outbound payment notice links
 * to. A generic payment-processor look (a lock in a shield, Inter, a cool blue) that shares nothing
 * with the stores, so a shopper who lands there has left the store.
 */
export const PAYLANTERN_BRAND: Brand = {
  name: "PayLantern Checkout",
  tagline: "Secure payments for independent stores",
  logoSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 136 32" width="136" height="32" role="img" aria-label="PayLantern">' +
    '<path d="M16 1.5 3.5 6v9c0 7.6 5.3 13.9 12.5 15.5 7.2-1.6 12.5-7.9 12.5-15.5V6L16 1.5Z" fill="#0F62FE"/>' +
    '<path d="M12.25 14.5v-2.75a3.75 3.75 0 0 1 7.5 0v2.75" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>' +
    '<rect x="10" y="14" width="12" height="9.5" rx="2" fill="#FFFFFF"/>' +
    '<circle cx="16" cy="18.1" r="1.4" fill="#0F62FE"/>' +
    '<path d="M16 18.6v2.4" stroke="#0F62FE" stroke-width="1.4" stroke-linecap="round"/>' +
    '<text x="37" y="21.75" fill="#1A2233" font-family="Inter, system-ui, sans-serif" font-size="17" font-weight="700" letter-spacing="-0.2">PayLantern</text>' +
    "</svg>",
  announcement: "Secure payment · 256-bit encryption",
  supportEmail: "support@paylantern.example",
  supportPhone: "+1 (888) 555-0142",
  fonts: { display: "Inter", body: "Inter", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
  tokens: { bg: "#F6F8FB", fg: "#1A2233", muted: "#6B778C", accent: "#0F62FE", accentFg: "#FFFFFF", surface: "#FFFFFF", border: "#D9E0EA", radius: "8px" },
};
