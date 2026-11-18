import { PIZZA_ALLERGENS, type PizzaAllergen } from "@benchme/scenarios";
import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import { changeInput, date, orderInput, quoteInput, statusEnum, time, toMenuQuery } from "../api/inputs.js";
import type { PizzaRepo } from "../db/pizza-repo.js";

export type ToolContext = { workspaceId: string; pizza: PizzaRepo };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};
const allergens = z.array(z.enum(PIZZA_ALLERGENS as unknown as [PizzaAllergen, ...PizzaAllergen[]])).optional().describe('Allergens the pizza must not contain, e.g. ["nuts"]');

/** The pizza site's MCP surface (and, through the bridge, its WebMCP tools): the menu and builder, branches and slots, a quote, and orders. */
export function pizzaTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_branches",
      description: "Branches, optionally in one city: address, whether it delivers, its delivery fee and free-delivery threshold in cents, pizzas per 30-minute slot, and the toppings it is out of.",
      input: { city: z.string().optional() },
      handler: (a, c) => c.pizza.branches(c.workspaceId, a.city),
    })
    .register({
      name: "get_menu",
      description:
        "The builder's options and the menu: sizes (how many people each serves, base price in cents), crusts (which sizes, surcharge per size), sauces, cheeses (surcharge per size), toppings (price per size, vegetarian, vegan, allergens), and the named pizzas (configuration, price per size, diet, allergens, the branches that cannot make them).",
      input: {},
      handler: async (_a, c) => ({ ...(await c.pizza.builder(c.workspaceId)), pizzas: await c.pizza.menu(c.workspaceId) }),
    })
    .register({
      name: "search_menu",
      description:
        "Menu pizzas in one size that meet every filter, cheapest first, with the price in cents. With branchCode, only pizzas that branch can make (none of their toppings out of stock there). maxPrice is dollars per pizza.",
      input: {
        size: z.string().describe("small | medium | large | xlarge"),
        branchCode: z.string().optional(),
        vegetarian: z.boolean().optional(),
        vegan: z.boolean().optional(),
        without: allergens,
        maxPrice: z.number().positive().optional(),
        toppings: z.array(z.string()).optional().describe("topping keys every pizza must have"),
      },
      handler: (a, c) => c.pizza.search(c.workspaceId, toMenuQuery({ ...a, branch: a.branchCode, without: a.without ?? [], toppings: a.toppings ?? [] })),
    })
    .register({
      name: "find_slots",
      description: "A branch's 30-minute slots on a date (2027), each with how many more pizzas it can make. With pizzas, only slots with room for that many; with from (HH:MM), only slots starting then or later.",
      input: { branchCode: z.string(), date, pizzas: z.number().int().min(1).optional(), from: time.optional() },
      handler: (a, c) => c.pizza.slots(c.workspaceId, { branchCode: a.branchCode, date: a.date, ...(a.pizzas ? { pizzas: a.pizzas } : {}), ...(a.from ? { from: a.from } : {}) }),
    })
    .register({
      name: "quote_order",
      description:
        "Price an order without placing it: each line's price, the subtotal, the delivery fee (none for pickup, none when the subtotal reaches the branch's free-delivery threshold) and the total, in cents, plus any topping the branch is out of. A line is a menu pizza (pizzaCode, with any option you name replacing its own) or a pizza from scratch (classic crust, tomato sauce, mozzarella unless named).",
      input: quoteInput,
      handler: (a, c) => c.pizza.quote(c.workspaceId, a),
    })
    .register({
      name: "place_order",
      description:
        "Place an order at a branch for one 30-minute slot in 2027, for pickup or delivery (delivery needs an address and a branch that delivers). Lines as in quote_order. Fails if an option is unknown or not made in the size, a pizza has more than 5 toppings, the branch is out of a topping, or the slot has no room for every pizza.",
      input: orderInput,
      handler: (a, c) => c.pizza.placeOrder(c.workspaceId, a),
    })
    .register({
      name: "list_orders",
      description: "Orders, optionally for one customer email, one branch, one status (received | preparing | out_for_delivery | delivered | cancelled) or one slot date, with their lines. Paginated via cursor.",
      input: { customerEmail: z.string().optional(), branchCode: z.string().optional(), status: statusEnum.optional(), date: date.optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
      handler: (a, c) =>
        c.pizza.listOrders(c.workspaceId, {
          ...(a.customerEmail ? { customerEmail: a.customerEmail } : {}), ...(a.branchCode ? { branch: a.branchCode } : {}), ...(a.status ? { status: a.status } : {}),
          ...(a.date ? { date: a.date } : {}), ...(a.cursor ? { cursor: a.cursor } : {}), limit: a.limit ?? 25,
        }),
    })
    .register({
      name: "get_order",
      description: "One order by its number (PO-…), with its lines.",
      input: { orderNo: z.string() },
      handler: async (a, c) => (await c.pizza.getOrder(c.workspaceId, a.orderNo)) ?? notFound(`order ${a.orderNo}`),
    })
    .register({
      name: "change_order_line",
      description:
        "Change one line of an order that is still received: size, crust, sauce, cheese, quantity, the whole topping set (toppings), or toppings added or removed. The order is re-priced. Fails once the order is preparing or later.",
      input: { orderNo: z.string(), line: z.number().int().min(1), ...changeInput },
      handler: ({ orderNo, line, ...change }, c) => c.pizza.changeLine(c.workspaceId, orderNo, line, change),
    })
    .register({
      name: "cancel_order",
      description: "Cancel an order that is still received. A cancelled order cannot be restored; order again instead.",
      input: { orderNo: z.string() },
      handler: (a, c) => c.pizza.cancelOrder(c.workspaceId, a.orderNo),
    });
}
