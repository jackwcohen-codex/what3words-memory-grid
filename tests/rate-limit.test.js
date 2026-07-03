const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const nodePath = process.execPath;
const port = 5199;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        headers: {
          "x-forwarded-for": "203.0.113.10",
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ body, headers: res.headers, statusCode: res.statusCode });
        });
      }
    );
    req.on("error", reject);
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }

    try {
      await request("/");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Timed out waiting for test server");
}

(async () => {
  const child = spawn(nodePath, ["server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: "ignore",
  });

  try {
    await waitForServer(child);

    for (let index = 0; index < 120; index += 1) {
      const response = await request("/api/address?lat=91&lng=0");
      assert.strictEqual(response.statusCode, 400);
      assert.strictEqual(response.headers["ratelimit-limit"], "120");
    }

    const limited = await request("/api/address?lat=91&lng=0");
    assert.strictEqual(limited.statusCode, 429);
    assert.match(limited.body, /Too many requests/);
    assert.strictEqual(limited.headers["ratelimit-remaining"], "0");
    assert.ok(Number(limited.headers["retry-after"]) > 0);

    console.log("Rate limit tests passed");
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
