import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function asFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function assertUsername(username) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) {
    throw new Error("username format is invalid");
  }
  return normalized;
}

function normalizeAssets(assets) {
  if (!Array.isArray(assets)) {
    throw new Error("assets must be an array");
  }

  if (assets.length > 60) {
    throw new Error("assets length exceeds limit");
  }

  return assets.map((asset) => ({
    symbol: String(asset?.symbol || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z.\-]/g, "")
      .slice(0, 10),
    weightPct: asFiniteNumber(asset?.weightPct),
    priceUsd: asFiniteNumber(asset?.priceUsd)
  }));
}

function normalizeStoreShape(parsed, legacyOwnerUsername) {
  const owner = assertUsername(legacyOwnerUsername);

  if (Array.isArray(parsed)) {
    return {
      version: 2,
      users: {
        [owner]: normalizeAssets(parsed)
      }
    };
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("assets file has invalid structure");
  }

  const users = parsed.users;
  if (!users || typeof users !== "object" || Array.isArray(users)) {
    throw new Error("assets file has invalid users object");
  }

  const normalizedUsers = {};
  for (const [username, value] of Object.entries(users)) {
    const key = normalizeUsername(username);
    if (!key) {
      continue;
    }
    normalizedUsers[key] = normalizeAssets(value);
  }

  return {
    version: 2,
    users: normalizedUsers
  };
}

export function createAssetsStore(dataDir, legacyOwnerUsername = "admin") {
  const assetsFilePath = path.join(dataDir, "assets.json");

  async function ensureDir() {
    await mkdir(dataDir, { recursive: true });
  }

  async function readStore() {
    await ensureDir();

    try {
      const raw = await readFile(assetsFilePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeStoreShape(parsed, legacyOwnerUsername);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { version: 2, users: {} };
      }

      if (error instanceof SyntaxError) {
        throw new Error("assets file is corrupted JSON");
      }

      throw error;
    }
  }

  async function writeStore(store) {
    await ensureDir();
    const payload = JSON.stringify(store, null, 2);
    const tempFilePath = path.join(
      dataDir,
      `assets.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    );
    await writeFile(tempFilePath, payload, "utf8");
    await rename(tempFilePath, assetsFilePath);
    return store;
  }

  async function readUserAssets(username) {
    const key = assertUsername(username);
    const store = await readStore();
    return normalizeAssets(store.users[key] || []);
  }

  async function writeUserAssets(username, assets) {
    const key = assertUsername(username);
    const normalizedAssets = normalizeAssets(assets);
    const store = await readStore();
    store.users[key] = normalizedAssets;
    await writeStore(store);
    return normalizedAssets;
  }

  return {
    readUserAssets,
    writeUserAssets,
    assetsFilePath
  };
}

const dataDir = process.env.DATA_DIR || "/tmp/etf-dashboard-data";
const legacyOwner = process.env.ADMIN_USERNAME || "admin";
const defaultStore = createAssetsStore(dataDir, legacyOwner);

export async function readPersistedAssets(username) {
  return defaultStore.readUserAssets(username);
}

export async function writePersistedAssets(username, assets) {
  return defaultStore.writeUserAssets(username, assets);
}
