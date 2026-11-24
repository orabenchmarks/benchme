# cuj-v1 corpus

120 critical-user-journey tasks against a fresh `cuj-v1` workspace (`node tools/intent-corpus.mjs --seed 4242`), in ten focus areas and four levels; 26 of them have follow-up steps. Every derived value comes from `@benchme/scenarios`' rows and rules, never typed by hand, and every level is derived from the countable properties its template declares (`tools/intent-corpus/cuj/levels.mjs`), never written on a task. `node tools/intent-integrity.mjs --scenario cuj-v1` measures those properties again on each reference solution, against live sites, and refuses a task whose level they do not give. The interface is described in `docs/scenarios/cuj-v1.md`.

| area | easy | medium | hard | impossible | of hard, very hard | tasks |
| --- | --- | --- | --- | --- | --- | --- |
| find-the-fit | 4 | 4 | 4 | 2 | 0 | 14 |
| price-it | 4 | 4 | 3 | 2 | 0 | 13 |
| book-it | 5 | 4 | 4 | 2 | 0 | 15 |
| book-the-best | 3 | 3 | 5 | 2 | 2 | 13 |
| change-it | 4 | 3 | 4 | 2 | 1 | 13 |
| cancel-it | 4 | 3 | 3 | 2 | 0 | 12 |
| return-or-repeat | 3 | 3 | 3 | 2 | 0 | 11 |
| act-as-yourself | 3 | 3 | 4 | 2 | 1 | 12 |
| carry-a-conversation | — | 2 | 5 | 2 | 3 | 9 |
| plan-across-sites | — | 1 | 5 | 2 | 3 | 8 |
| **total** | 30 | 30 | 40 | 20 | 10 | 120 |

## Levels

- **easy** — One site. The target is named in the prompt. One read or one write. No rule changes the outcome.
- **medium** — One site (one per step). The target must be found by two or three constraints, or a rule changes the outcome (a fee, a party size). One write.
- **hard** — A tempting option that fails one constraint; or three to five steps; or a sign-up with an emailed code before the task can start.
- **very hard** (a flagged part of hard) — Two or more sites or six to eight steps, constraints that interact across them (a budget, a schedule), and one failure to recover from part-way.
- **impossible** — The site's rules or stock make the request impossible, or nothing on offer meets every requirement. The right outcome: say so, give the site's reason when it refuses, change nothing.

## Templates

### fit-room-sleeps (find-the-fit; pages, tools) — 1 task

Which room type of a named hotel sleeps a party: exactly one of its room types takes that many adults and children.

- **cuj-fit-room-sleeps-01** — easy: HT-116: 3 adults → HT-116-FAM

### fit-restaurant-days (find-the-fit; pages, tools) — 1 task

Which day a named restaurant is closed, and whether it has a vegan menu: both on its page.

- **cuj-fit-restaurant-days-01** — easy: RS-105: closed monday, vegan false

### fit-doctor-visits (find-the-fit; pages, tools) — 1 task

Whether a named doctor sees patients by video and takes new patients: both on the doctor's page.

- **cuj-fit-doctor-visits-01** — easy: DR-204: video true, new patients true

### fit-room-equipment (find-the-fit; pages, tools) — 1 task

Whether a named meeting room has video conferencing and step-free access: both on the room's page.

- **cuj-fit-room-equipment-01** — easy: QUI-R6: video conferencing false, step-free true

### fit-listing (find-the-fit; pages, tools) — 1 task

The only active listing in a city of one type, with a named feature, at no more than a price cap (`searchHomeListings`). Each requirement matters: drop any one and two or more listings fit.

- **cuj-fit-listing-01** — medium: Karrow, house, air conditioning, ≤ $1,500,000 → LS-3192

### fit-flight (find-the-fit; pages, tools) — 1 task

The only nonstop flight on a route and date that leaves before noon and still has an economy seat (`searchFlights`). Without either filter, two or more would do.

- **cuj-fit-flight-01** — medium: VEO→TAL 2027-04-03, nonstop, before 12:00 → QE354

### fit-showtime (find-the-fit; pages, tools) — 1 task

The only showtime in a city on a date of a named genre, in a named format, starting at or after a time, with seats for a party (`cinemaSearchShowtimes`). The format and the time each matter.

- **cuj-fit-showtime-01** — medium: Quillhaven 2027-05-14, science fiction, 2D, ≥ 18:00, 2 seats → ST-2023

### fit-pizza (find-the-fit; pages, tools) — 1 task

The only menu pizza a named branch can make that is vegetarian, has none of an allergen, and costs no more than a cap in a size (`pizzaMenuSearch` with the branch). The cap and the allergen each matter.

- **cuj-fit-pizza-01** — medium: BR-106 medium, vegetarian, no dairy, ≤ $17 → PZ-108

### fit-stay-tempting (find-the-fit; pages, tools) — 1 task

Which hotel in a city has a room free for a stay that fits the party, at no more than a nightly cap, with two named amenities: exactly one (`searchStays`). The tempting one: another hotel has both amenities and a room within the cap that fits, but that room is booked out on one of the nights.

- **cuj-fit-stay-tempting-01** — hard: Ostrand 2027-03-26 × 2, 1 adult, ≤ $180, gym + washer → HT-110; HT-106-SGL would fit but is booked out

### fit-table-tempting (find-the-fit; pages, tools) — 1 task

Which restaurant in a city has a table in a named area free for a party at a date and time and offers a named dietary menu: exactly one (`diningSearch`). The tempting one: another restaurant there has the menu and tables in that area big enough, but every one of them is taken then.

- **cuj-fit-table-tempting-01** — hard: Karrow 2027-05-22 15:00, 4 people, indoor, vegan → RS-123; RS-124 has both but is full then

### fit-doctor-tempting (find-the-fit; pages, tools) — 1 task

Which doctor of a specialty in a city is in a plan's network, takes new patients and has a free appointment on a date: exactly one (`clinicFindDoctors`). The tempting one: another doctor there of that specialty is in the network and free that day, but takes no new patients.

- **cuj-fit-doctor-tempting-01** — hard: Brenmoor, general practice, PL-12, new patients, 2027-04-07 → DR-223; DR-219 is in network and free but takes no new patients

### price-room-night (price-it; pages, tools) — 1 task

What one night in a named room type costs: its nightly price, on the hotel's page.

- **cuj-price-room-night-01** — easy: HT-112-FAM → $270 a night

### price-flight-fare (price-it; pages, tools) — 1 task

What one seat in a named cabin of a named flight costs: the cabin's fare per passenger.

- **cuj-price-flight-fare-01** — easy: SZ203 premium → $250

