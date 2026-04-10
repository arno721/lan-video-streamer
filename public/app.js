const serverUrlsEl = document.getElementById("server-urls");
const copyUrlBtn = document.getElementById("copy-url");
const refreshBtn = document.getElementById("refresh");
const mediaRootInputEl = document.getElementById("media-root-input");
const setMediaRootBtn = document.getElementById("set-media-root");
const searchInputEl = document.getElementById("search-input");
const typeFilterEl = document.getElementById("type-filter");
const showRawPathEl = document.getElementById("show-raw-path");
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
let isLoadingLibrary = false;

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

function updateStatusText() {
  if (!libraryData) {
    statusTextEl.textContent = "載入中...";
    return;
  }

  const parts = [];
  parts.push(`路徑: ${libraryData.mediaRoot}`);
  parts.push(`總檔案: ${libraryData.totalItems}`);
  parts.push(`總大小: ${formatSize(libraryData.totalSize)}`);

  if (libraryData.index?.isIndexing) {
    parts.push("索引中...");
  } else {
    parts.push("索引完成");
  }

  const preview = libraryData.preview || {};
  const generated = Number(preview.finishedThisRound || 0);
  const total = Number(preview.totalQueuedThisRound || 0);
  if (total > 0) {
    parts.push(`預覽生成: ${generated}/${total} (執行緒 ${preview.threads || "-"})`);
  }

  if (libraryData.index?.lastError) {
    parts.push(`錯誤: ${libraryData.index.lastError}`);
  }

  statusTextEl.textContent = parts.join(" | ");
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
  if (!item) {
    return;
  }

  clearViewers();
  viewerTitleEl.textContent = item.displayPath || item.relativePath;

  if (item.category === "video") {
    videoViewerEl.classList.remove("hidden");
    videoViewerEl.src = item.mediaUrl;
    videoViewerEl.play().catch(() => {
      // Ignore autoplay restrictions.
    });
  } else if (item.category === "audio") {
    audioViewerEl.classList.remove("hidden");
    audioViewerEl.src = item.mediaUrl;
    audioViewerEl.play().catch(() => {
      // Ignore autoplay restrictions.
    });
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
  const fullLink = `${currentBaseUrl}/media?file=${encodeURIComponent(item.relativePath)}`;
  try {
    await navigator.clipboard.writeText(fullLink);
    alert(`已複製\n${fullLink}`);
  } catch {
    alert(`請手動複製\n${fullLink}`);
  }
}

function itemMatches(item, keyword, typeFilter) {
  if (typeFilter !== "all" && item.category !== typeFilter) {
    return false;
  }

  if (!keyword) {
    return true;
  }

  const text = [item.name, item.relativePath, item.displayPath, item.displayFolder, item.rawFolder]
    .join(" ")
    .toLowerCase();
  return text.includes(keyword);
}

function sumCounts(a, b) {
  return {
    total: (a.total || 0) + (b.total || 0),
    video: (a.video || 0) + (b.video || 0),
    image: (a.image || 0) + (b.image || 0),
    audio: (a.audio || 0) + (b.audio || 0),
    document: (a.document || 0) + (b.document || 0),
    archive: (a.archive || 0) + (b.archive || 0),
    code: (a.code || 0) + (b.code || 0),
    other: (a.other || 0) + (b.other || 0),
  };
}

function computeCountsFromItems(items) {
  const counts = {
    total: items.length,
    video: 0,
    image: 0,
    audio: 0,
    document: 0,
    archive: 0,
    code: 0,
    other: 0,
  };

  for (const item of items) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }

  return counts;
}

function filterTree(node, keyword, typeFilter) {
  if (!node) {
    return null;
  }

  const filteredChildren = (node.children || [])
    .map((child) => filterTree(child, keyword, typeFilter))
    .filter(Boolean);

  const filteredItems = (node.items || []).filter((item) => itemMatches(item, keyword, typeFilter));

  if (!filteredChildren.length && !filteredItems.length && node.path !== "/") {
    return null;
  }

  let counts = computeCountsFromItems(filteredItems);
  for (const child of filteredChildren) {
    counts = sumCounts(counts, child.counts);
  }

  return {
    ...node,
    children: filteredChildren,
    items: filteredItems,
    counts,
  };
}

