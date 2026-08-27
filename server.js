const express = require("express");
const compression = require("compression");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Worker } = require("worker_threads");
const { spawn, spawnSync } = require("child_process");
const ffmpegStatic = require("ffmpeg-static");
const sevenZipBin = require("7zip-bin");
const { DatabaseSync } = require("node:sqlite");

const app = express();
app.disable("x-powered-by");

const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

const DEFAULT_MEDIA_DIR = path.join(__dirname, "videos");
const CACHE_DIR = path.join(__dirname, ".cache");
const PREVIEW_DIR = path.join(CACHE_DIR, "previews");
const SCRUB_DIR = path.join(CACHE_DIR, "video-frames");
const TRANSCODE_DIR = path.join(CACHE_DIR, "transcodes");
const DB_PATH = path.join(CACHE_DIR, "streamer.db");
const PREVIEW_WORKER_PATH = path.join(__dirname, "preview-worker.js");

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
const PREVIEW_QUEUE_BATCH = Math.max(50, Number(process.env.PREVIEW_QUEUE_BATCH) || 300);
const AUTO_RESCAN_MS = Math.max(60000, Number(process.env.AUTO_RESCAN_MS) || 600000);
const VIDEO_FALLBACK_TIMEOUT_MS = Math.max(1000, Number(process.env.VIDEO_FALLBACK_TIMEOUT_MS) || 7000);
const VIDEO_HOLD_SPEED = Math.max(1.25, Number(process.env.VIDEO_HOLD_SPEED) || 3);
const VIDEO_HOLD_TRIGGER_MS = Math.max(120, Number(process.env.VIDEO_HOLD_TRIGGER_MS) || 420);
const VIDEO_SEEK_SECONDS = Math.max(1, Number(process.env.VIDEO_SEEK_SECONDS) || 5);
const VIDEO_SEEK_SECONDS_SHIFT = Math.max(1, Number(process.env.VIDEO_SEEK_SECONDS_SHIFT) || 15);
const IMAGE_ZOOM_MOBILE = Math.max(1.1, Number(process.env.IMAGE_ZOOM_MOBILE) || 1.45);
const IMAGE_ZOOM_DESKTOP = Math.max(1.1, Number(process.env.IMAGE_ZOOM_DESKTOP) || 1.6);
const MEDIA_STREAM_HIGH_WATER_MARK = Math.max(64 * 1024, Number(process.env.MEDIA_STREAM_HIGH_WATER_MARK) || 1024 * 1024);
const TRANSCODE_PRESET = String(process.env.TRANSCODE_PRESET || "veryfast");
const TRANSCODE_CRF = Math.max(16, Number(process.env.TRANSCODE_CRF) || 22);
const TRANSCODE_AUDIO_KBPS = Math.max(64, Number(process.env.TRANSCODE_AUDIO_KBPS) || 160);
const TRANSCODE_PROBE_SIZE = Math.max(50000, Number(process.env.TRANSCODE_PROBE_SIZE) || 1000000);
const TRANSCODE_ANALYZE_DURATION = Math.max(50000, Number(process.env.TRANSCODE_ANALYZE_DURATION) || 1000000);
const TRANSCODE_KEYINT = Math.max(12, Number(process.env.TRANSCODE_KEYINT) || 48);
const FFMPEG_BIN = process.env.FFMPEG_BIN || ffmpegStatic || "ffmpeg";
const ARCHIVE_LIST_BIN = process.env.ARCHIVE_LIST_BIN || findArchiveListBin();
const RESCAN_TICK_MS = 30000;
const DIRECT_PLAYABLE_VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".webm"]);
const TRANSCODE_PRESET_VALUES = new Set(["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"]);
const ARCHIVE_PREVIEW_MAX_ENTRIES = Math.max(100, Number(process.env.ARCHIVE_PREVIEW_MAX_ENTRIES) || 5000);
const ARCHIVE_PREVIEW_STDOUT_LIMIT = Math.max(1024 * 1024, Number(process.env.ARCHIVE_PREVIEW_STDOUT_LIMIT) || 12 * 1024 * 1024);
const ARCHIVE_PREVIEW_TIMEOUT_MS = Math.max(3000, Number(process.env.ARCHIVE_PREVIEW_TIMEOUT_MS) || 20000);
const ARCHIVE_COVER_TIMEOUT_MS = Math.max(300, Number(process.env.ARCHIVE_COVER_TIMEOUT_MS) || 900);
const ARCHIVE_COVER_STDOUT_LIMIT = Math.max(256 * 1024, Number(process.env.ARCHIVE_COVER_STDOUT_LIMIT) || 2 * 1024 * 1024);
const ARCHIVE_COVER_EXTRACT_TIMEOUT_MS = Math.max(3000, Number(process.env.ARCHIVE_COVER_EXTRACT_TIMEOUT_MS) || 15000);
const ARCHIVE_COVER_EXTRACT_MAX_BYTES = Math.max(1024 * 1024, Number(process.env.ARCHIVE_COVER_EXTRACT_MAX_BYTES) || 30 * 1024 * 1024);

function findArchiveListBin() {
  for (const candidate of ["7z", "7za"]) {
    try {
      const result = spawnSync(candidate, ["-h"], { stdio: "ignore", windowsHide: true });
      if (result.status === 0) return candidate;
    } catch {
      // continue to bundled 7za
    }
  }
  return sevenZipBin.path7za || "7z";
}

function readPositiveIntegerOption(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.round(value);
}

const RUNTIME_OPTION_DEFAULTS = Object.freeze({
  autoRescanMs: AUTO_RESCAN_MS,
  previewQueueBatch: PREVIEW_QUEUE_BATCH,
  preferMediaFolderPreview: true,
  mobileTranscodeFirst: true,
  videoFallbackTimeoutMs: VIDEO_FALLBACK_TIMEOUT_MS,
  videoHoldSpeed: VIDEO_HOLD_SPEED,
  videoHoldTriggerMs: VIDEO_HOLD_TRIGGER_MS,
  videoSeekSeconds: VIDEO_SEEK_SECONDS,
  videoSeekSecondsShift: VIDEO_SEEK_SECONDS_SHIFT,
  imageZoomMobile: IMAGE_ZOOM_MOBILE,
  imageZoomDesktop: IMAGE_ZOOM_DESKTOP,
  transcodePreset: TRANSCODE_PRESET,
  transcodeCrf: TRANSCODE_CRF,
  transcodeAudioKbps: TRANSCODE_AUDIO_KBPS,
  transcodeProbeSize: TRANSCODE_PROBE_SIZE,
  transcodeAnalyzeDuration: TRANSCODE_ANALYZE_DURATION,
  transcodeKeyint: TRANSCODE_KEYINT,
  transcodeTuneZerolatency: true,
});

let runtimeOptions = { ...RUNTIME_OPTION_DEFAULTS };
let lastAutoRescanAt = Date.now();
let restartInProgress = false;

const EXT_CATEGORY = {
  video: new Set([
    ".mp4",
    ".webm",
    ".mov",
    ".m4v",
    ".mkv",
    ".avi",
    ".flv",
    ".wmv",
    ".mpeg",
    ".mpg",
    ".ts",
    ".m2ts",
    ".mts",
    ".3gp",
    ".3g2",
    ".vob",
    ".asf",
    ".f4v",
    ".ogv",
    ".rm",
    ".rmvb",
  ]),
  image: new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".heic"]),
  audio: new Set([".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a"]),
  document: new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".md"]),
  archive: new Set([".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz"]),
  code: new Set([".js", ".ts", ".tsx", ".jsx", ".json", ".py", ".go", ".java", ".cs", ".cpp", ".c", ".rs", ".html", ".css"]),
};

const MIME_BY_EXT = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".ts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".mts": "video/mp2t",
  ".3gp": "video/3gpp",
  ".3g2": "video/3gpp2",
  ".vob": "video/dvd",
  ".asf": "video/x-ms-asf",
  ".f4v": "video/mp4",
  ".ogv": "video/ogg",
  ".rm": "application/vnd.rn-realmedia",
  ".rmvb": "application/vnd.rn-realmedia-vbr",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".svg": "image/svg+xml; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDir(DEFAULT_MEDIA_DIR);
