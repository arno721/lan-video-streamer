const serverUrlsEl = document.getElementById("server-urls");
const copyUrlBtn = document.getElementById("copy-url");
const refreshBtn = document.getElementById("refresh");
const searchInputEl = document.getElementById("search-input");
const typeFilterEl = document.getElementById("type-filter");
const statusTextEl = document.getElementById("status-text");
const treeContainerEl = document.getElementById("tree-container");
const emptyStateEl = document.getElementById("empty-state");

const viewerTitleEl = document.getElementById("viewer-title");
const videoViewerEl = document.getElementById("video-viewer");
const audioViewerEl = document.getElementById("audio-viewer");
const imageViewerEl = document.getElementById("image-viewer");
const downloadLinkEl = document.getElementById("download-link");

let currentBaseUrl = window.location.origin;
let libraryData = null;
let itemMap = new Map();
let pollTimer = null;
let renderDebounceTimer = null;
let isLoading = false;

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

function renderServerUrls(urls) {
  serverUrlsEl.innerHTML = "";
  for (const url of urls) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "url-item";
    btn.textContent = url;

    if (url === currentBaseUrl) {
      btn.classList.add("active");
    }

    btn.addEventListener("click", () => {
      currentBaseUrl = url;
      renderServerUrls(urls);
    });

    li.append(btn);
    serverUrlsEl.append(li);
  }
}

function clearViewers() {
  videoViewerEl.pause();
  videoViewerEl.classList.add("hidden");
  videoViewerEl.removeAttribute("src");

  audioViewerEl.pause();
  audioViewerEl.classList.add("hidden");
  audioViewerEl.removeAttribute("src");

  imageViewerEl.classList.add("hidden");
  imageViewerEl.removeAttribute("src");
}

function openItem(item) {
  clearViewers();
  viewerTitleEl.textContent = item.displayPath || item.name;

  if (item.category === "video") {
    videoViewerEl.classList.remove("hidden");
    videoViewerEl.src = item.mediaUrl;
    videoViewerEl.play().catch(() => {});
  } else if (item.category === "audio") {
    audioViewerEl.classList.remove("hidden");
    audioViewerEl.src = item.mediaUrl;
    audioViewerEl.play().catch(() => {});
  } else if (item.category === "image") {
    imageViewerEl.classList.remove("hidden");
    imageViewerEl.src = item.mediaUrl;
  } else {
    imageViewerEl.classList.remove("hidden");
    imageViewerEl.src = item.previewUrl;
  }

  downloadLinkEl.classList.remove("hidden");
  downloadLinkEl.href = item.downloadUrl;
}

async function copyMediaLink(item) {
  const link = `${currentBaseUrl}/media?id=${encodeURIComponent(item.id)}`;
  try {
    await navigator.clipboard.writeText(link);
    alert(`已複製\n${link}`);
  } catch {
    alert(`請手動複製\n${link}`);
  }
}

function nodeFilter(node, keyword, typeFilter) {
  const children = (node.children || []).map((child) => nodeFilter(child, keyword, typeFilter)).filter(Boolean);
  const items = (node.items || []).filter((item) => {
    if (typeFilter !== "all" && item.category !== typeFilter) return false;
    if (!keyword) return true;
    return [item.name, item.displayPath, item.relativePath].join(" ").toLowerCase().includes(keyword);
  });

  if (!children.length && !items.length && node.path !== "/") {
    return null;
  }

  return {
    ...node,
    children,
    items,
  };
}

function createItemElement(item) {
  itemMap.set(item.id, item);

  const li = document.createElement("li");
  li.className = "media-item";

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
  meta.textContent = `${item.category.toUpperCase()} | ${formatSize(item.size)} | ${new Date(item.updatedAt).toLocaleString()}`;

  const pathLine = document.createElement("div");
  pathLine.className = "media-path";
  pathLine.textContent = item.displayPath || item.relativePath;

  info.append(title, meta, pathLine);

  const actions = document.createElement("div");
  actions.className = "media-actions";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.textContent = "查看";
  openBtn.dataset.action = "open";
  openBtn.dataset.id = item.id;

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn-secondary";
  copyBtn.textContent = "複製鏈接";
  copyBtn.dataset.action = "copy";
  copyBtn.dataset.id = item.id;

  actions.append(openBtn, copyBtn);
  li.append(thumb, info, actions);

  return li;
}

