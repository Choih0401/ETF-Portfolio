import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { createRecordsStore } from "../records-store.js";

test("records store writes and reads records", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-records-"));
  const store = createRecordsStore(dir, "admin");

  const input = [{ id: "a1", monthLabel: "2026-03" }];
  await store.writeUserRecords("admin", input);
  const output = await store.readUserRecords("admin");

  assert.deepEqual(output, input);
});

test("records store creates atomic file payload", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-records-"));
  const store = createRecordsStore(dir, "admin");

  await store.writeUserRecords("admin", [{ id: "b1", monthLabel: "2026-04" }]);
  const raw = await readFile(path.join(dir, "records.json"), "utf8");
  const parsed = JSON.parse(raw);
  assert.ok(parsed.users.admin[0].monthLabel === "2026-04");
});

test("records store rejects non-array values", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-records-"));
  const store = createRecordsStore(dir, "admin");

  await assert.rejects(
    async () => store.writeUserRecords("admin", { bad: true }),
    /records must be an array/
  );
});

test("records store isolates data by username", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-records-"));
  const store = createRecordsStore(dir, "admin");

  await store.writeUserRecords("alice", [{ id: "a" }]);
  await store.writeUserRecords("bob", [{ id: "b" }]);

  const alice = await store.readUserRecords("alice");
  const bob = await store.readUserRecords("bob");

  assert.deepEqual(alice, [{ id: "a" }]);
  assert.deepEqual(bob, [{ id: "b" }]);
});
