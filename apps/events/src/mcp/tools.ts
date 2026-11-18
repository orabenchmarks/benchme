import { DomainError, ToolRegistry } from "@benchme/site-kit";
import { z } from "zod";
import { date, time } from "../api/inputs.js";
import type { EventsRepo } from "../db/events-repo.js";
import type { OfficesRepo } from "../db/offices-repo.js";
import type { RegistrationsRepo } from "../db/registrations-repo.js";

export type ToolContext = { workspaceId: string; offices: OfficesRepo; events: EventsRepo; registrations: RegistrationsRepo };

const notFound = (what: string) => {
  throw new DomainError("NOT_FOUND", `${what} not found`, 404);
};
const emails = (what: string) => z.array(z.string()).optional().describe(what);
const mode = z.enum(["invite-only", "open"]);
const office = z.string().describe("office code (OF-…) or city");
/** Leaves out the keys a call did not give. */
const given = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** The office events site's MCP surface (and, through the bridge, its WebMCP tools): offices and rooms, people, events, registrations. */
export function eventTools(): ToolRegistry<ToolContext> {
  return new ToolRegistry<ToolContext>()
    .register({
      name: "list_offices",
      description: "Every office: city, address, the days and hours it is open, and its meeting rooms with capacity (people, the organiser included), equipment and step-free access.",
      input: {},
      handler: (_a, c) => c.offices.listOffices(c.workspaceId),
    })
    .register({
      name: "find_free_rooms",
      description:
        "Rooms in one office that are free for the whole time, hold the number of people, and have every piece of equipment asked (projector, video conferencing, whiteboard) — smallest first. Fails with the reason when the office is closed that day or at that time.",
      input: {
        office,
        date: date.describe("YYYY-MM-DD"),
        startTime: time.describe("HH:MM, 24-hour"),
        endTime: time.describe("HH:MM, 24-hour"),
        people: z.number().int().min(1).describe("how many people the room must hold, the organiser included"),
        equipment: z.array(z.string()).optional(),
        accessible: z.boolean().optional().describe("only rooms with step-free access"),
      },
      handler: (a, c) => c.offices.freeRooms(c.workspaceId, { ...a, equipment: a.equipment ?? [], accessible: a.accessible ?? false }),
    })
    .register({
      name: "list_people",
      description: "The staff directory: name, email, office and team. Optionally one office, one team, or names containing some text.",
      input: { office: office.optional(), team: z.string().optional(), name: z.string().optional() },
      handler: (a, c) => c.offices.listPeople(c.workspaceId, given(a)),
    })
    .register({
      name: "list_events",
      description:
        "Events, earliest first, each with its room, organiser, guests, place limit and places left. Filter by office, room, one date or a from/to range, organiser, invited guest, a person registered for it (registrantEmail), title text, invite-only|open, scheduled|cancelled, or only open events with places left. Paginated via cursor.",
      input: {
        office: office.optional(), roomCode: z.string().optional(), date: date.optional(), from: date.optional(), to: date.optional(), organiserEmail: z.string().optional(), guestEmail: z.string().optional(),
        registrantEmail: z.string().optional(), title: z.string().optional().describe("text the title contains"), registration: mode.optional(), status: z.enum(["scheduled", "cancelled"]).optional(),
        hasPlaces: z.boolean().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional(),
      },
      handler: (a, c) =>
        c.events.listEvents(c.workspaceId, {
          ...given({ office: a.office, room: a.roomCode, date: a.date, from: a.from, to: a.to, organiser: a.organiserEmail, guest: a.guestEmail, registrant: a.registrantEmail, q: a.title, registration: a.registration, status: a.status, cursor: a.cursor }),
          ...(a.hasPlaces ? { hasPlaces: true } : {}),
          limit: a.limit ?? 25,
        }),
    })
    .register({
      name: "get_event",
      description: "One event by its code (EV-…): time, room, organiser, guests, registration mode, place limit, how many are registered and how many places are left.",
      input: { eventCode: z.string() },
      handler: async (a, c) => (await c.events.getEvent(c.workspaceId, a.eventCode)) ?? notFound(`event ${a.eventCode}`),
    })
    .register({
      name: "create_event",
      description:
        "Book a room for an event. The organiser must be in the staff directory. Fails if the date is outside 2027, the office is closed that day or at that time, times are not on the quarter hour, a guest email is not valid, the room cannot hold the organiser + guests + places, or the room is taken for any part of the time. An open event needs places; an invite-only one has none.",
      input: {
        title: z.string(), description: z.string().default(""), date, startTime: time, endTime: time, roomCode: z.string(), organiserEmail: z.string().email(),
        guestEmails: emails("emails of the invited guests"), registration: mode.default("invite-only"), places: z.number().int().min(1).optional().describe("places open to registration (open events only)"),
      },
      handler: (a, c) => c.events.createEvent(c.workspaceId, { ...a, guestEmails: a.guestEmails ?? [], places: a.places ?? null }),
    })
    .register({
      name: "change_event",
      description:
        "Change an event: only its organiser can (organiserEmail). Fields left out stay as they are; guestEmails replaces the guest list, addGuestEmails/removeGuestEmails edit it. Held to the same rules as create_event, and never fewer places than people registered.",
      input: {
        eventCode: z.string(), organiserEmail: z.string().email(), title: z.string().optional(), description: z.string().optional(), date: date.optional(), startTime: time.optional(), endTime: time.optional(),
        roomCode: z.string().optional(), guestEmails: emails("the whole new guest list"), addGuestEmails: emails("guests to add"), removeGuestEmails: emails("guests to remove"), registration: mode.optional(),
        places: z.number().int().min(1).nullable().optional(),
      },
      handler: ({ eventCode, ...change }, c) => c.events.changeEvent(c.workspaceId, eventCode, given(change)),
    })
    .register({
      name: "cancel_event",
      description: "Cancel a scheduled event: only its organiser can. Its room is free again; a cancelled event cannot be restored.",
      input: { eventCode: z.string(), organiserEmail: z.string().email() },
      handler: (a, c) => c.events.cancelEvent(c.workspaceId, a.eventCode, a.organiserEmail),
    })
    .register({
      name: "register_for_event",
      description: "Register a person for an open event. Fails if the event is invite-only or cancelled, has no places left, the person is already registered for it, or they are registered for another event at an overlapping time.",
      input: { eventCode: z.string(), name: z.string(), email: z.string().email() },
      handler: (a, c) => c.registrations.register(c.workspaceId, a.eventCode, { name: a.name, email: a.email }),
    })
    .register({
      name: "cancel_registration",
      description: "Cancel a registration, by its number (RG-…) or by the event and the person's email. Its place is free again.",
      input: { regNo: z.string().optional(), eventCode: z.string().optional(), email: z.string().optional() },
      handler: (a, c) => {
        if (a.regNo) return c.registrations.cancelRegistration(c.workspaceId, a.regNo);
        if (a.eventCode && a.email) return c.registrations.cancelRegistrationFor(c.workspaceId, a.eventCode, a.email);
        throw new DomainError("BAD_REQUEST", "give regNo, or eventCode and email", 422);
      },
    });
}
