const http = require("http");
const path = require("path");
const fs = require("fs/promises");

const PORT = Number(process.env.PORT || 5173);
const API_KEY = process.env.WHAT3WORDS_API_KEY;
const PUBLIC_DIR = path.join(__dirname, "public");
const W3W_BASE_URL = "https://api.what3words.com/v3";
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const rateLimitBuckets = new Map();

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
    if (url.pathname === "/api/grid" || url.pathname === "/api/address") {
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
