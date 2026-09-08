import type { z } from "zod";
import type { CatalogRepo } from "../db/catalog-repo.js";
import type { OrdersRepo } from "../db/orders-repo.js";

export type ToolContext = { workspaceId: string; catalog: CatalogRepo; orders: OrdersRepo };

/** One MCP tool: a name, a description the model reads, an input schema, and a handler. */
export type ToolDef<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  input: S;
  /** Returns a JSON-serialisable result; thrown DomainErrors become isError results. */
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
};

/** Registry (Open/Closed): a tool is added by registering a ToolDef, never by editing the server. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();

  register<S extends z.ZodRawShape>(def: ToolDef<S>): this {
    if (this.tools.has(def.name)) throw new Error(`duplicate tool: ${def.name}`);
    this.tools.set(def.name, def as unknown as ToolDef);
    return this;
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }
}