### price-medication (price-it; pages, tools) — 1 task

What one clinic's pharmacy charges for a named medication at one dosage: its price on the medication's page.

- **cuj-price-medication-01** — easy: CL-15 MED-45 50 mg → $33.50

### price-variant (price-it; pages, tools) — 1 task

What one variant of a product costs, named by its SKU: its price on the variant's page.

- **cuj-price-variant-01** — easy: SP-106-BLK-43 → $217.99

### price-stay-total (price-it; pages, tools) — 1 task

What a named stay costs in total, with a dog where the hotel allows pets and late checkout where it offers it: nights × the nightly price + the pet fee once + the late-checkout fee (`stayTotalCents`). The rule that changes the outcome is the fees: the nights alone are not the price.

- **cuj-price-stay-total-01** — medium: HT-132-FAM × 3 + pet fee $20 + late checkout $10 → $900

### price-flight-total (price-it; pages, tools) — 1 task

What a named booking costs in total: passengers × the cabin's fare + passengers × bags × the carrier's bag fee. The bag fees are the rule that changes the outcome.

- **cuj-price-flight-total-01** — medium: SZ813 economy: 3 × $150 + 3 × 2 × $35 → $660

### price-pizza-delivery (price-it; pages, tools) — 1 task

What several of one menu pizza cost delivered from a named branch: the quote's total, which adds the branch's delivery fee because the order stays under its free-delivery threshold (`pizzaQuote`).

- **cuj-price-pizza-delivery-01** — medium: BR-110 2 × large PZ-104: $37.80 + delivery $5 → $42.80

### price-tickets (price-it; pages, tools) — 1 task

What named seats in a premium row of a showtime cost for a ticket mix: each ticket's price for the showtime's format and type, plus the premium-row surcharge per seat, plus the booking fee per ticket (`cinemaQuote`). The surcharge and the fee are the rule that changes the outcome.

- **cuj-price-tickets-01** — medium: ST-2064 seats G1, G2 (premium row G), adult + a senior → $39

### price-bags-cheapest (price-it; pages, tools) — 1 task

The cheapest way for a party to fly a route on a date in economy with two checked bags each: of the flights whose carrier takes two bags, the lowest total of fares and bag fees, and that total. The tempting one: the lowest fare on the route is on a carrier that takes only one checked bag.

- **cuj-price-bags-cheapest-01** — hard: QLV→KAO 2027-04-09: TF399 is cheapest but its carrier takes 1 bag → SZ796, $410

### price-trip-steps (price-it; pages, tools) — 1 task

A price asked three times over one conversation: a named booking's total, then with more bags each, then in another cabin. Each answer is the cabin's fare × passengers + the carrier's bag fee × bags × passengers.

- **cuj-price-trip-steps-01** — hard: SZ293: economy × 1 bag $260; × 2 bags $330; premium × 2 bags $470

### price-order-steps (price-it; pages, tools) — 1 task

A basket priced three times over one conversation, with shipping: one item, then a second item added, then more of the second. Each answer is the lines' prices + the shop's shipping fee, which falls away once the subtotal reaches the free-shipping threshold (`sportsShippingCents`) — it does at one of the steps.

- **cuj-price-order-steps-01** — hard: SP-111-BLK-L $108.94; + 2 × SP-102-BLK-44 $357.97; + 3 × SP-102-BLK-44 $484.96 (free shipping from $125)

### price-child-rated (price-it; pages, tools) — 1 task

Two adult tickets and a child's for a showing of a film rated 15 or 18, booked and priced: impossible (`CHILD_NOT_ALLOWED`: child tickets are not sold for those ratings).

- **cuj-price-child-rated-01** — impossible: ST-2051: The Thoren Compass is rated 18

### price-bags-over (price-it; pages, tools) — 1 task

A booking on a named flight with more checked bags per passenger than its carrier takes, booked and priced: impossible (`TOO_MANY_BAGS`).

- **cuj-price-bags-over-01** — impossible: SZ214 (SZ) takes 2 bag(s) per passenger; 3 asked

### book-room (book-it; pages, tools) — 1 task

Book a named room type for a new guest on dates when it is free, for a party it sleeps. The check reads the guest's bookings: exactly one, confirmed, of that room from that date, for the nights and party asked.

- **cuj-book-room-01** — easy: keira.greystone.52953@journeys.example → HT-116-KNG, 2027-10-04 × 3, 2 adults

### book-viewing (book-it; pages, tools) — 1 task

Request a viewing of a named active listing in a named free slot for a new viewer. The check reads the viewer's requests: exactly one, of that listing, at that date and time.

- **cuj-book-viewing-01** — easy: aurelie.everhart.70175@journeys.example → LS-3165 at 2027-06-07 10:00

### book-appointment (book-it; pages, tools) — 1 task

Book a new patient, on a plan the doctor is in network for, into a named free slot of a doctor who takes new patients, for a visit type the doctor offers. The check reads the patient's appointments: exactly one, booked, with that doctor at that time.

- **cuj-book-appointment-01** — easy: ottilie.ingram.13949@journeys.example → DR-222 2027-08-18 09:00, in-person, PL-11

### book-registration (book-it; pages, tools) — 1 task

Register a new person for a named open event that has places left. The check reads the person's registrations: exactly one, active, for that event.

- **cuj-book-registration-01** — easy: aurelie.juniper.41323@journeys.example → EV-1068 "Negotiation basics" 2027-05-29

### book-flight (book-it; pages, tools) — 1 task

Book two new passengers in a named cabin of a named flight on a date it has seats, with no checked bags. The check reads the contact's bookings: exactly one, confirmed, on that flight and date, in that cabin, for two.

- **cuj-book-flight-01** — easy: hollis.ingram.15142@journeys.example → SZ445 2027-05-23 economy × 2

### book-table-party (book-it; pages, tools) — 1 task

Book a table at a named restaurant, date and time for a party only one of its seating areas seats: the party size, a site rule, decides the area (`TABLE_TOO_SMALL` elsewhere). The check reads the guest's reservations: exactly one, in that area.

- **cuj-book-table-party-01** — medium: RS-110 2027-10-25 19:00, party 6 → indoor (tables seat 6; terrace seats 4)

### book-pizza-serves (book-it; pages, tools) — 1 task

Order a named menu pizza big enough for a number of people, for pickup at a named branch and slot: the size is the smallest that serves them (`pizzaSizeFor`), a site rule the agent has to read. The check reads the customer's orders: exactly one, received, of that pizza in that size.

- **cuj-book-pizza-serves-01** — medium: PZ-103 for 3 people → large (serves 4)

