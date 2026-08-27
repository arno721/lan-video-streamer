# Performance and Responsiveness Design

## Goal

Reduce background CPU, disk, and process pressure while making user-triggered UI actions feel faster. The first pass should be conservative: keep existing features and routes intact, avoid large rewrites, and preserve environment-variable overrides for users who prefer higher throughput.

## Scope

This design covers option B:

- Lower backend background concurrency for scans and preview generation.
- Make frontend folder rendering incremental so clicks return control to the browser sooner.
- Avoid starting extra background preview work while a user action is actively rendering.

This design does not add a full power-mode switch, authentication, or a new worker architecture.

## Backend Design

The current defaults are aggressive for a local media server:

- `SCAN_CONCURRENCY` defaults to `os.cpus().length * 2`, capped at 16.
- `PREVIEW_THREADS` defaults to `os.cpus().length`, capped at 8.
- startup and rescan can enqueue preview generation immediately after indexing.

Change the defaults to favor responsiveness:

- Default scan concurrency to roughly half the CPU count, capped lower than today.
- Default preview threads to a small value, such as 1 or 2 depending on CPU count.
- Keep `SCAN_CONCURRENCY` and `PREVIEW_THREADS` environment variables as explicit overrides.
- Keep preview queue behavior, but avoid making default warmup feel like a burst job.

The intent is that browsing and playback stay responsive while background work makes steady progress.

## Frontend Design

The current viewer can create a large list of DOM nodes and image requests in one pass. That makes opening a large folder feel slow even if the API response is fast.

Change folder item rendering to use batched DOM insertion:

- Render the first batch immediately.
- Yield back to the browser between later batches with `requestIdleCallback` when available, falling back to a short timer.
- Keep existing item markup and event delegation so behavior remains unchanged.
- Use a render token so switching folders cancels stale batch work.
- Preserve current sorting, filtering, favorites, and archive item behavior.

The first visible items should appear quickly, and the rest should fill in without blocking clicks, scrolling, or media controls.

## Data Flow

Backend:

1. Server starts with conservative scan and preview concurrency defaults.
2. Rescan still builds the same in-memory snapshot and folder lookup.
3. Preview warmup still queues useful media items, but fewer workers run at once.

Frontend:

1. User opens a folder.
2. Viewer fetches `/api/folder-items` as it does today.
3. Viewer clears the target list and inserts the first batch.
4. Later batches are scheduled during idle time.
5. If the user opens another folder, the previous batch sequence stops.

## Error Handling

- If batched rendering fails, show the existing empty/error state rather than leaving stale content.
- If `requestIdleCallback` is unavailable, use `setTimeout` so all supported browsers keep working.
- Environment variable overrides remain accepted and clamped, so advanced users can restore higher throughput.

## Testing

Add focused tests before implementation:

- Backend test: `/api/server-info` reports lower default scan and preview concurrency when no override is set.
- Backend test: explicit `SCAN_CONCURRENCY` and `PREVIEW_THREADS` overrides are still honored within clamps.
- Frontend test strategy: add a small exported or testable batching helper if practical; otherwise verify via static behavior and manual browser checks after implementation.
- Existing security tests must continue to pass.

## Acceptance Criteria

- Default background concurrency is lower than the current aggressive defaults.
- User-facing API shapes remain compatible.
- Large folder rendering starts with an immediate first batch and continues asynchronously.
- Switching folders does not append stale items from an older render.
- `npm test`, syntax checks, and `npm audit` pass after implementation.
