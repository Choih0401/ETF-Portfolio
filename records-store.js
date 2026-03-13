import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function normalizeRecords(records) {
  if (!Array.isArray(records)) {
    throw new Error("records must be an array");
  }

  if (records.length > 1200) {
    throw new Error("records length exceeds limit");
  }

  return records;
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

function normalizeStoreShape(parsed, legacyOwnerUsername) {
  const owner = assertUsername(legacyOwnerUsername);

  if (Array.isArray(parsed)) {
    return {
      version: 2,
      users: {
        [owner]: normalizeRecords(parsed)
      }
    };
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("records file has invalid structure");
  }

  const users = parsed.users;
  if (!users || typeof users !== "object" || Array.isArray(users)) {
    throw new Error("records file has invalid users object");
  }

  const normalizedUsers = {};
  for (const [username, value] of Object.entries(users)) {
    const key = normalizeUsername(username);
    if (!key) {
      continue;
    }
    normalizedUsers[key] = normalizeRecords(value);
  }

  return {
    version: 2,
    users: normalizedUsers
  };
}

export function createRecordsStore(dataDir, legacyOwnerUsername = "admin") {
  const recordsFilePath = path.join(dataDir, "records.json");
  const tempFilePath = path.join(dataDir, "records.json.tmp");

  async function ensureDir() {
    await mkdir(dataDir, { recursive: true });
  }

  async function readStore() {
    await ensureDir();

    try {
      const raw = await readFile(recordsFilePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeStoreShape(parsed, legacyOwnerUsername);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { version: 2, users: {} };
      }

      if (error instanceof SyntaxError) {
        throw new Error("records file is corrupted JSON");
      }

      throw error;
    }
  }

  async function writeStore(store) {
    await ensureDir();
    const payload = JSON.stringify(store, null, 2);
    await writeFile(tempFilePath, payload, "utf8");
    await rename(tempFilePath, recordsFilePath);
    return store;
  }

  async function readUserRecords(username) {
    const key = assertUsername(username);
    const store = await readStore();
    return normalizeRecords(store.users[key] || []);
  }

  async function writeUserRecords(username, records) {
    const key = assertUsername(username);
    const normalizedRecords = normalizeRecords(records);
    const store = await readStore();
    store.users[key] = normalizedRecords;
    await writeStore(store);
    return normalizedRecords;
  }

  return {
    readUserRecords,
    writeUserRecords,
    recordsFilePath
  };
}

const dataDir = process.env.DATA_DIR || "/tmp/etf-dashboard-data";
const legacyOwner = process.env.ADMIN_USERNAME || "admin";
const defaultStore = createRecordsStore(dataDir, legacyOwner);

export async function readPersistedRecords(username) {
  return defaultStore.readUserRecords(username);
}

export async function writePersistedRecords(username, records) {
  return defaultStore.writeUserRecords(username, records);
}