### book-seats-row (book-it; pages, tools) — 1 task

Book a number of seats side by side in a named row of a named showtime, for a ticket mix with a non-adult ticket: the row has exactly one such run free. The check reads the customer's bookings: exactly one, of those seats, with that mix.

- **cuj-book-seats-row-01** — medium: ST-2129 row D: the one run of 3 free → D1, D2, D3

### book-sports-order (book-it; pages, tools) — 1 task

Order one of a named product for a store customer, in a named size and in the only colour of that size in stock, to the customer's address with a named label (not their default). The check reads the customer's processing orders: exactly one, of that variant, to that address.

- **cuj-book-sports-order-01** — medium: danae.ferrante@example.org: SP-113 size M, the only colour in stock → SP-113-RED-M (red), to AD-1021 (home)

### book-earliest-together (book-it; pages, tools) — 1 task

Book seats side by side for a new customer at the earliest showing of a named film at a named cinema that still has that many free side by side (`cinemaSearchShowtimes` with `together`). The tempting one: an earlier showing has as many seats free, but none side by side.

- **cuj-book-earliest-together-01** — hard: FM-114 at CN-101, 4 together → ST-2111; ST-2053 is earlier but has at most 1 side by side

### book-slot-after (book-it; pages, tools) — 1 task

Order several of one menu pizza for pickup at a named branch on a busy day, in the earliest slot at or after a named time with room for all of them (`pizzaSlots`). The tempting one: the named time's slot has not room enough.

- **cuj-book-slot-after-01** — hard: BR-102 2027-05-10: 18:30 has room for fewer than 3 → 19:30

### book-trip-steps (book-it; pages, tools) — 1 task

A trip booked over three prompts: a named outbound flight, then a named return flight on a later date, then what the two bookings cost together. The checks read the contact's bookings; the last answer is the two totals added up.

- **cuj-book-trip-steps-01** — hard: EM693 Karrow→Ostrand 2027-05-24, QE737 back 2027-05-28; together $230

### book-session-earliest (book-it; pages, tools) — 1 task

Register a new person for the earliest session of a course at an office that still has places left. The tempting one: the earliest session there is full (the generator fills it on purpose).

- **cuj-book-session-earliest-01** — hard: "First-aid course" at OF-VEL: EV-1083 is full → EV-1081

### book-showtime-sold-out (book-it; pages, tools) — 1 task

Two seats at a named showing with no seat left: impossible (`SOLD_OUT`). The right outcome is to say so and book nothing.

- **cuj-book-showtime-sold-out-01** — impossible: ST-2086: every seat booked

### book-cabin-sold-out (book-it; pages, tools) — 1 task

Seats in a named cabin of a named flight on a date it has none left: impossible (`SOLD_OUT`). The right outcome is to say so and book nothing.

- **cuj-book-cabin-sold-out-01** — impossible: EM244 economy on 2027-04-06: no seat left

### change-time (change-it; pages, tools) — 1 task

Move one of a seeded guest's confirmed reservations, named by its number, to another seating time the same day with a table free in its area. The checks read the reservation (the new time, the rest as it was) and the ledger: no write to the guest's other reservations.

- **cuj-change-time-01** — easy: RV-10160 (RS-119 2027-05-24) 21:00 → 19:30; RV-10007, RV-10058, RV-10088 untouched

### change-party (change-it; pages, tools) — 1 task

Change the party size of one of a seeded guest's confirmed reservations, named by its number, to a size its area's tables seat. The checks read the reservation (the new party, the rest as it was) and the ledger: no write to the guest's other reservations.

- **cuj-change-party-01** — easy: RV-10117 (RS-118 2027-05-19 13:00, terrace seats 4) party 4 → 2

### change-line-size (change-it; pages, tools) — 1 task

Make one line of a seeded customer's received pizza order, named by the order's number and the pizza, another size its crust comes in (`pizzaChangeLine`). The checks read the order (that line in the new size, every other line as it was) and the ledger: no write to the customer's other orders.

- **cuj-change-line-size-01** — easy: PO-10072 line 1 (PZ-104) medium → xlarge

### change-event-time (change-it; pages, tools) — 1 task

Move one of an organiser's scheduled events, named by its code, to another time the same day, as long as before, with its room free then (`eventChangeProblem`). The checks read the event (the new time, the same day and room) and the ledger: no write to the organiser's other events.

- **cuj-change-event-time-01** — easy: EV-1060 11:30–12:30 → 13:30–14:30 in VEL-R5

### change-party-area (change-it; pages, tools) — 1 task

A seeded guest's confirmed reservation, named by its number, is now for a bigger party than its area's tables seat: the change only goes through in the one other area whose tables seat them and has a table free then (a rule: `TABLE_TOO_SMALL` in the old area). The checks read the reservation (the party, the new area, the same time) and the ledger: no write to the guest's other reservations.

- **cuj-change-party-area-01** — medium: RV-10084 (RS-118 2027-04-20 14:00): party 3 → 5; terrace seats 4 → indoor (seats 6)

### change-event-room (change-it; pages, tools) — 1 task

Move one of an organiser's scheduled events, named by its code, to the one other room at its office, free at its time and holding everyone, that has a named piece of equipment and step-free access (`eventFreeRooms`). Each requirement matters. The checks read the event (the new room, the same time) and the ledger: no write to the organiser's other events.

- **cuj-change-event-room-01** — medium: EV-1038 2027-06-08 12:30–14:30, 4 people, video conferencing + step-free → QUI-R4

### change-line-serves (change-it; pages, tools) — 1 task

Make one line of a seeded customer's received pizza order, named by the order's number and the pizza, big enough for a number of people: the smallest size that serves them (`pizzaSizeFor`), a site rule. The checks read the order (that line in that size, every other line as it was) and the ledger.

- **cuj-change-line-serves-01** — medium: PO-10075 line 1: medium → for 4 people → large (serves 4)

### change-time-tempting (change-it; pages, tools) — 1 task

Move a seeded guest's confirmed reservation, named by its number, to the earliest seating time at or after a named time that day with a table free in its area for the two hours. The tempting one: the named time itself has no table free.

- **cuj-change-time-tempting-01** — hard: RV-10125 (RS-109 2027-05-22, indoor): 17:00 is full → 20:30

### change-line-steps (change-it; pages, tools) — 1 task

One line of a seeded customer's received pizza order changed over three prompts: another size, then a topping taken off, then what the order now costs (`pizzaChangeLine`, twice). Each change step's check stands on its own change in the ledger (the second after the first) and reads what it made.

