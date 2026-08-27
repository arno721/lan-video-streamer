const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const test = require("node:test");

function nextPort() {
  return 35000 + Math.floor(Math.random() * 20000);
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

  try {
    await waitForServer(baseUrl, child);
    await fn(baseUrl);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

test("status endpoint returns lightweight index and preview state", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/status`, { cache: "no-store" });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(typeof body.generation, "number");
    assert.equal(typeof body.totalItems, "number");
    assert.equal(typeof body.totalSize, "number");
    assert.equal(typeof body.index, "object");
    assert.equal(typeof body.preview, "object");
    assert.equal(Object.hasOwn(body, "tree"), false);
    assert.equal(Object.hasOwn(body, "flatFolders"), false);
    assert.equal(Object.hasOwn(body, "scanPaths"), false);
    assert.equal(Object.hasOwn(body, "excludePaths"), false);
  });
});

test("path mutation routes queue rescans instead of awaiting scans", () => {
  const source = fs.readFileSync("server.js", "utf8");
  const handlers = [
    [
      source.indexOf('app.post("/api/scan-paths"'),
      source.indexOf('app.delete("/api/scan-paths"'),
      'startRescan("add-scan-path")',
    ],
    [
      source.indexOf('app.delete("/api/scan-paths"'),
      source.indexOf('app.post("/api/exclude-paths"'),
      'startRescan("remove-scan-path")',
    ],
    [
      source.indexOf('app.post("/api/exclude-paths"'),
      source.indexOf('app.delete("/api/exclude-paths"'),
      'startRescan("add-exclude-path")',
    ],
    [
      source.indexOf('app.delete("/api/exclude-paths"'),
      source.indexOf('app.post("/api/rescan"'),
      'startRescan("remove-exclude-path")',
    ],
  ];

  for (const [start, end, expectedCall] of handlers) {
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const handler = source.slice(start, end);
    assert.doesNotMatch(handler, /await\s+triggerRescan/);
    assert.match(handler, new RegExp(expectedCall.replace(/[()"]/g, "\\$&")));
  }
});

test("foreground preview generation uses the bounded preview queue", () => {
  const source = fs.readFileSync("server.js", "utf8");
  const start = source.indexOf("async function generatePreviewNow");
  const end = source.indexOf("function archiveEntryFromSevenZipRecord");
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const generatePreviewNow = source.slice(start, end);
  assert.doesNotMatch(generatePreviewNow, /runPreviewWorker/);
  assert.match(generatePreviewNow, /enqueuePreviewJob\(item,\s*\{[\s\S]*priority/);
  assert.match(generatePreviewNow, /waitForResult:\s*true/);
});

test("viewer polls lightweight status instead of the full library snapshot", () => {
  const source = fs.readFileSync("public/viewer.js", "utf8");
  assert.match(source, /fetch\('\/api\/status'/);
  assert.doesNotMatch(source, /setInterval\(\(\) => loadLib\(true\)/);
});

test("legacy frontend entry scripts are removed", () => {
  assert.equal(fs.existsSync("public/app.js"), false);
  assert.equal(fs.existsSync("public/desktop.js"), false);
  assert.equal(fs.existsSync("public/mobile.js"), false);
});