ensureDir(CACHE_DIR);
ensureDir(PREVIEW_DIR);
ensureDir(SCRUB_DIR);
ensureDir(TRANSCODE_DIR);

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS scan_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exclude_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_items (
    file_key TEXT PRIMARY KEY,
    source_path TEXT NOT NULL UNIQUE,
    scan_root TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    category TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_ms INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    raw_folder TEXT NOT NULL,
    display_folder TEXT NOT NULL,
    display_path TEXT NOT NULL,
    preview_key TEXT NOT NULL,
    indexed_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_media_category ON media_items(category);
  CREATE INDEX IF NOT EXISTS idx_media_display_folder ON media_items(display_folder);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const selectScanPathsStmt = db.prepare("SELECT path FROM scan_paths WHERE enabled = 1 ORDER BY id ASC");
const selectExcludePathsStmt = db.prepare("SELECT path FROM exclude_paths ORDER BY id ASC");
const insertScanPathStmt = db.prepare(`
  INSERT OR IGNORE INTO scan_paths(path, enabled, created_at, updated_at)
  VALUES (?, 1, ?, ?)
`);
const deleteScanPathStmt = db.prepare("DELETE FROM scan_paths WHERE path = ?");
const insertExcludePathStmt = db.prepare(`
  INSERT OR IGNORE INTO exclude_paths(path, created_at, updated_at)
  VALUES (?, ?, ?)
`);
const deleteExcludePathStmt = db.prepare("DELETE FROM exclude_paths WHERE path = ?");
const clearMediaStmt = db.prepare("DELETE FROM media_items");
const insertMediaStmt = db.prepare(`
  INSERT INTO media_items (
    file_key, source_path, scan_root, relative_path, file_name, extension, category, mime_type,
    size, modified_ms, modified_at, raw_folder, display_folder, display_path, preview_key, indexed_at
  ) VALUES (
    @file_key, @source_path, @scan_root, @relative_path, @file_name, @extension, @category, @mime_type,
    @size, @modified_ms, @modified_at, @raw_folder, @display_folder, @display_path, @preview_key, @indexed_at
  )
`);
const selectMediaRowsStmt = db.prepare(`
  SELECT file_key, source_path, scan_root, relative_path, file_name, extension, category, mime_type,
         size, modified_ms, modified_at, raw_folder, display_folder, display_path, preview_key, indexed_at
  FROM media_items
  ORDER BY modified_ms DESC
`);
const upsertSettingStmt = db.prepare(`
  INSERT INTO app_settings(key, value, updated_at)
  VALUES (@key, @value, @updated_at)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);
const getSettingStmt = db.prepare("SELECT value FROM app_settings WHERE key = ?");

function normalizeToSlash(value) {
  return value.split(path.sep).join("/");
}

function normalizePathForCompare(inputPath) {
  return path.resolve(inputPath).replace(/[/\\]+/g, "\\").toLowerCase();
}

function getCategory(ext) {
  const lowered = ext.toLowerCase();
  for (const [category, extensions] of Object.entries(EXT_CATEGORY)) {
    if (extensions.has(lowered)) {
      return category;
    }
  }
  return "other";
}

function getMimeType(ext) {
  return MIME_BY_EXT[ext.toLowerCase()] || "application/octet-stream";
}

function getSetting(key, fallbackValue) {
  try {
    const row = getSettingStmt.get(key);
    if (!row) return fallbackValue;
    const parsed = JSON.parse(row.value);
    return parsed ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function setSetting(key, value) {
  const now = new Date().toISOString();
  upsertSettingStmt.run({
    key,
    value: JSON.stringify(value),
    updated_at: now,
  });
}

function clampNumber(raw, min, max, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function getRuntimeOption(key, fallback) {
  return getSetting(key, fallback);
}

function sanitizeRuntimeOptions(input = {}, fallbackBase = RUNTIME_OPTION_DEFAULTS) {
  const base = { ...fallbackBase, ...input };
  const presetRaw = String(base.transcodePreset || RUNTIME_OPTION_DEFAULTS.transcodePreset).trim().toLowerCase();
  const transcodePreset = TRANSCODE_PRESET_VALUES.has(presetRaw) ? presetRaw : RUNTIME_OPTION_DEFAULTS.transcodePreset;

  return {
    autoRescanMs: Math.round(clampNumber(base.autoRescanMs, 60000, 24 * 60 * 60 * 1000, RUNTIME_OPTION_DEFAULTS.autoRescanMs)),
    previewQueueBatch: Math.round(clampNumber(base.previewQueueBatch, 20, 5000, RUNTIME_OPTION_DEFAULTS.previewQueueBatch)),
    preferMediaFolderPreview: base.preferMediaFolderPreview !== false,
    mobileTranscodeFirst: base.mobileTranscodeFirst !== false,
    videoFallbackTimeoutMs: Math.round(clampNumber(base.videoFallbackTimeoutMs, 1000, 30000, RUNTIME_OPTION_DEFAULTS.videoFallbackTimeoutMs)),
    videoHoldSpeed: clampNumber(base.videoHoldSpeed, 1.25, 8, RUNTIME_OPTION_DEFAULTS.videoHoldSpeed),
    videoHoldTriggerMs: Math.round(clampNumber(base.videoHoldTriggerMs, 120, 1200, RUNTIME_OPTION_DEFAULTS.videoHoldTriggerMs)),
    videoSeekSeconds: clampNumber(base.videoSeekSeconds, 1, 60, RUNTIME_OPTION_DEFAULTS.videoSeekSeconds),
    videoSeekSecondsShift: clampNumber(base.videoSeekSecondsShift, 1, 180, RUNTIME_OPTION_DEFAULTS.videoSeekSecondsShift),
    imageZoomMobile: clampNumber(base.imageZoomMobile, 1.1, 4, RUNTIME_OPTION_DEFAULTS.imageZoomMobile),
    imageZoomDesktop: clampNumber(base.imageZoomDesktop, 1.1, 5, RUNTIME_OPTION_DEFAULTS.imageZoomDesktop),
    transcodePreset,
    transcodeCrf: Math.round(clampNumber(base.transcodeCrf, 16, 35, RUNTIME_OPTION_DEFAULTS.transcodeCrf)),
    transcodeAudioKbps: Math.round(clampNumber(base.transcodeAudioKbps, 64, 320, RUNTIME_OPTION_DEFAULTS.transcodeAudioKbps)),
    transcodeProbeSize: Math.round(clampNumber(base.transcodeProbeSize, 50000, 20000000, RUNTIME_OPTION_DEFAULTS.transcodeProbeSize)),
    transcodeAnalyzeDuration: Math.round(
      clampNumber(base.transcodeAnalyzeDuration, 50000, 20000000, RUNTIME_OPTION_DEFAULTS.transcodeAnalyzeDuration)
    ),
    transcodeKeyint: Math.round(clampNumber(base.transcodeKeyint, 12, 360, RUNTIME_OPTION_DEFAULTS.transcodeKeyint)),
    transcodeTuneZerolatency: base.transcodeTuneZerolatency !== false,
  };
}

function getAdminOptionsPayload() {
  return {
    ...runtimeOptions,
    autoRescanMinutes: Math.max(1, Math.round(runtimeOptions.autoRescanMs / 60000)),
  };
}

function loadRuntimeOptions() {
  runtimeOptions = sanitizeRuntimeOptions({
    autoRescanMs: getRuntimeOption("autoRescanMs", RUNTIME_OPTION_DEFAULTS.autoRescanMs),
    previewQueueBatch: getRuntimeOption("previewQueueBatch", RUNTIME_OPTION_DEFAULTS.previewQueueBatch),
    preferMediaFolderPreview: getRuntimeOption("preferMediaFolderPreview", RUNTIME_OPTION_DEFAULTS.preferMediaFolderPreview),
    mobileTranscodeFirst: getRuntimeOption("mobileTranscodeFirst", RUNTIME_OPTION_DEFAULTS.mobileTranscodeFirst),
    videoFallbackTimeoutMs: getRuntimeOption("videoFallbackTimeoutMs", RUNTIME_OPTION_DEFAULTS.videoFallbackTimeoutMs),
    videoHoldSpeed: getRuntimeOption("videoHoldSpeed", RUNTIME_OPTION_DEFAULTS.videoHoldSpeed),
    videoHoldTriggerMs: getRuntimeOption("videoHoldTriggerMs", RUNTIME_OPTION_DEFAULTS.videoHoldTriggerMs),
    videoSeekSeconds: getRuntimeOption("videoSeekSeconds", RUNTIME_OPTION_DEFAULTS.videoSeekSeconds),
    videoSeekSecondsShift: getRuntimeOption("videoSeekSecondsShift", RUNTIME_OPTION_DEFAULTS.videoSeekSecondsShift),
    imageZoomMobile: getRuntimeOption("imageZoomMobile", RUNTIME_OPTION_DEFAULTS.imageZoomMobile),
    imageZoomDesktop: getRuntimeOption("imageZoomDesktop", RUNTIME_OPTION_DEFAULTS.imageZoomDesktop),
    transcodePreset: getRuntimeOption("transcodePreset", RUNTIME_OPTION_DEFAULTS.transcodePreset),
    transcodeCrf: getRuntimeOption("transcodeCrf", RUNTIME_OPTION_DEFAULTS.transcodeCrf),
    transcodeAudioKbps: getRuntimeOption("transcodeAudioKbps", RUNTIME_OPTION_DEFAULTS.transcodeAudioKbps),
    transcodeProbeSize: getRuntimeOption("transcodeProbeSize", RUNTIME_OPTION_DEFAULTS.transcodeProbeSize),
    transcodeAnalyzeDuration: getRuntimeOption("transcodeAnalyzeDuration", RUNTIME_OPTION_DEFAULTS.transcodeAnalyzeDuration),
    transcodeKeyint: getRuntimeOption("transcodeKeyint", RUNTIME_OPTION_DEFAULTS.transcodeKeyint),
    transcodeTuneZerolatency: getRuntimeOption("transcodeTuneZerolatency", RUNTIME_OPTION_DEFAULTS.transcodeTuneZerolatency),
  });
}

function scheduleServerRestart() {
  if (restartInProgress) return false;
  restartInProgress = true;

  const nodeExec = process.execPath;
  const entryArgs = process.argv.slice(1);
  const bootstrapCode = `
const { spawn } = require("child_process");
setTimeout(() => {
  try {
    const child = spawn(${JSON.stringify(nodeExec)}, ${JSON.stringify(entryArgs)}, {
      cwd: ${JSON.stringify(__dirname)},
      env: process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch {}
}, 800);
`;

  const bootstrap = spawn(nodeExec, ["-e", bootstrapCode], {
    cwd: __dirname,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  bootstrap.unref();
  return true;
}

function hashForPreview(sourcePath, size, mtimeMs) {
  return crypto.createHash("sha1").update(`${sourcePath}|${size}|${mtimeMs}`).digest("hex");
}

function hashFileKey(sourcePath) {
  return crypto.createHash("sha1").update(sourcePath.toLowerCase()).digest("hex").slice(0, 20);
}

function getScanPaths() {
  return selectScanPathsStmt.all().map((row) => row.path);
}

function getExcludePaths() {
  return selectExcludePathsStmt.all().map((row) => row.path);
}

function ensureDefaultScanPath() {
  const scanPaths = getScanPaths();
  if (!scanPaths.length) {
    const now = new Date().toISOString();
    insertScanPathStmt.run(path.resolve(DEFAULT_MEDIA_DIR), now, now);
  }
}

ensureDefaultScanPath();
loadRuntimeOptions();

function isPrivateIPv4(ip) {
  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function getLanIPv4Candidates() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === "IPv4" && !info.internal) {
        candidates.push(info.address);
      }
    }
  }

  return candidates;
}

function getPreferredLanIPv4() {
  const candidates = getLanIPv4Candidates();
  const preferred = candidates.find((ip) => isPrivateIPv4(ip));
  return preferred || candidates[0] || "127.0.0.1";
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function createTreeNode(name, nodePath) {
  return {
    id: nodePath || "/",
    name,
    path: nodePath || "/",
    children: [],
    items: [],
    counts: {
      total: 0,
      video: 0,
      image: 0,
      audio: 0,
      document: 0,
      archive: 0,
      code: 0,
      other: 0,
    },
  };
}

function createEmptySnapshot() {
  return {
    generation: 0,
    totalItems: 0,
    totalSize: 0,
    byCategory: {
      video: 0,
      image: 0,
      audio: 0,
      document: 0,
      archive: 0,
      code: 0,
      other: 0,
    },
    tree: createTreeNode("/", "/"),
    flatFolders: [],
    generatedAt: null,
  };
}

const supportsFfmpeg = (() => {
  try {
    const result = spawnSync(FFMPEG_BIN, ["-version"], { stdio: "ignore", windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
})();

let librarySnapshot = createEmptySnapshot();
let itemLookup = new Map();
let folderItemsLookup = new Map();
let previewCache = new Map();
const archivePreviewCache = new Map();
const archiveCoverCache = new Map();
const pendingTranscodeJobs = new Map();
let indexState = {
  isIndexing: false,
  startedAt: null,
  finishedAt: null,
  lastError: null,
  generation: 0,
};
let previewState = {
  active: 0,
  queued: 0,
  totalQueuedThisRound: 0,
  finishedThisRound: 0,
};
const pendingFrameJobs = new Map();

const previewQueue = [];
const previewQueuedKeys = new Set();
const pendingPreviewJobs = new Map();
let previewQueueOrder = 0;
const pendingArchivePreviewJobs = new Map();
const pendingArchiveCoverJobs = new Map();
const pendingArchiveCoverExtractJobs = new Map();

function buildPreviewJob(item) {
  return {
    itemId: item.id,
    sourcePath: item.sourcePath,
    relativePath: item.relativePath,
    previewKey: item.previewKey,
    category: item.category,
    extension: item.extension,
    fileName: item.name,
    targetDir: PREVIEW_DIR,
    ffmpegEnabled: supportsFfmpeg,
    ffmpegPath: FFMPEG_BIN,
  };
}

function enqueuePreviewJob(item, options = {}) {
  return enqueuePreviewJobWithOptions(item, options);
}

function sortPreviewQueue() {
  previewQueue.sort((a, b) => {
    const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return Number(a.queuedOrder || 0) - Number(b.queuedOrder || 0);
  });
}

function previewWorkerResultToCacheEntry(record, result) {
  if (!result || !result.ok || !result.outputPath || !fs.existsSync(result.outputPath)) return null;
  return {
    previewKey: record.previewKey,
    outputPath: result.outputPath,
    mimeType: result.mimeType || "image/jpeg",
    updatedAt: Date.now(),
  };
}

function enqueuePreviewJobWithOptions(item, options = {}) {
  if (!item) return Promise.resolve(null);
  const queueKey = `${item.id}|${item.previewKey}`;
  const priority = Number(options.priority || 0);
  const existing = pendingPreviewJobs.get(queueKey);
  if (existing) {
    if (!existing.started && priority > existing.priority) {
      existing.priority = priority;
      sortPreviewQueue();
    }
    return existing.promise;
  }

  let resolveJob;
  const promise = new Promise((resolve) => {
    resolveJob = resolve;
  });

  const job = buildPreviewJob(item);
  const record = {
    queueKey,
    itemId: job.itemId,
    previewKey: job.previewKey,
    priority,
    queuedOrder: previewQueueOrder,
    started: false,
    job,
    promise,
    resolve: resolveJob,
  };
  previewQueueOrder += 1;

  previewQueuedKeys.add(queueKey);
  pendingPreviewJobs.set(queueKey, record);
  previewQueue.push(record);
  sortPreviewQueue();

  previewState.queued = previewQueue.length;
  previewState.totalQueuedThisRound += 1;
  pumpPreviewQueue();
  return promise;
}

function runPreviewWorker(job) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(PREVIEW_WORKER_PATH, { workerData: job });

    worker.on("message", (message) => resolve(message));
    worker.on("error", (err) => reject(err));
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Preview worker exited with code ${code}`));
    });
  });
}

