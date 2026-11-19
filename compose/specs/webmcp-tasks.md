# webmcp-v1 intent corpus

162 natural-language intent tasks (81 state, 81 json) against a fresh `webmcp-v1` workspace
(`node tools/intent-corpus.mjs --seed 4242`). Every derived value comes
from `@benchme/scenarios`' generator or `answers.ts` helpers — never typed
by hand — so re-running the tool for a different seed regenerates matching
specs, `webmcp-tasks.json` and `webmcp-corpus.json` together. All of them
assume the SAME fresh workspace (seed 4242); none of them create their own
workspace.


## Templated tasks (tools/intent-corpus/templates/)

Every task below comes from a template: one kind of intent, instantiated over
distinct seeded rows, its answer key derived from those rows. No two tasks
touch the same row, so the state tasks stay independent inside one
workspace. `node tools/intent-integrity.mjs` proves each one against a live
benchme: every state task FAILS on a fresh workspace and PASSES once its
reference solution has run; every json task's answer, read back from the
live apps, is accepted, and a wrong one is refused.

### stay-only-match (json, hotels) — 3 tasks

Which hotel in a city has a room free for a stay that fits the party, under a nightly cap, with two named amenities. Exactly one does (`searchStays`), and each requirement matters: without the cap, or without the amenities, two or more would. One more hotel has both amenities and a room within the cap that fits, but that room is booked out on one of the nights (any other room of it that fits is over the cap). The miss names that hotel.

- **intent-stay-only-match-01** — Karrow 2027-03-31 × 2, 1 adult, ≤ $180, breakfast + airport shuttle → HT-129; HT-132 fits too but HT-132-DBL is booked out
- **intent-stay-only-match-02** — Tessalind 2027-06-09 × 3, 2 adults, ≤ $160, gym + airport shuttle → HT-125; HT-124 fits too but HT-124-DBL is booked out
- **intent-stay-only-match-03** — Brenmoor 2027-03-19 × 2, 2 adults, ≤ $190, gym + restaurant → HT-117; HT-120 fits too but HT-120-DBL is booked out

### stay-no-match (json, hotels) — 3 tasks

Whether any hotel in a city has a room free for a stay that fits the party, under a nightly cap, with two named amenities — none does — and which hotel comes closest: the cheapest with a free room that fits and both amenities, at any price (no tie for cheapest). The cap alone and the amenities alone can each be met. One hotel has both amenities and a room within the cap that fits, but that room is booked out on one of the nights. The miss says one exists.

- **intent-stay-no-match-01** — Tessalind 2027-03-18 × 3, 2 adults, ≤ $110, spa + pool → none; closest HT-126 at $140.00; HT-126's HT-126-DBL would fit but is booked out
- **intent-stay-no-match-02** — Quillhaven 2027-04-28 × 2, 2 adults, ≤ $200, gym + free parking → none; closest HT-112 at $215.00; HT-114's HT-114-DBL would fit but is booked out
- **intent-stay-no-match-03** — Brenmoor 2027-03-25 × 3, 2 adults and 1 child, ≤ $200, breakfast + washer → none; closest HT-118 at $250.00; HT-116's HT-116-KNG would fit but is booked out

### stay-quote (json, hotels) — 3 tasks

What a named stay costs in total: one room type for some nights, with one dog where the hotel allows pets and late checkout where it offers it — at least one of the two applies. nights × nightly price + the pet fee (once per stay) + the late-checkout fee (`stayTotalCents`), ±0.01. Asked of autumn dates, when no seeded booking holds a room. The miss is the nights alone.

- **intent-stay-quote-01** — HT-119-DBL × 3 at $140.00 + pet fee $20.00 → $440.00
- **intent-stay-quote-02** — HT-109-FAM × 4 at $175.00 + late checkout $10.00 → $710.00
- **intent-stay-quote-03** — HT-102-FAM × 2 at $400.00 + pet fee $60.00 → $860.00

### stay-book (state, hotels) — 3 tasks

Book a named room type for a new guest (a name and email no seeded booking has): dates, party, and late checkout where the hotel offers it, else a dog where it allows pets. The check reads the guest's bookings: exactly one confirmed booking of that room type from that date, with the nights, party and extras asked. The miss books it without the extra, or one night short when there is none.

- **intent-stay-book-01** — emeric.fairweather@travel.example → HT-123-DBL, 2027-05-17 × 3, 1 adult and 1 child
- **intent-stay-book-02** — fenna.esterhazy@travel.example → HT-126-SGL, 2027-04-20 × 4, 1 adult
- **intent-stay-book-03** — fenna.fairweather@travel.example → HT-120-SGL, 2027-06-12 × 4, 1 adult, with late checkout

### stay-book-cheapest (state, hotels) — 3 tasks

Book, for a new guest, the cheapest room in a city that fits the party, is free every night, and is in a hotel with a named amenity (`searchStays`, first offer; strictly cheaper than the next). A cheaper room in a hotel with that amenity fits the party but is booked out on one of the nights. The check: exactly one confirmed booking for the guest, of that room type, those dates and that party. The miss books the second-cheapest.

- **intent-stay-book-cheapest-01** — Brenmoor 2027-04-22 × 3, 1 adult, gym → HT-117-FAM at $145.00; HT-117-KNG at $115.00 is booked out
- **intent-stay-book-cheapest-02** — Velmora 2027-04-20 × 3, 1 adult and 1 child, breakfast → HT-104-FAM at $255.00; HT-101-KNG at $225.00 is booked out
- **intent-stay-book-cheapest-03** — Brenmoor 2027-04-19 × 3, 2 adults, gym → HT-117-FAM at $145.00; HT-117-KNG at $115.00 is booked out

### stay-cancel-one (state, hotels) — 3 tasks

Cancel one of a seeded guest's confirmed bookings, named by its hotel and check-in date, and leave the guest's other confirmed bookings alone. Asked of a guest with at least two confirmed bookings, where no other booking of theirs has the same hotel and date. One check per confirmed booking of the guest: `cancelled` for the one named, `confirmed` for the rest. The miss cancels all of them.

- **intent-stay-cancel-one-01** — maren.sandoval9@example.com: BK-10176 (HT-131, 2027-06-11) → cancelled; BK-10093 stay confirmed
- **intent-stay-cancel-one-02** — bram.prewitt3@example.com: BK-10021 (HT-101, 2027-05-08) → cancelled; BK-10087, BK-10098, BK-10132 stay confirmed
- **intent-stay-cancel-one-03** — vesna.okonjo9@example.com: BK-10062 (HT-124, 2027-04-07) → cancelled; BK-10044, BK-10045, BK-10055, BK-10112, BK-10141, BK-10159 stay confirmed

### flight-only-match (json, flights) — 3 tasks

