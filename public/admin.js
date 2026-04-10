const serverUrlsEl = document.getElementById("admin-server-urls");
const statusEl = document.getElementById("admin-status");
const summaryEl = document.getElementById("summary-box");

const scanInputEl = document.getElementById("scan-path-input");
const addScanBtn = document.getElementById("add-scan-path");
const scanListEl = document.getElementById("scan-path-list");

const excludeInputEl = document.getElementById("exclude-path-input");
const addExcludeBtn = document.getElementById("add-exclude-path");
const excludeListEl = document.getElementById("exclude-path-list");

const rescanBtn = document.getElementById("rescan-btn");
const restartServerBtn = document.getElementById("restart-server-btn");
const autoRescanMinutesEl = document.getElementById("auto-rescan-minutes");
const previewQueueBatchEl = document.getElementById("preview-queue-batch");
const preferMediaPreviewEl = document.getElementById("prefer-media-preview");
const mobileTranscodeFirstEl = document.getElementById("mobile-transcode-first");
const videoFallbackTimeoutMsEl = document.getElementById("video-fallback-timeout-ms");
const videoHoldSpeedEl = document.getElementById("video-hold-speed");
const videoHoldTriggerMsEl = document.getElementById("video-hold-trigger-ms");
const videoSeekSecondsEl = document.getElementById("video-seek-seconds");
const videoSeekSecondsShiftEl = document.getElementById("video-seek-seconds-shift");
const imageZoomMobileEl = document.getElementById("image-zoom-mobile");
const imageZoomDesktopEl = document.getElementById("image-zoom-desktop");
const transcodePresetEl = document.getElementById("transcode-preset");
const transcodeCrfEl = document.getElementById("transcode-crf");
const transcodeAudioKbpsEl = document.getElementById("transcode-audio-kbps");
const transcodeProbeSizeEl = document.getElementById("transcode-probe-size");
const transcodeAnalyzeDurationEl = document.getElementById("transcode-analyze-duration");
const transcodeKeyintEl = document.getElementById("transcode-keyint");
const transcodeZerolatencyEl = document.getElementById("transcode-zerolatency");
const saveOptionsBtn = document.getElementById("save-options-btn");

let settings = { scanPaths: [], excludePaths: [] };
let library = null;
let pollTimer = null;
let options = {
  autoRescanMinutes: 10,
  previewQueueBatch: 300,
  preferMediaFolderPreview: true,
  mobileTranscodeFirst: true,
  videoFallbackTimeoutMs: 7000,
  videoHoldSpeed: 3,
  videoHoldTriggerMs: 420,
  videoSeekSeconds: 5,
  videoSeekSecondsShift: 15,
  imageZoomMobile: 1.45,
  imageZoomDesktop: 1.6,
  transcodePreset: "veryfast",
  transcodeCrf: 22,
  transcodeAudioKbps: 160,
  transcodeProbeSize: 1000000,
  transcodeAnalyzeDuration: 1000000,
  transcodeKeyint: 48,
  transcodeTuneZerolatency: true,
};

function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Number(bytes || 0);
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function numInRange(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function renderServerUrls(urls) {
  serverUrlsEl.innerHTML = "";
  for (const url of urls) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = url;
    li.append(a);
    serverUrlsEl.append(li);
  }
}

function createPathRow(pathValue, type) {
  const li = document.createElement("li");
  li.className = "path-item";

  const text = document.createElement("span");
  text.textContent = pathValue;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-secondary";
  removeBtn.textContent = "移除";
  removeBtn.dataset.action = `remove-${type}`;
  removeBtn.dataset.path = pathValue;

  li.append(text, removeBtn);
  return li;
}

function renderSettings() {
  scanListEl.innerHTML = "";
  for (const p of settings.scanPaths || []) {
    scanListEl.append(createPathRow(p, "scan"));
  }

  excludeListEl.innerHTML = "";
  for (const p of settings.excludePaths || []) {
    excludeListEl.append(createPathRow(p, "exclude"));
  }
}