function pumpPreviewQueue() {
  while (previewState.active < PREVIEW_THREADS && previewQueue.length > 0) {
    const record = previewQueue.shift();
    record.started = true;
    previewState.active += 1;
    previewState.queued = previewQueue.length;

    runPreviewWorker(record.job)
      .then((result) => {
        const entry = previewWorkerResultToCacheEntry(record, result);
        if (entry) previewCache.set(record.itemId, entry);
        record.resolve(entry);
      })
      .catch(() => {
        // Keep fallback preview.
        record.resolve(null);
      })
      .finally(() => {
        previewQueuedKeys.delete(record.queueKey);
        pendingPreviewJobs.delete(record.queueKey);
        previewState.active -= 1;
        previewState.finishedThisRound += 1;
        previewState.queued = previewQueue.length;
        pumpPreviewQueue();
      });
  }
}

async function generatePreviewNow(item) {
  if (!item) return null;
  return enqueuePreviewJob(item, { priority: 100, waitForResult: true });
}

function archiveEntryFromSevenZipRecord(record) {
  if (!record || !record.Path) return null;
  const entryPath = String(record.Path || "").replace(/\\/g, "/");
  if (!entryPath || entryPath === "." || entryPath.endsWith(":/")) return null;

  const attr = String(record.Attributes || "");
  const isDirectory = attr.includes("D") || entryPath.endsWith("/");
  return {
    path: entryPath,
    name: entryPath.split("/").filter(Boolean).pop() || entryPath,
    directory: isDirectory,
    size: isDirectory ? 0 : Math.max(0, Number(record.Size) || 0),
    packedSize: Math.max(0, Number(record["Packed Size"]) || 0),
    modifiedAt: record.Modified || null,
    encrypted: String(record.Encrypted || "").trim() === "+",
  };
}

function parseSevenZipList(text, maxEntries = ARCHIVE_PREVIEW_MAX_ENTRIES) {
  const entries = [];
  let current = null;
  let truncated = false;

  const flush = () => {
    const entry = archiveEntryFromSevenZipRecord(current);
    if (!entry) return;
    if (entries.length >= maxEntries) {
      truncated = true;
      return;
    }
    entries.push(entry);
  };

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      flush();
      current = null;
      continue;
    }

    const idx = line.indexOf(" = ");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 3).trim();
    if (key === "Path") {
      flush();
      current = { Path: value };
    } else if (current) {
      current[key] = value;
    }
  }
  flush();

  entries.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    return a.path.localeCompare(b.path, "zh-Hant", { numeric: true, sensitivity: "base" });
  });

  return { entries, truncated };
}

function buildArchiveSummary(entries) {
  return entries.reduce(
    (acc, entry) => {
      if (entry.directory) acc.directories += 1;
      else {
        acc.files += 1;
        acc.totalSize += Number(entry.size || 0);
      }
      if (entry.encrypted) acc.encrypted += 1;
      return acc;
    },
    { files: 0, directories: 0, totalSize: 0, encrypted: 0 }
  );
}

function archiveEntryId(archiveItem, entryPath) {
  return `archive-entry:${archiveItem.id}:${Buffer.from(String(entryPath || ""), "utf8").toString("base64url")}`;
}

function archiveEntryQuery(archiveItem, entryPath) {
  return `id=${encodeURIComponent(archiveItem.id)}&entry=${encodeURIComponent(entryPath)}`;
}

