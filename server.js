const http = require("http");
const path = require("path");
const fs = require("fs/promises");

const PORT = Number(process.env.PORT || 5173);
const API_KEY = process.env.WHAT3WORDS_API_KEY;
const PUBLIC_DIR = path.join(__dirname, "public");
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || path.join(__dirname, "data", "leaderboard.json");
const W3W_BASE_URL = "https://api.what3words.com/v3";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimitBuckets = new Map();
const bannedNicknameParts = [
  "arse",
  "asshole",
  "bastard",
  "bitch",
  "bollock",
  "bollocks",
  "cunt",
  "dick",
  "fuck",
  "fuk",
  "motherfucker",
  "nazi",
  "prick",
  "pussy",
  "shit",
  "slut",
  "twat",
  "wank",
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.socket.remoteAddress || "unknown";
}

function checkRateLimit(req) {
  const now = Date.now();
  const clientIp = getClientIp(req);
  const bucket = rateLimitBuckets.get(clientIp);

  if (!bucket || now >= bucket.resetAt) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitBuckets.set(clientIp, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetAt,
    };
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.resetAt,
    };
  }

  bucket.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - bucket.count,
    resetAt: bucket.resetAt,
  };
}

function rateLimitHeaders(rateLimit) {
  const resetSeconds = Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
  return {
    "ratelimit-limit": String(RATE_LIMIT_MAX_REQUESTS),
    "ratelimit-remaining": String(rateLimit.remaining),
    "ratelimit-reset": String(resetSeconds),
  };
}

function pruneRateLimitBuckets() {
  const now = Date.now();
  for (const [clientIp, bucket] of rateLimitBuckets.entries()) {
    if (now >= bucket.resetAt) {
      rateLimitBuckets.delete(clientIp);
    }
  }
}

setInterval(pruneRateLimitBuckets, RATE_LIMIT_WINDOW_MS).unref();

function parseRequestBody(req, maxBytes = 10_000) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function normalizeNickname(rawNickname) {
  const nickname = String(rawNickname || "").trim().replace(/\s+/g, " ");

  if (nickname.length < 2 || nickname.length > 18) {
    throw new Error("Nickname must be 2 to 18 characters");
  }

  if (!/^[a-zA-Z0-9 _.-]+$/.test(nickname)) {
    throw new Error("Nickname can only use letters, numbers, spaces, dots, dashes, and underscores");
  }

  const compact = nickname.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (bannedNicknameParts.some((part) => compact.includes(part))) {
    throw new Error("Please choose a different nickname");
  }

  return nickname;
}

function normalizeScore(rawScore) {
  const score = Number(rawScore);

  if (!Number.isInteger(score) || score < 0 || score > 1_000_000) {
    throw new Error("Score must be a whole number between 0 and 1000000");
  }

  return score;
}

async function readLeaderboard() {
  try {
    const raw = await fs.readFile(LEADERBOARD_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeLeaderboard(entries) {
  await fs.mkdir(path.dirname(LEADERBOARD_FILE), { recursive: true });
  await fs.writeFile(
    LEADERBOARD_FILE,
    `${JSON.stringify({ entries }, null, 2)}\n`,
    "utf8"
  );
}

function rankLeaderboard(entries) {
  return [...entries]
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))
    .slice(0, 10)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function handleLeaderboard(req, res) {
  if (req.method === "GET") {
    const entries = rankLeaderboard(await readLeaderboard());
    sendJson(res, 200, { entries });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" }, { allow: "GET, POST" });
    return;
  }

  const body = await parseRequestBody(req);
  const nickname = normalizeNickname(body.nickname);
  const score = normalizeScore(body.score);
  const now = new Date().toISOString();
  const entries = await readLeaderboard();
  const existing = entries.find((entry) => entry.nickname.toLowerCase() === nickname.toLowerCase());

  if (existing) {
    existing.nickname = nickname;
    existing.score = Math.max(existing.score, score);
    existing.updatedAt = now;
  } else {
    entries.push({ nickname, score, updatedAt: now });
  }

  await writeLeaderboard(rankLeaderboard(entries));
  sendJson(res, 200, { entries: rankLeaderboard(entries) });
}

function normalizeBBox(rawBBox) {
  const values = String(rawBBox || "")
    .split(",")
    .map((value) => Number(value.trim()));

  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("bbox must be four comma-separated numbers: south,west,north,east");
  }

  const [south, west, north, east] = values;
  if (south < -90 || north > 90 || south >= north) {
    throw new Error("bbox latitude values are invalid");
  }

  const latMeters = (north - south) * 111_320;
  const midLat = ((north + south) / 2) * (Math.PI / 180);
  const lngMeters = Math.abs(east - west) * 111_320 * Math.max(Math.cos(midLat), 0.01);
  const diagonalKm = Math.sqrt(latMeters ** 2 + lngMeters ** 2) / 1000;

  if (diagonalKm > 4) {
    throw new Error("bbox must be no more than 4km corner-to-corner");
  }

  return values.join(",");
}

function normalizeCoordinate(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a number`);
  }
  return number;
}

async function callWhat3Words(endpoint, params) {
  if (!API_KEY) {
    const error = new Error("WHAT3WORDS_API_KEY is not configured");
    error.status = 500;
    throw error;
  }

  const url = new URL(`${W3W_BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", API_KEY);

  const response = await fetch(url);
  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text };
  }

  if (!response.ok) {
    const error = new Error(body?.error?.message || body?.message || "what3words request failed");
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/grid" || url.pathname === "/api/address" || url.pathname === "/api/leaderboard") {
      const rateLimit = checkRateLimit(req);
      const headers = rateLimitHeaders(rateLimit);

      if (!rateLimit.allowed) {
        sendJson(
          res,
          429,
          { error: "Too many requests. Please wait a moment and try again." },
          { ...headers, "retry-after": headers["ratelimit-reset"] }
        );
        return;
      }

      res.setHeader("ratelimit-limit", headers["ratelimit-limit"]);
      res.setHeader("ratelimit-remaining", headers["ratelimit-remaining"]);
      res.setHeader("ratelimit-reset", headers["ratelimit-reset"]);
    }

    if (url.pathname === "/api/leaderboard") {
      await handleLeaderboard(req, res);
      return;
    }

    if (url.pathname === "/api/grid") {
      const bbox = normalizeBBox(url.searchParams.get("bbox"));
      const data = await callWhat3Words("grid-section", {
        "bounding-box": bbox,
        format: "geojson",
      });
      sendJson(res, 200, data);
      return;
    }

    if (url.pathname === "/api/address") {
      const lat = normalizeCoordinate(url.searchParams.get("lat"), "lat");
      const lng = normalizeCoordinate(url.searchParams.get("lng"), "lng");
      if (lat < -90 || lat > 90) {
        throw new Error("lat must be between -90 and 90");
      }
      const data = await callWhat3Words("convert-to-3wa", {
        coordinates: `${lat},${lng}`,
        language: "en",
        format: "json",
      });
      sendJson(res, 200, data);
      return;
    }

    sendJson(res, 404, { error: "Unknown API route" });
  } catch (error) {
    sendJson(res, error.status || 400, {
      error: error.message,
      details: error.details,
    });
  }
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`what3words Memory Grid Game running at http://localhost:${PORT}`);
});