Which flight on a route and date has seats in a cabin for a party and meets two or three filters (nonstop, a departure window, one of two carriers, a fare cap). Exactly one does (`searchFlights`), and each filter matters: without any one of them, two or more would. One more flight meets every filter, but its cabin has fewer seats left than the party (sold out, or one or two left). The miss names that flight.

- **intent-flight-only-match-01** — TAL→BNO 2027-04-19, economy × 2, is nonstop; costs no more than $130 per passenger → TF187; TF253 meets every filter but has 0 economy seat(s) left
- **intent-flight-only-match-02** — VEO→TAL 2027-03-01, economy × 3, is flown by Ello Wings (EM) or Trulo Aviation (TF); costs no more than $150 per passenger → TF132; TF935 meets every filter but has 2 economy seat(s) left
- **intent-flight-only-match-03** — VEO→TAL 2027-04-18, economy × 2, is nonstop; is flown by Quendor Air (QE) or Trulo Aviation (TF) → TF132; QE354 meets every filter but has 1 economy seat(s) left

### flight-no-match (json, flights) — 3 tasks

Whether any flight on a route and date has seats in a cabin for a party, meets one filter (nonstop, a departure window, or one of two carriers) and costs no more than a fare cap — none does — and which flight comes closest: the cheapest that has the seats and meets the filter, at any fare (no tie for cheapest). The cap is the highest whole $10 below that fare, and the cap alone can be met. One flight meets the filter and the cap, but its cabin has fewer seats left than the party. The miss says one exists and names that flight.

- **intent-flight-no-match-01** — OND→KAO 2027-04-08, business × 3, is nonstop, ≤ $380 → none; closest QE737 at $390.00; TF341 would fit but has 1 seat(s) left
- **intent-flight-no-match-02** — TAL→KAO 2027-03-05, premium × 2, departs between 04:00 and 08:00, ≤ $170 → none; closest SZ853 at $180.00; SZ815 would fit but has 0 seat(s) left
- **intent-flight-no-match-03** — QLV→KAO 2027-04-10, economy × 3, is flown by Quendor Air (QE) or Silel Wings (SZ), ≤ $190 → none; closest QE935 at $195.00; SZ796 would fit but has 2 seat(s) left

### flight-quote (json, flights) — 3 tasks

What a named booking costs in total: two to four passengers, never more than the cabin seats, in one cabin of a named flight, each with one or more checked bags. passengers × the cabin's fare + passengers × bags × the carrier's bag fee (`flightTotalCents`), ±0.01. Fares do not change by date. The miss charges the bags once for the whole booking instead of for each passenger.

- **intent-flight-quote-01** — TF522 business $410.00 × 2 + TF bag fee $45.00 × 1 × 2 → $910.00
- **intent-flight-quote-02** — QE130 economy $175.00 × 2 + QE bag fee $40.00 × 1 × 2 → $430.00
- **intent-flight-quote-03** — SZ214 business $425.00 × 2 + SZ bag fee $35.00 × 1 × 2 → $920.00

### flight-book-round-trip (state, flights) — 3 tasks

Book a round trip on two named flights for a new traveller and a companion (names and an email no seeded booking has): out on one date and back on a later one, in one cabin both flights sell, with checked bags for each passenger. A round trip is two bookings. Two checks per leg read the contact's bookings: exactly one confirmed booking of that flight on that date, in the cabin, with two passengers, the bags asked and each passenger's name. The miss books the outbound flight only.

- **intent-flight-book-round-trip-01** — florin.fenwick@travel.example: SZ214 2027-05-18 + EM431 2027-05-26, economy, Florin Fenwick & Aurelio Fenwick, 1 bag(s) each
- **intent-flight-book-round-trip-02** — cosmin.dunmore@travel.example: QE554 2027-05-12 + EM612 2027-05-18, economy, Cosmin Dunmore & Florin Dunmore, 2 bag(s) each
- **intent-flight-book-round-trip-03** — dagny.bracknell@travel.example: TF253 2027-05-24 + QE802 2027-05-28, premium, Dagny Bracknell & Greer Bracknell, 1 bag(s) each

### flight-book-cheapest (state, flights) — 3 tasks

Book, for a new traveller and their party, the cheapest flight on a route and date that has seats in a cabin for all of them, sometimes with one filter (nonstop, a departure window, or one of two carriers): `searchFlights`' first offer, strictly cheaper than the next. A cheaper flight that meets the filter has fewer seats left in that cabin than the party. The check: exactly one confirmed booking for the contact, of that flight on that date, in that cabin, for the whole party, with no checked bag (the intent says so). The miss books the cheapest flight that ignores the filter, or the second-cheapest when there is no filter.

- **intent-flight-book-cheapest-01** — OND→KAO 2027-03-05, business × 2 → TF341 at $315.00; EM702 at $220.00 has 0 seat(s) left; miss QE737
- **intent-flight-book-cheapest-02** — VEO→OND 2027-04-14, business × 2, is nonstop → SZ203 at $425.00; TF243 at $360.00 has 0 seat(s) left; miss QE121
- **intent-flight-book-cheapest-03** — VEO→TAL 2027-03-22, premium × 2 → TF132 at $250.00; TF935 at $175.00 has 0 seat(s) left; miss EM524

### flight-cancel-return (state, flights) — 3 tasks

Cancel the return flight of a seeded traveller's round trip (two confirmed bookings with the same party, out and back on the same route) and leave the outbound flight and the traveller's other confirmed bookings alone. Asked of a contact with no other booking on either leg's route and date. One check per confirmed booking of the contact: `cancelled` for the return flight, `confirmed` for the rest. The miss cancels both legs.

- **intent-flight-cancel-return-01** — teodor.okonjo8@example.com: BK-10056 (QE615, 2027-03-20) → cancelled; BK-10037, BK-10055, BK-10063, BK-10064, BK-10071, BK-10072, BK-10079, BK-10104, BK-10131, BK-10133, BK-10141 stay confirmed
- **intent-flight-cancel-return-02** — bram.thorsby4@example.com: BK-10070 (QE935, 2027-04-13) → cancelled; BK-10020, BK-10069, BK-10088, BK-10142, BK-10150 stay confirmed
- **intent-flight-cancel-return-03** — lior.kowalczyk4@example.com: BK-10076 (EM244, 2027-04-12) → cancelled; BK-10049, BK-10075 stay confirmed

### dining-only-match (json, dining) — 3 tasks

Which restaurant in a city has a table in a named area free for a party at a date and time, offers a named dietary menu and, in some tasks, has at most a named price level. Exactly one does (`diningSearch`), and the menu matters: without it, two or more would. One more restaurant offers the menu, is within the price level, is open then and has tables in that area that seat the party, but every one of them is taken for the two hours. The miss names that restaurant.