function archiveEntryPreviewKey(archiveItem, entryPath) {
  const hash = crypto.createHash("sha1").update(`${archiveItem.previewKey}|${entryPath}`).digest("hex").slice(0, 16);
  return `archive_${archiveItem.id}_${hash}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toArchiveEntryClientItem(archiveItem, entry) {
  const entryPath = String(entry?.path || "");
  const name = String(entry?.name || path.posix.basename(entryPath) || "file");
  const extension = path.posix.extname(name).toLowerCase();
  const category = getCategory(extension);
  const mediaUrl = `/api/archive-media?${archiveEntryQuery(archiveItem, entryPath)}`;
  const previewUrl =
    category === "video"
      ? `/api/archive-video-frame?${archiveEntryQuery(archiveItem, entryPath)}`
      : category === "image"
        ? mediaUrl
        : `/api/archive-entry-preview?${archiveEntryQuery(archiveItem, entryPath)}`;

  return {
    id: archiveEntryId(archiveItem, entryPath),
    archiveId: archiveItem.id,
    archiveEntryPath: entryPath,
    relativePath: entryPath,
    displayFolder: `壓縮包: ${archiveItem.name}`,
    name,
    extension,
    category,
    size: Number(entry.size || 0),
    updatedAt: entry.modifiedAt || archiveItem.updatedAt,
    displayPath: `${archiveItem.displayPath || archiveItem.name} / ${entryPath}`,
    previewKey: archiveEntryPreviewKey(archiveItem, entryPath),
    mediaUrl,
    transcodeUrl: mediaUrl,
    transcodeFileUrl: mediaUrl,
    downloadUrl: `${mediaUrl}&download=1`,
    previewUrl,
    directPlayPreferred: true,
    sourceArchiveId: archiveItem.id,
  };
}

function getArchiveEntryFromPreview(preview, entryPath) {
  const normalized = String(entryPath || "").replace(/\\/g, "/");
  return (preview?.entries || []).find((entry) => entry.path === normalized) || null;
}

function listArchiveWithSevenZip(item) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let finished = false;

    const child = spawn(ARCHIVE_LIST_BIN, ["l", "-slt", "-sccUTF-8", "-ba", item.sourcePath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      if (finished) return;
      outputTruncated = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore cleanup kill failure
      }
    }, ARCHIVE_PREVIEW_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      if (outputTruncated) return;
      stdout += chunk.toString("utf8");
      if (stdout.length > ARCHIVE_PREVIEW_STDOUT_LIMIT) {
        outputTruncated = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore cleanup kill failure
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      if (stderr.length > 4096) return;
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      finished = true;
      clearTimeout(timer);
      reject(new Error(`archive preview tool failed: ${err.message || "spawn failed"}`));
    });

    child.on("close", (code) => {
      finished = true;
      clearTimeout(timer);
      const parsed = parseSevenZipList(stdout);
      if (code !== 0 && parsed.entries.length === 0) {
        const detail = stderr.trim() || `exit code ${code}`;
        reject(new Error(`archive preview failed: ${detail}`));
        return;
      }
      resolve({
        ...parsed,
        truncated: parsed.truncated || outputTruncated,
      });
    });
  });
}

function listArchiveCoverWithSevenZip(item) {
  return new Promise((resolve) => {
    let stdoutSize = 0;
    let buffer = "";
    let current = null;
    let settled = false;

    const child = spawn(ARCHIVE_LIST_BIN, ["l", "-slt", "-sccUTF-8", "-ba", item.sourcePath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (entry = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore cleanup kill failure
      }
      resolve(entry);
    };

    const considerCurrent = () => {
      const entry = archiveEntryFromSevenZipRecord(current);
      current = null;
      if (!entry || entry.directory || entry.encrypted) return;
      if (getCategory(path.posix.extname(entry.name || entry.path || "")) === "image") finish(entry);
    };

    const processLine = (rawLine) => {
      const line = String(rawLine || "").trimEnd();
      if (!line) {
        considerCurrent();
        return;
      }
      const idx = line.indexOf(" = ");
      if (idx < 0) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 3).trim();
      if (key === "Path") {
        considerCurrent();
        current = { Path: value };
      } else if (current) {
        current[key] = value;
      }
    };

    const timer = setTimeout(() => finish(null), ARCHIVE_COVER_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      if (settled) return;
      stdoutSize += chunk.length;
      if (stdoutSize > ARCHIVE_COVER_STDOUT_LIMIT) {
        finish(null);
        return;
      }
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
        if (settled) return;
      }
    });

    child.on("error", () => finish(null));
    child.on("close", () => {
      if (settled) return;
      if (buffer) processLine(buffer);
      considerCurrent();
      finish(null);
    });
  });
}

async function getArchivePreview(item) {
  if (!item || item.category !== "archive") return null;
  const cacheKey = `${item.id}|${item.previewKey}`;
  const cached = archivePreviewCache.get(cacheKey);
  if (cached) return cached;
  if (pendingArchivePreviewJobs.has(cacheKey)) return pendingArchivePreviewJobs.get(cacheKey);

  const task = listArchiveWithSevenZip(item)
    .then((result) => {
      const preview = {
        item: toClientItem(item),
        entries: result.entries,
        items: result.entries
          .filter((entry) => !entry.directory)
          .map((entry) => toArchiveEntryClientItem(item, entry)),
        summary: buildArchiveSummary(result.entries),
        truncated: !!result.truncated,
        generatedAt: new Date().toISOString(),
      };
      archivePreviewCache.set(cacheKey, preview);
      const coverItem = preview.items.find((entryItem) => entryItem.category === "image") || null;
      if (coverItem) archiveCoverCache.set(cacheKey, coverItem);
      return preview;
    })
    .finally(() => {
      pendingArchivePreviewJobs.delete(cacheKey);
    });

  pendingArchivePreviewJobs.set(cacheKey, task);
  return task;
}

async function getArchiveCoverPreview(item) {
  if (!item || item.category !== "archive") return null;
  const cacheKey = `${item.id}|${item.previewKey}`;
  if (archiveCoverCache.has(cacheKey)) return archiveCoverCache.get(cacheKey);
  if (pendingArchiveCoverJobs.has(cacheKey)) return pendingArchiveCoverJobs.get(cacheKey);

  const task = listArchiveCoverWithSevenZip(item)
    .then((entry) => {
      const coverItem = entry ? toArchiveEntryClientItem(item, entry) : null;
      archiveCoverCache.set(cacheKey, coverItem);
      return coverItem;
    })
    .finally(() => {
      pendingArchiveCoverJobs.delete(cacheKey);
    });

  pendingArchiveCoverJobs.set(cacheKey, task);
  return task;
}

function getArchiveCoverPreviewOutputPath(item, coverItem) {
  const rawExt = String(coverItem?.extension || "").toLowerCase();
  const ext = EXT_CATEGORY.image.has(rawExt) ? rawExt : ".jpg";
  return path.join(PREVIEW_DIR, `${item.previewKey}${ext}`);
}

function extractArchiveCoverToFile(item, coverItem, outputPath) {
  return new Promise((resolve, reject) => {
    ensureDir(PREVIEW_DIR);
    const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
    const out = fs.createWriteStream(tempPath);
    const child = spawn(ARCHIVE_LIST_BIN, ["x", "-so", "-sccUTF-8", item.sourcePath, coverItem.archiveEntryPath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let settled = false;
    let written = 0;
    const cleanupTemp = () => {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup failure
      }
    };
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        cleanupTemp();
        reject(err);
        return;
      }
      try {
        fs.renameSync(tempPath, outputPath);
        resolve(outputPath);
      } catch (renameErr) {
        cleanupTemp();
        reject(renameErr);
      }
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      finish(new Error("archive cover extraction timed out"));
    }, ARCHIVE_COVER_EXTRACT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      written += chunk.length;
      if (written > ARCHIVE_COVER_EXTRACT_MAX_BYTES) {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish(new Error("archive cover extraction exceeded size limit"));
      }
    });
    child.stdout.pipe(out);

    child.stderr.on("data", (chunk) => {
      if (stderr.length > 4096) return;
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => finish(err));
    out.on("error", (err) => {
      try {
        child.kill("SIGKILL");
      } catch {}
      finish(err);
    });
    child.on("close", (code) => {
      out.end(() => {
        if (code === 0 && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
          finish(null);
          return;
        }
        finish(new Error(stderr.trim() || `archive cover extraction failed (${code})`));
      });
    });
  });
}

async function ensureArchiveCoverPreviewCached(item, coverItem) {
  if (!item || !coverItem || coverItem.category !== "image" || !coverItem.archiveEntryPath) return null;

  const outputPath = getArchiveCoverPreviewOutputPath(item, coverItem);
  if (fs.existsSync(outputPath)) {
    const stat = fs.statSync(outputPath);
    if (stat.size > 0) {
      const entry = {
        previewKey: item.previewKey,
        outputPath,
        mimeType: getMimeType(path.extname(outputPath).toLowerCase()),
        updatedAt: Date.now(),
      };
      previewCache.set(item.id, entry);
      return entry;
    }
  }

  const jobKey = `${item.id}|${item.previewKey}|${coverItem.archiveEntryPath}`;
  if (pendingArchiveCoverExtractJobs.has(jobKey)) return pendingArchiveCoverExtractJobs.get(jobKey);

  const task = extractArchiveCoverToFile(item, coverItem, outputPath)
    .then(() => {
      const entry = {
        previewKey: item.previewKey,
        outputPath,
        mimeType: getMimeType(path.extname(outputPath).toLowerCase()),
        updatedAt: Date.now(),
      };
      previewCache.set(item.id, entry);
      return entry;
    })
    .catch(() => null)
    .finally(() => {
      pendingArchiveCoverExtractJobs.delete(jobKey);
    });

  pendingArchiveCoverExtractJobs.set(jobKey, task);
  return task;
}

function queueArchiveCoverUpgrade(item) {
  if (!item || item.category !== "archive" || !fs.existsSync(item.sourcePath)) return;
  getArchiveCoverPreview(item)
    .then((coverItem) => ensureArchiveCoverPreviewCached(item, coverItem))
    .catch(() => null);
}

async function getArchiveEntryForRequest(req, res) {
  const id = String(req.query.id || "").trim();
  const entryPath = String(req.query.entry || "").trim();
  if (!id || !entryPath) {
    res.status(400).json({ error: "id and entry are required" });
    return null;
  }

  const archiveItem = getItemById(id);
  if (!archiveItem || archiveItem.category !== "archive" || !fs.existsSync(archiveItem.sourcePath)) {
    res.status(404).json({ error: "archive not found" });
    return null;
  }

  const preview = await getArchivePreview(archiveItem);
  const entry = getArchiveEntryFromPreview(preview, entryPath);
  if (!entry || entry.directory) {
    res.status(404).json({ error: "archive entry not found" });
    return null;
  }

  const item = toArchiveEntryClientItem(archiveItem, entry);
  return { archiveItem, entry, item };
}

function streamArchiveEntry(archiveItem, entry, res, opt = {}) {
  const entryPath = String(entry.path || "");
  const name = String(entry.name || path.posix.basename(entryPath) || "file");
  const extension = path.posix.extname(name).toLowerCase();
  const mimeType = getMimeType(extension);

  res.status(200);
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Accept-Ranges", "none");
  if (opt.download) {
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }

  const child = spawn(ARCHIVE_LIST_BIN, ["x", "-so", "-sccUTF-8", archiveItem.sourcePath, entryPath], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  const closeChild = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore cleanup kill failure
    }
  };

  res.on("close", closeChild);
  child.stderr.on("data", (chunk) => {
    if (stderr.length > 4096) return;
    stderr += chunk.toString("utf8");
  });
  child.on("error", (err) => {
    if (!res.headersSent) res.status(500).json({ error: err.message || "archive entry stream failed" });
    else if (!res.writableEnded) res.end();
  });
  child.on("close", (code) => {
    res.off("close", closeChild);
    if (code !== 0 && !res.headersSent) {
      res.status(500).json({ error: stderr.trim() || `archive entry stream failed (${code})` });
      return;
    }
    if (!res.writableEnded) res.end();
  });

  child.stdout.pipe(res);
}

function generateArchiveVideoFrame(archiveItem, entry, frameItem) {
  const jobKey = `${frameItem.previewKey}|archive-frame-buffer`;
  if (pendingFrameJobs.has(jobKey)) return pendingFrameJobs.get(jobKey);

  const job = new Promise((resolve, reject) => {
    const extract = spawn(ARCHIVE_LIST_BIN, ["x", "-so", "-sccUTF-8", archiveItem.sourcePath, entry.path], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ffmpeg = spawn(
      FFMPEG_BIN,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        "pipe:0",
        "-ss",
        "1",
        "-frames:v",
        "1",
        "-vf",
        "scale=640:-1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );

    let stderr = "";
    const chunks = [];
    let size = 0;
    let settled = false;
    const killBoth = () => {
      try {
        extract.kill("SIGKILL");
      } catch {}
      try {
        ffmpeg.kill("SIGKILL");
      } catch {}
    };
    const finish = (err, buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(buffer);
    };
    const timer = setTimeout(() => {
      killBoth();
      finish(new Error("archive video frame timed out"));
    }, 20000);

    extract.stdout.pipe(ffmpeg.stdin);
    extract.on("error", (err) => {
      killBoth();
      finish(err);
    });
    ffmpeg.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        killBoth();
        finish(new Error("archive video frame too large"));
        return;
      }
      chunks.push(chunk);
    });
    ffmpeg.stderr.on("data", (chunk) => {
      if (stderr.length > 4096) return;
      stderr += chunk.toString("utf8");
    });
    ffmpeg.on("error", (err) => {
      killBoth();
      finish(err);
    });
    ffmpeg.on("close", (code) => {
      if (settled) return;
      if (code === 0 && size > 0) {
        finish(null, Buffer.concat(chunks, size));
        return;
      }
      finish(new Error(stderr.trim() || `archive video frame failed (${code})`));
    });
  }).finally(() => {
    pendingFrameJobs.delete(jobKey);
  });

  pendingFrameJobs.set(jobKey, job);
  return job;
}

async function scanAllFiles(scanPaths, excludePaths) {
  const normalizedExcludes = excludePaths.map((p) => normalizePathForCompare(p));
  const queue = [];
  for (const root of scanPaths) {
    const resolved = path.resolve(root);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      queue.push({ root: resolved, dir: resolved });
    }
  }

  const seenFiles = new Set();
  const collected = [];
  let cursor = 0;

  function isExcluded(targetPath) {
    const normalized = normalizePathForCompare(targetPath);
    for (const excluded of normalizedExcludes) {
      if (normalized === excluded || normalized.startsWith(`${excluded}\\`)) {
        return true;
      }
    }
    return false;
  }

  async function workerLoop() {
    while (true) {
      let work = null;
      if (cursor < queue.length) {
        work = queue[cursor];
        cursor += 1;
      }

      if (!work) {
        break;
      }

      if (isExcluded(work.dir)) {
        continue;
      }

      let entries;
      try {
        entries = await fsp.readdir(work.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(work.dir, entry.name);
        if (isExcluded(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          queue.push({ root: work.root, dir: fullPath });
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const dedupeKey = normalizePathForCompare(fullPath);
        if (seenFiles.has(dedupeKey)) {
          continue;
        }

        seenFiles.add(dedupeKey);
        collected.push({ root: work.root, fullPath });
      }
    }
  }

  const workers = Array.from({ length: SCAN_CONCURRENCY }, () => workerLoop());
  await Promise.all(workers);
  return collected;
}

function itemFromDbRow(row) {
  const extension = String(row.extension || "").toLowerCase();
  const canDirectPlay = DIRECT_PLAYABLE_VIDEO_EXTENSIONS.has(extension);
  return {
    id: row.file_key,
    sourcePath: row.source_path,
    scanRoot: row.scan_root,
    relativePath: row.relative_path,
    name: row.file_name,
    extension: row.extension,
    category: row.category,
    mimeType: row.mime_type,
    size: row.size,
    updatedAt: row.modified_at,
    rawFolder: row.raw_folder,
    displayFolder: row.display_folder,
    displayPath: row.display_path,
    previewKey: row.preview_key,
    mediaUrl: `/media?id=${encodeURIComponent(row.file_key)}`,
    transcodeUrl: `/media-transcode?id=${encodeURIComponent(row.file_key)}`,
    transcodeFileUrl: `/media-transcode-file?id=${encodeURIComponent(row.file_key)}`,
    downloadUrl: `/download?id=${encodeURIComponent(row.file_key)}`,
    previewUrl: `/api/preview?id=${encodeURIComponent(row.file_key)}`,
    directPlayPreferred: row.category !== "video" ? true : canDirectPlay,
  };
}

function toClientItem(item) {
  return {
    id: item.id,
    relativePath: item.relativePath,
    displayFolder: item.displayFolder,
    name: item.name,
    extension: item.extension,
    category: item.category,
    size: item.size,
    updatedAt: item.updatedAt,
    displayPath: item.displayPath,
    previewKey: item.previewKey,
    mediaUrl: item.mediaUrl,
    transcodeUrl: item.transcodeUrl,
    transcodeFileUrl: item.transcodeFileUrl,
    downloadUrl: item.downloadUrl,
    previewUrl: item.previewUrl,
    directPlayPreferred: item.directPlayPreferred,
    archiveId: item.archiveId,
    archiveEntryPath: item.archiveEntryPath,
    sourceArchiveId: item.sourceArchiveId,
  };
}

function buildSnapshotFromItems(items) {
  const rootNode = createTreeNode("/", "/");
  const nodes = new Map([["/", rootNode]]);
  const folderMap = new Map();

  const byCategory = {
    video: 0,
    image: 0,
    audio: 0,
    document: 0,
    archive: 0,
    code: 0,
    other: 0,
  };

  let totalItems = 0;
  let totalSize = 0;

  const flatFoldersMap = new Map();

  for (const item of items) {
    totalItems += 1;
    totalSize += Number(item.size || 0);
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;

    if (!flatFoldersMap.has(item.displayFolder)) {
      flatFoldersMap.set(item.displayFolder, {
        folder: item.displayFolder,
        count: 0,
      });
    }
    flatFoldersMap.get(item.displayFolder).count += 1;

    const clientItem = toClientItem(item);
    if (!folderMap.has(item.displayFolder)) {
      folderMap.set(item.displayFolder, []);
    }
    folderMap.get(item.displayFolder).push(clientItem);

    const segments = item.displayFolder === "/" ? [] : item.displayFolder.split("/").filter(Boolean);
    let cursorNode = rootNode;
    let cursorPath = "";

    for (const segment of segments) {
      cursorPath = cursorPath ? `${cursorPath}/${segment}` : segment;
      if (!nodes.has(cursorPath)) {
        const node = createTreeNode(segment, cursorPath);
        nodes.set(cursorPath, node);
        cursorNode.children.push(node);
      }
      cursorNode = nodes.get(cursorPath);
    }

    cursorNode.items.push(clientItem);
  }

  function finalize(node) {
    for (const child of node.children) {
      finalize(child);
    }

    node.items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    node.children.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));

    const counts = {
      total: node.items.length,
      video: 0,
      image: 0,
      audio: 0,
      document: 0,
      archive: 0,
      code: 0,
      other: 0,
    };

    for (const item of node.items) {
      counts[item.category] += 1;
    }

    for (const child of node.children) {
      counts.total += child.counts.total;
      counts.video += child.counts.video;
      counts.image += child.counts.image;
      counts.audio += child.counts.audio;
      counts.document += child.counts.document;
      counts.archive += child.counts.archive;
      counts.code += child.counts.code;
      counts.other += child.counts.other;
    }

    node.counts = counts;
  }

  finalize(rootNode);

  for (const [folder, list] of folderMap) {
    list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    folderMap.set(folder, list);
  }

  function toSummaryTree(node) {
    const children = node.children.map((child) => toSummaryTree(child));
    const ownCounts = {
      total: node.items.length,
      video: 0,
      image: 0,
      audio: 0,
      document: 0,
      archive: 0,
      code: 0,
      other: 0,
    };
    for (const item of node.items) {
      ownCounts[item.category] += 1;
    }

    let sampleAny = node.items.length ? node.items[0] : null;
    if (!sampleAny) {
      const firstChildWithSample = children.find((child) => child.sampleItemId);
      if (firstChildWithSample) {
        sampleAny = {
          id: firstChildWithSample.sampleItemId,
          category: firstChildWithSample.sampleCategory || "other",
        };
      }
    }

    let sampleMedia = node.items.find((item) => item.category === "video" || item.category === "image") || null;
    if (!sampleMedia) {
      const firstChildWithMedia = children.find((child) => child.sampleMediaItemId);
      if (firstChildWithMedia) {
        sampleMedia = {
          id: firstChildWithMedia.sampleMediaItemId,
          category: firstChildWithMedia.sampleMediaCategory || "video",
        };
      }
    }

    let sampleArchive = node.items.find((item) => item.category === "archive") || null;
    if (!sampleArchive) {
      const firstChildWithArchive = children.find((child) => child.sampleArchiveItemId);
      if (firstChildWithArchive) {
        sampleArchive = {
          id: firstChildWithArchive.sampleArchiveItemId,
          category: "archive",
        };
      }
    }

    return {
      id: node.id,
      name: node.name,
      path: node.path,
      counts: node.counts,
      ownCounts,
      sampleItemId: sampleAny ? sampleAny.id : null,
      sampleCategory: sampleAny ? sampleAny.category : null,
      sampleMediaItemId: sampleMedia ? sampleMedia.id : null,
      sampleMediaCategory: sampleMedia ? sampleMedia.category : null,
      sampleArchiveItemId: sampleArchive ? sampleArchive.id : null,
      children,
    };
  }

  return {
    totalItems,
    totalSize,
    byCategory,
    tree: toSummaryTree(rootNode),
    folderItems: folderMap,
    flatFolders: Array.from(flatFoldersMap.values()).sort((a, b) => {
      if (a.folder === "/") return -1;
      if (b.folder === "/") return 1;
      return a.folder.localeCompare(b.folder, "zh-Hant");
    }),
  };
}

function loadSnapshotFromDb() {
  const rows = selectMediaRowsStmt.all();
  const items = rows.map(itemFromDbRow);

  itemLookup = new Map(items.map((item) => [item.id, item]));

  const summary = buildSnapshotFromItems(items);
  folderItemsLookup = summary.folderItems;
  librarySnapshot = {
    generation: indexState.generation,
    totalItems: summary.totalItems,
    totalSize: summary.totalSize,
    byCategory: summary.byCategory,
    tree: summary.tree,
    flatFolders: summary.flatFolders,
    generatedAt: new Date().toISOString(),
  };
}

function persistMediaItems(items) {
  db.exec("BEGIN TRANSACTION");
  try {
    clearMediaStmt.run();
    for (const item of items) {
      insertMediaStmt.run(item);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

let pendingRescan = false;

async function triggerRescan(reason = "manual") {
  if (indexState.isIndexing) {
    pendingRescan = true;
    return;
  }

  indexState.isIndexing = true;
  indexState.startedAt = new Date().toISOString();
  indexState.lastError = null;
  indexState.generation += 1;
  lastAutoRescanAt = Date.now();

  try {
    const scanPaths = getScanPaths();
    const excludePaths = getExcludePaths();
    const files = await scanAllFiles(scanPaths, excludePaths);
    const indexedAt = new Date().toISOString();

    const itemsForDb = [];
    for (const file of files) {
      const fullPath = file.fullPath;
      const scanRoot = file.root;

      if (!isInsideRoot(scanRoot, fullPath)) {
        continue;
      }

      let stat;
      try {
        stat = await fsp.stat(fullPath);
      } catch {
        continue;
      }

      const extension = path.extname(fullPath).toLowerCase();
      const category = getCategory(extension);
      const relativePath = normalizeToSlash(path.relative(scanRoot, fullPath));
      const fileName = path.basename(fullPath);
      const rawFolder = normalizeToSlash(path.dirname(relativePath));
      const normalizedRawFolder = rawFolder === "." ? "/" : rawFolder;
      const normalizedRoot = normalizeToSlash(scanRoot);
      const displayFolder = normalizedRawFolder === "/" ? normalizedRoot : `${normalizedRoot}/${normalizedRawFolder}`;
      const displayPath = normalizeToSlash(fullPath);

      const fileKey = hashFileKey(fullPath);
      const previewKey = hashForPreview(fullPath, stat.size, stat.mtimeMs);

      itemsForDb.push({
        file_key: fileKey,
        source_path: fullPath,
        scan_root: scanRoot,
        relative_path: relativePath,
        file_name: fileName,
        extension,
        category,
        mime_type: getMimeType(extension),
        size: stat.size,
        modified_ms: Math.floor(stat.mtimeMs),
        modified_at: stat.mtime.toISOString(),
        raw_folder: normalizedRawFolder,
        display_folder: displayFolder,
        display_path: displayPath,
        preview_key: previewKey,
        indexed_at: indexedAt,
      });
    }

    persistMediaItems(itemsForDb);
    loadSnapshotFromDb();

    previewState.totalQueuedThisRound = 0;
    previewState.finishedThisRound = 0;

    let warmItems = Array.from(itemLookup.values())
      .sort((a, b) => {
        const score = (category) => {
          if (category === "image") return 4;
          if (category === "video") return 3;
          if (category === "archive") return 2;
          if (category === "audio") return 1.5;
          return 1;
        };
        return score(b.category) - score(a.category);
      });

    if (runtimeOptions.preferMediaFolderPreview) {
      warmItems = warmItems.filter(
        (item) => item.category === "video" || item.category === "image" || item.category === "archive"
      );
    }

    warmItems = warmItems.slice(0, runtimeOptions.previewQueueBatch);

    for (const item of warmItems) {
      enqueuePreviewJob(item);
    }
  } catch (err) {
    indexState.lastError = err.message || `Rescan failed (${reason})`;
  } finally {
    indexState.isIndexing = false;
    indexState.finishedAt = new Date().toISOString();

    if (pendingRescan) {
      pendingRescan = false;
      setImmediate(() => {
        triggerRescan("pending").catch(() => {
          // no-op
        });
      });
    }
  }
}

function startRescan(reason = "manual") {
  const wasIndexing = indexState.isIndexing;
  triggerRescan(reason).catch(() => {
    // triggerRescan records failures in indexState.lastError.
  });
  return {
    accepted: true,
    indexing: indexState.isIndexing || wasIndexing,
    pending: pendingRescan,
    generation: indexState.generation,
  };
}

function getIndexStatus() {
  return {
    isIndexing: indexState.isIndexing,
    startedAt: indexState.startedAt,
    finishedAt: indexState.finishedAt,
    lastError: indexState.lastError,
    generation: indexState.generation,
    pendingRescan,
  };
}

function getPreviewStatus() {
  return {
    active: previewState.active,
    queued: previewState.queued,
    totalQueuedThisRound: previewState.totalQueuedThisRound,
    finishedThisRound: previewState.finishedThisRound,
    ffmpegEnabled: supportsFfmpeg,
    threads: PREVIEW_THREADS,
  };
}

function getStatusResponse() {
  return {
    generation: librarySnapshot.generation,
    totalItems: librarySnapshot.totalItems,
    totalSize: librarySnapshot.totalSize,
    generatedAt: librarySnapshot.generatedAt,
    index: getIndexStatus(),
    preview: getPreviewStatus(),
  };
}

function getLibraryResponse() {
  return {
    ...librarySnapshot,
    index: getIndexStatus(),
    preview: getPreviewStatus(),
  };
}

function getItemById(id) {
  if (!id) return null;
  return itemLookup.get(String(id)) || null;
}

function sortItems(items, sort) {
  const list = items.slice();
  const mode = String(sort || "time_desc");

  const compareName = (a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true, sensitivity: "base" });
  const compareTime = (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt);
  const compareSize = (a, b) => Number(a.size || 0) - Number(b.size || 0);

  if (mode === "name_asc") list.sort(compareName);
  else if (mode === "name_desc") list.sort((a, b) => compareName(b, a));
  else if (mode === "size_asc") list.sort(compareSize);
  else if (mode === "size_desc") list.sort((a, b) => compareSize(b, a));
  else if (mode === "time_asc") list.sort(compareTime);
  else if (mode === "type_asc") {
    list.sort((a, b) => {
      const categoryCmp = a.category.localeCompare(b.category, "zh-Hant");
      if (categoryCmp !== 0) return categoryCmp;
      return compareName(a, b);
    });
  } else {
    list.sort((a, b) => compareTime(b, a));
  }

  return list;
}

function streamWithRange(filePath, mimeType, req, res) {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath, { highWaterMark: MEDIA_STREAM_HIGH_WATER_MARK }).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
    return;
  }

  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize) {
    res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
    return;
  }

  end = Math.min(end, fileSize - 1);
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": mimeType,
    "Cache-Control": "no-store",
  });

  fs.createReadStream(filePath, { start, end, highWaterMark: MEDIA_STREAM_HIGH_WATER_MARK }).pipe(res);
}

function streamWholeFile(filePath, mimeType, res) {
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Length": stat.size,
    "Content-Type": mimeType,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath, { highWaterMark: MEDIA_STREAM_HIGH_WATER_MARK }).pipe(res);
}

function sendMedia(item, req, res) {
  if (!item || !fs.existsSync(item.sourcePath)) {
    res.status(404).json({ error: "Media not found" });
    return;
  }

  if (item.category === "video" || item.category === "audio") {
    streamWithRange(item.sourcePath, item.mimeType, req, res);
    return;
  }

  streamWholeFile(item.sourcePath, item.mimeType, res);
}

function streamVideoTranscode(item, req, res) {
  if (!item || item.category !== "video") {
    res.status(404).json({ error: "video not found" });
    return;
  }

  if (!fs.existsSync(item.sourcePath)) {
    res.status(404).json({ error: "video not found" });
    return;
  }

  if (!supportsFfmpeg) {
    sendMedia(item, req, res);
    return;
  }

  const liveTranscodePreset =
    runtimeOptions.transcodePreset === "ultrafast" || runtimeOptions.transcodePreset === "superfast"
      ? runtimeOptions.transcodePreset
      : "superfast";
  const liveProbeSize = Math.max(50000, Math.min(Number(runtimeOptions.transcodeProbeSize) || 50000, 400000));
  const liveAnalyzeDuration = Math.max(50000, Math.min(Number(runtimeOptions.transcodeAnalyzeDuration) || 50000, 400000));

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-fflags",
    "+genpts",
    "-probesize",
    String(liveProbeSize),
    "-analyzeduration",
    String(liveAnalyzeDuration),
    "-i",
    item.sourcePath,
    "-map",
    "0:V:0?",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-c:v",
    "libx264",
    "-preset",
    liveTranscodePreset,
  ];

  if (runtimeOptions.transcodeTuneZerolatency) {
    args.push("-tune", "zerolatency");
  }

  args.push(
    "-g",
    String(runtimeOptions.transcodeKeyint),
    "-keyint_min",
    String(runtimeOptions.transcodeKeyint),
    "-sc_threshold",
    "0",
    "-crf",
    String(runtimeOptions.transcodeCrf),
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:a",
    "aac",
    "-b:a",
    `${runtimeOptions.transcodeAudioKbps}k`,
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof+faststart",
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-f",
    "mp4",
    "pipe:1",
  );

  let stderrText = "";
  let finished = false;

  const ffmpeg = spawn(FFMPEG_BIN, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const cleanup = () => {
    req.off("close", closeHandler);
    req.off("aborted", closeHandler);
    res.off("close", closeHandler);
  };

  const closeHandler = () => {
    if (finished) return;
    try {
      ffmpeg.kill("SIGKILL");
    } catch {
      // ignore cleanup kill failure
    }
  };

  req.on("close", closeHandler);
  req.on("aborted", closeHandler);
  res.on("close", closeHandler);

  ffmpeg.stderr.on("data", (chunk) => {
    if (stderrText.length > 4096) return;
    stderrText += chunk.toString("utf8");
  });

  ffmpeg.on("error", (err) => {
    finished = true;
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: `ffmpeg 啟動失敗: ${err.message || "spawn failed"}` });
      return;
    }
    if (!res.writableEnded) res.end();
  });

  res.status(200);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Accept-Ranges", "none");
  res.setHeader("X-Transcode", "ffmpeg");

  ffmpeg.stdout.pipe(res);

  ffmpeg.on("close", (code) => {
    finished = true;
    cleanup();
    if (code === 0) {
      if (!res.writableEnded) res.end();
      return;
    }

    if (!res.headersSent) {
      const detail = stderrText.trim() || `exit code ${code}`;
      res.status(500).json({ error: `轉碼失敗: ${detail}` });
      return;
    }

    if (!res.writableEnded) res.end();
  });
}

function getTranscodeOutputPath(item) {
  const safeId = String(item?.id || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safePreviewKey = String(item?.previewKey || "v").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(TRANSCODE_DIR, `${safeId}_${safePreviewKey}.mp4`);
}

async function ensureTranscodedFile(item) {
  const outputPath = getTranscodeOutputPath(item);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    return outputPath;
  }

  const jobKey = `${item.id}|${item.previewKey}`;
  if (pendingTranscodeJobs.has(jobKey)) {
    return pendingTranscodeJobs.get(jobKey);
  }

  const job = new Promise((resolve, reject) => {
    ensureDir(TRANSCODE_DIR);
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      item.sourcePath,
      "-map",
      "0:V:0?",
      "-map",
      "0:a:0?",
      "-sn",
      "-dn",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    const ffmpeg = spawn(FFMPEG_BIN, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderrText = "";
    ffmpeg.stderr.on("data", (chunk) => {
      if (stderrText.length > 4096) return;
      stderrText += chunk.toString("utf8");
    });

    ffmpeg.on("error", (err) => {
      reject(new Error(`ffmpeg 啟動失敗: ${err.message || "spawn failed"}`));
    });

    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        resolve(outputPath);
        return;
      }
      const detail = stderrText.trim() || `exit code ${code}`;
      reject(new Error(`轉碼失敗: ${detail}`));
    });
  }).finally(() => {
    pendingTranscodeJobs.delete(jobKey);
  });

  pendingTranscodeJobs.set(jobKey, job);
  return job;
}

function fallbackPreviewSvg(item) {
  const safeName = (item.name || "file").replace(/[&<>'"]/g, "");
  const ext = (item.extension || "").replace(".", "").toUpperCase() || "FILE";
  const category = (item.category || "other").toUpperCase();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#f4f7fb" />
  <rect x="24" y="24" width="592" height="312" rx="20" fill="#d8e7fb" />
  <text x="56" y="110" font-family="Arial,sans-serif" font-size="38" fill="#0f172a">${category}</text>
  <text x="56" y="170" font-family="Arial,sans-serif" font-size="30" fill="#1f2937">.${ext}</text>
  <text x="56" y="220" font-family="Arial,sans-serif" font-size="18" fill="#334155">${safeName.slice(0, 44)}</text>
</svg>`;
}

