import { describe, expect, it } from "vitest";
import { shell } from "./html.js";

const base = { site: "Warehouse", accent: "#123", prefix: "/w/x/warehouse", nav: [], user: null };

describe("shell", () => {
  it("keeps noindex by default and injects head + scripts verbatim", () => {
    const html = shell({ ...base, head: '<link rel="nlweb" href="/w/x/warehouse/ask">', scripts: ["<script>window.__a=1</script>"] }, "T", "<p>b</p>");
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).toContain('<link rel="nlweb" href="/w/x/warehouse/ask"></head>');
    expect(html).toContain("<script>window.__a=1</script></body>");
  });
  it("flips to index,follow on request", () => {
    expect(shell({ ...base, robots: "index" }, "T", "")).toContain('content="index,follow"');
  });
});
