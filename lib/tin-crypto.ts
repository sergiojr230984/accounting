import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_HEX = process.env.TIN_ENCRYPTION_KEY ?? "";

function getKey(): Buffer {
  if (!KEY_HEX || KEY_HEX.length < 64) {
    throw new Error(
      "TIN_ENCRYPTION_KEY env var is missing or too short. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(KEY_HEX, "hex");
}

/** Encrypts a TIN string → base64 encoded `iv:authTag:ciphertext` */
export function encryptTin(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/** Decrypts a `iv:authTag:ciphertext` string → plaintext TIN */
export function decryptTin(stored: string): string {
  const key = getKey();
  const [ivB64, authTagB64, ciphertextB64] = stored.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) throw new Error("Invalid encrypted TIN format");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Returns masked TIN for non-Admin display: ***-**-1234 */
export function maskTin(plaintext: string): string {
  const digits = plaintext.replace(/\D/g, "");
  if (digits.length === 9) {
    return `***-**-${digits.slice(-4)}`;
  }
  return `****${digits.slice(-4)}`;
}