function ensureFallbackPreviewCached(item) {
  if (!item?.previewKey) return null;
  try {
    ensureDir(PREVIEW_DIR);
    const outputPath = path.join(PREVIEW_DIR, `${item.previewKey}.svg`);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
      fs.writeFileSync(outputPath, fallbackPreviewSvg(item), "utf8");
    }
    const entry = {
      previewKey: item.previewKey,
      outputPath,
      mimeType: "image/svg+xml",
      updatedAt: Date.now(),
    };
    previewCache.set(item.id, entry);
    return entry;
  } catch {
    return null;
  }
}

function getPreviewFileByKey(previewKey) {
  if (!previewKey) return null;

  const candidates = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".heic", ".svg"];
  for (const ext of candidates) {
    const filePath = path.join(PREVIEW_DIR, `${previewKey}${ext}`);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return { outputPath: filePath, mimeType: getMimeType(ext) };
    }
  }

  return null;
}

function resolveCachedPreview(item) {
  const fromMemory = previewCache.get(item.id);
  if (fromMemory && fromMemory.previewKey === item.previewKey && fs.existsSync(fromMemory.outputPath)) {
    return fromMemory;
  }

  const fromDisk = getPreviewFileByKey(item.previewKey);
  if (!fromDisk) return null;

  const synced = {
    previewKey: item.previewKey,
    outputPath: fromDisk.outputPath,
    mimeType: fromDisk.mimeType,
    updatedAt: Date.now(),
  };
  previewCache.set(item.id, synced);
  return synced;
}

