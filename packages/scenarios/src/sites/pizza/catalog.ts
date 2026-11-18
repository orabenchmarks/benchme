import type { PizzaAllergen, PizzaCheese, PizzaCrust, PizzaOrderStatus, PizzaSauce, PizzaSizeKey, PizzaTopping } from "./types.js";

/**
 * The chain's fixed options and limits. Sizes and toppings are rows (their
 * prices come from the seed); crusts, sauces and cheeses are the same in every
 * workspace.
 */

/** Slot dates the site takes orders for. Fixed, not "from today", so a seed means the same slots forever. */
export const PIZZA_WINDOW = { first: "2027-01-01", last: "2027-12-31" } as const;
/** Every branch's 30-minute slots, 12:00 to 21:30. */
export const PIZZA_SLOT_TIMES: readonly string[] = Array.from({ length: 20 }, (_, i) => `${String(12 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
export const PIZZA_MAX_TOPPINGS = 5;
export const PIZZA_MAX_QUANTITY = 10;
export const PIZZA_MAX_LINES = 6;
export const PIZZA_SIZE_KEYS: readonly PizzaSizeKey[] = ["small", "medium", "large", "xlarge"];
export const PIZZA_ALLERGENS: readonly PizzaAllergen[] = ["gluten", "dairy", "nuts", "fish"];
export const PIZZA_STATUSES: readonly PizzaOrderStatus[] = ["received", "preparing", "out_for_delivery", "delivered", "cancelled"];
/** Statuses whose pizzas hold a slot's capacity: every one but cancelled. */
export const PIZZA_HOLDING: readonly PizzaOrderStatus[] = ["received", "preparing", "out_for_delivery", "delivered"];

export const PIZZA_SIZE_SHAPES: readonly { key: PizzaSizeKey; name: string; inches: number; serves: number }[] = [
  { key: "small", name: "Small", inches: 10, serves: 1 },
  { key: "medium", name: "Medium", inches: 12, serves: 2 },
  { key: "large", name: "Large", inches: 14, serves: 4 },
  { key: "xlarge", name: "Extra large", inches: 16, serves: 6 },
];

export const PIZZA_CRUSTS: readonly PizzaCrust[] = [
  { key: "classic", name: "Classic", vegetarian: true, vegan: true, allergens: ["gluten"], sizes: ["small", "medium", "large", "xlarge"], surchargeCents: { small: 0, medium: 0, large: 0, xlarge: 0 } },
  { key: "thin", name: "Thin", vegetarian: true, vegan: true, allergens: ["gluten"], sizes: ["small", "medium", "large", "xlarge"], surchargeCents: { small: 0, medium: 0, large: 0, xlarge: 0 } },
  { key: "stuffed", name: "Cheese-stuffed", vegetarian: true, vegan: false, allergens: ["dairy", "gluten"], sizes: ["medium", "large", "xlarge"], surchargeCents: { medium: 250, large: 300, xlarge: 350 } },
  { key: "gluten-free", name: "Gluten-free", vegetarian: true, vegan: true, allergens: [], sizes: ["small", "medium"], surchargeCents: { small: 300, medium: 350 } },
];

export const PIZZA_SAUCES: readonly PizzaSauce[] = [
  { key: "tomato", name: "Tomato", vegetarian: true, vegan: true, allergens: [] },
  { key: "bbq", name: "Barbecue", vegetarian: true, vegan: true, allergens: [] },
  { key: "pesto", name: "Basil pesto", vegetarian: true, vegan: false, allergens: ["dairy", "nuts"] },
  { key: "garlic-cream", name: "Garlic cream", vegetarian: true, vegan: false, allergens: ["dairy"] },
  { key: "none", name: "No sauce", vegetarian: true, vegan: true, allergens: [] },
];

export const PIZZA_CHEESES: readonly PizzaCheese[] = [
  { key: "regular", name: "Mozzarella", vegetarian: true, vegan: false, allergens: ["dairy"], surchargeCents: { small: 0, medium: 0, large: 0, xlarge: 0 } },
  { key: "extra", name: "Extra mozzarella", vegetarian: true, vegan: false, allergens: ["dairy"], surchargeCents: { small: 100, medium: 150, large: 200, xlarge: 250 } },
  { key: "cashew", name: "Cashew cheese", vegetarian: true, vegan: true, allergens: ["nuts"], surchargeCents: { small: 150, medium: 200, large: 250, xlarge: 300 } },
  { key: "none", name: "No cheese", vegetarian: true, vegan: true, allergens: [], surchargeCents: { small: 0, medium: 0, large: 0, xlarge: 0 } },
];

/** The toppings every workspace has; the seed draws their prices. `meat` toppings cost more. */
export const PIZZA_TOPPING_SHAPES: readonly (Omit<PizzaTopping, "pricesCents"> & { meat: boolean })[] = [
  { key: "mushroom", name: "Mushrooms", vegetarian: true, vegan: true, allergens: [], meat: false },
  { key: "red-onion", name: "Red onion", vegetarian: true, vegan: true, allergens: [], meat: false },
  { key: "green-pepper", name: "Green peppers", vegetarian: true, vegan: true, allergens: [], meat: false },
  { key: "black-olive", name: "Black olives", vegetarian: true, vegan: true, allergens: [], meat: false },
  { key: "pineapple", name: "Pineapple", vegetarian: true, vegan: true, allergens: [], meat: false },
  { key: "sweetcorn", name: "Sweetcorn", vegetarian: true, vegan: true, allergens: [], meat: false },
  { key: "jalapeno", name: "Jalapeños", vegetarian: true, vegan: true, allergens: [], meat: false },
  { key: "spinach", name: "Spinach", vegetarian: true, vegan: true, allergens: [], meat: false },
  { key: "artichoke", name: "Artichoke hearts", vegetarian: true, vegan: true, allergens: [], meat: false },
  { key: "walnut", name: "Walnuts", vegetarian: true, vegan: true, allergens: ["nuts"], meat: false },
  { key: "vegan-sausage", name: "Wheat-protein sausage", vegetarian: true, vegan: true, allergens: ["gluten"], meat: false },
  { key: "feta", name: "Feta", vegetarian: true, vegan: false, allergens: ["dairy"], meat: false },
  { key: "goat-cheese", name: "Goat cheese", vegetarian: true, vegan: false, allergens: ["dairy"], meat: false },
  { key: "pepperoni", name: "Pepperoni", vegetarian: false, vegan: false, allergens: [], meat: true },
  { key: "ham", name: "Ham", vegetarian: false, vegan: false, allergens: [], meat: true },
  { key: "chicken", name: "Roast chicken", vegetarian: false, vegan: false, allergens: [], meat: true },
  { key: "bacon", name: "Bacon", vegetarian: false, vegan: false, allergens: [], meat: true },
  { key: "anchovy", name: "Anchovies", vegetarian: false, vegan: false, allergens: ["fish"], meat: true },
  { key: "meatball", name: "Beef meatballs", vegetarian: false, vegan: false, allergens: ["gluten"], meat: true },
];