- **intent-dining-only-match-01** — Brenmoor 2027-04-14 20:30, 2 people, terrace, gluten-free → RS-115; RS-118 fits too but its terrace tables are all taken
- **intent-dining-only-match-02** — Karrow 2027-05-22 15:00, 3 people, indoor, vegan → RS-123; RS-124 fits too but its indoor tables are all taken
- **intent-dining-only-match-03** — Ostrand 2027-05-22 18:30, 2 people, indoor, vegetarian, level ≤ 3 → RS-110; RS-109 fits too but its indoor tables are all taken

### dining-no-match (json, dining) — 3 tasks

Whether any restaurant in a city has a table in a named area free for a party at a date and time and offers a named dietary menu — none does — and the closest: the first later half hour that day at which one does, and that restaurant (only one at that time). The area alone and the menu alone can each be met at the asked time. One restaurant offers the menu and has tables in that area that seat the party, but they are all taken. The miss says that restaurant has one at the asked time.

- **intent-dining-no-match-01** — Quillhaven 2027-05-25 18:00, 2 people, terrace, vegan → none; first later: RS-112 at 20:00; RS-112's terrace tables would fit but are all taken
- **intent-dining-no-match-02** — Brenmoor 2027-05-30 14:00, 2 people, terrace, gluten-free → none; first later: RS-115 at 15:00; RS-115's terrace tables would fit but are all taken
- **intent-dining-no-match-03** — Karrow 2027-05-21 16:00, 6 people, private, vegan → none; first later: RS-124 at 18:00; RS-124's private tables would fit but are all taken

### dining-deposit (json, dining) — 3 tasks

The deposit a restaurant takes for a reservation of its private room: the party × the restaurant's deposit per guest + its private-room fee (`diningDepositCents`), ±0.01. Asked of restaurants that take both, on autumn dates when no seeded reservation holds a table. The miss is the per-guest part alone.

- **intent-dining-deposit-01** — RS-105: 9 × $5.00 + room $50.00 → $95.00
- **intent-dining-deposit-02** — RS-122: 9 × $20.00 + room $150.00 → $330.00
- **intent-dining-deposit-03** — RS-106: 6 × $10.00 + room $130.00 → $190.00

### dining-book-note (state, dining) — 3 tasks

Book a table in a named area at a named restaurant for a new guest (a name and email no seeded reservation has), with a phone number, a party, a date and time when a table is free, and a special request to enter word for word. The check reads the guest's reservations: exactly one confirmed reservation at that restaurant on that date, with the area, time, party and the request as asked. The miss books it without the request.

- **intent-dining-book-note-01** — elodie.ashcombe@table.example → RS-113 bar, 2027-04-08 16:30, 2 people, "One guest has a severe nut allergy"
- **intent-dining-book-note-02** — benedikt.everleigh@table.example → RS-120 indoor, 2027-04-22 18:00, 3 people, "Please seat us together, we may arrive separately"
- **intent-dining-book-note-03** — florian.fenwick@table.example → RS-126 indoor, 2027-05-24 18:00, 2 people, "One guest is gluten intolerant"

### dining-book-earliest (state, dining) — 3 tasks

Book, for a new guest, a table in a named area at a named restaurant at a date and time — every table of the area is taken then — or else at the earliest later half hour that day when one is free for the two hours (`diningAvailability`). The check: exactly one confirmed reservation for the guest at that restaurant on that date, in that area, at that time, for that party. The miss books the first free time on the hour after the asked one (or the free time after the earliest, when the earliest is on the hour).

- **intent-dining-book-earliest-01** — RS-103 indoor 2027-05-07: 18:30 is full → 20:30 for 3 people (cosima.fenwick@table.example); the miss books 21:00
- **intent-dining-book-earliest-02** — RS-122 terrace 2027-05-03: 14:00 is full → 16:00 for 3 people (elodie.dunmore@table.example); the miss books 16:30
- **intent-dining-book-earliest-03** — RS-124 terrace 2027-04-12: 13:00 is full → 15:00 for 2 people (cosima.calloway@table.example); the miss books 15:30

### dining-change-party (state, dining) — 3 tasks

Change the party size of one of a seeded guest's confirmed reservations, named by its restaurant and date, and leave the guest's other confirmed reservations alone. Asked of a guest with at least two confirmed reservations, where no other reservation of theirs has the same restaurant and date; the new size fits the area's tables. One check per confirmed reservation of the guest: the new party for the one named, the party it had for the rest, all still confirmed. The miss changes every one of their reservations whose tables seat the new size.

- **intent-dining-change-party-01** — teodor.thorsby9@example.com: RV-10095 (RS-105, 2027-05-23) 3 → 4; RV-10021, RV-10027, RV-10032, RV-10062, RV-10196 unchanged
- **intent-dining-change-party-02** — teodor.prewitt8@example.com: RV-10034 (RS-122, 2027-04-07) 8 → 9; RV-10030, RV-10044, RV-10059, RV-10089, RV-10141, RV-10145, RV-10173 unchanged
- **intent-dining-change-party-03** — quill.thorsby4@example.com: RV-10077 (RS-114, 2027-04-27) 2 → 1; RV-10073, RV-10074, RV-10188, RV-10199, RV-10203 unchanged

### pizza-custom-order (state, pizza) — 3 tasks

Order, for a new customer, one menu pizza changed in the builder: the smallest size that serves a number of people (`pizzaSizeFor`), another crust made in that size, one of its toppings taken off and one added (in stock at the branch), for pickup in an empty autumn slot. The check reads the customer's orders: exactly one received order in that slot, with one line whose size, crust, sauce, cheese, exact topping set and quantity are the ones asked. The miss keeps the topping that was to be taken off.

- **intent-pizza-custom-order-01** — aurelio.ashdown@order.example → BR-104 2027-10-20 13:00: PZ-113 large (serves 4 ≥ 3), thin, −vegan-sausage +walnut → black-olive,mushroom,pineapple,walnut
- **intent-pizza-custom-order-02** — caspian.brightwater@order.example → BR-112 2027-10-20 12:30: PZ-104 medium (serves 2 ≥ 2), stuffed, −artichoke +walnut → feta,walnut
- **intent-pizza-custom-order-03** — florin.copperfield@order.example → BR-109 2027-09-17 18:00: PZ-114 large (serves 4 ≥ 3), thin, −red-onion +sweetcorn → anchovy,meatball,sweetcorn

### pizza-quote-delivery (json, pizza) — 3 tasks

What an order of several identical pizzas costs in total, delivered from a named branch: quantity × the pizza's price (the size's base, the crust and cheese surcharges in that size, each topping's price in that size), plus the branch's delivery fee unless the subtotal reaches its free-delivery threshold (`pizzaUnitCents`, `pizzaDeliveryFeeCents`), ±0.01. The quantity puts the subtotal within one pizza of the threshold, below it or at or above it. The miss gets the fee the wrong way round: added when it is waived, left out when it is due.

