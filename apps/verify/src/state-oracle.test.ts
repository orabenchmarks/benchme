import type { z } from "zod";
import { describe, expect, it } from "vitest";
import { StateOracle } from "./oracles/state-oracle.js";
import type { WorkspaceStateReader } from "./oracles/state-reader.js";
import { stateSpec, taskSpecSchema } from "./specs/spec.js";

type Spec = z.infer<typeof stateSpec>;

/** An in-memory stand-in for the reader: keyed by "app path", returns whatever the test seeded. */
class MemoryStateReader implements WorkspaceStateReader {
  private readonly data = new Map<string, unknown>();
  seed(app: string, path: string, data: unknown): void {
    this.data.set(`${app} ${path}`, data);
  }
  async get(_workspaceId: string, app: string, path: string): Promise<unknown> {
    return this.data.get(`${app} ${path}`) ?? null;
  }
}

const ctx = { workspaceId: "ws_state_oracle_test", taskId: "state-oracle-test" };
const spec = (checks: Spec["checks"]): Spec => ({ kind: "state", checks });

describe("StateOracle", () => {
  it("passes when a matching row exists", async () => {
    const reader = new MemoryStateReader();
    reader.seed("warehouse", "/api/v1/orders", [
      { no: "SO-1", status: "shipped" },
      { no: "SO-2", status: "open" },
    ]);
    const result = await new StateOracle(reader).check(
      Buffer.alloc(0),
      spec([{ name: "shipped", app: "warehouse", path: "/api/v1/orders", where: { no: "SO-1" }, expect: { status: "shipped" } }]),
      ctx,
    );
    expect(result.verdict).toBe("OK");
    expect(result.checks).toEqual([{ name: "shipped", ok: true }]);
  });

  it("FAILS on an empty list (no rows at all)", async () => {
    const reader = new MemoryStateReader();
    reader.seed("warehouse", "/api/v1/orders", []);
    const result = await new StateOracle(reader).check(Buffer.alloc(0), spec([{ name: "shipped", app: "warehouse", path: "/api/v1/orders", expect: { status: "shipped" } }]), ctx);
    expect(result.verdict).toBe("FAIL");
    expect(result.checks[0]).toMatchObject({ name: "shipped", ok: false });
    expect(result.checks[0].note).toMatch(/no row/);
  });

  it("FAILS when `where` matches nothing (an empty list after filtering)", async () => {
    const reader = new MemoryStateReader();
    reader.seed("warehouse", "/api/v1/orders", [{ no: "SO-2", status: "open" }]);
    const result = await new StateOracle(reader).check(
      Buffer.alloc(0),
      spec([{ name: "shipped", app: "warehouse", path: "/api/v1/orders", where: { no: "SO-1" }, expect: { status: "shipped" } }]),
      ctx,
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.checks[0].note).toMatch(/no row/);
  });

  it("FAILS when a field mismatches on the only matching row", async () => {
    const reader = new MemoryStateReader();
    reader.seed("warehouse", "/api/v1/orders", [{ no: "SO-1", status: "open" }]);
    const result = await new StateOracle(reader).check(
      Buffer.alloc(0),
      spec([{ name: "shipped", app: "warehouse", path: "/api/v1/orders", where: { no: "SO-1" }, expect: { status: "shipped" } }]),
      ctx,
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.checks[0].note).toMatch(/status/);
  });

  it("passes when at least one matching row satisfies expect, even if another does not", async () => {
    const reader = new MemoryStateReader();
    reader.seed("warehouse", "/api/v1/orders", [
      { customer: "acme", status: "open" },
      { customer: "acme", status: "shipped" },
    ]);
    const result = await new StateOracle(reader).check(
      Buffer.alloc(0),
      spec([{ name: "some-shipped", app: "warehouse", path: "/api/v1/orders", where: { customer: "acme" }, expect: { status: "shipped" } }]),
      ctx,
    );
    expect(result.verdict).toBe("OK");
  });

  it("honours count.max: too many matching rows fails even though each matches expect", async () => {
    const reader = new MemoryStateReader();
    reader.seed("warehouse", "/api/v1/orders", [
      { customer: "acme", status: "open" },
      { customer: "acme", status: "open" },
    ]);
    const result = await new StateOracle(reader).check(
      Buffer.alloc(0),
      spec([{ name: "one-open", app: "warehouse", path: "/api/v1/orders", where: { customer: "acme" }, expect: { status: "open" }, count: { max: 1 } }]),
      ctx,
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.checks[0].note).toMatch(/at most 1/);
  });

  it("honours count.min: too few matching rows fails", async () => {
    const reader = new MemoryStateReader();
    reader.seed("helpdesk", "/api/v1/tickets", [{ customer: "acme", status: "resolved" }]);
    const result = await new StateOracle(reader).check(
      Buffer.alloc(0),
      spec([{ name: "two-resolved", app: "helpdesk", path: "/api/v1/tickets", where: { customer: "acme" }, expect: { status: "resolved" }, count: { min: 2 } }]),
      ctx,
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.checks[0].note).toMatch(/at least 2/);
  });

  it("a detail-path object response (not a list) is treated as a single row", async () => {
    const reader = new MemoryStateReader();
    reader.seed("helpdesk", "/api/v1/tickets/T-1", { id: "T-1", status: "resolved" });
    const result = await new StateOracle(reader).check(Buffer.alloc(0), spec([{ name: "resolved", app: "helpdesk", path: "/api/v1/tickets/T-1", expect: { status: "resolved" } }]), ctx);
    expect(result.verdict).toBe("OK");
  });

  it("a reader error surfaces as a failed check, not a thrown exception", async () => {
    class ThrowingReader implements WorkspaceStateReader {
      async get(): Promise<unknown> {
        throw new Error("boom");
      }
    }
    const result = await new StateOracle(new ThrowingReader()).check(Buffer.alloc(0), spec([{ name: "x", app: "warehouse", path: "/api/v1/orders", expect: { status: "shipped" } }]), ctx);
    expect(result.verdict).toBe("FAIL");
    expect(result.checks[0].note).toMatch(/boom/);
  });

  it("multiple checks: one failing check fails the verdict without hiding the others", async () => {
    const reader = new MemoryStateReader();
    reader.seed("warehouse", "/api/v1/orders", [{ no: "SO-1", status: "shipped" }]);
    reader.seed("helpdesk", "/api/v1/tickets", []);
    const result = await new StateOracle(reader).check(
      Buffer.alloc(0),
      spec([
        { name: "order-shipped", app: "warehouse", path: "/api/v1/orders", where: { no: "SO-1" }, expect: { status: "shipped" } },
        { name: "ticket-resolved", app: "helpdesk", path: "/api/v1/tickets", expect: { status: "resolved" } },
      ]),
      ctx,
    );
    expect(result.verdict).toBe("FAIL");
    expect(result.checks.map((c) => ({ name: c.name, ok: c.ok }))).toEqual([
      { name: "order-shipped", ok: true },
      { name: "ticket-resolved", ok: false },
    ]);
  });

  it("the artifact body is ignored entirely — end state is the evidence", async () => {
    const reader = new MemoryStateReader();
    reader.seed("warehouse", "/api/v1/orders", [{ no: "SO-1", status: "shipped" }]);
    const s = spec([{ name: "shipped", app: "warehouse", path: "/api/v1/orders", where: { no: "SO-1" }, expect: { status: "shipped" } }]);
    const oracle = new StateOracle(reader);
    const withEmptyBody = await oracle.check(Buffer.alloc(0), s, ctx);
    const withGarbageBody = await oracle.check(Buffer.from("not json at all, doesn't matter"), s, ctx);
    expect(withEmptyBody.verdict).toBe("OK");
    expect(withGarbageBody.verdict).toBe("OK");
  });

  describe("pagination ({ items, nextCursor } envelope)", () => {
    it("a single page with nextCursor: null is treated as its items", async () => {
      const reader = new MemoryStateReader();
      reader.seed("warehouse", "/api/v1/orders", { items: [{ no: "SO-1", status: "open" }], nextCursor: null });
      const result = await new StateOracle(reader).check(
        Buffer.alloc(0),
        spec([{ name: "open", app: "warehouse", path: "/api/v1/orders", where: { no: "SO-1" }, expect: { status: "open" } }]),
        ctx,
      );
      expect(result.verdict).toBe("OK");
    });

    it("follows nextCursor to a second page and a check can match a row that only exists there", async () => {
      const reader = new MemoryStateReader();
      reader.seed("warehouse", "/api/v1/orders", { items: [{ no: "SO-1", status: "open" }], nextCursor: "c1" });
      reader.seed("warehouse", "/api/v1/orders?cursor=c1", { items: [{ no: "SO-2", status: "shipped" }], nextCursor: null });
      const result = await new StateOracle(reader).check(
        Buffer.alloc(0),
        spec([{ name: "shipped", app: "warehouse", path: "/api/v1/orders", where: { no: "SO-2" }, expect: { status: "shipped" } }]),
        ctx,
      );
      expect(result.verdict).toBe("OK");
    });

    it("appends the cursor with & when the path already carries a query string", async () => {
      const reader = new MemoryStateReader();
      reader.seed("warehouse", "/api/v1/orders?status=open", { items: [{ no: "SO-1" }], nextCursor: "c1" });
      reader.seed("warehouse", "/api/v1/orders?status=open&cursor=c1", { items: [{ no: "SO-2" }], nextCursor: null });
      const result = await new StateOracle(reader).check(
        Buffer.alloc(0),
        spec([{ name: "found-on-page-2", app: "warehouse", path: "/api/v1/orders?status=open", where: { no: "SO-2" }, expect: {} }]),
        ctx,
      );
      expect(result.verdict).toBe("OK");
    });

    it("stops after MAX_PAGES (10) reads and notes it when the check still fails", async () => {
      let calls = 0;
      class InfiniteReader implements WorkspaceStateReader {
        async get(): Promise<unknown> {
          calls++;
          return { items: [{ no: `SO-${calls}` }], nextCursor: "more" };
        }
      }
      const result = await new StateOracle(new InfiniteReader()).check(
        Buffer.alloc(0),
        spec([{ name: "never-matches", app: "warehouse", path: "/api/v1/orders", where: { no: "SO-999" }, expect: {} }]),
        ctx,
      );
      expect(calls).toBe(10);
      expect(result.verdict).toBe("FAIL");
      expect(result.checks[0].note).toMatch(/10 pages/);
    });

    it("a bare object without an items array is still treated as one row (unchanged detail-route behavior)", async () => {
      const reader = new MemoryStateReader();
      reader.seed("warehouse", "/api/v1/orders/SO-1", { no: "SO-1", status: "shipped" });
      const result = await new StateOracle(reader).check(
        Buffer.alloc(0),
        spec([{ name: "shipped", app: "warehouse", path: "/api/v1/orders/SO-1", expect: { status: "shipped" } }]),
        ctx,
      );
      expect(result.verdict).toBe("OK");
    });

    it("empty items in a paginated envelope FAILs the same way an empty bare array does", async () => {
      const reader = new MemoryStateReader();
      reader.seed("warehouse", "/api/v1/orders", { items: [], nextCursor: null });
      const result = await new StateOracle(reader).check(
        Buffer.alloc(0),
        spec([{ name: "shipped", app: "warehouse", path: "/api/v1/orders", expect: { status: "shipped" } }]),
        ctx,
      );
      expect(result.verdict).toBe("FAIL");
      expect(result.checks[0].note).toMatch(/no row/);
    });
  });

  it("the discriminated union recognizes kind: \"state\" and the registry can dispatch to it", () => {
    const parsed = taskSpecSchema.parse({
      id: "state-oracle-schema-test",
      oracle: spec([{ name: "shipped", app: "warehouse", path: "/api/v1/orders", expect: { status: "shipped" } }]),
    });
    expect(parsed.oracle.kind).toBe("state");
  });
});
