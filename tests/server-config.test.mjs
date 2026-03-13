import test from "node:test";
import assert from "node:assert/strict";

import { verifyPassword } from "../auth.js";
import {
  isScryptHash,
  readEnvValue,
  resolveAdminPasswordConfig,
  resolveCookieSecureValue
} from "../server-config.js";

test("readEnvValue reads direct env first", () => {
  const value = readEnvValue("ADMIN_PASSWORD", { ADMIN_PASSWORD: "plain-123" });
  assert.equal(value, "plain-123");
});

test("readEnvValue reads from *_FILE when direct env missing", () => {
  const env = { ADMIN_PASSWORD_FILE: "/tmp/fake-admin-password" };
  const value = readEnvValue("ADMIN_PASSWORD", env, (path) => {
    assert.equal(path, "/tmp/fake-admin-password");
    return "from-file\n";
  });

  assert.equal(value, "from-file");
});

test("resolveAdminPasswordConfig prioritizes hash over raw", () => {
  const config = resolveAdminPasswordConfig({
    ADMIN_PASSWORD_HASH: "scrypt$abc$def",
    ADMIN_PASSWORD: "raw-pass"
  });

  assert.equal(config.source, "hash");
  assert.equal(config.passwordHash, "scrypt$abc$def");
});

test("resolveAdminPasswordConfig auto-hashes plaintext password", () => {
  const config = resolveAdminPasswordConfig({ ADMIN_PASSWORD: "my-plain-password" });

  assert.equal(config.source, "raw");
  assert.ok(config.passwordHash.startsWith("scrypt$"));
  assert.equal(verifyPassword("my-plain-password", config.passwordHash), true);
  assert.equal(verifyPassword("wrong-password", config.passwordHash), false);
});

test("resolveAdminPasswordConfig rejects malformed hash", () => {
  assert.throws(
    () =>
      resolveAdminPasswordConfig({
        ADMIN_PASSWORD_HASH: "not-a-valid-hash"
      }),
    /ADMIN_PASSWORD_HASH format is invalid/
  );
});

test("resolveAdminPasswordConfig treats whitespace-only raw password as missing", () => {
  const config = resolveAdminPasswordConfig({ ADMIN_PASSWORD: "   " });
  assert.equal(config.source, "none");
  assert.equal(config.passwordHash, "");
});

test("isScryptHash validates expected format", () => {
  assert.equal(isScryptHash("scrypt$abc123$ff00"), true);
  assert.equal(isScryptHash("scrypt$abc123$gg"), false);
  assert.equal(isScryptHash("bad$abc$ff"), false);
});

test("resolveCookieSecureValue supports true false auto", () => {
  assert.equal(resolveCookieSecureValue("true"), true);
  assert.equal(resolveCookieSecureValue("false"), false);
  assert.equal(resolveCookieSecureValue("auto"), "auto");
  assert.equal(resolveCookieSecureValue(undefined), "auto");
});