- **intent-pizza-quote-delivery-01** — BR-110: 3 × $18.00 (medium classic garlic-cream extra artichoke+feta+green-pepper) = $54.00; free from $40.00, so fee $0.00 → $54.00
- **intent-pizza-quote-delivery-02** — BR-105: 2 × $23.40 (large classic garlic-cream cashew artichoke+goat-cheese+green-pepper) = $46.80; free from $30.00, so fee $0.00 → $46.80
- **intent-pizza-quote-delivery-03** — BR-102: 1 × $21.45 (medium gluten-free tomato cashew anchovy+pineapple) = $21.45; free from $35.00, so fee $5.00 → $26.45

### pizza-cheapest-menu (json, pizza) — 3 tasks

Which menu pizza is the cheapest in a size that meets a diet or allergen filter and can be made at a named branch, with the toppings it has in stock (`pizzaMenuSearch` with the branch; strictly cheaper than the next). A cheaper menu pizza meets the filter too, but the branch is out of one of its toppings. The miss names that pizza.

- **intent-pizza-cheapest-menu-01** — BR-103 large vegan and contains no nuts → PZ-111 at $22.10; PZ-108 at $20.05 fits but BR-103 is out of red-onion
- **intent-pizza-cheapest-menu-02** — BR-107 small free of dairy → PZ-106 at $13.60; PZ-108 at $12.50 fits but BR-107 is out of red-onion
- **intent-pizza-cheapest-menu-03** — BR-101 xlarge vegetarian and contains no nuts → PZ-107 at $28.10; PZ-104 at $22.95 fits but BR-101 is out of feta

### pizza-menu-none (json, pizza) — 3 tasks

Whether any menu pizza in a size meets a diet or allergen filter, costs no more than a cap, and can be made at a named branch — none does — and which comes closest: the cheapest that meets the filter and can be made there, at any price (no tie for cheapest). The cap alone can be met at the branch. One menu pizza meets the filter within the cap, but the branch is out of one of its toppings. The miss says one exists and names that pizza.

- **intent-pizza-menu-none-01** — BR-108 medium free of dairy ≤ $17 → none; closest PZ-106 at $17.75; PZ-108 at $16.25 would fit but BR-108 is out of red-onion
- **intent-pizza-menu-none-02** — BR-105 large free of dairy ≤ $21 → none; closest PZ-106 at $21.95; PZ-108 at $20.05 would fit but BR-105 is out of pineapple
- **intent-pizza-menu-none-03** — BR-103 small free of dairy ≤ $13 → none; closest PZ-111 at $13.85; PZ-108 at $12.50 would fit but BR-103 is out of red-onion

### pizza-earliest-slot (state, pizza) — 3 tasks

Order, for a new customer, several of one menu pizza for pickup at a branch on a busy day, in the earliest slot at or after a named time that has room for all of them (`pizzaSlots`). The named time's slot is full, and so may be the next ones, or they have room for fewer pizzas. The check reads the customer's orders: exactly one received order at that branch on that day, in that slot, with the pizzas asked. The miss orders them in a later slot with room, not the earliest.

- **intent-pizza-earliest-slot-01** — BR-104 2027-05-19 from 18:30 (full), 2 pizzas → 20:00 (19:30 has 1 left); next with room 20:30
- **intent-pizza-earliest-slot-02** — BR-106 2027-05-03 from 19:00 (full), 3 pizzas → 21:00 (20:30 has 1 left); next with room 21:30
- **intent-pizza-earliest-slot-03** — BR-108 2027-05-19 from 16:30 (full), 3 pizzas → 17:30 (17:00 has 1 left); next with room 18:00

### pizza-remove-topping (state, pizza) — 3 tasks

Take one topping off the pizza in one of a seeded customer's received orders, named by its branch and slot, and leave their other orders alone. Asked of a customer with at least two received orders that carry that topping, where the named one carries it on one line only. One check per line: the named line without the topping (and the order still received, re-priced by `pizzaChangeLine`), every other line of that order unchanged, and the topping still on each of the customer's other received orders. The miss takes the topping off all of them.

- **intent-pizza-remove-topping-01** — vesna.prewitt9@example.org: PO-10136 (BR-101, 2027-05-07 12:30) line 1 −meatball → $17.40; PO-10100, PO-10135 keep meatball
- **intent-pizza-remove-topping-02** — bram.halvard1@example.org: PO-10093 (BR-102, 2027-05-10 18:30) line 1 −walnut → $16.30; PO-10008, PO-10024, PO-10111 keep walnut
- **intent-pizza-remove-topping-03** — teodor.mbeki7@example.org: PO-10059 (BR-112, 2027-05-11 15:30) line 1 −artichoke → $13.80; PO-10105 keep artichoke

### cinema-no-showtime (json, cinema) — 3 tasks

Whether any showtime in a city on a date is of a named genre, in a named format, starts at or after a time, and has at least N free seats — none does — and which comes closest: the earliest showtime of that genre there that day, from that time, with N free seats, in any format (start times in one cinema never tie). One showtime meets every requirement but the seats: it is sold out or has fewer than N free. The miss says one exists and names it.

- **intent-cinema-no-showtime-01** — Tessalind 2027-05-15 action 2d from 15:00, 3 seats → none; closest ST-2092 (21:50, 3d); ST-2086 (15:30) fits but has 0 free
- **intent-cinema-no-showtime-02** — Karrow 2027-05-15 drama 3d from 15:00, 6 seats → none; closest ST-2094 (15:30, large); ST-2100 (21:50) fits but has 3 free
- **intent-cinema-no-showtime-03** — Karrow 2027-05-14 drama 2d from 16:00, 6 seats → none; closest ST-2044 (21:30, large); ST-2050 (16:10) fits but has 5 free

### cinema-only-showtime (json, cinema) — 3 tasks

Which showtime in a city on a date is of a named genre, in a named format, starts at or after a time, and has at least N free seats. Exactly one does (`cinemaSearchShowtimes`), and the time or the format matters (both where the day allows it): without it, two or more would. One more showtime is of that genre and format and starts after the time, but it is sold out or has fewer than N seats free. The miss names that showtime.

- **intent-cinema-only-showtime-01** — Karrow 2027-05-16 drama 3d from 14:00, 2 seats → ST-2151 (18:50, 42 free); ST-2154 (16:10) fits but has 0 free
- **intent-cinema-only-showtime-02** — Tessalind 2027-05-14 drama 2d from 12:00, 5 seats → ST-2038 (15:50, 48 free); ST-2033 (12:30) fits but has 4 free
- **intent-cinema-only-showtime-03** — Ostrand 2027-05-16 animation 3d from 15:00, 6 seats → ST-2120 (21:50, 43 free); ST-2118 (15:50) fits but has 5 free

### cinema-book-earliest-together (state, cinema) — 3 tasks