async function generateScrubFrame(item, second) {
  const safeSecond = Math.max(0, Math.floor(Number(second) || 0));
  const itemFrameDir = path.join(SCRUB_DIR, item.id);
  ensureDir(itemFrameDir);

  const outputPath = path.join(itemFrameDir, `${safeSecond}.jpg`);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    return outputPath;
  }

  const jobKey = `${item.id}|${safeSecond}`;
  if (pendingFrameJobs.has(jobKey)) {
    return pendingFrameJobs.get(jobKey);
  }

  const job = new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      FFMPEG_BIN,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(safeSecond),
        "-i",
        item.sourcePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=420:-1",
        outputPath,
      ],
      { windowsHide: true }
    );

    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        resolve(outputPath);
        return;
      }
      reject(new Error("ffmpeg frame generation failed"));
    });
  }).finally(() => {
    pendingFrameJobs.delete(jobKey);
  });

  pendingFrameJobs.set(jobKey, job);
  return job;
}

function isSameOriginRequest(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;

  const host = String(req.headers.host || "").toLowerCase();
  if (!host) return false;

  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function rejectCrossOriginUnsafeRequests(req, res, next) {
  if (!UNSAFE_METHODS.has(req.method) || !req.path.startsWith("/api/")) {
    next();
    return;
  }

  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site" || !isSameOriginRequest(req)) {
    res.status(403).json({ error: "cross-origin requests are not allowed" });
    return;
  }

  next();
}

