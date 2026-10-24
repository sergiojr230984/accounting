# Google Calendar + Drive write-back (Module 1: Deliveries) — one-time setup

Roughly 15 minutes. Once done, scheduling a delivery creates/moves a real
Calendar event, and a crew's "Entregado" photo gets mirrored to a Drive
folder and attached to that event automatically.

**Without this configured, the Deliveries feature still works end to end**
(upload link, photo capture, status tracking, office board) — scheduling
just won't create a calendar event, and photos stay local-only. Every write
to Calendar/Drive is deliberately best-effort and never blocks a crew
member's submission; see `lib/google-calendar.ts` / `lib/google-drive.ts`.

## Why a service account (not your personal Google login)

This is a server-to-server integration — nobody manually signs in. A
**service account** is a robot identity Google issues you a private key
for. It has (almost) no access to anything by default; you explicitly
*share* one calendar and one Drive folder with it, the same way you'd
share them with a coworker's email address.

## 1. Create a Google Cloud project (free)

1. Open <https://console.cloud.google.com/>.
2. Top bar → project picker → **New Project**.
3. Name it `lacuevita-deliveries` (or anything).
4. Create it, then switch to that project.

## 2. Enable the Calendar and Drive APIs

1. Left menu → **APIs & Services** → **Library**.
2. Search **Google Calendar API** → **Enable**.
3. Search **Google Drive API** → **Enable**.

## 3. Create the service account

1. Left menu → **APIs & Services** → **Credentials**.
2. **+ Create credentials** → **Service account**.
3. Name it `delivery-writeback` → **Create and continue** → skip the
   optional role/access steps → **Done**.
4. Click the new service account in the list → **Keys** tab → **Add
   key** → **Create new key** → **JSON** → **Create**. A `.json` file
   downloads — keep it private, this is the credential.
5. Note the service account's **email address** (looks like
   `delivery-writeback@lacuevita-deliveries.iam.gserviceaccount.com`) —
   you'll share things with this address in the next two steps.

## 4. Share a calendar with it

1. Open <https://calendar.google.com/> as whichever Google account should
   own the delivery calendar (the office's real account, not the service
   account — service accounts can't be browsed to directly).
2. Either use an existing calendar or create a new one dedicated to
   deliveries (recommended — keeps delivery events out of personal
   calendars): left sidebar → **+** next to "Other calendars" → **Create
   new calendar**.
3. Hover that calendar → **⋮** → **Settings and sharing**.
4. Under **Share with specific people** → **Add people** → paste the
   service account's email → permission **Make changes to events** → **Send**.
5. Scroll to **Integrate calendar** → copy the **Calendar ID** (for a
   dedicated calendar it looks like a long string ending in
   `@group.calendar.google.com`; for your primary calendar it's just your
   email address).

## 5. Share a Drive folder with it

1. In <https://drive.google.com/> (same real Google account), create a
   folder — e.g. `Delivery Photos`.
2. Right-click it → **Share** → paste the service account's email →
   role **Editor** → **Send**.

   > A bare service account has ~0 bytes of its own Drive storage quota —
   > it can only write into a folder a real account owns and has shared
   > with it. This is that folder.
3. Open the folder and copy its **folder ID** from the URL:
   `https://drive.google.com/drive/folders/<THIS PART>`.

## 6. Set the environment variables in Railway

Railway → `accounting` service → **Variables** → add:

```
GOOGLE_SERVICE_ACCOUNT_JSON=<paste the entire downloaded .json file content, as one line>
GOOGLE_CALENDAR_ID=<the Calendar ID from step 4>
GOOGLE_DRIVE_ROOT_FOLDER_ID=<the folder ID from step 5>

# Optional — defaults to GOOGLE_CALENDAR_ID when that's an email address.
# Only needed if your Calendar ID is a @group.calendar.google.com one and
# you want delivery photos shared with a different specific person.
GOOGLE_DRIVE_SHARE_WITH=

# Optional — defaults to America/New_York. Affects how the delivery
# window's start/end times are written to the calendar event.
DELIVERY_TIMEZONE=America/New_York
```

Pasting the JSON: most Railway/clipboard tools preserve the file's
newlines inside `private_key` fine as long as you paste the whole file
content verbatim into one variable value (don't reformat it). If the
private key ever gets corrupted on paste (Calendar/Drive calls start
failing with an auth error in the logs), re-copy directly from the
downloaded `.json` file rather than retyping it.

Save. Railway redeploys automatically.

## 7. Verify

1. In the app, open any invoice with a delivery-service line item (or
   create one — see **Products & Services**, flag a line item "This is a
   delivery service").
2. Go to **Deliveries**, open that delivery, set a window and assign
   crew, click **Schedule**.
3. Check the Calendar you shared in step 4 — an event should appear with
   the invoice number, customer, and a "Subir foto de entrega" link in
   its description.
4. Open that link on a phone (or paste it in a browser), take a photo,
   tap **Entregado**.
5. Within a minute, refresh the calendar event — its description should
   now show a "✅ ENTREGADO" line with a working Drive link, and the
   photo should appear as an attachment on the event.
6. Check the Drive folder from step 5 — a `<year>/<week>` subfolder
   should contain `PO<invoice#>_1.jpg`.

If step 5 doesn't show the ENTREGADO line, check the Railway deploy logs
for `[google-calendar]` or `[google-drive]` warnings — they name exactly
what's missing or failing (unset env var, expired/revoked share, wrong
folder ID, etc.). The photo and the local record of the delivery are
never lost even if this step fails — see this file's intro.

## Cost

Both APIs are free for this volume (a few hundred events/uploads a
month is nowhere near any quota). No billing account is required to use
service accounts within Calendar/Drive API free limits.