Book, for a new customer, N seats side by side at the earliest showtime of a named film at a named cinema that still has N free seats side by side (`cinemaSearchShowtimes` with `together`, first result). An earlier showtime of the film there has N or more seats free, but none side by side. The check: exactly one confirmed booking for the customer, at that showtime, of N seats side by side, with the ticket mix asked. The miss books N free seats at the earliest showtime with N free seats, which are not side by side.

- **intent-cinema-book-earliest-together-01** — FM-114 at CN-101, 4 together → ST-2111 (2027-05-16 18:50); ST-2053 (2027-05-15 12:30) has 5 free, at most 1 side by side
- **intent-cinema-book-earliest-together-02** — FM-103 at CN-105, 2 together → ST-2090 (2027-05-15 15:50); ST-2085 (2027-05-15 12:30) has 4 free, at most 1 side by side
- **intent-cinema-book-earliest-together-03** — FM-115 at CN-106, 3 together → ST-2103 (2027-05-15 19:10); ST-2097 (2027-05-15 12:50) has 4 free, at most 1 side by side

### cinema-ticket-quote (json, cinema) — 3 tasks

What named seats in a premium row of a showtime cost in total for a ticket mix with at least one non-adult ticket: each ticket's price for the showtime's format and type, plus the premium surcharge per seat, plus the booking fee per ticket (`cinemaQuote`), ±0.01. The seats are free in the seed. The miss is the ticket prices alone.

- **intent-cinema-ticket-quote-01** — ST-2056 2d H1,H2,H3 (premium) 1 adult, 1 child and 1 student: tickets $33.00 + 3 × (surcharge $3.25 + fee $1.25) → $46.50
- **intent-cinema-ticket-quote-02** — ST-2067 2d F3,F4,F5,F6 (premium) 1 adult, 2 children and 1 student: tickets $34.75 + 4 × (surcharge $3.50 + fee $0.75) → $51.75
- **intent-cinema-ticket-quote-03** — ST-2011 large G4,G5,G6 (premium) 1 adult, 1 senior and 1 student: tickets $45.00 + 3 × (surcharge $3.50 + fee $0.75) → $57.75

### cinema-book-row (state, cinema) — 3 tasks

Book N seats side by side in a named row of a showtime, for a new customer, with a ticket mix that has at least one non-adult ticket. The row has exactly one set of N free seats side by side (its other free seats are in shorter runs). The check reads the customer's bookings: exactly one confirmed booking at that showtime, of exactly those seats, with the ticket counts asked. The miss books the right seats as adult tickets only.

- **intent-cinema-book-row-01** — aurelio.ashdown@film.example → ST-2037 row A: A3,A4,A5,A6 as 1 adult and 3 seniors
- **intent-cinema-book-row-02** — dagny.ashdown@film.example → ST-2058 row B: B1,B2,B3,B4 as 3 seniors and 1 student
- **intent-cinema-book-row-03** — florentyna.ashdown@film.example → ST-2091 row D: D1,D2,D3,D4 as 2 children, 1 senior and 1 student

### cinema-cancel-one (state, cinema) — 3 tasks

Cancel one of a seeded customer's confirmed bookings, named by its film and date, and leave the customer's other confirmed bookings alone. Asked of a customer with at least two confirmed bookings, where no other booking of theirs is for the same film on the same date. One check per confirmed booking of the customer: `cancelled` for the one named, `confirmed` for the rest. The miss cancels all of them.

- **intent-cinema-cancel-one-01** — lior.sandoval7@example.com: TK-30018 (FM-106, 2027-05-16, ST-2156) → cancelled; TK-30041, TK-30067, TK-30124, TK-30189 stay confirmed
- **intent-cinema-cancel-one-02** — vesna.kowalczyk4@example.com: TK-30164 (FM-112, 2027-05-14, ST-2023) → cancelled; TK-30022, TK-30059, TK-30061, TK-30097, TK-30105, TK-30106, TK-30146, TK-30181 stay confirmed
- **intent-cinema-cancel-one-03** — lior.voss4@example.com: TK-30062 (FM-109, 2027-05-14, ST-2027) → cancelled; TK-30019, TK-30025, TK-30066, TK-30139 stay confirmed

### sport-cancel-one (state, sports) — 3 tasks

Cancel the one order of a seeded customer that has a named product and has not shipped, out of their two orders still processing and one shipped, and leave the others alone. The product is in no other processing order of theirs. One check per order on its way: `cancelled` for the one named, `processing` / `shipped` for the rest. The miss cancels both processing orders (`sportsCancelProblem` refuses only shipped ones).

- **intent-sport-cancel-one-01** — orrin.kowalczyk@example.org: ORD-10058 (SP-101) → cancelled; ORD-10044 stays shipped, ORD-10053 stays processing
- **intent-sport-cancel-one-02** — teodor.okonjo@example.org: ORD-10056 (SP-107) → cancelled; ORD-10043 stays shipped, ORD-10051 stays processing
- **intent-sport-cancel-one-03** — quill.okonjo@example.org: ORD-10052 (SP-111) → cancelled; ORD-10035 stays shipped, ORD-10057 stays processing

### sport-reorder-last (state, sports) — 3 tasks

Place a new order for a seeded customer that repeats their most recent delivered order: the same SKUs and quantities, to the same address. Their latest order is shipped or cancelled, not delivered, and has other lines; they have no order processing, and every line of both orders is in stock. One check per line of the repeated order, and one for the address and the number of lines, each on exactly one processing order of theirs. The miss reorders their latest order instead.

- **intent-sport-reorder-last-01** — lior.ferrante@example.org: repeat ORD-10019 (SP-113-GRY-XL×2,SP-115-BLK-S×2 to AD-1033); their latest, ORD-10037, is shipped
- **intent-sport-reorder-last-02** — sable.kowalczyk@example.org: repeat ORD-10017 (SP-101-BLK-43×2,SP-111-BLU-S×1 to AD-1015); their latest, ORD-10045, is shipped
- **intent-sport-reorder-last-03** — teodor.sandoval@example.org: repeat ORD-10030 (SP-106-BLU-42×1,SP-112-BLU-M×3 to AD-1036); their latest, ORD-10040, is shipped

### sport-return-item (state, sports) — 3 tasks

Request the return of part of one line of a delivered order, with a named reason: a line of 2 or more units, none returned yet, still within its category's return window on SPORTS_TODAY (`sportsReturnProblem`). The check reads the order's returns: exactly one return of that SKU, with the quantity and reason asked. The miss returns every unit of the line.

- **intent-sport-return-item-01** — ORD-10031 SP-118-BLK-42: return 1 of 2, "too small"
- **intent-sport-return-item-02** — ORD-10018 SP-116-GRY-S: return 1 of 2, "too large"
- **intent-sport-return-item-03** — ORD-10025 SP-119-BLK-43: return 1 of 3, "defective"

### sport-return-by (json, sports) — 3 tasks

The last day a product from a delivered order can be returned: the order's delivery date plus the return window of the product's category (`sportsReturnDeadline`). The order has lines from categories with different windows. The miss counts the window from the day the order was placed.

