import { readFileSync } from "node:fs";

import { hashPassword } from "./auth.js";

function defaultReadFile(path) {
  return readFileSync(path, "utf8");
}

export function readEnvValue(name, env = process.env, readFile = defaultReadFile) {
  const direct = env[name];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }

  const filePath = env[`${name}_FILE`];
  if (typeof filePath === "string" && filePath.length > 0) {
    try {
      return readFile(filePath).trim();
    } catch {
      return "";
    }
  }

  return "";
}

export function isScryptHash(value) {
  return /^scrypt\$[a-z0-9]+\$[a-f0-9]+$/i.test(String(value || ""));
}

export function resolveAdminPasswordConfig(env = process.env, readFile = defaultReadFile) {
  const hashed = readEnvValue("ADMIN_PASSWORD_HASH", env, readFile).trim();
  if (hashed) {
    if (!isScryptHash(hashed)) {
      throw new Error("ADMIN_PASSWORD_HASH format is invalid. Expected scrypt$<salt>$<hex>");
    }

    return {
      passwordHash: hashed,
      source: "hash"
    };
  }

  const raw = readEnvValue("ADMIN_PASSWORD", env, readFile);
  if (raw.trim().length > 0) {
    return {
      passwordHash: hashPassword(raw),
      source: "raw"
    };
  }

  return {
    passwordHash: "",
    source: "none"
  };
}

export function resolveCookieSecureValue(value) {
  const normalized = String(value || "auto").toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return "auto";
}
