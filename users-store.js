import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashPassword, verifyPassword } from "./auth.js";

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function assertValidUsername(username) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) {
    throw new Error("username format is invalid");
  }
  return normalized;
}

function assertValidPassword(password) {
  const text = String(password || "");
  if (text.length < 8 || text.length > 128) {
    throw new Error("password length must be 8-128");
  }
  return text;
}

function normalizeUsersShape(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("users file has invalid structure");
  }

  const users = parsed.users;
  if (!users || typeof users !== "object" || Array.isArray(users)) {
    throw new Error("users file has invalid users object");
  }

  const normalized = {};
  for (const [username, user] of Object.entries(users)) {
    const key = normalizeUsername(username);
    if (!key || !user || typeof user !== "object") {
      continue;
    }

    const passwordHash = String(user.passwordHash || "");
    if (!passwordHash) {
      continue;
    }

    normalized[key] = {
      passwordHash,
      createdAt: String(user.createdAt || new Date().toISOString())
    };
  }

  return {
    version: 1,
    users: normalized
  };
}

export function createUsersStore(dataDir) {
  const usersFilePath = path.join(dataDir, "users.json");
  const tempFilePath = path.join(dataDir, "users.json.tmp");

  async function ensureDir() {
    await mkdir(dataDir, { recursive: true });
  }

  async function readStore() {
    await ensureDir();

    try {
      const raw = await readFile(usersFilePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeUsersShape(parsed);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { version: 1, users: {} };
      }

      if (error instanceof SyntaxError) {
        throw new Error("users file is corrupted JSON");
      }

      throw error;
    }
  }

  async function writeStore(store) {
    await ensureDir();
    const payload = JSON.stringify(store, null, 2);
    await writeFile(tempFilePath, payload, "utf8");
    await rename(tempFilePath, usersFilePath);
    return store;
  }

  async function ensureBootstrapUser(username, passwordHash) {
    const normalized = normalizeUsername(username);
    const hash = String(passwordHash || "");
    if (!normalized || !hash) {
      return false;
    }

    const store = await readStore();
    if (store.users[normalized]) {
      return false;
    }

    store.users[normalized] = {
      passwordHash: hash,
      createdAt: new Date().toISOString()
    };
    await writeStore(store);
    return true;
  }

  async function createUser(username, password) {
    const key = assertValidUsername(username);
    const plain = assertValidPassword(password);
    const store = await readStore();

    if (store.users[key]) {
      throw new Error("username already exists");
    }

    store.users[key] = {
      passwordHash: hashPassword(plain),
      createdAt: new Date().toISOString()
    };
    await writeStore(store);

    return { username: key };
  }

  async function verifyUserCredentials(username, password) {
    const key = normalizeUsername(username);
    const plain = String(password || "");
    if (!key || !plain) {
      return { ok: false };
    }

    const store = await readStore();
    const user = store.users[key];
    if (!user) {
      return { ok: false };
    }

    const ok = verifyPassword(plain, user.passwordHash);
    return ok ? { ok: true, username: key } : { ok: false };
  }

  return {
    ensureBootstrapUser,
    createUser,
    verifyUserCredentials,
    usersFilePath
  };
}

const dataDir = process.env.DATA_DIR || "/tmp/etf-dashboard-data";
const defaultStore = createUsersStore(dataDir);

export async function ensureBootstrapUser(username, passwordHash) {
  return defaultStore.ensureBootstrapUser(username, passwordHash);
}

export async function createUser(username, password) {
  return defaultStore.createUser(username, password);
}

export async function verifyUserCredentials(username, password) {
  return defaultStore.verifyUserCredentials(username, password);
}
