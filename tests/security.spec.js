const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const test = require("node:test");

function nextPort() {
  return 31000 + Math.floor(Math.random() * 20000);
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 15000;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }

    try {
      const res = await fetch(`${baseUrl}/api/server-info`, { cache: "no-store" });
      if (res.ok) return;
      lastError = new Error(`unexpected status ${res.status}`);
    } catch (err) {
      lastError = err;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw lastError || new Error("server did not start");
}

async function withServer(fn) {
  const port = nextPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      AUTO_RESCAN_MS: "86400000",
      PREVIEW_QUEUE_BATCH: "20",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });

  try {
    await waitForServer(baseUrl, child);
    await fn(baseUrl);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }

  return output;
}

test("public library response does not expose local scan paths", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/library`, { cache: "no-store" });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(Object.hasOwn(body, "scanPaths"), false);
    assert.equal(Object.hasOwn(body, "excludePaths"), false);
  });
});

test("unsafe API requests reject cross-origin browser submissions", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/rescan`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
      },
    });

    assert.equal(res.status, 403);
  });
});

test("responses include baseline security headers", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/server-info`, { cache: "no-store" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.has("x-powered-by"), false);
  });
});
