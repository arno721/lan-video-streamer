# Performance Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce default background work and make large folder interactions render sooner.

**Architecture:** Keep the existing Express server and static viewer structure. Add small helper functions for backend integer runtime defaults and frontend batched rendering, then cover both with Node test runner tests.

**Tech Stack:** Node.js, Express, built-in `node:test`, browser DOM APIs in `public/viewer.js`.

---

## File Structure

- Modify `server.js`: lower default scan/preview concurrency and keep environment overrides.
- Modify `public/viewer.js`: add batched item rendering and stale-render cancellation.
- Modify `package.json`: keep the existing `npm test` entry created by the security work.
- Create `tests/performance.spec.js`: integration tests for concurrency defaults/overrides and static tests for frontend batching hooks.

### Task 1: Backend Concurrency Defaults

**Files:**
- Modify: `server.js`
- Create: `tests/performance.spec.js`

- [ ] **Step 1: Write the failing backend tests**

Add tests that start the server without concurrency overrides and assert default scan concurrency is at most half the CPU count capped at 8, preview threads are at most 2, and explicit overrides are still honored.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/performance.spec.js`

Expected: the default concurrency test fails because current defaults report scan concurrency up to `os.cpus().length * 2` and preview threads up to `os.cpus().length`.

- [ ] **Step 3: Implement the minimal backend change**

In `server.js`, introduce small integer option helpers and change defaults:

```js
function readPositiveIntegerOption(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
}

const CPU_COUNT = Math.max(1, os.cpus().length);
const DEFAULT_SCAN_CONCURRENCY = Math.max(2, Math.min(8, Math.ceil(CPU_COUNT / 2)));
const DEFAULT_PREVIEW_THREADS = Math.max(1, Math.min(2, Math.floor(CPU_COUNT / 4) || 1));
const SCAN_CONCURRENCY = Math.max(
  1,
  Math.min(16, readPositiveIntegerOption(process.env.SCAN_CONCURRENCY, DEFAULT_SCAN_CONCURRENCY))
);
const PREVIEW_THREADS = Math.max(
  1,
  Math.min(8, readPositiveIntegerOption(process.env.PREVIEW_THREADS, DEFAULT_PREVIEW_THREADS))
);
```

- [ ] **Step 4: Run the backend tests to verify they pass**

Run: `node --test tests/performance.spec.js`

Expected: all performance tests pass.

### Task 2: Frontend Batched Folder Rendering

**Files:**
- Modify: `public/viewer.js`
- Modify: `tests/performance.spec.js`

- [ ] **Step 1: Write the failing frontend static tests**

Add static assertions that `public/viewer.js` contains `renderItemsBatched`, uses `requestIdleCallback`, and increments a render token before mounting folder contents.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/performance.spec.js`

Expected: frontend static tests fail because folder rendering currently calls `host.append(itemList(d.items))` in one synchronous pass.

- [ ] **Step 3: Implement batched rendering**

In `public/viewer.js`:

- Add a global `folderRenderToken`.
- Add `scheduleIdleWork(callback)` using `requestIdleCallback` with a `setTimeout` fallback.
- Add `renderItemsBatched(items, host, token, options = {})`, which renders the first batch immediately and later batches during idle time.
- Update `mountFolder` to increment the token, clear the host, and call `renderItemsBatched` instead of appending the whole list at once.

- [ ] **Step 4: Run the performance tests**

Run: `node --test tests/performance.spec.js`

Expected: all performance tests pass.

### Task 3: Full Verification

**Files:**
- Modify: no new files expected.

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Expected: security and performance tests pass.

- [ ] **Step 2: Run syntax checks**

Run: `node --check server.js`

Expected: no output and exit code 0.

Run: `node --check tests/security.spec.js`

Expected: no output and exit code 0.

Run: `node --check tests/performance.spec.js`

Expected: no output and exit code 0.

- [ ] **Step 3: Run dependency audit**

Run: `npm audit --json`

Expected: `"total": 0` vulnerabilities.