function createItemRow(item, showRawPath) {
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
  if (showRawPath && item.rawFolder !== item.displayFolder) {
    pathLine.textContent = `${item.displayPath} (原始: ${item.relativePath})`;
  } else {
    pathLine.textContent = item.displayPath || item.relativePath;
  }

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

function createNodeElement(node, depth, showRawPath) {
  const details = document.createElement("details");
  details.className = "tree-node";
  details.open = depth < 2;

  const summary = document.createElement("summary");
  const displayName = node.path === "/" ? "根目錄" : node.name;
  summary.textContent = `${displayName} (${node.counts.total})`;
  details.append(summary);

  const body = document.createElement("div");
  body.className = "tree-body";

  if (node.items && node.items.length) {
    const list = document.createElement("ul");
    list.className = "media-list";

    for (const item of node.items) {
      list.append(createItemRow(item, showRawPath));
    }

    body.append(list);
  }

  if (node.children && node.children.length) {
    const children = document.createElement("div");
    children.className = "tree-children";
    for (const child of node.children) {
      children.append(createNodeElement(child, depth + 1, showRawPath));
    }
    body.append(children);
  }

  details.append(body);
  return details;
}

function renderTree() {
  treeContainerEl.innerHTML = "";
  itemMap = new Map();

  if (!libraryData || !libraryData.tree) {
    emptyStateEl.classList.remove("hidden");
    return;
  }

  const keyword = (searchInputEl.value || "").trim().toLowerCase();
  const typeFilter = typeFilterEl.value || "all";
  const showRawPath = showRawPathEl.checked;

  const filteredRoot = filterTree(libraryData.tree, keyword, typeFilter);
  if (!filteredRoot || filteredRoot.counts.total === 0) {
    emptyStateEl.classList.remove("hidden");
    return;
  }

  emptyStateEl.classList.add("hidden");

  const fragment = document.createDocumentFragment();

  const rootItems = filteredRoot.items || [];
  if (rootItems.length) {
    const rootList = document.createElement("ul");
    rootList.className = "media-list";
    for (const item of rootItems) {
      rootList.append(createItemRow(item, showRawPath));
    }
    fragment.append(rootList);
  }

  for (const child of filteredRoot.children || []) {
    fragment.append(createNodeElement(child, 0, showRawPath));
  }

  treeContainerEl.append(fragment);
}

function scheduleRender() {
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
  }

  renderDebounceTimer = setTimeout(() => {
    renderTree();
  }, 120);
}

function handlePolling() {
  const shouldPoll =
    Boolean(libraryData?.index?.isIndexing) ||
    Number(libraryData?.preview?.active || 0) > 0 ||
    Number(libraryData?.preview?.queued || 0) > 0;

  if (shouldPoll && !pollTimer) {
    pollTimer = setInterval(() => {
      loadLibrary(true).catch(() => {
        // Ignore periodic polling errors.
      });
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
  if (!res.ok) {
    throw new Error(`讀取伺服器資訊失敗 (${res.status})`);
  }

  const info = await res.json();
  const urls = Array.isArray(info.urls) && info.urls.length ? info.urls : [info.url || window.location.origin];

  if (!urls.includes(currentBaseUrl)) {
    currentBaseUrl = urls[0];
  }

  renderServerUrls(urls);
}

async function loadLibrary(silent = false) {
  if (isLoadingLibrary) {
    return;
  }

  isLoadingLibrary = true;
  try {
    const res = await fetch("/api/library");
    if (!res.ok) {
      throw new Error(`讀取媒體庫失敗 (${res.status})`);
    }

    libraryData = await res.json();
    if (document.activeElement !== mediaRootInputEl) {
      mediaRootInputEl.value = libraryData.mediaRoot || "";
    }

    updateStatusText();
    scheduleRender();
    handlePolling();
  } catch (err) {
    if (!silent) {
      alert(err.message);
    }
  } finally {
    isLoadingLibrary = false;
  }
}

async function setMediaRoot() {
  const value = mediaRootInputEl.value.trim();
  if (!value) {
    alert("請先輸入路徑");
    return;
  }

  setMediaRootBtn.disabled = true;
  const original = setMediaRootBtn.textContent;
  setMediaRootBtn.textContent = "設定中...";

  try {
    const res = await fetch("/api/media-root", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: value }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `設定路徑失敗 (${res.status})`);
    }

    mediaRootInputEl.value = data.mediaRoot || value;
    await loadLibrary();
  } catch (err) {
    alert(`設定路徑失敗: ${err.message}`);
  } finally {
    setMediaRootBtn.disabled = false;
    setMediaRootBtn.textContent = original;
  }
}

async function requestRescan() {
  try {
    const res = await fetch("/api/rescan", { method: "POST" });
    if (!res.ok) {
      throw new Error(`重新掃描失敗 (${res.status})`);
    }
    await loadLibrary(true);
  } catch (err) {
    alert(err.message);
  }
}

copyUrlBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentBaseUrl);
    copyUrlBtn.textContent = "已複製";
    setTimeout(() => {
      copyUrlBtn.textContent = "複製手機網址";
    }, 1200);
  } catch {
    alert(`請手動複製: ${currentBaseUrl}`);
  }
});

refreshBtn.addEventListener("click", () => {
  requestRescan();
});

setMediaRootBtn.addEventListener("click", () => {
  setMediaRoot();
});

mediaRootInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    setMediaRoot();
  }
});

searchInputEl.addEventListener("input", scheduleRender);
typeFilterEl.addEventListener("change", scheduleRender);
showRawPathEl.addEventListener("change", scheduleRender);

treeContainerEl.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const id = target.dataset.id;
  if (!id) {
    return;
  }

  const item = itemMap.get(id);
  if (!item) {
    return;
  }

  const action = target.dataset.action;
  if (action === "open") {
    openItem(item);
  } else if (action === "copy") {
    copyMediaLink(item);
  }
});

Promise.all([loadServerInfo(), loadLibrary()]).catch((err) => {
  alert(`初始化失敗: ${err.message}`);
});