function renderOptions() {
  autoRescanMinutesEl.value = String(options.autoRescanMinutes || 10);
  previewQueueBatchEl.value = String(options.previewQueueBatch || 300);
  preferMediaPreviewEl.checked = options.preferMediaFolderPreview !== false;
  mobileTranscodeFirstEl.checked = options.mobileTranscodeFirst !== false;
  videoFallbackTimeoutMsEl.value = String(options.videoFallbackTimeoutMs || 7000);
  videoHoldSpeedEl.value = String(options.videoHoldSpeed || 3);
  videoHoldTriggerMsEl.value = String(options.videoHoldTriggerMs || 420);
  videoSeekSecondsEl.value = String(options.videoSeekSeconds || 5);
  videoSeekSecondsShiftEl.value = String(options.videoSeekSecondsShift || 15);
  imageZoomMobileEl.value = String(options.imageZoomMobile || 1.45);
  imageZoomDesktopEl.value = String(options.imageZoomDesktop || 1.6);
  transcodePresetEl.value = String(options.transcodePreset || "veryfast");
  transcodeCrfEl.value = String(options.transcodeCrf || 22);
  transcodeAudioKbpsEl.value = String(options.transcodeAudioKbps || 160);
  transcodeProbeSizeEl.value = String(options.transcodeProbeSize || 1000000);
  transcodeAnalyzeDurationEl.value = String(options.transcodeAnalyzeDuration || 1000000);
  transcodeKeyintEl.value = String(options.transcodeKeyint || 48);
  transcodeZerolatencyEl.checked = options.transcodeTuneZerolatency !== false;
}

function renderSummary() {
  if (!library) {
    summaryEl.textContent = "讀取中...";
    return;
  }

  summaryEl.textContent = [
    `檔案 ${library.totalItems}`,
    `大小 ${formatSize(library.totalSize)}`,
    `影片 ${library.byCategory.video}`,
    `圖片 ${library.byCategory.image}`,
    `音訊 ${library.byCategory.audio}`,
    library.index?.isIndexing ? "索引中" : "索引完成",
    `預覽 ${library.preview?.finishedThisRound || 0}/${library.preview?.totalQueuedThisRound || 0}`,
  ].join(" | ");

  const statusParts = [];
  if (library.index?.lastError) {
    statusParts.push(`錯誤: ${library.index.lastError}`);
  }
  if (library.index?.isIndexing) {
    statusParts.push("背景重掃中...");
  }
  statusEl.textContent = statusParts.join(" | ") || "系統正常";
}

function handlePolling() {
  const shouldPoll = Boolean(library?.index?.isIndexing) || Number(library?.preview?.active || 0) > 0 || Number(library?.preview?.queued || 0) > 0;

  if (shouldPoll && !pollTimer) {
    pollTimer = setInterval(() => {
      loadLibrary(true).catch(() => {});
    }, 1800);
    return;
  }

  if (!shouldPoll && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function loadServerInfo() {
  const res = await fetch("/api/server-info");
  if (!res.ok) throw new Error(`讀取伺服器資訊失敗 (${res.status})`);
  const data = await res.json();
  const urls = Array.isArray(data.urls) && data.urls.length ? data.urls : [data.url];
  renderServerUrls(urls);
}

async function loadSettings() {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error(`讀取設定失敗 (${res.status})`);
  settings = await res.json();
  if (settings.options) {
    const src = settings.options;
    options = {
      ...options,
      autoRescanMinutes: Math.max(1, Math.round(Number(src.autoRescanMs || 600000) / 60000)),
      previewQueueBatch: Number(src.previewQueueBatch || 300),
      preferMediaFolderPreview: src.preferMediaFolderPreview !== false,
      mobileTranscodeFirst: src.mobileTranscodeFirst !== false,
      videoFallbackTimeoutMs: Number(src.videoFallbackTimeoutMs || 7000),
      videoHoldSpeed: Number(src.videoHoldSpeed || 3),
      videoHoldTriggerMs: Number(src.videoHoldTriggerMs || 420),
      videoSeekSeconds: Number(src.videoSeekSeconds || 5),
      videoSeekSecondsShift: Number(src.videoSeekSecondsShift || 15),
      imageZoomMobile: Number(src.imageZoomMobile || 1.45),
      imageZoomDesktop: Number(src.imageZoomDesktop || 1.6),
      transcodePreset: String(src.transcodePreset || "veryfast"),
      transcodeCrf: Number(src.transcodeCrf || 22),
      transcodeAudioKbps: Number(src.transcodeAudioKbps || 160),
      transcodeProbeSize: Number(src.transcodeProbeSize || 1000000),
      transcodeAnalyzeDuration: Number(src.transcodeAnalyzeDuration || 1000000),
      transcodeKeyint: Number(src.transcodeKeyint || 48),
      transcodeTuneZerolatency: src.transcodeTuneZerolatency !== false,
    };
  }
  renderSettings();
  renderOptions();
}

async function loadLibrary(silent = false) {
  const res = await fetch("/api/library");
  if (!res.ok) {
    if (!silent) throw new Error(`讀取索引失敗 (${res.status})`);
    return;
  }
  library = await res.json();
  renderSummary();
  handlePolling();
}

async function addPath(type, value) {
  const endpoint = type === "scan" ? "/api/scan-paths" : "/api/exclude-paths";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: value }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `新增失敗 (${res.status})`);
  }

  settings = data;
  renderSettings();
  await loadLibrary(true);
}