app.use((req, res, next) => {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(header, value);
  }
  next();
});
app.use(rejectCrossOriginUnsafeRequests);
app.use(express.json({ limit: "1mb" }));
app.use(compression());
app.use((req, res, next) => {
  if (
    req.method === "GET" &&
    (req.path === "/" || req.path.endsWith(".html") || req.path.endsWith(".js") || req.path.endsWith(".css"))
  ) {
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  }
  next();
});

app.get("/", (req, res) => {
  const ua = String(req.headers["user-agent"] || "");
  if (/mobile|android|iphone|ipad|ipod/i.test(ua)) {
    res.sendFile(path.join(__dirname, "public", "mobile.html"));
    return;
  }
  res.sendFile(path.join(__dirname, "public", "desktop.html"));
});



app.use(express.static(path.join(__dirname, "public")));
app.use("/preview-cache", express.static(PREVIEW_DIR));

app.get("/api/server-info", (_req, res) => {
  const preferredIp = getPreferredLanIPv4();
  const ips = getLanIPv4Candidates();
  res.json({
    port: PORT,
    localIp: preferredIp,
    url: `http://${preferredIp}:${PORT}`,
    urls: ips.map((ip) => `http://${ip}:${PORT}`),
    preview: {
      ffmpegEnabled: supportsFfmpeg,
      threads: PREVIEW_THREADS,
    },
    scan: {
      concurrency: SCAN_CONCURRENCY,
    },
    options: runtimeOptions,
  });
});
app.get("/api/settings", (_req, res) => {
  res.json({
    scanPaths: getScanPaths(),
    excludePaths: getExcludePaths(),
    options: runtimeOptions,
  });
});

app.get("/api/admin-options", (_req, res) => {
  res.json(getAdminOptionsPayload());
});

app.post("/api/admin-options", (req, res) => {
  try {
    const incoming = req.body || {};
    const autoRescanMinutes = clampNumber(incoming.autoRescanMinutes, 1, 1440, Math.round(runtimeOptions.autoRescanMs / 60000));

    runtimeOptions = sanitizeRuntimeOptions({
      ...runtimeOptions,
      ...incoming,
      autoRescanMs: Math.round(autoRescanMinutes * 60000),
    });

    setSetting("autoRescanMs", runtimeOptions.autoRescanMs);
    setSetting("previewQueueBatch", runtimeOptions.previewQueueBatch);
    setSetting("preferMediaFolderPreview", runtimeOptions.preferMediaFolderPreview);
    setSetting("mobileTranscodeFirst", runtimeOptions.mobileTranscodeFirst);
    setSetting("videoFallbackTimeoutMs", runtimeOptions.videoFallbackTimeoutMs);
    setSetting("videoHoldSpeed", runtimeOptions.videoHoldSpeed);
    setSetting("videoHoldTriggerMs", runtimeOptions.videoHoldTriggerMs);
    setSetting("videoSeekSeconds", runtimeOptions.videoSeekSeconds);
    setSetting("videoSeekSecondsShift", runtimeOptions.videoSeekSecondsShift);
    setSetting("imageZoomMobile", runtimeOptions.imageZoomMobile);
    setSetting("imageZoomDesktop", runtimeOptions.imageZoomDesktop);
    setSetting("transcodePreset", runtimeOptions.transcodePreset);
    setSetting("transcodeCrf", runtimeOptions.transcodeCrf);
    setSetting("transcodeAudioKbps", runtimeOptions.transcodeAudioKbps);
    setSetting("transcodeProbeSize", runtimeOptions.transcodeProbeSize);
    setSetting("transcodeAnalyzeDuration", runtimeOptions.transcodeAnalyzeDuration);
    setSetting("transcodeKeyint", runtimeOptions.transcodeKeyint);
    setSetting("transcodeTuneZerolatency", runtimeOptions.transcodeTuneZerolatency);

    res.json({
      ok: true,
      options: getAdminOptionsPayload(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to update options" });
  }
});

app.post("/api/restart-server", (_req, res) => {
  try {
    const scheduled = scheduleServerRestart();
    if (!scheduled) {
      res.status(409).json({ ok: false, error: "restart already in progress" });
      return;
    }
    res.json({ ok: true, restarting: true });
    setTimeout(() => {
      process.exit(0);
    }, 250);
  } catch (err) {
    restartInProgress = false;
    res.status(500).json({ ok: false, error: err.message || "failed to restart" });
  }
});

app.post("/api/scan-paths", async (req, res) => {
  try {
    const raw = String(req.body?.path || "").trim();
    if (!raw) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const resolved = path.resolve(raw);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      res.status(400).json({ error: "path does not exist or is not directory" });
      return;
    }

    const now = new Date().toISOString();
    insertScanPathStmt.run(resolved, now, now);
    const rescan = startRescan("add-scan-path");

    res.json({ scanPaths: getScanPaths(), excludePaths: getExcludePaths(), rescan });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to add scan path" });
  }
});

app.delete("/api/scan-paths", async (req, res) => {
  try {
    const raw = String(req.body?.path || "").trim();
    if (!raw) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const resolved = path.resolve(raw);
    const current = getScanPaths();
    const exists = current.some((p) => path.resolve(p).toLowerCase() === resolved.toLowerCase());
    if (!exists) {
      res.json({ scanPaths: current, excludePaths: getExcludePaths() });
      return;
    }

    if (current.length <= 1) {
      res.status(400).json({ error: "至少保留一個掃描路徑" });
      return;
    }

    deleteScanPathStmt.run(resolved);
    const rescan = startRescan("remove-scan-path");

    res.json({ scanPaths: getScanPaths(), excludePaths: getExcludePaths(), rescan });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to remove scan path" });
  }
});

app.post("/api/exclude-paths", async (req, res) => {
  try {
    const raw = String(req.body?.path || "").trim();
    if (!raw) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const resolved = path.resolve(raw);
    const now = new Date().toISOString();
    insertExcludePathStmt.run(resolved, now, now);
    const rescan = startRescan("add-exclude-path");

    res.json({ scanPaths: getScanPaths(), excludePaths: getExcludePaths(), rescan });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to add exclude path" });
  }
});

app.delete("/api/exclude-paths", async (req, res) => {
  try {
    const raw = String(req.body?.path || "").trim();
    if (!raw) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const resolved = path.resolve(raw);
    deleteExcludePathStmt.run(resolved);
    const rescan = startRescan("remove-exclude-path");

    res.json({ scanPaths: getScanPaths(), excludePaths: getExcludePaths(), rescan });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to remove exclude path" });
  }
});

app.post("/api/rescan", (_req, res) => {
  const rescan = startRescan("api-rescan");
  res.json({ ok: true, indexing: rescan.indexing, pending: rescan.pending, rescan });
});

app.get("/api/library", (_req, res) => {
  res.json({
    ...getLibraryResponse(),
    options: runtimeOptions,
  });
});

app.get("/api/status", (_req, res) => {
  res.json(getStatusResponse());
});

app.get("/api/folder-items", (req, res) => {
  try {
    const folderPath = String(req.query.path || "").trim();
    if (!folderPath) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const selectedTypes = new Set(
      String(req.query.types || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    );
    const keyword = String(req.query.keyword || "").trim().toLowerCase();
    const sort = String(req.query.sort || "time_desc");

    let items = folderItemsLookup.get(folderPath) || [];

    if (selectedTypes.size > 0) {
      items = items.filter((item) => selectedTypes.has(item.category));
    }

    if (keyword) {
      items = items.filter((item) =>
        [item.name, item.displayPath, item.relativePath].join(" ").toLowerCase().includes(keyword)
      );
    }

    const sorted = sortItems(items, sort);

    res.json({
      path: folderPath,
      total: sorted.length,
      items: sorted,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load folder items" });
  }
});

app.get("/api/item", (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "id is required" });
      return;
    }

    const item = getItemById(id);
    if (!item) {
      res.status(404).json({ error: "item not found" });
      return;
    }

    res.json({ item: toClientItem(item) });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load item" });
  }
});

app.get("/api/archive-preview", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const id = String(req.query.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "id is required" });
      return;
    }

    const item = getItemById(id);
    if (!item || item.category !== "archive") {
      res.status(404).json({ error: "archive not found" });
      return;
    }
    if (!fs.existsSync(item.sourcePath)) {
      res.status(404).json({ error: "archive not found" });
      return;
    }

    const preview = await getArchivePreview(item);
    res.json(preview);
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to preview archive" });
  }
});