- **intent-sport-return-by-01** — ORD-10004 delivered 2027-01-26, hiking window 14 days → 2027-02-09
- **intent-sport-return-by-02** — ORD-10022 delivered 2027-04-06, swimming window 90 days → 2027-07-05
- **intent-sport-return-by-03** — ORD-10028 delivered 2027-04-23, climbing window 60 days → 2027-06-22

### sport-delivered-where (json, sports) — 3 tasks

When and where a seeded customer's order was delivered, named by a product in it and the month it was placed: the only order of theirs placed that month with that product. It went to one of their saved addresses that is not their default one. The miss gives the day it shipped and the city of their default address.

- **intent-sport-delivered-where-01** — danae.okonjo@example.org 2027-01 SP-122 → ORD-10003, delivered 2027-01-21 to AD-1009 in Velmora (default address in Quillhaven; shipped 2027-01-19)
- **intent-sport-delivered-where-02** — sable.larrabee@example.org 2027-03 SP-102 → ORD-10021, delivered 2027-04-04 to AD-1029 in Tessalind (default address in Karrow; shipped 2027-04-02)
- **intent-sport-delivered-where-03** — quill.okonjo@example.org 2027-01 SP-101 → ORD-10007, delivered 2027-02-03 to AD-1011 in Velmora (default address in Tessalind; shipped 2027-01-30)

### sport-cheapest-fit (json, sports) — 3 tasks

The cheapest in-stock variant, in any category, in one size and colour that weighs at most a cap (`searchSportsVariants` with `inStock`, first offer; strictly cheaper than the next), and what a few of it cost with shipping (`sportsOrderTotals`: the fee unless the subtotal reaches the free-shipping threshold), ±0.01. A cheaper variant within the cap is out of stock, and a cheaper in-stock one is over the cap. The miss names the out-of-stock variant and its total.

- **intent-sport-cheapest-fit-01** — 42 black ≤ 330 g → SP-101-BLK-42 at $142.99 × 3 = $428.97 with shipping; SP-102-BLK-42 at $126.99 is out of stock
- **intent-sport-cheapest-fit-02** — L blue ≤ 120 g → SP-115-BLU-L at $77.99 × 1 = $82.94 with shipping; SP-113-BLU-L at $32.99 is out of stock
- **intent-sport-cheapest-fit-03** — 43 blue ≤ 320 g → SP-103-BLU-43 at $146.99 × 3 = $440.97 with shipping; SP-102-BLU-43 at $126.99 is out of stock

### home-only-match (json, homes) — 3 tasks

Which active listing in a city is of a named type, with at least so many bedrooms and bathrooms, a named feature, at no more than a price cap. Exactly one is (`searchHomeListings` with `status: active`), and the feature and the cap each matter: without either, two or more active listings would fit. A pending listing fits every other requirement; a search without the status filter returns it too. The miss names that pending listing.

- **intent-home-only-match-01** — Tessalind, house, ≥ 3 bed, ≥ 1 bath, solar panels, ≤ $750,000 → LS-3174 at $735,000; LS-3167 at $750,000 fits too but is pending
- **intent-home-only-match-02** — Tessalind, house, ≥ 3 bed, ≥ 1 bath, garage, ≤ $700,000 → LS-3169 at $700,000; LS-3173 at $645,000 fits too but is pending
- **intent-home-only-match-03** — Karrow, house, ≥ 2 bed, ≥ 1 bath, air conditioning, ≤ $1,500,000 → LS-3192 at $1,500,000; LS-3178 at $630,000 fits too but is pending

### home-no-match (json, homes) — 3 tasks

Whether any active listing in a city is of a named type, with at least so many bedrooms and bathrooms, one or two named features, at no more than a price cap — none is — and which comes closest: the cheapest active listing of that type, size and features at any price (no tie for cheapest). The cap is the highest whole $10,000 below that closest listing's price, and an active listing of that type is within it. A pending or sold listing fits every requirement. The miss says one exists and names that listing.

- **intent-home-no-match-01** — Velmora, house, ≥ 3 bed, ≥ 1 bath, garage + air conditioning, ≤ $780,000 → none; closest LS-3110 at $790,000; LS-3106 at $560,000 fits but is pending
- **intent-home-no-match-02** — Ostrand, house, ≥ 2 bed, ≥ 1 bath, pets allowed, ≤ $740,000 → none; closest LS-3121 at $745,000; LS-3122 at $565,000 fits but is pending
- **intent-home-no-match-03** — Karrow, house, ≥ 2 bed, ≥ 1 bath, garden + air conditioning, ≤ $1,490,000 → none; closest LS-3192 at $1,500,000; LS-3185 at $985,000 fits but is sold

### home-yearly-costs (json, homes) — 3 tasks

What a named listing's service fee and property tax come to over one year: twelve times the monthly service fee plus the annual property tax (`homeYearlyCostsCents`), ±0.01. Asked of listings with both. The miss counts the monthly fee once.

- **intent-home-yearly-costs-01** — LS-3105: 12 × $110 + $2,848 → $4168.00
- **intent-home-yearly-costs-02** — LS-3176: 12 × $115 + $5,099 → $6479.00
- **intent-home-yearly-costs-03** — LS-3185: 12 × $65 + $12,707 → $13487.00

### home-viewing-earliest (state, homes) — 3 tasks

Request, for a new viewer, the earliest free viewing slot of a named listing that starts at or after the first slot of a day its agent is fully booked (`homeSlotsOf`, first free slot from then on, so on a later day). The agent has a free slot earlier in the window. The check: exactly one requested viewing for the viewer, of that listing in that slot. The miss takes the agent's earliest free slot in the window, before the time asked.

- **intent-home-viewing-earliest-01** — LS-3109 (AG-12): 2027-06-15 is fully booked → 2027-06-17 11:30; the earliest free slot in the window is 2027-06-09 09:00
- **intent-home-viewing-earliest-02** — LS-3133 (AG-16): 2027-06-16 is fully booked → 2027-06-18 10:00; the earliest free slot in the window is 2027-06-08 13:00
- **intent-home-viewing-earliest-03** — LS-3144 (AG-15): 2027-06-11 is fully booked → 2027-06-15 10:00; the earliest free slot in the window is 2027-06-07 13:00

### home-viewing-book (state, homes) — 3 tasks

Request a viewing of a named active listing for a new viewer (a name and email no seeded request has) in a named free slot: a date and a start time. The check reads the viewer's requests: exactly one requested viewing, of that listing in that slot. The miss takes the next free slot of the same agent that day, 30 minutes or more off.

- **intent-home-viewing-book-01** — odile.brightwell@homebuyer.example → LS-3110 (AG-11), 2027-06-08 14:30
- **intent-home-viewing-book-02** — rhoswen.fanshawe@homebuyer.example → LS-3158 (AG-17), 2027-06-10 14:00
- **intent-home-viewing-book-03** — ulric.dunmore@homebuyer.example → LS-3115 (AG-11), 2027-06-16 15:00