- **cuj-change-line-steps-01** — hard: PO-10111 line 1: xlarge → small; − vegan-sausage → walnut; total $26.55 → $12.15

### change-event-tempting (change-it; pages, tools) — 1 task

Move one of an organiser's scheduled events, named by its code, to the one other room at its office with a named piece of equipment that holds everyone and is free at its time. The tempting one: another room there has the equipment and is free then, but cannot hold everyone (the organiser, the guests and any places).

- **cuj-change-event-tempting-01** — hard: EV-1078 2027-06-23 09:00–10:00, 5 people, whiteboard → TES-R2; TES-R1 is free but holds 4

### change-event-steps (change-it; pages, tools) — 1 task

One of an organiser's events changed over six prompts: a guest added, the time moved, a named room asked for that can no longer hold everyone (`OVER_CAPACITY`: it would have before the guest was added) with another named room to fall back on, a guest removed, registration opened with places that still fit, and which floor the room is on. The constraints interact: the guest list decides which room holds everyone, and the room and the time decide each other. Each change step stands on its own change in the ledger, after the step before.

- **cuj-change-event-steps-01** — hard (very hard): EV-1019: + aurelie.delacourt.91899@journeys.example; 12:00 → 10:30; TES-R2 (holds 6) refuses 7 → TES-R4 (holds 16, floor 1); − bram.mbeki@staff.example; open, 2 places

### change-locked (change-it; pages, tools) — 1 task

A size change on a seeded customer's pizza order that the kitchen is already preparing: impossible (`ORDER_LOCKED`: only a received order can be changed). The right outcome is to say so and change nothing.

- **cuj-change-locked-01** — impossible: PO-10101 is preparing

### change-room-taken (change-it; pages, tools) — 1 task

Move one of an organiser's events to a named room at the same time, when another event holds that room then: impossible (`ROOM_TAKEN`). The right outcome is to say so and change nothing.

- **cuj-change-room-taken-01** — impossible: EV-1075 2027-04-12 16:00–17:00 → VEL-R5: Omom room (VEL-R5) is taken from 14:30 to 16:30 on 2027-04-12 by EV-1062

### cancel-room (cancel-it; pages, tools) — 1 task

Cancel one of a seeded guest's confirmed hotel bookings, named by its number. The checks read the booking (cancelled) and the ledger: no write to the guest's other bookings.

- **cuj-cancel-room-01** — easy: bram.prewitt9@example.com: cancel BK-10162 (HT-111 from 2027-05-28); BK-10017, BK-10035, BK-10057, BK-10161 untouched

### cancel-viewing (cancel-it; pages, tools) — 1 task

Cancel one of a seeded viewer's requested viewings, named by its number. The checks read the viewing (cancelled) and the ledger: no write to the viewer's other viewings.

- **cuj-cancel-viewing-01** — easy: lior.voss1@mail.example: cancel VW-1134 (LS-3160 2027-06-11 15:30)

### cancel-appointment (cancel-it; pages, tools) — 1 task

Cancel one of a seeded patient's booked appointments, named by its number. The checks read the appointment (cancelled) and the ledger: no write to the patient's other appointments.

- **cuj-cancel-appointment-01** — easy: lior.larrabee7@example.com: cancel AP-30014 (DR-201 2027-03-23 09:30)

### cancel-tickets (cancel-it; pages, tools) — 1 task

Cancel one of a seeded customer's confirmed cinema bookings, named by its number. The checks read the booking (cancelled) and the ledger: no write to the customer's other bookings.

- **cuj-cancel-tickets-01** — easy: vesna.thorsby1@example.com: cancel TK-30026 (ST-2082 FM-103)

### cancel-flight-route (cancel-it; pages, tools) — 1 task

Cancel the one confirmed flight booking of a seeded contact on a route and date, described by both and not by its number; the contact has other bookings on the route or on the date. The checks read the booking and the ledger.

- **cuj-cancel-flight-route-01** — medium: ilsa.larrabee6@example.com: VEO→TAL 2027-04-08 → BK-10130; others BK-10135 BNO→KAO 2027-04-08, BK-10136 VEO→TAL 2027-03-01

### cancel-registration (cancel-it; pages, tools) — 1 task

Cancel a seeded person's registration for an event described by its title and date; they are registered for other events, some of the same title or on the same day. The checks read the registration (cancelled) and the ledger.

- **cuj-cancel-registration-01** — medium: sable.okonjo@visitor.example: "Data privacy basics" 2027-03-30 → RG-3048 (EV-1057)

### cancel-pickup (cancel-it; pages, tools) — 1 task

Cancel the one received pickup order of a seeded customer for a date, described by both; the customer has other orders that day or other pickups. The checks read the order (cancelled) and the ledger.

- **cuj-cancel-pickup-01** — medium: vesna.prewitt9@example.org: pickup on 2027-05-06 → PO-10135

### cancel-later-twin (cancel-it; pages, tools) — 1 task

A seeded patient has two booked appointments with one doctor: cancel the later one. The tempting one: the earlier appointment with the same doctor. The checks read the appointment and the ledger: no write to the patient's other appointments.

- **cuj-cancel-later-twin-01** — hard: danae.kowalczyk1@example.com with DR-237: AP-30036 2027-03-09, AP-30093 2027-03-31 → cancel AP-30093

### cancel-earlier-twin (cancel-it; pages, tools) — 1 task

A seeded guest has two confirmed reservations at one restaurant on different days: cancel the earlier one. The tempting one: the later reservation at the same restaurant. The checks read the reservation and the ledger.

- **cuj-cancel-earlier-twin-01** — hard: lior.sandoval5@example.com at RS-126: RV-10185 2027-05-01 → cancel; RV-10098 2027-05-04 stays

### cancel-stays-steps (cancel-it; pages, tools) — 1 task

Two of a seeded guest's hotel bookings cancelled over three prompts, each described by its hotel and check-in date: one, then a second, then how many of their bookings are still confirmed. Each cancel step's check reads its booking; the last state step holds the rest to no write.

- **cuj-cancel-stays-steps-01** — hard: danae.ferrante5@example.com: cancel BK-10146 (HT-126 2027-06-07), then BK-10124 (HT-105 2027-04-16); 4 left confirmed

### cancel-shipped (cancel-it; pages, tools) — 1 task

Cancel a seeded customer's sports order, named by its number, that has already shipped: impossible (`NOT_CANCELLABLE`: only an order still processing can be cancelled). The right outcome is to say so and change nothing.

- **cuj-cancel-shipped-01** — impossible: ORD-10042 shipped on 2027-06-12

### cancel-locked (cancel-it; pages, tools) — 1 task