function createNodeElement(node, depth) {
  const details = document.createElement("details");
  details.className = "tree-node";
  details.open = depth < 2;

  const summary = document.createElement("summary");
  const name = node.path === "/" ? "根目錄" : node.name;
  const count = (node.items || []).length + (node.children || []).reduce((sum, n) => sum + (n.counts?.total || 0), 0);
  summary.textContent = `${name} (${count})`;
  details.append(summary);

  const body = document.createElement("div");
  body.className = "tree-body";

  if (node.items && node.items.length) {
    const list = document.createElement("ul");
    list.className = "media-list";
    for (const item of node.items) {
      list.append(createItemElement(item));
    }
    body.append(list);
  }

  if (node.children && node.children.length) {
    const childrenWrap = document.createElement("div");
    childrenWrap.className = "tree-children";
    for (const child of node.children) {
      childrenWrap.append(createNodeElement(child, depth + 1));
    }
    body.append(childrenWrap);
  }

  details.append(body);
  return details;
}

function render() {
  treeContainerEl.innerHTML = "";
  itemMap = new Map();

  if (!libraryData || !libraryData.tree) {
    emptyStateEl.classList.remove("hidden");
    return;
  }

  const keyword = (searchInputEl.value || "").trim().toLowerCase();
  const typeFilter = typeFilterEl.value || "all";

  const filtered = nodeFilter(libraryData.tree, keyword, typeFilter);
  if (!filtered) {
    emptyStateEl.classList.remove("hidden");
    return;
  }

  const hasData = (filtered.items && filtered.items.length) || (filtered.children && filtered.children.length);
  if (!hasData) {
    emptyStateEl.classList.remove("hidden");
    return;
  }

  emptyStateEl.classList.add("hidden");

  const fragment = document.createDocumentFragment();

  if (filtered.items && filtered.items.length) {
    const rootList = document.createElement("ul");
    rootList.className = "media-list";
    for (const item of filtered.items) {
      rootList.append(createItemElement(item));
    }
    fragment.append(rootList);
  }

  for (const child of filtered.children || []) {
    fragment.append(createNodeElement(child, 0));
  }

  treeContainerEl.append(fragment);
}

function updateStatus() {
  if (!libraryData) {
    statusTextEl.textContent = "載入中...";
    return;
  }

  const p = libraryData.preview || {};
  const i = libraryData.index || {};

  statusTextEl.textContent = [
    `檔案 ${libraryData.totalItems}`,
    `大小 ${formatSize(libraryData.totalSize)}`,
    i.isIndexing ? "索引中" : "索引完成",
    `預覽 ${p.finishedThisRound || 0}/${p.totalQueuedThisRound || 0}`,
  ].join(" | ");
}

function handlePolling() {
  const shouldPoll = Boolean(libraryData?.index?.isIndexing) || Number(libraryData?.preview?.queued || 0) > 0 || Number(libraryData?.preview?.active || 0) > 0;

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

function scheduleRender() {
  if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
  renderDebounceTimer = setTimeout(render, 120);
}

async function loadServerInfo() {
  const res = await fetch("/api/server-info");
  if (!res.ok) throw new Error(`讀取伺服器資訊失敗 (${res.status})`);
  const data = await res.json();
  const urls = Array.isArray(data.urls) && data.urls.length ? data.urls : [data.url || window.location.origin];
  if (!urls.includes(currentBaseUrl)) currentBaseUrl = urls[0];
  renderServerUrls(urls);
}

async function loadLibrary(silent = false) {
  if (isLoading) return;
  isLoading = true;

  try {
    const res = await fetch("/api/library");
    if (!res.ok) throw new Error(`讀取媒體庫失敗 (${res.status})`);

    libraryData = await res.json();
    updateStatus();
    scheduleRender();
    handlePolling();
  } catch (err) {
    if (!silent) alert(err.message);
  } finally {
    isLoading = false;
  }
}

async function requestRescan() {
  try {
    const res = await fetch("/api/rescan", { method: "POST" });
    if (!res.ok) throw new Error(`重掃失敗 (${res.status})`);
    await loadLibrary(true);
  } catch (err) {
    alert(err.message);
  }
}

copyUrlBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentBaseUrl.replace(/\/$/, "") + "/mobile.html");
    copyUrlBtn.textContent = "已複製";
    setTimeout(() => {
      copyUrlBtn.textContent = "複製手機網址";
    }, 1200);
  } catch {
    alert("複製失敗，請手動複製網址");
  }
});

refreshBtn.addEventListener("click", () => {
  requestRescan();
});

searchInputEl.addEventListener("input", scheduleRender);
typeFilterEl.addEventListener("change", scheduleRender);

treeContainerEl.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;

  const item = itemMap.get(el.dataset.id || "");
  if (!item) return;

  if (el.dataset.action === "open") {
    openItem(item);
  } else if (el.dataset.action === "copy") {
    copyMediaLink(item);
  }
});

Promise.all([loadServerInfo(), loadLibrary()]).catch((err) => {
  alert(`初始化失敗: ${err.message}`);
});