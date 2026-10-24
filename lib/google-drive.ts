import { google } from "googleapis";
import { getWeek } from "date-fns";

/**
 * Google Drive write-back for delivery photos (spec §3): a service account
 * uploads into a folder tree the office owns and has shared with it --
 * `Delivery Photos / <year> / <week of year> / PO<invoice#>_<n>.jpg`.
 *
 * Degrades to a no-op (returns null, logs once) when not configured, so a
 * delivery can always be marked Delivered from the public link even if
 * Google credentials are missing or Drive is briefly unreachable -- the
 * local copy (lib/delivery-storage.ts) is always the real, non-optional
 * record; Drive is a best-effort mirror the calendar event links to.
 */

let warnedMissingConfig = false;
function warnOnce(msg: string) {
  if (warnedMissingConfig) return;
  warnedMissingConfig = true;
  console.warn(`[google-drive] ${msg}`);
}

function getCredentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!parsed.client_email || !parsed.private_key) return null;
    // Railway/most env-var UIs store newlines escaped -- unescape them, same
    // as every other "paste a PEM key into an env var" integration.
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

function getDriveClient() {
  const creds = getCredentials();
  if (!creds) {
    warnOnce("GOOGLE_SERVICE_ACCOUNT_JSON not set (or invalid) -- Drive upload disabled, photos stay local-only.");
    return null;
  }
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

const folderIdCache = new Map<string, string>();

/**
 * Finds-or-creates the `<year>/<week>` subfolder chain under
 * GOOGLE_DRIVE_ROOT_FOLDER_ID (which must already exist and be shared
 * "Editor" with the service account's client_email -- a bare service
 * account has ~0 bytes of its own Drive quota, so it can only write into a
 * folder a real account owns and has shared with it; see
 * GOOGLE_CALENDAR_DRIVE_SETUP.md).
 */
async function ensureDeliveryPhotoFolder(date: Date): Promise<string | null> {
  const drive = getDriveClient();
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!drive || !rootId) {
    if (!rootId) warnOnce("GOOGLE_DRIVE_ROOT_FOLDER_ID not set -- Drive upload disabled.");
    return null;
  }

  const year = String(date.getFullYear());
  const week = String(getWeek(date));
  const cacheKey = `${year}/${week}`;
  const cached = folderIdCache.get(cacheKey);
  if (cached) return cached;

  try {
    const yearId = await findOrCreateFolder(drive, year, rootId);
    const weekId = await findOrCreateFolder(drive, week, yearId);
    folderIdCache.set(cacheKey, weekId);
    return weekId;
  } catch (e) {
    console.error("[google-drive] failed to ensure folder tree:", e);
    return null;
  }
}

async function findOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId: string
): Promise<string> {
  const escapedName = name.replace(/'/g, "\\'");
  const existing = await drive.files.list({
    q: `name = '${escapedName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive",
  });
  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Drive did not return an id for new folder "${name}"`);
  return created.data.id;
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
}

/**
 * Uploads one delivery photo and names it `PO<invoiceNumber>_<n>.jpg` per
 * spec §3. Grants read access to GOOGLE_DRIVE_SHARE_WITH (defaults to
 * GOOGLE_CALENDAR_ID when that looks like an email) so the calendar owner
 * can actually open the file the event links to -- a service-account upload
 * is private to the service account by default.
 */
export async function uploadDeliveryPhoto(
  buffer: Buffer,
  invoiceNumber: string,
  index: number,
  mimeType: string,
  deliveredAt: Date
): Promise<DriveUploadResult | null> {
  const drive = getDriveClient();
  if (!drive) return null;

  const folderId = await ensureDeliveryPhotoFolder(deliveredAt);
  if (!folderId) return null;

  const ext = mimeType === "image/png" ? "png" : "jpg";
  const name = `PO${invoiceNumber}_${index}.${ext}`;

  try {
    const { Readable } = await import("stream");
    const created = await drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: "id, webViewLink",
    });
    const fileId = created.data.id;
    if (!fileId) return null;

    const shareWith = process.env.GOOGLE_DRIVE_SHARE_WITH || process.env.GOOGLE_CALENDAR_ID;
    if (shareWith && shareWith.includes("@")) {
      await drive.permissions
        .create({
          fileId,
          requestBody: { role: "reader", type: "user", emailAddress: shareWith },
          sendNotificationEmail: false,
        })
        .catch((e) => console.error("[google-drive] failed to share photo with calendar owner:", e));
    }

    const webViewLink = created.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
    return { fileId, webViewLink };
  } catch (e) {
    console.error("[google-drive] photo upload failed:", e);
    return null;
  }
}
