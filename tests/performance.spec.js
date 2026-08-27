const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");
const test = require("node:test");

function nextPort() {
  return 33000 + Math.floor(Math.random() * 20000);
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

async function withServer(extraEnv, fn) {
  const port = nextPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      AUTO_RESCAN_MS: "86400000",
      PREVIEW_QUEUE_BATCH: "20",
      SCAN_CONCURRENCY: "",
      PREVIEW_THREADS: "",
      ...extraEnv,
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

test("default background concurrency favors responsiveness", async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/server-info`, { cache: "no-store" });
    assert.equal(res.status, 200);

    const body = await res.json();
    const cpuCount = Math.max(1, os.cpus().length);
    const expectedScanConcurrency = Math.max(2, Math.min(8, Math.ceil(cpuCount / 2)));
    const expectedPreviewThreads = Math.max(1, Math.min(2, Math.floor(cpuCount / 4) || 1));

    assert.equal(body.scan.concurrency, expectedScanConcurrency);
    assert.equal(body.preview.threads, expectedPreviewThreads);
  });
});

test("explicit background concurrency overrides are honored", async () => {
  await withServer({ SCAN_CONCURRENCY: "12", PREVIEW_THREADS: "5" }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/server-info`, { cache: "no-store" });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.scan.concurrency, 12);
    assert.equal(body.preview.threads, 5);
  });
});

test("viewer renders large folders in idle batches", () => {
  const source = fs.readFileSync("public/viewer.js", "utf8");

  assert.match(source, /let\s+folderRenderToken\s*=/);
  assert.match(source, /function\s+scheduleIdleWork\s*\(/);
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /function\s+renderItemsBatched\s*\(/);
  assert.match(source, /\+\+folderRenderToken/);
  assert.doesNotMatch(source, /host\.append\(itemList\(d\.items\)\)/);
});
