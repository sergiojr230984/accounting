import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { getUploadDir, ensureUploadDir } from "./upload";

// Separate allow-list from lib/upload.ts (invoice attachments: PDF/JPG/PNG/
// CSV/XLS) -- this file only ever handles what the public delivery-photo
// page can produce: a client-compressed JPEG, or a recorded voice note.
const PHOTO_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
};
const VOICE_MIME_TYPES: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
};

const MAX_PHOTO_SIZE = 8 * 1024 * 1024; // 8MB -- generous even though the client compresses to ~2000px edge first
const MAX_VOICE_SIZE = 15 * 1024 * 1024; // 15MB, a few minutes of spoken audio

export interface SavedFile {
  /** Basename only (uuid + extension) -- mirrors UploadedFile.storedName. */
  storedName: string;
  /** Relative to UPLOAD_DIR, e.g. "deliveries/photos/<uuid>.jpg" -- what DeliveryPhoto.path stores and what app/api/deliveries/photos/[id]/route.ts reads from disk. Deliberately NOT web-servable directly (no assumption that UPLOAD_DIR sits under public/): that route auth-gates every read, since delivery photos (a customer's address, their home) are more sensitive than this app's existing public/uploads convention was designed for. */
  relativePath: string;
}

export function validatePhoto(mimeType: string, size: number): { ok: boolean; error?: string } {
  if (!(mimeType in PHOTO_MIME_TYPES)) {
    return { ok: false, error: "Tipo de foto no permitido. Usa JPG o PNG." };
  }
  if (size > MAX_PHOTO_SIZE) {
    return { ok: false, error: "Foto demasiado grande." };
  }
  return { ok: true };
}

export function validateVoiceNote(mimeType: string, size: number): { ok: boolean; error?: string } {
  if (!(mimeType in VOICE_MIME_TYPES)) {
    return { ok: false, error: "Tipo de audio no permitido." };
  }
  if (size > MAX_VOICE_SIZE) {
    return { ok: false, error: "Nota de voz demasiado grande." };
  }
  return { ok: true };
}

async function saveBuffer(buffer: Buffer, ext: string, subdir: string): Promise<SavedFile> {
  const baseDir = await ensureUploadDir();
  const dir = path.join(baseDir, subdir);
  await fs.mkdir(dir, { recursive: true });
  const storedName = `${randomUUID()}${ext}`;
  const filePath = path.join(dir, storedName);
  await fs.writeFile(filePath, buffer);
  return { storedName, relativePath: path.join(subdir, storedName) };
}

export async function saveDeliveryPhoto(buffer: Buffer, mimeType: string): Promise<SavedFile> {
  const ext = PHOTO_MIME_TYPES[mimeType] ?? ".jpg";
  return saveBuffer(buffer, ext, "deliveries/photos");
}

export async function saveDeliveryVoiceNote(buffer: Buffer, mimeType: string): Promise<SavedFile> {
  const ext = VOICE_MIME_TYPES[mimeType] ?? ".webm";
  return saveBuffer(buffer, ext, "deliveries/voice");
}

export function deliveryFileAbsolutePath(relativePath: string): string {
  return path.join(getUploadDir(), relativePath);
}
