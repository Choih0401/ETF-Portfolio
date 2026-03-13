import test from "node:test";
import assert from "node:assert/strict";

import { hashPassword, verifyPassword } from "../auth.js";

test("hashPassword creates scrypt encoded value", () => {
  const encoded = hashPassword("hello123");
  assert.ok(encoded.startsWith("scrypt$"));
  assert.equal(encoded.split("$").length, 3);
});

test("verifyPassword returns true only for correct password", () => {
  const encoded = hashPassword("my-password");
  assert.equal(verifyPassword("my-password", encoded), true);
  assert.equal(verifyPassword("wrong-password", encoded), false);
  assert.equal(verifyPassword("my-password", "bad-format"), false);
});