async function removePath(type, value) {
  const endpoint = type === "scan" ? "/api/scan-paths" : "/api/exclude-paths";
  const res = await fetch(endpoint, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: value }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `移除失敗 (${res.status})`);
  }

  settings = data;
  renderSettings();
  await loadLibrary(true);
}

async function triggerRescan() {
  const res = await fetch("/api/rescan", { method: "POST" });
  if (!res.ok) throw new Error(`重掃失敗 (${res.status})`);
  await loadLibrary(true);
}

async function restartServer() {
  const res = await fetch("/api/restart-server", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `重啟失敗 (${res.status})`);
  }
}

async function saveOptions() {
  const payload = {
    autoRescanMinutes: Math.round(numInRange(autoRescanMinutesEl.value, 1, 1440, options.autoRescanMinutes || 10)),
    previewQueueBatch: Math.round(numInRange(previewQueueBatchEl.value, 20, 5000, options.previewQueueBatch || 300)),
    preferMediaFolderPreview: preferMediaPreviewEl.checked,
    mobileTranscodeFirst: mobileTranscodeFirstEl.checked,
    videoFallbackTimeoutMs: Math.round(numInRange(videoFallbackTimeoutMsEl.value, 1000, 30000, options.videoFallbackTimeoutMs || 7000)),
    videoHoldSpeed: numInRange(videoHoldSpeedEl.value, 1.25, 8, options.videoHoldSpeed || 3),
    videoHoldTriggerMs: Math.round(numInRange(videoHoldTriggerMsEl.value, 120, 1200, options.videoHoldTriggerMs || 420)),
    videoSeekSeconds: numInRange(videoSeekSecondsEl.value, 1, 60, options.videoSeekSeconds || 5),
    videoSeekSecondsShift: numInRange(videoSeekSecondsShiftEl.value, 1, 180, options.videoSeekSecondsShift || 15),
    imageZoomMobile: numInRange(imageZoomMobileEl.value, 1.1, 4, options.imageZoomMobile || 1.45),
    imageZoomDesktop: numInRange(imageZoomDesktopEl.value, 1.1, 5, options.imageZoomDesktop || 1.6),
    transcodePreset: String(transcodePresetEl.value || "veryfast"),
    transcodeCrf: Math.round(numInRange(transcodeCrfEl.value, 16, 35, options.transcodeCrf || 22)),
    transcodeAudioKbps: Math.round(numInRange(transcodeAudioKbpsEl.value, 64, 320, options.transcodeAudioKbps || 160)),
    transcodeProbeSize: Math.round(numInRange(transcodeProbeSizeEl.value, 50000, 20000000, options.transcodeProbeSize || 1000000)),
    transcodeAnalyzeDuration: Math.round(
      numInRange(transcodeAnalyzeDurationEl.value, 50000, 20000000, options.transcodeAnalyzeDuration || 1000000)
    ),
    transcodeKeyint: Math.round(numInRange(transcodeKeyintEl.value, 12, 360, options.transcodeKeyint || 48)),
    transcodeTuneZerolatency: transcodeZerolatencyEl.checked,
  };

  const res = await fetch("/api/admin-options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `保存選項失敗 (${res.status})`);
  }

  const src = data.options || payload;
  options = {
    ...options,
    autoRescanMinutes: Number(src.autoRescanMinutes || payload.autoRescanMinutes),
    previewQueueBatch: Number(src.previewQueueBatch || payload.previewQueueBatch),
    preferMediaFolderPreview: src.preferMediaFolderPreview !== false,
    mobileTranscodeFirst: src.mobileTranscodeFirst !== false,
    videoFallbackTimeoutMs: Number(src.videoFallbackTimeoutMs || payload.videoFallbackTimeoutMs),
    videoHoldSpeed: Number(src.videoHoldSpeed || payload.videoHoldSpeed),
    videoHoldTriggerMs: Number(src.videoHoldTriggerMs || payload.videoHoldTriggerMs),
    videoSeekSeconds: Number(src.videoSeekSeconds || payload.videoSeekSeconds),
    videoSeekSecondsShift: Number(src.videoSeekSecondsShift || payload.videoSeekSecondsShift),
    imageZoomMobile: Number(src.imageZoomMobile || payload.imageZoomMobile),
    imageZoomDesktop: Number(src.imageZoomDesktop || payload.imageZoomDesktop),
    transcodePreset: String(src.transcodePreset || payload.transcodePreset),
    transcodeCrf: Number(src.transcodeCrf || payload.transcodeCrf),
    transcodeAudioKbps: Number(src.transcodeAudioKbps || payload.transcodeAudioKbps),
    transcodeProbeSize: Number(src.transcodeProbeSize || payload.transcodeProbeSize),
    transcodeAnalyzeDuration: Number(src.transcodeAnalyzeDuration || payload.transcodeAnalyzeDuration),
    transcodeKeyint: Number(src.transcodeKeyint || payload.transcodeKeyint),
    transcodeTuneZerolatency: src.transcodeTuneZerolatency !== false,
  };
  renderOptions();
}

