# Repository Guidelines

## Project Structure & Module Organization
Core backend logic lives in `server.js` (Express API, media scanning, SQLite-backed state, and streaming routes). Background preview generation is handled by `preview-worker.js`. Static UI assets are in `public/` with page-specific scripts (`admin.js`, `desktop.js`, `mobile.js`, `viewer.js`) and shared styling in `styles.css`. Runtime data is written to `.cache/` (for example `.cache/streamer.db`, previews, and logs) and should be treated as generated state, not source. `videos/` is the default local media directory.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm start`: run the server (`server.js`) on port `8080`.
- `./start-media-streamer.ps1`: Windows PowerShell bootstrap (installs deps if missing, then starts server).
- `start-media-streamer.bat`: Windows batch equivalent for one-click local startup.
- `./install-autostart.ps1 -RunNow`: register Windows autostart and launch immediately.
- `./uninstall-autostart.ps1`: remove autostart registration.

## Coding Style & Naming Conventions
Follow existing JavaScript style in this repo: 2-space indentation, semicolons, double quotes, and `const`/`let` (avoid `var`). Use `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for process/runtime constants, and clear DOM ids matching page purpose. Keep new API endpoints grouped with existing `/api/*` routes in `server.js`; keep UI behavior in the corresponding file under `public/`.

## Testing Guidelines
No automated test framework is currently configured. Validate changes manually before opening a PR:
- Backend: hit `/api/server-info`, `/api/library`, and affected `/api/*` routes.
- Frontend: verify `/desktop.html`, `/mobile.html`, and `/admin.html` flows.
- Streaming: confirm preview generation and media playback paths (`/media`, `/media-transcode`) still work.
If you add automated tests, place them under `tests/` and use `*.spec.js`.

## Commit & Pull Request Guidelines
This workspace snapshot does not include `.git` history, so no project-specific commit pattern can be inferred here. Use concise, imperative subjects (optionally Conventional Commits, e.g. `fix: handle empty scan path`). PRs should include: purpose, behavior changes, manual test steps, screenshots for UI changes, and any config/runtime impact (especially `.cache`/SQLite or Windows startup scripts).

## Security & Configuration Notes
Do not commit machine-specific media paths, runtime logs, or database artifacts from `.cache/`. Prefer environment variables for runtime tuning (for example `PORT`, `SCAN_CONCURRENCY`, `FFMPEG_BIN`) instead of hard-coded local values.
