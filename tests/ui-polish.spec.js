const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

test("viewer pages expose polish hooks for toolbar and status chips", () => {
  const desktop = fs.readFileSync("public/desktop.html", "utf8");
  const mobile = fs.readFileSync("public/mobile.html", "utf8");
  const viewer = fs.readFileSync("public/viewer.js", "utf8");

  for (const html of [desktop, mobile]) {
    assert.match(html, /class="topbar panel app-toolbar"/);
    assert.match(html, /id="status-text"[^>]+class="muted status-strip"/);
  }

  assert.match(viewer, /function\s+renderStatusChips\s*\(/);
  assert.match(viewer, /status-chip/);
});

test("stylesheet includes media console polish primitives", () => {
  const css = fs.readFileSync("public/styles.css", "utf8");

  assert.match(css, /--surface-raised:/);
  assert.match(css, /\.app-toolbar\b/);
  assert.match(css, /\.status-strip\b/);
  assert.match(css, /\.status-chip\b/);
  assert.match(css, /\.media-list\.grid-mode\s+\.media-item\b/);
  assert.match(css, /\.viewer-overlay\s+\.overlay-panel\b/);
  assert.match(css, /backdrop-filter:/);
});