addScanBtn.addEventListener("click", async () => {
  const value = scanInputEl.value.trim();
  if (!value) return;

  try {
    await addPath("scan", value);
    scanInputEl.value = "";
  } catch (err) {
    alert(err.message);
  }
});

addExcludeBtn.addEventListener("click", async () => {
  const value = excludeInputEl.value.trim();
  if (!value) return;

  try {
    await addPath("exclude", value);
    excludeInputEl.value = "";
  } catch (err) {
    alert(err.message);
  }
});

scanInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addScanBtn.click();
});

excludeInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addExcludeBtn.click();
});

rescanBtn.addEventListener("click", async () => {
  try {
    await triggerRescan();
  } catch (err) {
    alert(err.message);
  }
});

restartServerBtn.addEventListener("click", async () => {
  if (!confirm("確認要重啟伺服器？重啟期間連線會短暫中斷。")) return;
  restartServerBtn.disabled = true;
  try {
    await restartServer();
    statusEl.textContent = "伺服器重啟中，請稍候 3-10 秒後重新整理。";
  } catch (err) {
    restartServerBtn.disabled = false;
    alert(err.message);
  }
});

saveOptionsBtn.addEventListener("click", async () => {
  try {
    await saveOptions();
    await loadLibrary(true);
    statusEl.textContent = "選項已保存";
  } catch (err) {
    alert(err.message);
  }
});

scanListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action='remove-scan']");
  if (!btn) return;

  try {
    await removePath("scan", btn.dataset.path || "");
  } catch (err) {
    alert(err.message);
  }
});

excludeListEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action='remove-exclude']");
  if (!btn) return;

  try {
    await removePath("exclude", btn.dataset.path || "");
  } catch (err) {
    alert(err.message);
  }
});

Promise.all([loadServerInfo(), loadSettings(), loadLibrary()]).catch((err) => {
  statusEl.textContent = `初始化失敗: ${err.message}`;
});
