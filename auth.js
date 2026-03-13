import crypto from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(plainText, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(plainText, salt, KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plainText, encodedValue) {
  if (typeof encodedValue !== "string") {
    return false;
  }

  const parts = encodedValue.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const [, salt, expectedHex] = parts;
  const currentHex = crypto.scryptSync(plainText, salt, KEY_LENGTH).toString("hex");

  const expected = Buffer.from(expectedHex, "hex");
  const current = Buffer.from(currentHex, "hex");

  if (expected.length !== current.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, current);
}
