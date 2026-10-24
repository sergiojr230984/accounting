import { google, calendar_v3 } from "googleapis";
import { formatDateOnly } from "./date";

/**
 * Google Calendar write-back (spec §3-4): the office's existing manual
 * calendar block for a delivery run becomes an app-managed event instead --
 * created once when the delivery is scheduled, moved (same event id) on
 * every reschedule, and updated with a "✅ ENTREGADO" line + photo
 * attachments the moment the crew submits.
 *
 * Degrades to a no-op when GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_CALENDAR_ID
 * aren't configured -- scheduling and delivery still work (no calendar
 * event exists, `calendarEventId` stays null), consistent with every other
 * optional integration in this app (Resend, Anthropic, Google Places).
 */

let warnedMissingConfig = false;
function warnOnce(msg: string) {
  if (warnedMissingConfig) return;
  warnedMissingConfig = true;
  console.warn(`[google-calendar] ${msg}`);
}

function getCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

function getCalendarClient() {
  const creds = getCredentials();
  if (!creds) {
    warnOnce("GOOGLE_SERVICE_ACCOUNT_JSON not set (or invalid) -- Calendar write-back disabled.");
    return null;
  }
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

function getCalendarId(): string | null {
  const id = process.env.GOOGLE_CALENDAR_ID;
  if (!id) {
    warnOnce("GOOGLE_CALENDAR_ID not set -- Calendar write-back disabled.");
    return null;
  }
  return id;
}

export interface ScheduleEventInput {
  existingEventId: string | null;
  summary: string;
  description: string;
  windowStart: Date;
  windowEnd: Date;
  timeZone: string;
}

/**
 * Creates the delivery's calendar event, or moves the existing one (by id)
 * to the new window -- never a second `events.insert` for the same
 * delivery (spec §4: "never create a duplicate event"). Falls back to a
 * fresh insert only if the stored event id no longer exists on the
 * calendar (e.g. someone deleted it by hand), which is a deliberate
 * recovery path, not the normal case.
 */
export async function scheduleDeliveryEvent(input: ScheduleEventInput): Promise<string | null> {
  const calendar = getCalendarClient();
  const calendarId = getCalendarId();
  if (!calendar || !calendarId) return null;

  const requestBody: calendar_v3.Schema$Event = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.windowStart.toISOString(), timeZone: input.timeZone },
    end: { dateTime: input.windowEnd.toISOString(), timeZone: input.timeZone },
  };

  try {
    if (input.existingEventId) {
      try {
        const updated = await calendar.events.patch({
          calendarId,
          eventId: input.existingEventId,
          requestBody,
        });
        return updated.data.id ?? input.existingEventId;
      } catch (e) {
        const status = (e as { code?: number; response?: { status?: number } })?.response?.status ?? (e as { code?: number })?.code;
        if (status !== 404 && status !== 410) throw e;
        console.warn(
          `[google-calendar] event ${input.existingEventId} no longer exists on the calendar -- creating a replacement.`
        );
      }
    }
    const created = await calendar.events.insert({ calendarId, requestBody });
    return created.data.id ?? null;
  } catch (e) {
    console.error("[google-calendar] failed to schedule event:", e);
    return null;
  }
}

export async function deleteDeliveryEvent(eventId: string): Promise<void> {
  const calendar = getCalendarClient();
  const calendarId = getCalendarId();
  if (!calendar || !calendarId) return;
  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (e) {
    console.error("[google-calendar] failed to delete event:", e);
  }
}

export interface DeliveredAttachment {
  fileId: string;
  fileUrl: string;
  title: string;
  mimeType: string;
}

/**
 * Appends the "✅ ENTREGADO" line to the event's existing description
 * (read-modify-write -- events.patch replaces the field outright, it is not
 * additive) and attaches the Drive photos. Per spec §3, the description
 * append is the mandatory half: if Drive attachment fails or no photos made
 * it to Drive at all, this still writes the description line (with
 * whatever Drive link it has, if any) rather than skipping the whole call.
 */
export async function appendDeliveredToEvent(
  eventId: string,
  deliveredAt: Date,
  driveLink: string | null,
  attachments: DeliveredAttachment[]
): Promise<{ ok: boolean }> {
  const calendar = getCalendarClient();
  const calendarId = getCalendarId();
  if (!calendar || !calendarId) return { ok: false };

  try {
    const existing = await calendar.events.get({ calendarId, eventId });
    const stamp = formatDateOnly(deliveredAt, "MMM d, yyyy") + " " + deliveredAt.toTimeString().slice(0, 5);
    const line = driveLink
      ? `✅ ENTREGADO ${stamp} — Fotos: ${driveLink}`
      : `✅ ENTREGADO ${stamp} — Fotos: (no se pudieron subir a Drive, ver la app)`;
    const newDescription = [existing.data.description, line].filter(Boolean).join("\n\n");

    await calendar.events.patch({
      calendarId,
      eventId,
      supportsAttachments: true,
      requestBody: {
        description: newDescription,
        attachments: attachments.length
          ? attachments.map((a) => ({
              fileId: a.fileId,
              fileUrl: a.fileUrl,
              title: a.title,
              mimeType: a.mimeType,
            }))
          : undefined,
      },
    });
    return { ok: true };
  } catch (e) {
    console.error("[google-calendar] failed to write ENTREGADO back to event:", e);
    return { ok: false };
  }
}