Cancel a seeded customer's pizza order, named by its number, that is already out for delivery or delivered: impossible (`ORDER_LOCKED`: only a received order can be cancelled). The right outcome is to say so and change nothing.

- **cuj-cancel-locked-01** — impossible: PO-10020 is delivered

### return-exchange-steps (return-or-repeat; pages, tools) — 1 task

An exchange over three prompts: one unit of a delivered line sent back as too small, then the same product and colour ordered in the next size up to the same address, then what that new order costs with shipping (`sportsShippingCents`). No order of the customer's in progress has that size.

- **cuj-return-exchange-steps-01** — hard: ORD-10019: return 1 × SP-115-BLK-S; order 1 × SP-115-BLK-M (M) to AD-1033; $72.94

### return-in-window (return-or-repeat; pages, tools) — 1 task

Send back everything from a named delivered order that can still be returned: each line's category has its own return window from the delivery date (`sportsReturnDeadline`), a site rule, and only one line's is still open. The checks read the order's returns: one for that line, none for the others.

- **cuj-return-in-window-01** — medium: ORD-10018 (delivered 2027-03-28): SP-116-GRY-S open until 2027-06-26; SP-106-BLK-42 closed 2027-04-11

### return-line (return-or-repeat; pages, tools) — 1 task

Return every unit still returnable of a named line of a seeded customer's delivered sports order (what was bought less what was returned already, `sportsReturnedQty`), inside its category's return window, for a named reason. The check reads the order's returns: exactly one more for that item and reason, of that quantity.

- **cuj-return-line-01** — easy: ORD-10022 (delivered 2027-04-06): return 2 × SP-115-BLU-L (1 returned already), "too large"

### refill-named (return-or-repeat; pages, tools) — 1 task

Request a refill of a named prescription with refills left at a named pharmacy that stocks its dosage (`clinicRefillProblem`). The checks read the prescription's refills (one requested, at that pharmacy) and the prescription (one refill fewer).

- **cuj-refill-named-01** — easy: RX-60033 (MED-42 20 mg, 3 left) → CL-13

### reorder-named (return-or-repeat; pages, tools) — 1 task

Repeat a named delivered order of a seeded customer with no order in progress: the same items in the same quantities, to the same address, every one in stock. The checks read the customer's processing orders: exactly one, with every line and the address.

- **cuj-reorder-named-01** — easy: repeat ORD-10012: 3 × SP-107-RED-XL to AD-1022

### reorder-to-address (return-or-repeat; pages, tools) — 1 task

Repeat a seeded customer's most recent order, which was delivered, to another of their addresses, named by its label. The checks read the customer's processing orders: exactly one, with every line, to the labelled address.

- **cuj-reorder-to-address-01** — medium: ilsa.larrabee@example.org: latest ORD-10026 (delivered) → to AD-1019 (home)

### refill-in-city (return-or-repeat; pages, tools) — 1 task

Request a refill of a named prescription with refills left at the one pharmacy in a named city that stocks its dosage. The city and the dosage each matter: another pharmacy there does not stock it, or one elsewhere does. The checks read the refills and the prescription.

- **cuj-refill-in-city-01** — medium: RX-60055 (MED-45 25 mg) in Ostrand → CL-14

### refill-cheapest (return-or-repeat; pages, tools) — 1 task

Request a refill of a named prescription at whichever pharmacy charges least for its medication in its dosage. The tempting one: the lowest price for the medication at any dosage is at a pharmacy that does not stock this dosage.

- **cuj-refill-cheapest-01** — hard: RX-60046 (MED-47 40 mg) → CL-11; CL-14 is cheaper at 10 mg, which it stocks instead

### reorder-latest-delivered (return-or-repeat; pages, tools) — 1 task

Repeat a seeded customer's most recent delivered order, to the same address. The tempting one: their most recent order of all has not been delivered (shipped or cancelled).

- **cuj-reorder-latest-delivered-01** — hard: sable.kowalczyk@example.org: latest ORD-10045 is shipped → repeat ORD-10017 (1 × SP-111-BLU-S, 2 × SP-101-BLK-43)

### return-window-closed (return-or-repeat; pages, tools) — 1 task

Send back a named line of a seeded customer's delivered order after its category's return window has closed: impossible (`RETURN_WINDOW_CLOSED`). The right outcome is to say so and change nothing.

- **cuj-return-window-closed-01** — impossible: ORD-10014 delivered 2027-03-12; Running window 21 days closed 2027-04-02

### refill-none-left (return-or-repeat; pages, tools) — 1 task

Request a refill of a named prescription that has no refills left: impossible (`NO_REFILLS_LEFT`). The right outcome is to say so and change nothing.

- **cuj-refill-none-left-01** — impossible: RX-60015: 0 refills left

### best-room-at-hotel (book-the-best; pages, tools) — 1 task

Book the cheapest room type of a named hotel that sleeps a party, for nights when every room type is free; a cheaper room type sleeps fewer, so the party matters. The check reads the guest's bookings: exactly one, of that room type, for the nights and party asked.

- **cuj-best-room-at-hotel-01** — easy: HT-108, two adults and one child → HT-108-DBL ($120); HT-108-SGL is cheaper but sleeps fewer

### best-showing-earliest (book-the-best; pages, tools) — 1 task

Book two named seats, free there, at the earliest of a named film's showings at a named cinema on a date (`cinemaSearchShowtimes`, by start time). The check reads the customer's bookings: exactly one, of those seats at that showing.

- **cuj-best-showing-earliest-01** — easy: FM-101 at CN-101 on 2027-05-14: earliest of 2 → ST-2002 (15:30), seats E1+E2

### best-viewing-earliest (book-the-best; pages, tools) — 1 task

Request the earliest free viewing slot of a named active listing, from a named date (`homeSlotsOf`). The check reads the viewer's requests: exactly one, of that listing at that slot.

- **cuj-best-viewing-earliest-01** — easy: LS-3138 (agent AG-16) from 2027-06-09 → 2027-06-09 10:00

### best-flight-nonstop (book-the-best; pages, tools) — 1 task

Book the cheapest nonstop economy flight on a route and date for two (`searchFlights` with `maxStops: 0`); a flight with a stop is cheaper, so the requirement matters. The check reads the contact's bookings: exactly one, on that flight.

- **cuj-best-flight-nonstop-01** — medium: QLV→BNO 2027-04-11: cheapest SZ214 has a stop → nonstop TF979 ($155)

### best-table-earliest (book-the-best; pages, tools) — 1 task

Book a table in a named area of a named restaurant on a date for a party the area seats, at a named time or the earliest after it with a table free (`diningTablesLeft`); the named time has one. The check reads the guest's reservations: exactly one, at that time, in that area.