### home-viewing-cancel-one (state, homes) — 3 tasks

Cancel one of a seeded viewer's requested viewings, named by its listing and date, and leave the viewer's other requests alone. Asked of a viewer with at least two requested viewings, where no other request of theirs is for the same listing on the same date. One check per requested viewing of the viewer: `cancelled` for the one named, `requested` for the rest. The miss cancels all of them.

- **intent-home-viewing-cancel-one-01** — orrin.larrabee4@mail.example: VW-1061 (LS-3127, 2027-06-11 10:30) → cancelled; VW-1098, VW-1139 stay requested
- **intent-home-viewing-cancel-one-02** — lior.voss7@mail.example: VW-1105 (LS-3182, 2027-06-15 15:30) → cancelled; VW-1127 stay requested
- **intent-home-viewing-cancel-one-03** — maren.sandoval9@mail.example: VW-1088 (LS-3154, 2027-06-12 09:30) → cancelled; VW-1133 stay requested

### clinic-only-doctor (json, clinic) — 3 tasks

Which doctor of a specialty in a city meets every requirement — a plan's network and at least one of: a language, a visit type, accepting new patients — and has a free appointment on a date. Exactly one does (`clinicFindDoctors`), and the requirements matter: without them, two or more doctors of that specialty in that city have a free slot that day. One more doctor meets every requirement but has no free slot that day (the seed books their day out). The miss names that doctor.

- **intent-clinic-only-doctor-01** — Ostrand general practice 2027-03-25, language=Vietnamese, planCode=PL-11, visitType=in-person, newPatients=true → DR-212; DR-210 meets every requirement but is fully booked
- **intent-clinic-only-doctor-02** — Velmora general practice 2027-03-01, planCode=PL-11, visitType=in-person, newPatients=true → DR-203; DR-206 meets every requirement but is fully booked
- **intent-clinic-only-doctor-03** — Quillhaven general practice 2027-03-16, planCode=PL-14, newPatients=true → DR-217; DR-218 meets every requirement but is fully booked

### clinic-no-doctor (json, clinic) — 3 tasks

Whether any doctor of a specialty in a city meets every requirement — a plan's network, a visit type, and some of: a language, accepting new patients — and has a free appointment on a date. None does, and which doctor comes closest: of those meeting every requirement except the plan's network, the one with the lowest fee for that visit type (no tie for lowest). One doctor meets every requirement but has no free slot that day. The miss says one exists and names that doctor.

- **intent-clinic-no-doctor-01** — Brenmoor pediatrics 2027-04-01, planCode=PL-13, visitType=in-person → none; closest DR-221 at $170.00; DR-220 meets every requirement but is fully booked
- **intent-clinic-no-doctor-02** — Karrow general practice 2027-03-05, planCode=PL-13, visitType=video, newPatients=true → none; closest DR-237 at $90.00; DR-232 meets every requirement but is fully booked
- **intent-clinic-no-doctor-03** — Quillhaven pediatrics 2027-03-04, planCode=PL-12, visitType=video → none; closest DR-215 at $95.00; DR-214 meets every requirement but is fully booked

### clinic-visit-cost (json, clinic) — 3 tasks

What a patient on a plan pays in total for an in-person visit with a named doctor and a named procedure, and whether the plan requires prior authorisation for it. The doctor is not in the plan's network, so the visit costs the doctor's fee, not the copay (`clinicVisitCostCents`); the procedure is covered, with or without prior authorisation, so it costs the coinsurance share of its price (`clinicProcedureCostCents`); ±0.01. The miss takes the plan's copay for the visit.

- **intent-clinic-visit-cost-01** — DR-211 is out of network for PL-14: fee $150.00 (copay would be $10.00) + PR-307 30% of $510.00 = $153.00, prior authorisation → $303.00
- **intent-clinic-visit-cost-02** — DR-216 is out of network for PL-14: fee $80.00 (copay would be $10.00) + PR-303 20% of $360.00 = $72.00 → $152.00
- **intent-clinic-visit-cost-03** — DR-218 is out of network for PL-12: fee $160.00 (copay would be $15.00) + PR-302 30% of $175.00 = $52.50 → $212.50

### clinic-book-earliest (state, clinic) — 3 tasks

Book a new patient (a name and email no seeded appointment has) on a named plan into the earliest free slot with a named doctor, accepting new patients, on a date at or after a time. The slot at that time is taken, a slot earlier in the day is free. The check reads the patient's appointments: exactly one booked, with that doctor, date, time, visit type and plan. The miss books the day's first free slot, before the time asked.

- **intent-clinic-book-earliest-01** — caspian.calloway@patient.example → DR-227 2027-04-07 video, PL-12: 10:00 is taken, earliest free after it 10:30; 09:30 is free but earlier
- **intent-clinic-book-earliest-02** — gideon.abernathy@patient.example → DR-204 2027-04-15 video, PL-13: 11:00 is taken, earliest free after it 11:30; 10:00 is free but earlier
- **intent-clinic-book-earliest-03** — evander.calloway@patient.example → DR-230 2027-03-25 in-person, PL-12: 14:00 is taken, earliest free after it 14:30; 13:30 is free but earlier

### clinic-cancel-one (state, clinic) — 3 tasks

Cancel one of a seeded patient's booked appointments, named by its doctor and date, and leave the patient's other appointments alone. Asked of a patient who has another booked appointment with the same doctor on another date, and no other appointment with that doctor on that date. One check per booked appointment of the patient: `cancelled` for the one named, `booked` for the rest. The miss cancels the other appointment with the same doctor.

- **intent-clinic-cancel-one-01** — teodor.okonjo3@example.com: AP-30157 (DR-235, 2027-05-14) → cancelled; AP-30032, AP-30117, AP-30156 stay booked (AP-30156 is with DR-235 on 2027-04-30)
- **intent-clinic-cancel-one-02** — quill.okonjo9@example.com: AP-30010 (DR-219, 2027-05-13) → cancelled; AP-30009, AP-30023, AP-30047, AP-30067, AP-30068, AP-30075, AP-30076 stay booked (AP-30009 is with DR-219 on 2027-04-21)
- **intent-clinic-cancel-one-03** — maren.larrabee5@example.com: AP-30079 (DR-216, 2027-03-01) → cancelled; AP-30044, AP-30080, AP-30126, AP-30127, AP-30137 stay booked (AP-30080 is with DR-216 on 2027-03-22)

### clinic-refill-cheapest (state, clinic) — 3 tasks

Request a refill of one of a seeded patient's prescriptions, named by medication and dosage, to be collected at the pharmacy that charges the least for that medication at that dosage (`clinicPrescriptionPrices`, first offer; strictly cheaper than the next). The patient also holds a prescription of the same medication at another dosage; both have refills left and no refill requested. The checks: exactly one requested refill of the named prescription, at that pharmacy; its refills left down by one; the other dosage's refills left unchanged. The miss requests the other dosage's refill.

