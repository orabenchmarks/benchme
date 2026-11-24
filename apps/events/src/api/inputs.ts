import { isDate, isEventTime } from "@benchme/scenarios";
import { z } from "zod";

/**
 * The input shapes REST, MCP and the pages share, so every door accepts the
 * same thing. Times are "HH:MM", 24-hour, on the quarter hour; a guest list
 * is an array, or one string of emails separated by commas, spaces or new
 * lines (what a form's textarea sends). Each guest email is checked by the
 * rules (BAD_GUEST_EMAIL, 422), so a form shows which one is wrong.
 */
// A fresh instance per call, for the MCP tools: one schema object shared by two fields of a tool becomes a "$ref" in its JSON Schema, which some agent clients cannot follow.
export const dateOf = () => z.string().refine(isDate, "a date as YYYY-MM-DD");
export const timeOf = () => z.string().refine(isEventTime, "a time as HH:MM (24-hour) on the quarter hour");
export const date = dateOf();
export const time = timeOf();
/** A query string sends "" for a parameter left empty: read it as not given before zod sees it, so it is no filter (or the default), not a bad value. */
export const given = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema);
const list = (split: RegExp) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(split)).map((a) => a.trim()).filter(Boolean)));
export const emailList = list(/[\s,;]+/);
/** "projector,whiteboard", ["projector", "whiteboard"] or one repeated query param. */
export const equipmentList = list(/,/).transform((v) => v.map((e) => e.toLowerCase()));
export const registrationMode = z.enum(["invite-only", "open"]);
/** Places: a whole number, or nothing for an invitation-only event. An empty form field is nothing. */
export const places = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(500).optional());
const people = z.coerce.number().int().min(1).max(500);

export const freeRoomInput = {
  office: z.string().min(1).describe("office code (OF-…) or city"),
  date,
  startTime: time,
  endTime: time,
  people: people.describe("how many people the room must hold, the organiser included"),
  equipment: equipmentList.describe('equipment every room must have, e.g. ["projector", "video conferencing"]'),
};
export const freeRoomSchema = z.object({ ...freeRoomInput, accessible: given(z.enum(["true", "false"]).optional()) });

export const eventInput = {
  title: z.string().min(1),
  description: z.string().default(""),
  date,
  startTime: time,
  endTime: time,
  roomCode: z.string().min(1),
  organiserEmail: z.string().email().describe("the organiser: a person in the staff directory"),
  guestEmails: emailList.describe("emails of the invited guests"),
  registration: registrationMode.default("invite-only"),
  places: places.describe("places open to registration (open events only)"),
};
export const eventSchema = z.object(eventInput).transform((e) => ({ ...e, places: e.places ?? null }));

export const changeInput = {
  organiserEmail: z.string().email().describe("the event's own organiser: the change is made in their name, by any signed-in account"),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  date: date.optional(),
  startTime: time.optional(),
  endTime: time.optional(),
  roomCode: z.string().min(1).optional(),
  guestEmails: z.union([z.string(), z.array(z.string())]).optional().describe("the whole new guest list (replaces it)"),
  addGuestEmails: emailList.describe("guests to add"),
  removeGuestEmails: emailList.describe("guests to remove"),
  registration: registrationMode.optional(),
  places: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).max(500).nullable().optional()),
};
export const changeSchema = z.object(changeInput).transform(({ guestEmails, ...rest }) => ({
  ...rest,
  ...(guestEmails === undefined ? {} : { guestEmails: (Array.isArray(guestEmails) ? guestEmails : guestEmails.split(/[\s,;]+/)).map((g) => g.trim()).filter(Boolean) }),
}));
export const registerSchema = z.object({ name: z.string().min(1), email: z.string().email() });
export const organiserSchema = z.object({ organiserEmail: z.string().email() });