- **cuj-best-table-earliest-01** — medium: RS-117 2027-05-14, terrace, 4 people, from 19:00 → 19:00

### best-stay-amenity (book-the-best; pages, tools) — 1 task

Book the cheapest room in a city, for nights when every room is free, for two adults at a hotel with a named amenity (`searchStays`); the cheapest hotel in the city lacks it, so the requirement matters. The check reads the guest's bookings.

- **cuj-best-stay-amenity-01** — medium: Karrow, spa, 2 adults, 2027-11-08 × 3 → HT-132-DBL ($180); cheapest overall HT-129-DBL has no spa

### best-flight-bags (book-the-best; pages, tools) — 1 task

Book the flight on a route and date that costs two travellers least in economy with two checked bags each (fares and the carrier's bag fees), and book it. The tempting one: the lowest fare is on a carrier that takes only one checked bag.

- **cuj-best-flight-bags-01** — hard: TAL→BNO 2027-03-18: TF187 lowest fare, 1 bag only → QE615 ($410 with bags)

### best-stay-pets (book-the-best; pages, tools) — 1 task

Book the cheapest room in a city, for nights when every room is free, for one adult bringing a dog (`searchStays` with `pets`). The tempting one: the cheapest hotel in the city does not allow pets.

- **cuj-best-stay-pets-01** — hard: Ostrand 2027-11-22 × 2, 1 adult + dog → HT-107-SGL; HT-109-SGL is cheaper but HT-109 allows no pets

### best-showing-cheapest (book-the-best; pages, tools) — 1 task

Book three seats side by side at the showing of a named film in a city on a date with the lowest adult price among those starting at or after a named time and still having three together (`cinemaSearchShowtimes`). The tempting one: an earlier showing that day is cheaper.

- **cuj-best-showing-cheapest-01** — hard: FM-113 Karrow 2027-05-14 from 17:00: ST-2045 (12:50) is cheaper → ST-2052 (22:10, $13.25)

### best-trip-budget (book-the-best; pages, tools) — 1 task

A trip over two sites under one budget: the earliest nonstop economy flight on a route and date for two travellers each checking two bags, then a room for two nights in the destination at the best-rated hotel with a gym that keeps flight and hotel together within the budget. The earliest nonstop is on a carrier that takes one bag, so its booking is refused (`TOO_MANY_BAGS`) and the next earliest nonstop is booked; it costs more, which leaves less for the hotel. The constraints interact: the hotel the first flight would have left room for is over the budget with the second.

- **cuj-best-trip-budget-01** — hard (very hard): TAL→BNO 2027-06-02: TF187 (TF, 1 bag) refused → QE130 $510; budget $890 → HT-120 HT-120-DBL (3.6, $380); with TF187 it would have been HT-116 (4.4)

### best-film-then-dinner (book-the-best; pages, tools) — 1 task

An evening over two sites and two prompts: five seats side by side at the earliest showing of a named film at a named cinema from 17:00, then a table for five at a named restaurant at the earliest seating at least thirty minutes after the film ends (start + `runtimeMinutes`), on the terrace if its tables seat five, otherwise inside. The terrace seats fewer, so that booking is refused (`TABLE_TOO_SMALL`) and an indoor table is booked. The constraints interact: the film's end decides the dinner time, and the restaurant's earliest evening table comes before it.

- **cuj-best-film-then-dinner-01** — hard (very hard): FM-110 at CN-106 2027-05-15: ST-2095 18:30 + 137 min → ends 20:47; RS-126 terrace seats 4 → indoor at 21:30 (first evening table 17:00)

### best-party-limit (book-the-best; pages, tools) — 1 task

The earliest table for fourteen at a named restaurant: impossible (`PARTY_LIMIT`: parties of more than twelve are not booked online). The right outcome is to say so and book nothing.

- **cuj-best-party-limit-01** — impossible: RS-115: party of 14 > 12

### best-viewing-inactive (book-the-best; pages, tools) — 1 task

The earliest viewing of a named listing that is no longer on the market (under offer or sold): impossible (`NOT_ACTIVE`: only active listings can be viewed). The right outcome is to say so and request nothing.

- **cuj-best-viewing-inactive-01** — impossible: LS-3181 is sold

### self-cancel (act-as-yourself; pages, tools) — 1 task

A person with an account on the hotel site signs in with their own email and password and cancels one of their confirmed bookings, named by its number. The checks read the booking (cancelled), the ledger (the cancel was made signed in as them) and their other bookings (untouched).

- **cuj-self-cancel-01** — easy: lior.ferrante2@example.com signs in and cancels BK-10060 (HT-122 from 2027-05-08)

### self-viewing (act-as-yourself; pages, tools) — 1 task

A person with an account on the home listings site signs in with their own email and password and requests a viewing of a named active listing at a named free slot. The checks read their viewings and the ledger (requested signed in as them).

- **cuj-self-viewing-01** — easy: maren.prewitt5@mail.example → LS-3110 2027-06-19 11:30

### self-refill (act-as-yourself; pages, tools) — 1 task

A patient with an account on the clinic site signs in with their own email and password and requests a refill of their named prescription at a named pharmacy that stocks it. The checks read the refill, the prescription and the ledger (requested signed in as them).

- **cuj-self-refill-01** — easy: orrin.okonjo8@example.com: RX-60003 → CL-12

### self-cancel-route (act-as-yourself; pages, tools) — 1 task

A person with an account on the flight site signs in with their own email and password and cancels the one of their bookings described by its route and date; they have other bookings on the route or on the day. The checks read the booking, the ledger (cancelled signed in as them) and their other bookings (untouched).

- **cuj-self-cancel-route-01** — medium: sable.voss3@example.com: QLV→KAO 2027-04-10 → BK-10028

### self-pizza-serves (act-as-yourself; pages, tools) — 1 task

A person with an account on the pizza site signs in with their own email and password and orders, for pickup, one named menu pizza big enough for a number of people: the smallest size that serves them (`pizzaSizeFor`), a site rule. The checks read their orders and the ledger (ordered signed in as them).

- **cuj-self-pizza-serves-01** — medium: bram.larrabee7@example.org: PZ-101 for 5 → xlarge

### self-table-party (act-as-yourself; pages, tools) — 1 task

A person with an account on the restaurant site signs in with their own email and password and books a table at a named restaurant, date and time for a party only one of its areas seats: the party size, a site rule, decides the area (`TABLE_TOO_SMALL` elsewhere). The checks read their reservations and the ledger.

- **cuj-self-table-party-01** — medium: quill.voss8@example.com: RS-104 2027-10-29 19:30, 6 → indoor

### self-signup-tickets (act-as-yourself; pages, tools) — 1 task

A new customer signs up on the cinema site, confirms the address with the emailed code, and books two named seats at a named showing in their own name. The checks read the ledger (the account confirmed, the booking made signed in as them) and their bookings.

- **cuj-self-signup-tickets-01** — hard: imogen.corrigan.41855@journeys.example signs up, books A1, A2 at ST-2040

### self-signup-register (act-as-yourself; pages, tools) — 1 task

A new person signs up on the office events site, confirms the address with the emailed code, and registers themself for a named open event with places left. The checks read the ledger (the account confirmed, the registration made signed in as them) and their registrations.

- **cuj-self-signup-register-01** — hard: greer.corrigan.27821@journeys.example signs up, registers for EV-1073

### self-signup-appointment (act-as-yourself; pages, tools) — 1 task

A new patient signs up on the clinic site, confirms the address with the emailed code, and books themself into a named free slot of a doctor who takes new patients, without a plan. The checks read the ledger (the account confirmed, the appointment made signed in as them) and their appointments.

- **cuj-self-signup-appointment-01** — hard: quinta.holloway.65447@journeys.example signs up, books DR-204 2027-09-22 11:30

### self-evening-steps (act-as-yourself; pages, tools) — 1 task

An evening over two sites, each with a new account confirmed by its emailed code: three named seats side by side at the earliest showing of a named film at a named cinema from 18:00 (one of them is taken, so that booking is refused, `SEAT_TAKEN`, and three others side by side are booked), then a table for three at a named restaurant at the earliest seating at least thirty minutes after the film ends. The constraints interact: the film's end decides the dinner time, and the restaurant's earliest evening table comes before it.

- **cuj-self-evening-steps-01** — hard (very hard): FM-113 at CN-105 2027-05-15: ST-2091 18:50, D3+D4+D5 has D5 taken; ends 20:58 → RS-119 at 21:30 (first evening table 17:00)

### self-cancel-locked (act-as-yourself; pages, tools) — 1 task

A person with an account on the pizza site signs in with their own email and password to cancel their order, named by its number, that the kitchen is already preparing: impossible (`ORDER_LOCKED`). The right outcome is to say so and change nothing; the check asks that the agent looked or was refused signed in as them.

- **cuj-self-cancel-locked-01** — impossible: maren.okonjo3@example.org: PO-10048 is preparing

### self-return-closed (act-as-yourself; pages, tools) — 1 task

A person with an account on the sports shop signs in with their own email and password to send back an item from their delivered order after its category's return window has closed: impossible (`RETURN_WINDOW_CLOSED`). The right outcome is to say so and change nothing; the check asks that the agent looked or was refused signed in as them.

- **cuj-self-return-closed-01** — impossible: lior.halvard@example.org: ORD-10005 delivered 2027-01-29, SP-108-BLU-OS window closed

### conv-table-deposit (carry-a-conversation; pages, tools) — 1 task

Two prompts: a table for a party only one of a named restaurant's areas seats (the party size, a site rule, decides the area), then what deposit the restaurant took for it (`diningDepositCents`: per guest, plus the private-room fee there).

- **cuj-conv-table-deposit-01** — medium: RS-112 2027-11-05 19:00, 4 → indoor; deposit $40

### conv-pizza-total (carry-a-conversation; pages, tools) — 1 task

Two prompts: one named menu pizza big enough for a number of people, for pickup (the size is the smallest that serves them, `pizzaSizeFor`, a site rule), then what the order costs.

- **cuj-conv-pizza-total-01** — medium: PZ-101 for 5 → xlarge; $28.65

### conv-rooms-steps (carry-a-conversation; pages, tools) — 1 task

Three prompts at one hotel: a named room type booked for a couple, then a second room for their parents (the hotel's cheapest that sleeps two), then that second room cancelled again. The first booking is held to no write after it was made.

- **cuj-conv-rooms-steps-01** — hard: HT-119 2027-11-15 × 3: HT-119-KNG; + cheapest for two HT-119-DBL; then cancel HT-119-DBL

### conv-event-steps (carry-a-conversation; pages, tools) — 1 task

Three prompts for an organiser in the staff directory: an invitation-only event made in a named free room with two guests, then two more guests added, then one of those taken off again. Each change step stands on its own change of that event, after the step before's.

- **cuj-conv-event-steps-01** — hard: VEL-R2 2027-11-10 14:00–15:00 by teodor.larrabee@staff.example: vesna.halvard@staff.example, teodor.kowalczyk@staff.example; + orrin.okonjo@staff.example, vesna.kowalczyk@staff.example; − vesna.kowalczyk@staff.example

### conv-dinner-long (carry-a-conversation; pages, tools) — 1 task

Six prompts about one reservation: a table for four indoors at 19:00 with the party needing to leave by 22:00; six people; the terrace if its tables seat six, otherwise the private room (the terrace seats fewer, so that change is refused, `TABLE_TOO_SMALL`, and the private room is taken); as late as they can still be out by 22:00 (a table is held two hours, so 20:00, not the last seating); four again; and the deposit now held (`diningDepositCents`). The constraints interact: the 22:00 from the first prompt decides the time asked for in the fourth.

- **cuj-conv-dinner-long-01** — hard (very hard): RS-122 2027-11-12: 4 indoor 19:00 → 6 → terrace seats 4 → private → 20:00 (last seating 21:30) → 4; deposit $230

### conv-event-long (carry-a-conversation; pages, tools) — 1 task

Six prompts about one new event: made in a named room with two guests; two more guests; a named smaller room, with a named bigger one to fall back on (the smaller holds everyone first invited but not after the two were added, so that change is refused, `OVER_CAPACITY`); an hour later; one of the added guests off again; and how many people the room must hold now (`eventHeadcount`). The constraints interact: the guests added in one prompt decide which room the next can have.

- **cuj-conv-event-long-01** — hard (very hard): OF-BRE 2027-11-17: BRE-R3 + 2 guests → +2 → BRE-R1 (holds 4) refused → BRE-R2 → 11:00 → −1; headcount 4

### conv-pizza-long (carry-a-conversation; pages, tools) — 1 task

Six prompts about one pizza order with a budget: two menu pizzas for pickup and a budget for the whole order; the second one in a bigger size; a named topping added to the first, or a named other if the branch is out of it (it is, so that change is refused, `TOPPING_OUT`); two of the first pizza if the order stays within the budget, otherwise the second back to its first size (two would go over, so the second goes back); the added topping off again; and the total. The constraints interact: the budget from the first prompt decides what the fourth can do.

- **cuj-conv-pizza-long-01** — hard (very hard): BR-105 2027-10-22 18:30: PZ-104 M + PZ-114 M; PZ-114 → L; + mushroom refused → + red-onion; ×2 would be $56.45 > $48 → PZ-114 back to M; − red-onion; total $34.20

### conv-party-limit (carry-a-conversation; pages, tools) — 1 task

Two prompts: a table for four booked, then the same reservation for fourteen, impossible (`PARTY_LIMIT`: parties of more than twelve are not booked online). The second step's right outcome is to say so and change nothing; its checks count from the booking.

- **cuj-conv-party-limit-01** — impossible: RS-121 2027-11-19 19:30 for 4; then 14 > 12

### conv-extra-night (carry-a-conversation; pages, tools) — 1 task

Two prompts: a named room type booked for nights it has free, then the same room type for the night after as well, when it is booked out (`SOLD_OUT`). The second step's right outcome is to say so and book nothing; its checks count from the first booking.

- **cuj-conv-extra-night-01** — impossible: HT-103-FAM 2027-04-01 × 2 booked; 2027-04-03 booked out

### plan-flight-then-room (plan-across-sites; pages, tools) — 1 task

Two prompts on two sites: which nonstop flight on a route and date leaves before noon (exactly one, `searchFlights`), then the cheapest room in the destination city for two adults for two nights from that date at a hotel with a named amenity (`searchStays`), booked. Each prompt is found by its own requirements.

- **cuj-plan-flight-then-room-01** — medium: QLV→BNO 2027-03-06 nonstop before 12:00 → TF979; Brenmoor spa → HT-118-KNG ($250)

### plan-trip-steps (plan-across-sites; pages, tools) — 1 task

Three prompts on two sites: a named flight booked for one traveller, then a named room type at a named hotel in the destination for the nights of the trip, then what the flight and the room cost together.

- **cuj-plan-trip-steps-01** — hard: TF805 2027-05-15 + HT-118-SGL × 3 → $585

### plan-talk-dinner-steps (plan-across-sites; pages, tools) — 1 task

Three prompts on two sites: a registration for a named open event with places, then a table for two at a named restaurant in the office's city that evening at a named time after it, then the deposit the restaurant took (`diningDepositCents`).

- **cuj-plan-talk-dinner-steps-01** — hard: EV-1062 2027-04-12 14:30–16:30; RS-103 at 17:30; deposit $40

### plan-overnight-trip (plan-across-sites; pages, tools) — 1 task

Four prompts on two sites: a named evening flight that lands after midnight, for two travellers with two checked bags each if the carrier takes two (it takes one, so that booking is refused, `TOO_MANY_BAGS`, and one bag each is booked); a named flight back three days later; a named room type for every night from the night they land until they fly back; and what it all costs. The constraints interact: the flight landing the next day decides the hotel's first night.

- **cuj-plan-overnight-trip-01** — hard (very hard): TF754 2027-04-17 21:20→00:00+1 (TF, 1 bag); back TF187 2027-04-20; HT-122-DBL from 2027-04-18 × 2; total $1,040

### plan-session-dinner (plan-across-sites; pages, tools) — 1 task

Two prompts on two sites: a registration for the earliest session of a course at an office that still has places (the earliest is full, so registering for it is refused, `FULL`, and the next is taken), then a table for two at a named restaurant in that city on the session's day at the earliest seating at least thirty minutes after it ends. The constraints interact: which session is had decides the dinner's day and time.

- **cuj-plan-session-dinner-01** — hard (very hard): "Data privacy basics" at OF-OST: EV-1052 full → EV-1053 2027-04-06 ends 12:00; RS-105 indoor at 17:00

### plan-film-hotel-budget (plan-across-sites; pages, tools) — 1 task

Two prompts on two sites under one budget: two named seats at a named showing, or two others side by side in the same row if one is taken (one is, so that booking is refused, `SEAT_TAKEN`); then a room for two for that night at the best-rated hotel in the city that keeps the tickets and the room within the budget. The constraints interact: the tickets decide what is left for the room, and the best-rated hotel is over it.

- **cuj-plan-film-hotel-budget-01** — hard (very hard): ST-2072 row B: B5+B6 has B5 taken; tickets $35; budget $240 → HT-114 HT-114-DBL (3.6); best HT-112 is over

### plan-no-pets (plan-across-sites; pages, tools) — 1 task

Two prompts on two sites: a named flight booked, then a named room type in the destination for the traveller and their dog, at a hotel that allows no pets: impossible (`NO_PETS`). The second step's right outcome is to say so and book nothing; its checks count from the flight.

- **cuj-plan-no-pets-01** — impossible: EM153 2027-04-24; then HT-127-SGL with a dog: HT-127 allows no pets

### plan-return-outside (plan-across-sites; pages, tools) — 1 task

Two prompts on two sites: a named room type booked for the last nights of June, then the flight home on a date in July, impossible (`OUTSIDE_WINDOW`: flights are sold for departures to 2027-06-30). The second step's right outcome is to say so and book nothing; its checks count from the room.

- **cuj-plan-return-outside-01** — impossible: HT-105-DBL 2027-06-28 × 3; then SZ148 on 2027-07-01 is outside the window

### fit-variant-tempting (find-the-fit; pages, tools) — 1 task

Which colour of a named product, in a named size, is the cheapest that is in stock, and at what price: exactly one. The tempting one: a cheaper colour in that size is out of stock.

- **cuj-fit-variant-tempting-01** — hard: SP-115 size S: SP-115-RED-S ($62.99) is out of stock → SP-115-BLK-S black, $67.99

### fit-stay-none (find-the-fit; pages, tools) — 1 task

Which hotel in a city has a room free for a stay that fits the party, at no more than a nightly cap, with two named amenities: none does (`searchStays`). The near miss: a hotel with both amenities and a room within the cap that fits, booked out on one of the nights. The right answer says none does.

- **cuj-fit-stay-none-01** — impossible: Quillhaven 2027-05-21 × 2, 2 adults, ≤ $160, spa + restaurant → none; HT-111-DBL at HT-111 would fit but is booked out

### fit-table-none (find-the-fit; pages, tools) — 1 task

Which restaurant in a city has a table in a named area free for a party at a date and time and offers a named dietary menu: none does (`diningSearch`). The near miss: a restaurant there with the menu and tables in that area big enough, every one of them taken then. The right answer says none does.

- **cuj-fit-table-none-01** — impossible: Brenmoor 2027-04-23 21:30, 4 people, indoor, vegan → none; RS-115 has both but is full then