- **intent-clinic-refill-cheapest-01** — bram.voss6@example.com: RX-60004 (MED-47 40 mg) → refill at CL-11 $15.00 (next CL-12 $17.25); RX-60064 (10 mg) untouched
- **intent-clinic-refill-cheapest-02** — maren.larrabee2@example.com: RX-60062 (MED-45 25 mg) → refill at CL-11 $20.75 (next CL-17 $21.00); RX-60030 (50 mg) untouched
- **intent-clinic-refill-cheapest-03** — maren.thorsby8@example.com: RX-60021 (MED-42 10 mg) → refill at CL-16 $16.00 (next CL-11 $16.75); RX-60061 (20 mg) untouched

### event-create (state, events) — 3 tasks

Create an event exactly as asked, for a named organiser from the staff directory: a named room, a weekday from September 2027 (every room is free), a start time in 12-hour form and a length, a quoted title and description, invitation only or open with a number of places, and three guests (two colleagues and one partner email). One check finds the organiser's event on that date at that start time (exactly one) and holds its title, description, room, end time, registration mode, places and guest count; one check per guest holds that email in its guest list. The miss creates it without the last-named guest.

- **intent-event-create-01** — lior.ferrante@staff.example → KAR-R5 2027-10-01 11:00–13:00, "Launch rehearsal", open, 8 places, guests quill.mbeki@staff.example, sable.halvard@staff.example, noor.lindqvist@partner.example
- **intent-event-create-02** — sable.halvard@staff.example → KAR-R2 2027-11-23 16:00–16:45, "Launch rehearsal", open, 4 places, guests danae.sandoval@staff.example, ilsa.voss@staff.example, rue.selwyn@partner.example
- **intent-event-create-03** — bram.mbeki@staff.example → QUI-R6 2027-10-12 10:00–11:00, "Supplier review", invite-only, guests teodor.mbeki@staff.example, danae.voss@staff.example, rue.selwyn@partner.example

### event-room-only (json, events) — 3 tasks

Which room at an office is free for a whole time slot, holds a number of people and has one or two named pieces of equipment. Exactly one free room does (`eventFreeRooms`), and each requirement matters: without the equipment, or with fewer people, two or more would. One more room meets every requirement but a scheduled event holds it for part of the slot. The miss names that room.

- **intent-event-room-only-01** — OF-KAR 2027-06-09 10:30–12:30, 12 people, projector → KAR-R3; KAR-R4 fits too but EV-1042 holds it
- **intent-event-room-only-02** — OF-TES 2027-06-15 13:00–14:00, 6 people, whiteboard → TES-R3; TES-R2 fits too but EV-1069 holds it
- **intent-event-room-only-03** — OF-KAR 2027-04-09 17:00–18:00, 12 people, projector → KAR-R4; KAR-R3 fits too but EV-1030 holds it

### event-room-none (json, events) — 3 tasks

Whether any room at an office is free for a whole time slot, holds a number of people and has one or two named pieces of equipment — none is — and which room comes closest: of the free rooms there with that equipment, the one that holds the most people (capacities differ within an office, so there is no tie). The headcount alone can be met by a free room. One room meets every requirement but a scheduled event holds it for part of the slot. The miss says one exists and names that room.

- **intent-event-room-none-01** — OF-KAR 2027-06-03 14:00–15:30, 15 people, whiteboard → none; closest KAR-R3 (12); KAR-R5 would fit but EV-1059 holds it
- **intent-event-room-none-02** — OF-KAR 2027-04-27 10:30–12:30, 12 people, projector + whiteboard → none; closest KAR-R2 (10); KAR-R3 would fit but EV-1100 holds it
- **intent-event-room-none-03** — OF-TES 2027-04-07 16:00–17:30, 8 people, projector → none; closest TES-R1 (4); TES-R3 would fit but EV-1071 holds it

### event-register-session (state, events) — 3 tasks

Register a member of an office's staff for the earliest session of a course at that office that still has places left. The earliest session there is full (the generator fills it on purpose); the course also runs at another office, where a session earlier than the answer has places — the miss registers for that one. The person can register for both (no overlap, not registered yet). Checks on the person's registrations: exactly one active registration for the answer, and exactly one more active registration than they had.

- **intent-event-register-session-01** — sable.thorsby@staff.example: "Data privacy basics" at OF-BRE → EV-1055 (2027-05-17 15:30); EV-1056 is full; EV-1053 at OF-OST (2027-04-06) is earlier with places
- **intent-event-register-session-02** — ilsa.kowalczyk@staff.example: "First-aid course" at OF-TES → EV-1079 (2027-06-10 16:30); EV-1080 is full; EV-1081 at OF-VEL (2027-04-06) is earlier with places
- **intent-event-register-session-03** — ilsa.prewitt@staff.example: "Negotiation basics" at OF-TES → EV-1063 (2027-06-22 08:30); EV-1064 is full; EV-1062 at OF-VEL (2027-04-12) is earlier with places

### event-most-places (json, events) — 3 tasks

Of the scheduled sessions of a course at one office, which has the most places left, and how many: its place limit less its active registrations (`eventPlacesLeft`; cancelled registrations hold no place). No tie for most. The miss reads the place limit as the places left: it names the session with the highest limit and gives that limit.

- **intent-event-most-places-01** — "Expense tool walkthrough" at OF-TES → EV-1070 with 3 left; EV-1069 has the highest limit (4)
- **intent-event-most-places-02** — "Expense tool walkthrough" at OF-KAR → EV-1073 with 4 left; EV-1073 has the highest limit (6)
- **intent-event-most-places-03** — "Expense tool walkthrough" at OF-VEL → EV-1077 with 3 left; EV-1076 has the highest limit (5)

### event-cancel-registration (state, events) — 3 tasks

Cancel one of a person's active registrations, named by the event's title and date, and leave their other active registrations alone. Asked of a person with at least two active registrations, where no other registration of theirs is for an event with the same title on the same date. One check per active registration of the person: `cancelled` for the one named, `registered` for the rest. The miss cancels all of them.

- **intent-event-cancel-registration-01** — sable.okonjo@visitor.example: RG-3064 (EV-1059, 2027-06-03) → cancelled; RG-3015, RG-3048, RG-3091, RG-3125 stay registered
- **intent-event-cancel-registration-02** — ilsa.voss@staff.example: RG-3094 (EV-1066, 2027-05-27) → cancelled; RG-3126 stay registered
- **intent-event-cancel-registration-03** — danae.halvard@staff.example: RG-3004 (EV-1008, 2027-06-17) → cancelled; RG-3026, RG-3032, RG-3070, RG-3081, RG-3138 stay registered
