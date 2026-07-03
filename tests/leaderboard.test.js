const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs/promises");

const repoRoot = path.join(__dirname, "..");
const nodePath = process.execPath;
const port = 5200;
const leaderboardFile = path.join(repoRoot, "work", "test-leaderboard.json");

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: options.method || "GET",
        headers: {
          "content-type": "application/json",
          "content-length": body ? Buffer.byteLength(body) : 0,
          "x-forwarded-for": "203.0.113.11",
        },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          let parsedBody = {};
          try {
            parsedBody = responseBody ? JSON.parse(responseBody) : {};
          } catch {
            parsedBody = responseBody;
          }

          resolve({
            body: parsedBody,
            statusCode: res.statusCode,
          });
        });
      }
    );
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
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
  await fs.rm(leaderboardFile, { force: true });

  const child = spawn(nodePath, ["server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LEADERBOARD_FILE: leaderboardFile,
      PORT: String(port),
    },
    stdio: "ignore",
  });

  try {
    await waitForServer(child);

    const first = await request("/api/leaderboard", {
      method: "POST",
      body: { nickname: "Jack", score: 250 },
    });
    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(first.body.entries[0].nickname, "Jack");
    assert.strictEqual(first.body.entries[0].score, 250);

    const lowerScore = await request("/api/leaderboard", {
      method: "POST",
      body: { nickname: "jack", score: 100 },
    });
    assert.strictEqual(lowerScore.statusCode, 200);
    assert.strictEqual(lowerScore.body.entries[0].score, 250);

    const higherScore = await request("/api/leaderboard", {
      method: "POST",
      body: { nickname: "Mae", score: 500 },
    });
    assert.strictEqual(higherScore.statusCode, 200);
    assert.strictEqual(higherScore.body.entries[0].nickname, "Mae");
    assert.strictEqual(higherScore.body.entries[0].rank, 1);

    const blocked = await request("/api/leaderboard", {
      method: "POST",
      body: { nickname: "badshitname", score: 999 },
    });
    assert.strictEqual(blocked.statusCode, 400);
    assert.match(blocked.body.error, /different nickname/);

    console.log("Leaderboard tests passed");
  } finally {
    child.kill();
    await fs.rm(leaderboardFile, { force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