app.get("/api/archive-media", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const resolved = await getArchiveEntryForRequest(req, res);
    if (!resolved) return;
    streamArchiveEntry(resolved.archiveItem, resolved.entry, res, { download: req.query.download === "1" });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message || "failed to stream archive entry" });
  }
});

app.get("/api/archive-entry-preview", async (req, res) => {
  try {
    const resolved = await getArchiveEntryForRequest(req, res);
    if (!resolved) return;
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(fallbackPreviewSvg(resolved.item));
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to preview archive entry" });
  }
});

app.get("/api/archive-video-frame", async (req, res) => {
  try {
    const resolved = await getArchiveEntryForRequest(req, res);
    if (!resolved) return;
    if (!supportsFfmpeg) {
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(fallbackPreviewSvg(resolved.item));
      return;
    }

    const frame = await generateArchiveVideoFrame(resolved.archiveItem, resolved.entry, resolved.item);
    res.type("image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(frame);
  } catch {
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(fallbackPreviewSvg({ name: "archive video", extension: ".mp4", category: "video" }));
  }
});

app.get("/api/preview", async (req, res) => {
  const id = String(req.query.id || "");
  const item = getItemById(id);
  if (!item) {
    res.status(404).json({ error: "file not found" });
    return;
  }

  const cacheEntry = resolveCachedPreview(item);
  const canUpgradeMediaSvg =
    cacheEntry &&
    cacheEntry.mimeType === "image/svg+xml" &&
    (item.category === "video" || item.category === "image") &&
    supportsFfmpeg &&
    fs.existsSync(item.sourcePath);
  const canUpgradeArchiveSvg =
    cacheEntry &&
    cacheEntry.mimeType === "image/svg+xml" &&
    item.category === "archive" &&
    fs.existsSync(item.sourcePath);

  if (cacheEntry && !canUpgradeMediaSvg) {
    if (canUpgradeArchiveSvg) queueArchiveCoverUpgrade(item);
    res.type(cacheEntry.mimeType || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(cacheEntry.outputPath).pipe(res);
    return;
  }

  if (canUpgradeMediaSvg || item.category === "video" || item.category === "image") {
    const generated = await generatePreviewNow(item);
    if (generated && fs.existsSync(generated.outputPath)) {
      res.type(generated.mimeType || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      fs.createReadStream(generated.outputPath).pipe(res);
      return;
    }
  }

  if (item.category === "video" && supportsFfmpeg && fs.existsSync(item.sourcePath)) {
    try {
      const framePath = await generateScrubFrame(item, 1);
      res.type("image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      fs.createReadStream(framePath).pipe(res);
      return;
    } catch {
      // continue to queued preview / fallback
    }
  }

  if (item.category === "archive") {
    const fallbackArchivePreview = ensureFallbackPreviewCached(item);
    if (fallbackArchivePreview && fs.existsSync(fallbackArchivePreview.outputPath)) {
      queueArchiveCoverUpgrade(item);
      res.type(fallbackArchivePreview.mimeType || "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=86400");
      fs.createReadStream(fallbackArchivePreview.outputPath).pipe(res);
      return;
    }
  }

  const shouldQueuePreview =
    !runtimeOptions.preferMediaFolderPreview ||
    item.category === "video" ||
    item.category === "image" ||
    item.category === "archive";
  if (shouldQueuePreview) {
    enqueuePreviewJob(item);
  }
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(fallbackPreviewSvg(item));
});

app.get("/api/video-frame", async (req, res) => {
  try {
    const id = String(req.query.id || "");
    const item = getItemById(id);
    if (!item || item.category !== "video") {
      res.status(404).json({ error: "video not found" });
      return;
    }

    if (!supportsFfmpeg || !fs.existsSync(item.sourcePath)) {
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(fallbackPreviewSvg(item));
      return;
    }

    const second = Math.max(0, Math.floor(Number(req.query.t) || 0));
    const framePath = await generateScrubFrame(item, second);
    res.type("image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    fs.createReadStream(framePath).pipe(res);
  } catch {
    const id = String(req.query.id || "");
    const item = getItemById(id);
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(fallbackPreviewSvg(item || { name: "video", extension: ".mp4", category: "video" }));
  }
});

app.get("/media", (req, res) => {
  const id = String(req.query.id || "");
  const item = getItemById(id);
  if (!item) {
    res.status(404).json({ error: "media not found" });
    return;
  }

  sendMedia(item, req, res);
});

app.get("/media-transcode", (req, res) => {
  const id = String(req.query.id || "");
  const item = getItemById(id);
  if (!item) {
    res.status(404).json({ error: "media not found" });
    return;
  }

  streamVideoTranscode(item, req, res);
});

app.get("/media-transcode-file", async (req, res) => {
  try {
    const id = String(req.query.id || "");
    const item = getItemById(id);
    if (!item) {
      res.status(404).json({ error: "media not found" });
      return;
    }

    if (item.category !== "video") {
      sendMedia(item, req, res);
      return;
    }

    if (!supportsFfmpeg) {
      sendMedia(item, req, res);
      return;
    }

    const outputPath = await ensureTranscodedFile(item);
    streamWithRange(outputPath, "video/mp4", req, res);
  } catch (err) {
    res.status(500).json({ error: err.message || "transcode file failed" });
  }
});

app.get("/download", (req, res) => {
  const id = String(req.query.id || "");
  const item = getItemById(id);
  if (!item) {
    res.status(404).json({ error: "file not found" });
    return;
  }

  if (!fs.existsSync(item.sourcePath)) {
    res.status(404).json({ error: "file not found" });
    return;
  }

  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`);
  streamWholeFile(item.sourcePath, item.mimeType, res);
});

app.listen(PORT, HOST, async () => {
  const preferredIp = getPreferredLanIPv4();
  const ips = getLanIPv4Candidates();

  loadSnapshotFromDb();

  console.log("LAN Media Hub running:");
  console.log(`- Local:   http://localhost:${PORT}`);
  console.log(`- LAN URL: http://${preferredIp}:${PORT}`);
  if (ips.length > 1) {
    console.log("- Other reachable URLs:");
    for (const ip of ips) {
      console.log(`  - http://${ip}:${PORT}`);
    }
  }
  console.log(`- Smart Viewer:   http://${preferredIp}:${PORT}/`);
  console.log(`- Admin:          http://localhost:${PORT}/admin.html`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Scan paths: ${getScanPaths().join(" | ")}`);
  console.log(`Exclude paths: ${getExcludePaths().join(" | ") || "(none)"}`);

  await triggerRescan("startup");

  setInterval(() => {
    if (indexState.isIndexing) return;
    if (Date.now() - lastAutoRescanAt < runtimeOptions.autoRescanMs) return;
    lastAutoRescanAt = Date.now();
    triggerRescan("auto-interval").catch(() => {
      // ignore interval scan failure, surfaced by indexState.lastError
    });
  }, RESCAN_TICK_MS).unref();
});
