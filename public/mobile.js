const statusEl = document.getElementById("mobile-status");
const searchEl = document.getElementById("mobile-search");
const typeFilterEl = document.getElementById("mobile-type-filter");
const listEl = document.getElementById("mobile-list");
const emptyEl = document.getElementById("mobile-empty");

const titleEl = document.getElementById("mobile-viewer-title");
const videoEl = document.getElementById("mobile-video");
const audioEl = document.getElementById("mobile-audio");
const imageEl = document.getElementById("mobile-image");
const downloadEl = document.getElementById("mobile-download");

let library = null;
let flatItems = [];
let itemMap = new Map();
let pollTimer = null;
let renderTimer = null;
let isLoading = false;

function formatSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes || 0);
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function flattenTree(node, bucket = []) {
  if (!node) return bucket;
  for (const item of node.items || []) {
    bucket.push(item);
  }
  for (const child of node.children || []) {
    flattenTree(child, bucket);
  }
  return bucket;
}

function clearPlayers() {
  videoEl.pause();
  videoEl.classList.add("hidden");
  videoEl.removeAttribute("src");

  audioEl.pause();
  audioEl.classList.add("hidden");
  audioEl.removeAttribute("src");

  imageEl.classList.add("hidden");
  imageEl.removeAttribute("src");
}

function openItem(item) {
  clearPlayers();
  titleEl.textContent = item.displayPath || item.name;

  if (item.category === "video") {
    videoEl.classList.remove("hidden");
    videoEl.src = item.mediaUrl;
    videoEl.play().catch(() => {});
  } else if (item.category === "audio") {
    audioEl.classList.remove("hidden");
    audioEl.src = item.mediaUrl;
    audioEl.play().catch(() => {});
  } else if (item.category === "image") {
    imageEl.classList.remove("hidden");
    imageEl.src = item.mediaUrl;
  } else {
    imageEl.classList.remove("hidden");
    imageEl.src = item.previewUrl;
  }

  downloadEl.classList.remove("hidden");
  downloadEl.href = item.downloadUrl;
}

function renderList() {
  listEl.innerHTML = "";
  itemMap = new Map();

  if (!flatItems.length) {
    emptyEl.classList.remove("hidden");
    return;
  }

  const keyword = (searchEl.value || "").trim().toLowerCase();
  const type = typeFilterEl.value || "all";

  const filtered = flatItems.filter((item) => {
    if (type !== "all" && item.category !== type) return false;
    if (!keyword) return true;
    return [item.name, item.displayPath, item.relativePath].join(" ").toLowerCase().includes(keyword);
  });

  if (!filtered.length) {
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");

  const frag = document.createDocumentFragment();

  for (const item of filtered) {
    itemMap.set(item.id, item);

    const row = document.createElement("li");
    row.className = "media-item";

    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.loading = "lazy";
    thumb.decoding = "async";
    thumb.src = item.previewUrl;
    thumb.alt = item.name;
    thumb.dataset.action = "open";
    thumb.dataset.id = item.id;

    const info = document.createElement("div");
    info.className = "media-info";

    const title = document.createElement("div");
    title.className = "media-title";
    title.textContent = item.name;

    const meta = document.createElement("div");
    meta.className = "media-meta";
    meta.textContent = `${item.category.toUpperCase()} | ${formatSize(item.size)}`;

    const pathLine = document.createElement("div");
    pathLine.className = "media-path";
    pathLine.textContent = item.displayPath || item.relativePath;

    info.append(title, meta, pathLine);

    const actions = document.createElement("div");
    actions.className = "media-actions";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "查看";
    btn.dataset.action = "open";
    btn.dataset.id = item.id;

    actions.append(btn);
    row.append(thumb, info, actions);
    frag.append(row);
  }

  listEl.append(frag);
}

function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(renderList, 120);
}

function handlePolling() {
  const shouldPoll = Boolean(library?.index?.isIndexing) || Number(library?.preview?.queued || 0) > 0 || Number(library?.preview?.active || 0) > 0;

  if (shouldPoll && !pollTimer) {
    pollTimer = setInterval(() => {
      loadLibrary(true).catch(() => {});
    }, 2000);
    return;
  }

  if (!shouldPoll && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function updateStatus() {
  if (!library) {
    statusEl.textContent = "載入中...";
    return;
  }

  statusEl.textContent = [
    `檔案 ${library.totalItems}`,
    library.index?.isIndexing ? "索引中" : "索引完成",
    `預覽 ${library.preview?.finishedThisRound || 0}/${library.preview?.totalQueuedThisRound || 0}`,
  ].join(" | ");
}

async function loadLibrary(silent = false) {
  if (isLoading) return;
  isLoading = true;

  try {
    const res = await fetch("/api/library");
    if (!res.ok) throw new Error(`讀取媒體庫失敗 (${res.status})`);

    library = await res.json();
    flatItems = flattenTree(library.tree, []);
    updateStatus();
    renderList();
    handlePolling();
  } catch (err) {
    if (!silent) alert(err.message);
  } finally {
    isLoading = false;
  }
}

searchEl.addEventListener("input", scheduleRender);
typeFilterEl.addEventListener("change", scheduleRender);

listEl.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action='open']");
  if (!target) return;

  const item = itemMap.get(target.dataset.id || "");
  if (!item) return;

  openItem(item);
});

loadLibrary().catch((err) => {
  alert(`初始化失敗: ${err.message}`);
});