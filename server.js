import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPersistedRecords, writePersistedRecords } from "./records-store.js";
import {
  createUser,
  ensureBootstrapUser,
  verifyUserCredentials
} from "./users-store.js";
import {
  readEnvValue,
  resolveAdminPasswordConfig,
  resolveCookieSecureValue
} from "./server-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.set("trust proxy", 1);

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
let adminPasswordConfig;
try {
  adminPasswordConfig = resolveAdminPasswordConfig(process.env);
} catch (error) {
  console.error(`[startup error] ${error instanceof Error ? error.message : "Invalid password config"}`);
  process.exit(1);
}
const ADMIN_PASSWORD_HASH = adminPasswordConfig.passwordHash;
const SESSION_SECRET = readEnvValue("SESSION_SECRET") || "change-me-on-production";
const SESSION_COOKIE_SECURE_RAW = (process.env.SESSION_COOKIE_SECURE || "auto").toLowerCase();

const SESSION_COOKIE_SECURE = resolveCookieSecureValue(SESSION_COOKIE_SECURE_RAW);

if (adminPasswordConfig.source === "raw") {
  console.warn("[warning] ADMIN_PASSWORD is used. Prefer ADMIN_PASSWORD_HASH in production.");
}

if (!ADMIN_PASSWORD_HASH) {
  console.warn("[warning] No bootstrap admin credentials configured. Use /signup to create first account.");
}

if (SESSION_SECRET === "change-me-on-production") {
  console.warn("[warning] SESSION_SECRET is default. Set a long random secret in production.");
}

const loginAttempts = new Map();
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    name: "etf.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: SESSION_COOKIE_SECURE,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.ip || "unknown";
}

function getAttemptState(ip) {
  const now = Date.now();
  const found = loginAttempts.get(ip);

  if (!found || now - found.firstAttemptAt > ATTEMPT_WINDOW_MS) {
    const init = { count: 0, firstAttemptAt: now };
    loginAttempts.set(ip, init);
    return init;
  }

  return found;
}

function authRequired(req, res, next) {
  if (req.session?.authenticated) {
    return next();
  }
  return res.redirect("/login");
}

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get("/login", (req, res) => {
  if (req.session?.authenticated) {
    return res.redirect("/");
  }
  return res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/signup", (req, res) => {
  if (req.session?.authenticated) {
    return res.redirect("/");
  }
  return res.sendFile(path.join(__dirname, "signup.html"));
});

app.get("/login.css", (_req, res) => {
  return res.sendFile(path.join(__dirname, "login.css"));
});

app.get("/favicon.ico", (_req, res) => {
  return res.sendFile(path.join(__dirname, "favicon.ico"));
});

app.post("/login", async (req, res) => {
  const ip = getClientIp(req);
  const attempt = getAttemptState(ip);

  if (attempt.count >= ATTEMPT_LIMIT) {
    return res.redirect("/login?e=locked");
  }

  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const result = await verifyUserCredentials(username, password).catch(() => ({ ok: false }));

  if (!result.ok) {
    attempt.count += 1;
    loginAttempts.set(ip, attempt);
    return res.redirect("/login?e=invalid");
  }

  loginAttempts.delete(ip);
  req.session.authenticated = true;
  req.session.username = result.username;

  return req.session.save(() => {
    res.redirect("/");
  });
});

app.post("/signup", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  if (password !== confirmPassword) {
    return res.redirect("/signup?e=confirm");
  }

  try {
    const created = await createUser(username, password);
    req.session.authenticated = true;
    req.session.username = created.username;

    return req.session.save(() => {
      res.redirect("/");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message.includes("exists")) {
      return res.redirect("/signup?e=exists");
    }
    if (message.includes("username")) {
      return res.redirect("/signup?e=username");
    }
    if (message.includes("password")) {
      return res.redirect("/signup?e=password");
    }

    return res.redirect("/signup?e=unknown");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("etf.sid");
    res.redirect("/login");
  });
});

app.use(authRequired);

app.get("/api/records", async (req, res) => {
  const username = String(req.session?.username || "");

  try {
    const records = await readPersistedRecords(username);
    return res.status(200).json({ records });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to read records"
    });
  }
});

app.put("/api/records", async (req, res) => {
  const username = String(req.session?.username || "");
  const records = req.body?.records;

  if (!Array.isArray(records)) {
    return res.status(400).json({ error: "records must be an array" });
  }

  try {
    const saved = await writePersistedRecords(username, records);
    return res.status(200).json({ ok: true, count: saved.length });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to write records"
    });
  }
});

async function fetchStooqPrice(symbol) {
  const stooqCode = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqCode)}&f=sd2t2ohlcv&h&e=csv`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Stooq fetch failed: ${response.status}`);
  }

  const text = await response.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return null;
  }

  const row = lines[1].split(",");
  if (row.length < 7) {
    return null;
  }

  const close = Number(row[6]);
  if (!Number.isFinite(close) || close <= 0) {
    return null;
  }

  return close;
}

app.get("/api/quotes", async (req, res) => {
  const raw = String(req.query.symbols || "");
  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z.\-]{1,10}$/.test(symbol))
    .slice(0, 30);

  if (!symbols.length) {
    return res.status(400).json({ error: "symbols query is required" });
  }

  try {
    const fetched = await Promise.all(
      symbols.map(async (symbol) => {
        const price = await fetchStooqPrice(symbol);
        return { symbol, price };
      })
    );

    const prices = {};
    for (const row of fetched) {
      const symbol = String(row.symbol || "").toUpperCase();
      const price = Number(row.price);
      if (symbol && Number.isFinite(price) && price > 0) {
        prices[symbol] = price;
      }
    }

    return res.status(200).json({
      prices,
      asOf: new Date().toISOString(),
      source: "stooq-close"
    });
  } catch (error) {
    return res.status(502).json({
      error: error instanceof Error ? error.message : "Failed to fetch quotes"
    });
  }
});

app.use(express.static(__dirname));

async function startServer() {
  if (ADMIN_PASSWORD_HASH) {
    const created = await ensureBootstrapUser(ADMIN_USERNAME, ADMIN_PASSWORD_HASH);
    if (created) {
      console.log(`[startup] bootstrap account created: ${ADMIN_USERNAME}`);
    }
  }

  app.listen(PORT, () => {
    console.log(`ETF dashboard server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error(`[startup error] ${error instanceof Error ? error.message : "failed to start server"}`);
  process.exit(1);
});
