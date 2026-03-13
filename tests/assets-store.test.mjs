import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { createAssetsStore } from "../assets-store.js";

test("assets store writes and reads assets", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-assets-"));
  const store = createAssetsStore(dir, "admin");

  const input = [
    { symbol: "jepq", weightPct: 40, priceUsd: 56.86 },
    { symbol: "schd", weightPct: 60, priceUsd: 31 }
  ];
  await store.writeUserAssets("admin", input);
  const output = await store.readUserAssets("admin");

  assert.deepEqual(output, [
    { symbol: "JEPQ", weightPct: 40, priceUsd: 56.86 },
    { symbol: "SCHD", weightPct: 60, priceUsd: 31 }
  ]);
});

test("assets store creates atomic file payload", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-assets-"));
  const store = createAssetsStore(dir, "admin");

  await store.writeUserAssets("admin", [{ symbol: "O", weightPct: 100, priceUsd: 67 }]);
  const raw = await readFile(path.join(dir, "assets.json"), "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.users.admin[0].symbol, "O");
});

test("assets store rejects non-array values", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-assets-"));
  const store = createAssetsStore(dir, "admin");

  await assert.rejects(
    async () => store.writeUserAssets("admin", { bad: true }),
    /assets must be an array/
  );
});

test("assets store isolates data by username", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "etf-assets-"));
  const store = createAssetsStore(dir, "admin");

  await store.writeUserAssets("alice", [{ symbol: "SPY", weightPct: 100, priceUsd: 500 }]);
  await store.writeUserAssets("bob", [{ symbol: "QQQ", weightPct: 100, priceUsd: 430 }]);

  const alice = await store.readUserAssets("alice");
  const bob = await store.readUserAssets("bob");

  assert.deepEqual(alice, [{ symbol: "SPY", weightPct: 100, priceUsd: 500 }]);
  assert.deepEqual(bob, [{ symbol: "QQQ", weightPct: 100, priceUsd: 430 }]);
});
