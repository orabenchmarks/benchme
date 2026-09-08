import type { Pool } from "@benchme/core";
import { UnknownScenarioError, type ScenarioRegistry } from "@benchme/scenarios";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { seedWarehouse } from "../db/seed.js";

/** Gateway-only: materialise a workspace. The workspace header is already verified by the scope hook. */
export function registerSeedRoute(app: FastifyInstance, pool: Pool, scenarios: ScenarioRegistry): void {
  app.post<{ Params: { id: string } }>("/internal/workspaces/:id/seed", async (req, reply) => {
    if (req.params.id !== req.workspaceId) return reply.code(400).send({ error: "WORKSPACE_MISMATCH" });
    const body = z.object({ scenario: z.string().min(1), seed: z.number().int().positive() }).parse(req.body);
    try {
      const rows = scenarios.get(body.scenario).generate(body.seed);
      await seedWarehouse(pool, req.workspaceId, rows);
      return reply.code(201).send({ ok: true, products: rows.warehouse.products.length, orders: rows.warehouse.orders.length });
    } catch (err) {
      if (err instanceof UnknownScenarioError) return reply.code(422).send({ error: "UNKNOWN_SCENARIO", message: err.message });
      throw err;
    }
  });
}
