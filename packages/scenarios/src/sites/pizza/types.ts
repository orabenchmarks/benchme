/**
 * The pizza ordering site (apps/pizza): a chain with branches in six cities, a
 * menu of named pizzas (each one a base configuration) and a builder. Prices
 * are per pizza; an order's total adds the branch's delivery fee unless the
 * subtotal reaches its free-delivery threshold. Rules: ./rules.ts.
 */
export type PizzaSizeKey = "small" | "medium" | "large" | "xlarge";
export type PizzaAllergen = "gluten" | "dairy" | "nuts" | "fish";

/** A size and the price of a plain pizza (crust, sauce, cheese) in it. `serves` is how many people it feeds. */
export type PizzaSize = { key: PizzaSizeKey; name: string; inches: number; serves: number; baseCents: number };

/** One topping; its price depends on the pizza's size. */
export type PizzaTopping = {
  key: string;
  name: string;
  vegetarian: boolean;
  vegan: boolean;
  allergens: PizzaAllergen[];
  pricesCents: Record<PizzaSizeKey, number>;
};

/** Crusts, sauces and cheeses are the chain's fixed options (./catalog.ts); a surcharge depends on the size. */
export type PizzaOption = { key: string; name: string; vegetarian: boolean; vegan: boolean; allergens: PizzaAllergen[] };
export type PizzaCrust = PizzaOption & { sizes: PizzaSizeKey[]; surchargeCents: Partial<Record<PizzaSizeKey, number>> };
export type PizzaSauce = PizzaOption;
export type PizzaCheese = PizzaOption & { surchargeCents: Record<PizzaSizeKey, number> };

/** What a pizza is made of. `toppings` is a set (each at most once), kept sorted. */
export type PizzaConfig = { size: string; crust: string; sauce: string; cheese: string; toppings: string[] };

/** A named pizza on the menu: a base configuration without a size. */
export type PizzaMenuItem = { code: string; name: string; description: string; crust: string; sauce: string; cheese: string; toppings: string[] };

export type PizzaBranch = {
  code: string;
  name: string;
  city: string;
  address: string;
  delivers: boolean;
  /** Null where the branch is pickup only. */
  deliveryFeeCents: number | null;
  /** Delivery is free when the subtotal is at least this; null where the branch is pickup only. */
  freeDeliveryFromCents: number | null;
  /** Pizzas the branch makes per 30-minute slot. */
  slotCapacity: number;
};

/** A topping a branch has run out of: no order there may use it. */
export type PizzaStockout = { branchCode: string; toppingKey: string };

export type PizzaOrderStatus = "received" | "preparing" | "out_for_delivery" | "delivered" | "cancelled";
export type PizzaFulfilment = "pickup" | "delivery";

export type PizzaOrderLine = PizzaConfig & {
  line: number;
  /** The menu pizza the line started from; null for a pizza built from scratch. */
  pizzaCode: string | null;
  quantity: number;
  unitCents: number;
  lineCents: number;
};

export type PizzaOrder = {
  orderNo: string;
  branchCode: string;
  customerName: string;
  customerEmail: string;
  fulfilment: PizzaFulfilment;
  /** The delivery address; null for pickup. */
  address: string | null;
  /** "YYYY-MM-DD" */
  slotDate: string;
  /** "HH:MM", one of PIZZA_SLOT_TIMES */
  slotTime: string;
  status: PizzaOrderStatus;
  lines: PizzaOrderLine[];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  createdAt: string;
};

export type PizzaRows = {
  sizes: PizzaSize[];
  toppings: PizzaTopping[];
  pizzas: PizzaMenuItem[];
  branches: PizzaBranch[];
  stockouts: PizzaStockout[];
  orders: PizzaOrder[];
};
