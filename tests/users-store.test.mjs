import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { hashPassword } from "../auth.js";
import { createUsersStore } from "../users-store.js";

test("users store creates and verifies user credentials", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-users-"));
  const store = createUsersStore(dir);

  const created = await store.createUser("alice", "strong-pass-123");
  assert.equal(created.username, "alice");

  const ok = await store.verifyUserCredentials("alice", "strong-pass-123");
  const bad = await store.verifyUserCredentials("alice", "wrong");

  assert.equal(ok.ok, true);
  assert.equal(ok.username, "alice");
  assert.equal(bad.ok, false);
});

test("users store rejects duplicate usernames", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-users-"));
  const store = createUsersStore(dir);

  await store.createUser("dup", "strong-pass-123");
  await assert.rejects(async () => store.createUser("dup", "strong-pass-123"), /exists/);
});

test("users store can bootstrap admin user", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-users-"));
  const store = createUsersStore(dir);
  const hash = hashPassword("bootstrap-pass-123");

  const created = await store.ensureBootstrapUser("admin", hash);
  const createdAgain = await store.ensureBootstrapUser("admin", hash);
  const verified = await store.verifyUserCredentials("admin", "bootstrap-pass-123");

  assert.equal(created, true);
  assert.equal(createdAgain, false);
  assert.equal(verified.ok, true);
});
