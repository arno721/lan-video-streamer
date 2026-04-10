
const STATE_KEY = 'viewer_state_v6';
const FAVORITES_KEY = 'viewer_favorites_v1';
const TYPES = ['video', 'image', 'audio', 'document', 'archive', 'code', 'other'];

const E = {
  refresh: document.getElementById('refresh'),
  theme: document.getElementById('theme-toggle'),
  favoritesToggle: document.getElementById('favorites-toggle'),
  favoritesBack: document.getElementById('favorites-back'),
  favoritesClear: document.getElementById('favorites-clear'),
  favoriteFolders: document.getElementById('favorite-folders'),
  favoriteItems: document.getElementById('favorite-items'),
  browsePanel: document.getElementById('browse-panel'),
  favoritesPanel: document.getElementById('favorites-panel'),
  view: document.getElementById('view-toggle'),
  layout: document.getElementById('layout-toggle'),
  thumbToggle: document.getElementById('folder-thumb-toggle'),
  pathToggle: document.getElementById('path-toggle'),
  detailToggle: document.getElementById('detail-toggle'),
  search: document.getElementById('search-input'),
  sort: document.getElementById('sort-select'),
  gridSize: document.getElementById('grid-size-select'),
  typesWrap: document.getElementById('type-checks'),
  typesAll: document.getElementById('types-all'),
  typesNone: document.getElementById('types-none'),
  status: document.getElementById('status-text'),
  tree: document.getElementById('tree-container'),
  folderGrid: document.getElementById('folder-grid-container'),
  empty: document.getElementById('empty-state'),
  overlay: document.getElementById('viewer-overlay'),
  mediaWrap: document.querySelector('#viewer-overlay .overlay-media-wrap'),
  title: document.getElementById('viewer-title'),
  close: document.getElementById('close-overlay'),
  prev: document.getElementById('prev-item'),
  next: document.getElementById('next-item'),
  favoriteCurrent: document.getElementById('favorite-current'),
  viewerNameToggle: document.getElementById('viewer-name-toggle'),
  toggleStrip: document.getElementById('toggle-strip'),
  download: document.getElementById('download-link'),
  video: document.getElementById('video-viewer'),
  audio: document.getElementById('audio-viewer'),
  image: document.getElementById('image-viewer'),
  strip: document.getElementById('folder-strip'),
  scrubWrap: document.getElementById('video-scrub-wrap'),
  scrub: document.getElementById('video-scrub'),
  top: document.getElementById('scroll-top'),
  back: document.getElementById('scroll-last'),
  menu: document.getElementById('folder-menu'),
};

const DEFAULTS = {
  viewMode: 'list',
  layoutMode: 'tree',
  gridSize: 'm',
  showFolderThumbs: true,
  showPaths: true,
  showDetails: true,
  showViewerTitle: true,
  showStrip: false,
  showFavorites: false,
  types: [...TYPES],
  sort: 'time_desc',
  search: '',
  open: [],
  focused: '',
  scrollY: 0,
  lastY: null,
};

const state = {
  viewMode: DEFAULTS.viewMode,
  layoutMode: DEFAULTS.layoutMode,
  gridSize: DEFAULTS.gridSize,
  showFolderThumbs: DEFAULTS.showFolderThumbs,
  showPaths: DEFAULTS.showPaths,
  showDetails: DEFAULTS.showDetails,
  showViewerTitle: DEFAULTS.showViewerTitle,
  showStrip: DEFAULTS.showStrip,
  showFavorites: DEFAULTS.showFavorites,
  types: new Set(DEFAULTS.types),
  sort: DEFAULTS.sort,
  search: DEFAULTS.search,
  open: new Set(DEFAULTS.open),
  focused: DEFAULTS.focused,
  scrollY: DEFAULTS.scrollY,
  lastY: DEFAULTS.lastY,
};

const favorites = {
  folders: new Set(),
  items: new Map(),
};

let lib = null;
let tree = null;
let isLoading = false;
let pollTimer = null;
let renderTimer = null;
let saveTimer = null;
let folderCache = new Map();
let folderAllCache = new Map();
let folderInflight = new Map();
let itemStore = new Map();
let folderByItem = new Map();
let detailsMap = new Map();
let currentId = '';
let currentFolder = '';
let menuPath = '';
let menuDetails = null;
let lastFilteredTree = null;
let pendingFocus = '';
let lastStripKey = '';
let lastStripImageMode = false;
let videoFastForwardByHold = false;
let videoTouchHoldTimer = null;
let videoTouchHoldActive = false;
let videoTouchStartX = 0;
let videoTouchStartY = 0;
let videoKeyHoldTimer = null;
let videoKeyHoldActive = false;
let videoRightKeyDown = false;
let videoRightKeyDownAt = 0;
let videoLastTapAt = 0;
let videoLastTapSide = '';
let videoTouchDownAt = 0;
let videoTouchMoved = false;
let videoPointerHoldTimer = null;
let videoPointerHoldActive = false;
let videoPointerHoldId = -1;
let videoPointerStartX = 0;
let videoPointerStartY = 0;
let videoSpaceKeyDown = false;
let videoBaseRate = 1;
let videoFallbackTimer = null;
let videoDecodeGuardTimer = null;
let mediaActionIndicator = null;
let mediaActionIndicatorTimer = null;
let videoLoadIndicator = null;
let videoLoadActive = false;
let videoHasStartedPlaying = false;
let imageZoomScale = 1;
let imagePointerId = -1;
let imagePointerStartX = 0;
let imagePointerStartY = 0;
let imagePointerMoved = false;
let imagePointerDragging = false;
let imagePointerScrollLeft = 0;
let imagePointerScrollTop = 0;
let overlaySwipeStartX = 0;
let overlaySwipeStartY = 0;
let overlaySwipeCurrentX = 0;
let overlaySwipeCurrentY = 0;
let overlaySwipeStartedAt = 0;
let overlaySwipeTracking = false;
let overlaySwipeLastTriggerAt = 0;
let overlayScrollLockY = 0;
let overlayScrollLocked = false;
let lastUserScrollAt = 0;
let viewerNavFolder = '';
let viewerNavItems = [];
let viewerNavIds = [];
let imagePreloadCache = new Map();
let imagePreloadInflight = new Map();
let imagePreloadQueue = [];
let imagePreloadQueued = new Set();
let imagePreloadWorkers = 0;
let treeHeightRaf = 0;
const NATIVE_VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm']);

const esc = (s) =>
  String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const fsize = (b) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Number(b || 0);
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
};

const purl = (i) => `/api/preview?id=${encodeURIComponent(i.id || i)}&k=${encodeURIComponent(i.previewKey || '')}`;
const mediaPreviewTypeSet = () => state.types.has('video') || state.types.has('image');
const IS_MOBILE_CLIENT = document.body.classList.contains('mobile');
const IMAGE_PRELOAD_LOOKAHEAD = IS_MOBILE_CLIENT ? 12 : 8;
const IMAGE_PRELOAD_CACHE_LIMIT = IS_MOBILE_CLIENT ? 36 : 24;
const IMAGE_PRELOAD_CONCURRENCY = IS_MOBILE_CLIENT ? 2 : 3;
const VIEWER_OPTION_DEFAULTS = Object.freeze({
  preferTranscodePlayback: true,
  mobileTranscodeFirst: true,
  videoFallbackTimeoutMs: 7000,
  videoHoldSpeed: 3,
  videoHoldTriggerMs: 420,
  videoSeekSeconds: 5,
  videoSeekSecondsShift: 15,
  imageZoomMobile: 1.45,
  imageZoomDesktop: 1.6,
});
let viewerOptions = { ...VIEWER_OPTION_DEFAULTS };
const getVideoTranscodeUrl = (item) =>
  item?.transcodeUrl || `/media-transcode?id=${encodeURIComponent(item?.id || '')}`;
const getVideoTranscodeFileUrl = (item) =>
  item?.transcodeFileUrl || `/media-transcode-file?id=${encodeURIComponent(item?.id || '')}`;
const isDirectVideoPreferred = (item) => {
  if (typeof item?.directPlayPreferred === 'boolean') return item.directPlayPreferred;
  return NATIVE_VIDEO_EXTENSIONS.has(String(item?.extension || '').toLowerCase());
};

function clampOptionNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function applyViewerOptions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  viewerOptions = {
    preferTranscodePlayback: src.preferTranscodePlayback !== false,
    mobileTranscodeFirst: src.mobileTranscodeFirst !== false,
    videoFallbackTimeoutMs: Math.round(
      clampOptionNumber(src.videoFallbackTimeoutMs, 1000, 30000, VIEWER_OPTION_DEFAULTS.videoFallbackTimeoutMs)
    ),
    videoHoldSpeed: clampOptionNumber(src.videoHoldSpeed, 1.25, 8, VIEWER_OPTION_DEFAULTS.videoHoldSpeed),
    videoHoldTriggerMs: Math.round(
      clampOptionNumber(src.videoHoldTriggerMs, 120, 1200, VIEWER_OPTION_DEFAULTS.videoHoldTriggerMs)
    ),
    videoSeekSeconds: clampOptionNumber(src.videoSeekSeconds, 1, 60, VIEWER_OPTION_DEFAULTS.videoSeekSeconds),
    videoSeekSecondsShift: clampOptionNumber(
      src.videoSeekSecondsShift,
      1,
      180,
      VIEWER_OPTION_DEFAULTS.videoSeekSecondsShift
    ),
    imageZoomMobile: clampOptionNumber(src.imageZoomMobile, 1.1, 4, VIEWER_OPTION_DEFAULTS.imageZoomMobile),
    imageZoomDesktop: clampOptionNumber(src.imageZoomDesktop, 1.1, 5, VIEWER_OPTION_DEFAULTS.imageZoomDesktop),
  };
}

function playVideoWithFallback(item) {
  const directUrl = String(item?.mediaUrl || '');
  const transcodeFileUrl = getVideoTranscodeFileUrl(item);
  const transcodeUrl = getVideoTranscodeUrl(item);
  const directPreferred = isDirectVideoPreferred(item);
  const preferTranscodePlayback = viewerOptions.preferTranscodePlayback !== false;
  const mobileTranscodeFirst = viewerOptions.mobileTranscodeFirst !== false;
  const order = [];

  if (preferTranscodePlayback) {
    if (directPreferred) {
      order.push(transcodeUrl, directUrl, transcodeFileUrl);
    } else {
      order.push(transcodeUrl, transcodeFileUrl, directUrl);
    }
  } else if (IS_MOBILE_CLIENT) {
    if (mobileTranscodeFirst) {
      if (directPreferred) {
        order.push(directUrl, transcodeUrl, transcodeFileUrl);
      } else {
        order.push(transcodeUrl, directUrl, transcodeFileUrl);
      }
    } else {
      if (directPreferred) {
        order.push(directUrl, transcodeFileUrl, transcodeUrl);
      } else {
        order.push(transcodeFileUrl, directUrl, transcodeUrl);
      }
    }
  } else if (directPreferred) {
    order.push(directUrl, transcodeUrl, transcodeFileUrl);
  } else {
    order.push(transcodeUrl, transcodeFileUrl, directUrl);
  }

  const unique = [];
  const seen = new Set();
  for (const url of order) {
    const u = String(url || '').trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    unique.push(u);
  }

  const primary = unique[0] || directUrl || transcodeFileUrl || transcodeUrl;
  const queue = unique.slice(1);

  E.video.dataset.fallbackQueue = JSON.stringify(queue);
  E.video.dataset.fallbackUsed = '0';
  videoHasStartedPlaying = false;
  setVideoLoadIndicator('正在載入...');
  clearVideoFallbackTimer();
  clearVideoDecodeGuardTimer();
  E.video.src = primary;
  E.video.load();
  E.video.play().catch(() => {});
  armVideoFallbackTimer();
  armVideoDecodeGuard();
}

function clearVideoFallbackTimer() {
  if (videoFallbackTimer) {
    clearTimeout(videoFallbackTimer);
    videoFallbackTimer = null;
  }
}

function clearVideoDecodeGuardTimer() {
  if (videoDecodeGuardTimer) {
    clearTimeout(videoDecodeGuardTimer);
    videoDecodeGuardTimer = null;
  }
}

function readVideoFallbackQueue() {
  try {
    const queue = JSON.parse(String(E.video.dataset.fallbackQueue || '[]'));
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

function getDecodedVideoFrameCount() {
  try {
    if (typeof E.video.getVideoPlaybackQuality === 'function') {
      const q = E.video.getVideoPlaybackQuality();
      if (q && Number.isFinite(Number(q.totalVideoFrames))) return Number(q.totalVideoFrames || 0);
    }
  } catch {
    // ignore
  }
  const webkitCount = Number(E.video.webkitDecodedFrameCount);
  if (Number.isFinite(webkitCount)) return webkitCount;
  return -1;
}

function armVideoDecodeGuard() {
  clearVideoDecodeGuardTimer();
  videoDecodeGuardTimer = setTimeout(() => {
    videoDecodeGuardTimer = null;
    if (E.video.classList.contains('hidden')) return;
    if (E.video.paused || E.video.ended) return;
    const queue = readVideoFallbackQueue();
    if (!queue.length) return;

    const t = Number(E.video.currentTime || 0);
    const frames = getDecodedVideoFrameCount();
    const hasSize = Number(E.video.videoWidth || 0) > 0 && Number(E.video.videoHeight || 0) > 0;

    if (t < 1.1) return;
    const noFrames = frames >= 0 && frames <= 0;
    const noVideoTrackVisible = !hasSize && t >= 1.6;
    if (!noFrames && !noVideoTrackVisible) return;

    setVideoLoadIndicator('偵測到黑屏，切換相容串流...');
    tryNextVideoFallback();
  }, 2600);
}

function armVideoFallbackTimer() {
  clearVideoFallbackTimer();
  videoFallbackTimer = setTimeout(() => {
    if (E.video.classList.contains('hidden')) return;
    if (Number(E.video.readyState || 0) >= 2) return;
    tryNextVideoFallback();
  }, viewerOptions.videoFallbackTimeoutMs);
}

function tryNextVideoFallback() {
  let queue = [];
  try {
    queue = JSON.parse(String(E.video.dataset.fallbackQueue || '[]'));
  } catch {
    queue = [];
  }
  if (!Array.isArray(queue) || queue.length === 0) return false;
  const next = String(queue.shift() || '').trim();
  E.video.dataset.fallbackQueue = JSON.stringify(queue);
  if (!next) return false;
  E.video.dataset.fallbackUsed = '1';
  setVideoLoadIndicator('正在切換更快串流...');
  clearVideoFallbackTimer();
  clearVideoDecodeGuardTimer();
  E.video.src = next;
  E.video.load();
  E.video.play().catch(() => {});
  armVideoFallbackTimer();
  armVideoDecodeGuard();
  return true;
}
function loadState() {
  try {
    const v = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if (!v) return;
    if (['list', 'grid'].includes(v.viewMode)) state.viewMode = v.viewMode;
    state.layoutMode = 'tree';
    if (['s', 'm', 'l'].includes(v.gridSize)) state.gridSize = v.gridSize;
    if (typeof v.showFolderThumbs === 'boolean') state.showFolderThumbs = v.showFolderThumbs;
    if (typeof v.showPaths === 'boolean') state.showPaths = v.showPaths;
    if (typeof v.showDetails === 'boolean') state.showDetails = v.showDetails;
    if (typeof v.showViewerTitle === 'boolean') state.showViewerTitle = v.showViewerTitle;
    if (typeof v.showStrip === 'boolean') state.showStrip = v.showStrip;
    if (typeof v.showFavorites === 'boolean') state.showFavorites = v.showFavorites;
    if (Array.isArray(v.types)) state.types = new Set(v.types.filter((x) => TYPES.includes(x)));
    if (typeof v.sort === 'string') state.sort = v.sort;
    if (typeof v.search === 'string') state.search = v.search;
    if (typeof v.focused === 'string') state.focused = v.focused;
    if (Array.isArray(v.open)) state.open = new Set(v.open);
    if (Number.isFinite(v.scrollY)) state.scrollY = v.scrollY;
    if (Number.isFinite(v.lastY)) state.lastY = v.lastY;
  } catch {}
  state.layoutMode = 'tree';
}

function saveState() {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({
      viewMode: state.viewMode,
      layoutMode: state.layoutMode,
      gridSize: state.gridSize,
      showFolderThumbs: state.showFolderThumbs,
      showPaths: state.showPaths,
      showDetails: state.showDetails,
      showViewerTitle: state.showViewerTitle,
      showStrip: state.showStrip,
      showFavorites: state.showFavorites,
      types: [...state.types],
      sort: state.sort,
      search: state.search,
      focused: state.focused,
      open: [...state.open],
      scrollY: window.scrollY,
      lastY: state.lastY,
    })
  );
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState();
  }, 250);
}

function loadFavorites() {
  try {
    const data = JSON.parse(localStorage.getItem(FAVORITES_KEY) || 'null');
    if (!data) return;
    if (Array.isArray(data.folders)) favorites.folders = new Set(data.folders.filter((p) => typeof p === 'string'));
    if (Array.isArray(data.items)) {
      favorites.items = new Map();
      for (const item of data.items) {
        if (item && item.id) favorites.items.set(item.id, item);
      }
    }
  } catch {}
}

function saveFavorites() {
  localStorage.setItem(
    FAVORITES_KEY,
    JSON.stringify({
      folders: [...favorites.folders],
      items: [...favorites.items.values()],
    })
  );
}

const THEME_ORDER = ['light', 'dark', 'portfolio'];
const THEME_LABEL = {
  light: '淺色主題',
  dark: '深色主題',
  portfolio: '作品集主題',
};

function normalizeTheme(mode) {
  const t = String(mode || '').toLowerCase();
  return THEME_ORDER.includes(t) ? t : 'light';
}

function nextTheme(mode) {
  const t = normalizeTheme(mode);
  const idx = THEME_ORDER.indexOf(t);
  return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
}

function setTheme(mode) {
  const t = normalizeTheme(mode);
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('viewer-theme', t);
  E.theme.textContent = `切換：${THEME_LABEL[nextTheme(t)]}`;
}

function initTheme() {
  const saved = localStorage.getItem('viewer-theme');
  if (saved && THEME_ORDER.includes(saved)) {
    setTheme(saved);
    return;
  }
  setTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function syncStripToggle() {
  E.toggleStrip.textContent = state.showStrip ? '隱藏縮圖列' : '顯示縮圖列';
  setBinaryButtonState(E.toggleStrip, state.showStrip);
  E.strip.classList.toggle('hidden', !state.showStrip);
  const panel = E.overlay?.querySelector('.overlay-panel');
  if (panel) {
    panel.classList.toggle('strip-hidden', !state.showStrip);
    panel.classList.toggle('strip-visible', !!state.showStrip);
  }
}

function lockOverlayScroll() {
  if (overlayScrollLocked) return;
  overlayScrollLockY = window.scrollY || window.pageYOffset || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${overlayScrollLockY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
  overlayScrollLocked = true;
}

function unlockOverlayScroll() {
  if (!overlayScrollLocked) return;
  const top = Number.parseInt(String(document.body.style.top || '0'), 10);
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  overlayScrollLocked = false;
  const fallbackY = Number.isFinite(-top) ? -top : overlayScrollLockY;
  const targetY = Number.isFinite(state.lastY) ? state.lastY : fallbackY;
  window.scrollTo(0, Math.max(0, Number(targetY || 0)));
}

function startVideoFastForward() {
  if (E.video.classList.contains('hidden')) return;
  if (!E.video.src) return;
  if (videoFastForwardByHold) return;

  videoBaseRate = Number(E.video.playbackRate || 1) || 1;
  E.video.playbackRate = viewerOptions.videoHoldSpeed;
  videoFastForwardByHold = true;
  const speedText = Number(E.video.playbackRate || viewerOptions.videoHoldSpeed).toFixed(2).replace(/\.?0+$/, '');
  showMediaActionIndicator(`${speedText}x`, { sticky: true });
}

function stopVideoFastForward() {
  if (!videoFastForwardByHold) return;
  E.video.playbackRate = videoBaseRate > 0 ? videoBaseRate : 1;
  videoFastForwardByHold = false;
  videoKeyHoldActive = false;
  hideMediaActionIndicator(true);
}

function ensureMediaActionIndicator() {
  if (mediaActionIndicator) return mediaActionIndicator;
  if (!E.mediaWrap) return null;
  const el = document.createElement('div');
  el.className = 'media-action-indicator';
  E.mediaWrap.append(el);
  mediaActionIndicator = el;
  return mediaActionIndicator;
}

function hideMediaActionIndicator(force = false) {
  const el = ensureMediaActionIndicator();
  if (!el) return;
  if (!force && el.dataset.sticky === '1') return;
  if (mediaActionIndicatorTimer) {
    clearTimeout(mediaActionIndicatorTimer);
    mediaActionIndicatorTimer = null;
  }
  el.dataset.sticky = '0';
  el.classList.remove('show');
}

function showMediaActionIndicator(text, opt = {}) {
  const el = ensureMediaActionIndicator();
  if (!el) return;
  const sticky = !!opt.sticky;
  const duration = Math.max(240, Number(opt.duration || 620));
  el.textContent = String(text || '').trim();
  if (!el.textContent) return;
  el.dataset.sticky = sticky ? '1' : '0';
  el.classList.add('show');
  if (mediaActionIndicatorTimer) {
    clearTimeout(mediaActionIndicatorTimer);
    mediaActionIndicatorTimer = null;
  }
  if (!sticky) {
    mediaActionIndicatorTimer = setTimeout(() => {
      el.classList.remove('show');
      mediaActionIndicatorTimer = null;
    }, duration);
  }
}

function ensureVideoLoadIndicator() {
  if (videoLoadIndicator) return videoLoadIndicator;
  if (!E.mediaWrap) return null;
  const el = document.createElement('div');
  el.className = 'video-load-indicator';
  E.mediaWrap.append(el);
  videoLoadIndicator = el;
  return videoLoadIndicator;
}

function setVideoLoadIndicator(text) {
  const el = ensureVideoLoadIndicator();
  if (!el) return;
  el.textContent = String(text || '').trim() || '正在載入...';
  el.classList.add('show');
  videoLoadActive = true;
}

function hideVideoLoadIndicator() {
  if (!videoLoadIndicator) return;
  videoLoadIndicator.classList.remove('show');
  videoLoadActive = false;
}

function updateVideoLoadIndicator() {
  if (E.video.classList.contains('hidden')) return;
  if (!videoLoadActive) return;

  const buffered = E.video.buffered;
  let bufferedEnd = 0;
  try {
    if (buffered && buffered.length > 0) bufferedEnd = Number(buffered.end(buffered.length - 1) || 0);
  } catch {
    bufferedEnd = 0;
  }

  const dur = Number(E.video.duration || 0);
  if (Number.isFinite(bufferedEnd) && bufferedEnd > 0) {
    if (Number.isFinite(dur) && dur > 0) {
      const pct = Math.max(1, Math.min(100, Math.round((bufferedEnd / dur) * 100)));
      setVideoLoadIndicator(`已載入 ${pct}%`);
      return;
    }
    setVideoLoadIndicator(`已載入 ${Math.max(1, Math.round(bufferedEnd))} 秒`);
    return;
  }
  setVideoLoadIndicator('正在載入...');
}

function clearVideoKeyHoldTimer() {
  if (videoKeyHoldTimer) {
    clearTimeout(videoKeyHoldTimer);
    videoKeyHoldTimer = null;
  }
}

function resetVideoTapState() {
  videoLastTapAt = 0;
  videoLastTapSide = '';
  videoTouchDownAt = 0;
  videoTouchMoved = false;
}

function resetVideoRightKeyState() {
  clearVideoKeyHoldTimer();
  videoRightKeyDown = false;
  videoRightKeyDownAt = 0;
  if (videoKeyHoldActive || videoFastForwardByHold) {
    videoKeyHoldActive = false;
    stopVideoFastForward();
  }
}

function seekVideoRelative(deltaSec) {
  const now = Number(E.video.currentTime || 0);
  const dur = Number(E.video.duration || 0);
  const target = now + Number(deltaSec || 0);
  if (Number.isFinite(dur) && dur > 0) {
    E.video.currentTime = Math.max(0, Math.min(dur, target));
  } else {
    E.video.currentTime = Math.max(0, target);
  }
  if (E.scrub && !Number.isNaN(E.video.currentTime)) {
    E.scrub.value = String(Number(E.video.currentTime || 0));
  }
  const sec = Math.abs(Math.round(Number(deltaSec || 0)));
  if (sec > 0) showMediaActionIndicator(`${deltaSec >= 0 ? '+' : '-'}${sec}s`, { duration: 560 });
}

function getVideoTapSide(clientX) {
  const rect = E.video.getBoundingClientRect();
  if (!rect.width) return 'right';
  return clientX < rect.left + rect.width / 2 ? 'left' : 'right';
}

function seekVideoBySide(side) {
  const step = viewerOptions.videoSeekSeconds;
  seekVideoRelative(side === 'left' ? -step : step);
}

function clearVideoTouchHoldTimer() {
  if (videoTouchHoldTimer) {
    clearTimeout(videoTouchHoldTimer);
    videoTouchHoldTimer = null;
  }
}

function clearVideoPointerHoldTimer() {
  if (videoPointerHoldTimer) {
    clearTimeout(videoPointerHoldTimer);
    videoPointerHoldTimer = null;
  }
}

function resetVideoPointerHoldState() {
  clearVideoPointerHoldTimer();
  const wasActive = videoPointerHoldActive;
  videoPointerHoldActive = false;
  videoPointerHoldId = -1;
  if (wasActive) stopVideoFastForward();
}

function resetVideoSpaceKeyState() {
  videoSpaceKeyDown = false;
}

function isOverlayVideoActive() {
  if (E.overlay.classList.contains('hidden')) return false;
  const current = currentId ? itemStore.get(currentId) : null;
  return !!(current && current.category === 'video');
}

function consumeKeyEvent(e) {
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
}

function startVideoRightKeyTracking(nowMs) {
  videoRightKeyDown = true;
  videoRightKeyDownAt = nowMs;
  videoKeyHoldActive = false;
  clearVideoKeyHoldTimer();
  videoKeyHoldTimer = setTimeout(() => {
    videoKeyHoldTimer = null;
    if (!videoRightKeyDown) return;
    videoKeyHoldActive = true;
    startVideoFastForward();
  }, viewerOptions.videoHoldTriggerMs);
}

function activateVideoRightKeyHold(nowMs) {
  if (!videoRightKeyDown) {
    videoRightKeyDown = true;
    videoRightKeyDownAt = nowMs - viewerOptions.videoHoldTriggerMs;
  }
  clearVideoKeyHoldTimer();
  if (!videoKeyHoldActive) {
    videoKeyHoldActive = true;
    startVideoFastForward();
  }
}

function isSpaceKey(e) {
  return e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
}

function handleVideoSpaceKeyDown(e) {
  if (!isOverlayVideoActive()) return false;
  if (!isSpaceKey(e)) return false;
  consumeKeyEvent(e);
  if (e.repeat || videoSpaceKeyDown) return true;
  videoSpaceKeyDown = true;

  const active = document.activeElement;
  if (
    active === E.scrub ||
    active === E.video ||
    active?.tagName === 'BUTTON' ||
    active?.tagName === 'A'
  ) {
    active.blur?.();
  }

  const shouldPlay = !!(E.video.paused || E.video.ended);
  if (shouldPlay) E.video.play().catch(() => {});
  else E.video.pause();
  showMediaActionIndicator(shouldPlay ? '播放' : '暫停', { duration: 360 });
  return true;
}

function handleVideoSpaceKeyUp(e) {
  if (!isOverlayVideoActive()) return false;
  if (!isSpaceKey(e)) return false;
  consumeKeyEvent(e);
  videoSpaceKeyDown = false;
  return true;
}

function handleOverlayPageNavKey(e) {
  if (E.overlay.classList.contains('hidden')) return false;
  if (e.key !== 'PageUp' && e.key !== 'PageDown') return false;
  consumeKeyEvent(e);
  if (e.repeat) return true;
  openAdj(e.key === 'PageUp' ? -1 : 1).catch(() => {});
  return true;
}

function handleOverlayPageNavKeyUp(e) {
  if (E.overlay.classList.contains('hidden')) return false;
  if (e.key !== 'PageUp' && e.key !== 'PageDown') return false;
  consumeKeyEvent(e);
  return true;
}

function handleVideoArrowKeyDown(e) {
  if (!isOverlayVideoActive()) return false;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
  consumeKeyEvent(e);

  if (e.key === 'ArrowLeft') {
    const step = e.shiftKey ? viewerOptions.videoSeekSecondsShift : viewerOptions.videoSeekSeconds;
    seekVideoRelative(-step);
    return true;
  }

  if (document.activeElement === E.scrub || document.activeElement === E.video) {
    document.activeElement.blur();
  }

  const nowMs = Date.now();
  if (videoRightKeyDown && nowMs - videoRightKeyDownAt > 3000) {
    resetVideoRightKeyState();
  }
  if (!videoRightKeyDown) {
    if (e.repeat) activateVideoRightKeyHold(nowMs);
    else startVideoRightKeyTracking(nowMs);
    return true;
  }
  if (!videoKeyHoldActive && nowMs - videoRightKeyDownAt >= viewerOptions.videoHoldTriggerMs) {
    activateVideoRightKeyHold(nowMs);
  }
  return true;
}

function handleVideoArrowKeyUp(e) {
  if (!isOverlayVideoActive()) return false;
  if (e.key !== 'ArrowRight') return false;
  consumeKeyEvent(e);

  if (!videoRightKeyDown && !videoKeyHoldTimer && !videoKeyHoldActive) return true;

  const heldMs = videoRightKeyDownAt > 0 ? Date.now() - videoRightKeyDownAt : 0;
  const wasHold = videoKeyHoldActive || videoFastForwardByHold || heldMs >= viewerOptions.videoHoldTriggerMs;

  videoRightKeyDown = false;
  videoRightKeyDownAt = 0;
  clearVideoKeyHoldTimer();

  if (wasHold) {
    videoKeyHoldActive = false;
    stopVideoFastForward();
    return true;
  }

  const step = e.shiftKey ? viewerOptions.videoSeekSecondsShift : viewerOptions.videoSeekSeconds;
  seekVideoRelative(step);
  return true;
}

function setImageZoom(scale, opt = {}) {
  const current = currentId ? itemStore.get(currentId) : null;
  const canZoom = current && current.category === 'image' && !E.image.classList.contains('hidden');
  imageZoomScale = canZoom ? Math.max(1, Number(scale || 1)) : 1;
  const zoomed = canZoom && imageZoomScale > 1.01;

  E.mediaWrap.classList.toggle('image-zoomed', zoomed);
  E.image.classList.toggle('zoomable', !!canZoom);
  E.image.classList.toggle('zoomed', zoomed);

  if (!zoomed) {
    E.image.style.removeProperty('width');
    E.image.style.removeProperty('height');
    E.image.style.removeProperty('max-width');
    E.image.style.removeProperty('max-height');
    E.mediaWrap.scrollLeft = 0;
    E.mediaWrap.scrollTop = 0;
    return;
  }

  const displayedWidth = Math.max(1, Math.round(E.image.getBoundingClientRect().width || E.mediaWrap.clientWidth || window.innerWidth));
  const targetWidth = Math.max(displayedWidth + 1, Math.round(displayedWidth * imageZoomScale));
  E.image.style.setProperty('width', `${targetWidth}px`, 'important');
  E.image.style.setProperty('height', 'auto', 'important');
  E.image.style.setProperty('max-width', 'none', 'important');
  E.image.style.setProperty('max-height', 'none', 'important');

  const ratioX = Math.max(0, Math.min(1, Number(opt.ratioX ?? 0.5)));
  const ratioY = Math.max(0, Math.min(1, Number(opt.ratioY ?? 0.5)));
  requestAnimationFrame(() => {
    E.mediaWrap.scrollLeft = Math.max(0, (E.mediaWrap.scrollWidth - E.mediaWrap.clientWidth) * ratioX);
    E.mediaWrap.scrollTop = Math.max(0, (E.mediaWrap.scrollHeight - E.mediaWrap.clientHeight) * ratioY);
  });
}

function resetImageZoom() {
  setImageZoom(1);
}

function toggleImageZoomByClick(ev) {
  const current = currentId ? itemStore.get(currentId) : null;
  if (!current || current.category !== 'image') return;
  if (E.image.classList.contains('hidden')) return;

  if (imageZoomScale > 1.01) {
    resetImageZoom();
    return;
  }

  const wrapRect = E.mediaWrap.getBoundingClientRect();
  const ratioX =
    wrapRect.width > 0 && Number.isFinite(ev?.clientX) ? (ev.clientX - wrapRect.left) / wrapRect.width : 0.5;
  const ratioY =
    wrapRect.height > 0 && Number.isFinite(ev?.clientY) ? (ev.clientY - wrapRect.top) / wrapRect.height : 0.5;
  const zoomTarget = IS_MOBILE_CLIENT ? viewerOptions.imageZoomMobile : viewerOptions.imageZoomDesktop;
  setImageZoom(zoomTarget, { ratioX, ratioY });
}

function resetImagePointerState() {
  imagePointerId = -1;
  imagePointerMoved = false;
  imagePointerDragging = false;
  imagePointerScrollLeft = 0;
  imagePointerScrollTop = 0;
  imagePointerStartX = 0;
  imagePointerStartY = 0;
  E.image.classList.remove('dragging');
}

function bindVideoFastForwardHold() {
  if (!E.video) return;

  E.video.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  E.video.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    e.preventDefault();
    startVideoFastForward();
  });

  E.video.addEventListener('mouseup', (e) => {
    if (e.button !== 2) return;
    stopVideoFastForward();
  });

  E.video.addEventListener('mouseleave', stopVideoFastForward);
  window.addEventListener('mouseup', stopVideoFastForward);
  window.addEventListener('blur', stopVideoFastForward);
  E.video.addEventListener('dblclick', (e) => {
    if (E.video.classList.contains('hidden')) return;
    e.preventDefault();
    const side = getVideoTapSide(e.clientX);
    seekVideoBySide(side);
  });

  const clearVideoFocusSoon = () => {
    setTimeout(() => {
      if (document.activeElement === E.video || document.activeElement === E.scrub) {
        document.activeElement.blur();
      }
    }, 0);
  };
  E.video.addEventListener('pointerup', clearVideoFocusSoon);
  E.scrub.addEventListener('pointerup', clearVideoFocusSoon);
  const onVideoKeyDown = (e) => {
    if (handleOverlayPageNavKey(e)) return;
    if (handleVideoSpaceKeyDown(e)) return;
    handleVideoArrowKeyDown(e);
  };
  const onVideoKeyUp = (e) => {
    if (handleOverlayPageNavKeyUp(e)) return;
    if (handleVideoSpaceKeyUp(e)) return;
    handleVideoArrowKeyUp(e);
  };
  E.video.addEventListener('keydown', onVideoKeyDown, { capture: true });
  E.video.addEventListener('keyup', onVideoKeyUp, { capture: true });
  E.scrub.addEventListener('keydown', onVideoKeyDown, { capture: true });
  E.scrub.addEventListener('keyup', onVideoKeyUp, { capture: true });

  E.video.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      videoPointerHoldId = e.pointerId;
      videoPointerStartX = e.clientX;
      videoPointerStartY = e.clientY;
      videoPointerHoldActive = false;
      clearVideoPointerHoldTimer();
      videoPointerHoldTimer = setTimeout(() => {
        videoPointerHoldTimer = null;
        if (videoPointerHoldId === -1) return;
        videoPointerHoldActive = true;
        startVideoFastForward();
      }, viewerOptions.videoHoldTriggerMs);
    },
    { passive: true }
  );

  E.video.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'touch') return;
      if (videoPointerHoldId !== e.pointerId) return;
      const moved = Math.abs(e.clientX - videoPointerStartX) > 18 || Math.abs(e.clientY - videoPointerStartY) > 18;
      if (!moved) return;
      clearVideoPointerHoldTimer();
      if (videoPointerHoldActive) {
        videoPointerHoldActive = false;
        stopVideoFastForward();
      }
    },
    { passive: true }
  );

  const endPointerHold = (e) => {
    if (e.pointerType !== 'touch') return;
    if (videoPointerHoldId !== -1 && e.pointerId !== videoPointerHoldId) return;
    const wasActive = videoPointerHoldActive;
    clearVideoPointerHoldTimer();
    videoPointerHoldActive = false;
    videoPointerHoldId = -1;
    if (wasActive) stopVideoFastForward();
  };
  E.video.addEventListener('pointerup', endPointerHold, { passive: true });
  E.video.addEventListener('pointercancel', endPointerHold, { passive: true });

  E.video.addEventListener(
    'touchstart',
    (e) => {
      if (videoPointerHoldId !== -1) return;
      if (!e.touches?.length) return;
      const t = e.touches[0];
      videoTouchStartX = t.clientX;
      videoTouchStartY = t.clientY;
      videoTouchDownAt = Date.now();
      videoTouchMoved = false;
      videoTouchHoldActive = false;
      clearVideoTouchHoldTimer();
      videoTouchHoldTimer = setTimeout(() => {
        videoTouchHoldTimer = null;
        videoTouchHoldActive = true;
        startVideoFastForward();
      }, viewerOptions.videoHoldTriggerMs);
    },
    { passive: true }
  );

  E.video.addEventListener(
    'touchmove',
    (e) => {
      if (videoPointerHoldId !== -1) return;
      if (!e.touches?.length) return;
      const t = e.touches[0];
      const moved = Math.abs(t.clientX - videoTouchStartX) > 12 || Math.abs(t.clientY - videoTouchStartY) > 12;
      if (moved) {
        videoTouchMoved = true;
        clearVideoTouchHoldTimer();
        if (videoTouchHoldActive) {
          videoTouchHoldActive = false;
          stopVideoFastForward();
        }
      }
    },
    { passive: true }
  );

  const endTouch = (e) => {
    if (videoPointerHoldId !== -1) return;
    const wasHold = videoTouchHoldActive;
    clearVideoTouchHoldTimer();
    if (videoTouchHoldActive) {
      videoTouchHoldActive = false;
      stopVideoFastForward();
    }
    if (wasHold) {
      resetVideoTapState();
      return;
    }
    if (videoTouchMoved) return;
    if (!e?.changedTouches?.length) return;
    const elapsed = videoTouchDownAt > 0 ? Date.now() - videoTouchDownAt : 0;
    if (elapsed > 320) return;
    const t = e.changedTouches[0];
    const side = getVideoTapSide(t.clientX);
    const nowMs = Date.now();
    if (videoLastTapSide === side && nowMs - videoLastTapAt <= 300) {
      seekVideoBySide(side);
      resetVideoTapState();
      return;
    }
    videoLastTapAt = nowMs;
    videoLastTapSide = side;
  };

  E.video.addEventListener('touchend', endTouch, { passive: true });
  E.video.addEventListener('touchcancel', endTouch, { passive: true });
}

function syncCurrentFavoriteButton() {
  if (!E.favoriteCurrent) return;
  const isFav = currentId && favorites.items.has(currentId);
  E.favoriteCurrent.textContent = isFav ? '取消收藏本文件' : '收藏本文件';
}

function syncViewerTitle() {
  const it = currentId ? itemStore.get(currentId) : null;
  if (!E.title) return;
  const panel = E.overlay?.querySelector('.overlay-panel');
  const showTitle = !!(it && state.showViewerTitle);
  if (panel) panel.classList.toggle('title-hidden', !showTitle);
  if (!showTitle) {
    E.title.classList.add('hidden');
    E.title.textContent = '';
    return;
  }
  E.title.classList.remove('hidden');
  E.title.textContent = state.showPaths ? it.displayPath || it.name : it.name;
}

function syncFavoritesVisibility() {
  E.browsePanel.classList.toggle('hidden', state.showFavorites);
  E.favoritesPanel.classList.toggle('hidden', !state.showFavorites);
  E.favoritesToggle.textContent = state.showFavorites ? '返回瀏覽' : '收藏夾';
}

function setBinaryButtonState(el, enabled) {
  if (!el) return;
  const isOn = !!enabled;
  el.classList.toggle('is-on', isOn);
  el.classList.toggle('is-off', !isOn);
  el.setAttribute('aria-pressed', isOn ? 'true' : 'false');
}

function syncControlStates() {
  setBinaryButtonState(E.thumbToggle, state.showFolderThumbs);
  setBinaryButtonState(E.pathToggle, state.showPaths);
  setBinaryButtonState(E.detailToggle, state.showDetails);
  setBinaryButtonState(E.viewerNameToggle, state.showViewerTitle);
  setBinaryButtonState(E.toggleStrip, state.showStrip);
  setBinaryButtonState(E.favoritesToggle, state.showFavorites);
}

function syncUI() {
  state.layoutMode = 'tree';
  document.body.dataset.viewMode = state.viewMode;
  document.body.dataset.gridSize = state.gridSize;
  document.body.dataset.layoutMode = 'tree';
  E.view.textContent = state.viewMode === 'grid' ? '列表檢視' : '網格檢視';
  E.thumbToggle.textContent = state.showFolderThumbs ? '資料夾縮圖: 開' : '資料夾縮圖: 關';
  E.pathToggle.textContent = state.showPaths ? '路徑: 開' : '路徑: 關';
  E.detailToggle.textContent = state.showDetails ? '詳細: 開' : '詳細: 關';
  E.viewerNameToggle.textContent = state.showViewerTitle ? '檔名: 開' : '檔名: 關';
  document.body.classList.toggle('hide-paths', !state.showPaths);
  document.body.classList.toggle('hide-details', !state.showDetails);
  E.search.value = state.search;
  E.sort.value = state.sort;
  E.gridSize.value = state.gridSize;
  for (const c of E.typesWrap.querySelectorAll("input[type='checkbox']")) c.checked = state.types.has(c.value);
  E.back.disabled = !Number.isFinite(state.lastY);
  syncStripToggle();
  syncFavoritesVisibility();
  syncCurrentFavoriteButton();
  syncViewerTitle();
  syncControlStates();
}

function typeCount(c) {
  if (!c || state.types.size === 0) return 0;
  let s = 0;
  for (const t of state.types) s += Number(c[t] || 0);
  return s;
}

function mediaCount(c) {
  if (!c) return 0;
  let s = 0;
  if (state.types.has('video')) s += Number(c.video || 0);
  if (state.types.has('image')) s += Number(c.image || 0);
  return s;
}

function filt(node, k) {
  const kids = (node.children || []).map((x) => filt(x, k)).filter(Boolean);
  const match = !k || `${node.name || ''} ${node.path || ''}`.toLowerCase().includes(k);
  const cnt = typeCount(node.counts);
  const mcnt = mediaCount(node.counts);
  const kidsCnt = kids.reduce((s, x) => s + Number(x.filteredCount || 0), 0);
  const ownCnt = Math.max(0, cnt - kidsCnt);
  if (node.path !== '/' && !match && !kids.length) return null;
  return { ...node, children: kids, filteredCount: cnt, filteredMediaCount: mcnt, filteredOwnCount: ownCnt };
}

function allPaths(node, a = []) {
  if (!node) return a;
  if (node.path !== '/') a.push(node.path);
  for (const c of node.children || []) allPaths(c, a);
  return a;
}

function ancestors(pathText) {
  const p = String(pathText || '').trim();
  if (!p || p === '/') return [];
  const seg = p.split('/').filter(Boolean);
  const out = [];
  let cur = '';
  for (const s of seg) {
    cur = cur ? `${cur}/${s}` : s;
    out.push(cur);
  }
  return out;
}

async function loadLib(silent = false) {
  if (isLoading) return;
  isLoading = true;
  try {
    const r = await fetch('/api/library', { cache: 'no-store' });
    if (!r.ok) throw new Error(`讀取媒體庫失敗 (${r.status})`);
    lib = await r.json();
    applyViewerOptions(lib?.options || {});
    tree = lib.tree || null;
    folderCache = new Map();
    folderAllCache = new Map();
    itemStore = new Map();
    folderByItem = new Map();
    const p = lib.preview || {};
    const i = lib.index || {};
    E.status.textContent = [`檔案 ${lib.totalItems || 0}`, `大小 ${fsize(lib.totalSize || 0)}`, i.isIndexing ? '索引中' : '索引完成', `預覽 ${p.finishedThisRound || 0}/${p.totalQueuedThisRound || 0}`].join(' | ');
    const needPoll = !!(i.isIndexing || Number(p.queued || 0) > 0 || Number(p.active || 0) > 0);
    if (needPoll && !pollTimer) pollTimer = setInterval(() => loadLib(true).catch(() => {}), 2500);
    if (!needPoll && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    await render();
    renderFavorites();
  } catch (err) {
    if (!silent) alert(err.message || '載入失敗');
  } finally {
    isLoading = false;
  }
}

async function folderItems(path, all = false) {
  const types = all ? '' : Array.from(state.types).sort().join(',');
  const kw = all ? '' : state.search.trim();
  const key = `${path}|${types}|${kw}|${state.sort}|${all ? 'a' : 'f'}`;
  const cache = all ? folderAllCache : folderCache;
  if (cache.has(key)) return cache.get(key);
  if (folderInflight.has(key)) return folderInflight.get(key);

  const q = new URLSearchParams({ path, sort: state.sort });
  if (types) q.set('types', types);
  if (kw) q.set('keyword', kw);

  const task = fetch(`/api/folder-items?${q.toString()}`, { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) throw new Error(`讀取資料夾失敗 (${r.status})`);
      const d = await r.json();
      for (const it of d.items || []) {
        itemStore.set(it.id, it);
        folderByItem.set(it.id, it.displayFolder || path);
      }
      cache.set(key, d);
      return d;
    })
    .finally(() => folderInflight.delete(key));

  folderInflight.set(key, task);
  return task;
}
function createGenericThumb(item) {
  const box = document.createElement('div');
  box.className = 'thumb thumb-generic';
  box.textContent = (item.extension || item.category || 'file').replace('.', '').toUpperCase().slice(0, 8);
  return box;
}

function makeFavoriteItemButton(itemId) {
  const isFav = favorites.items.has(itemId);
  return `<button type="button" class="btn-secondary" data-action="toggle-fav-item" data-id="${esc(itemId)}">${isFav ? '★已收藏' : '☆收藏'}</button>`;
}

function itemList(items) {
  const ul = document.createElement('ul');
  ul.className = state.viewMode === 'grid' ? 'media-list grid-mode' : 'media-list list-mode';

  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'media-item';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'thumb-wrap';
    if (it.category === 'video' || it.category === 'image') {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = it.name;
      img.dataset.action = 'open';
      img.dataset.id = it.id;
      img.src = purl(it);
      thumbWrap.append(img);
    } else {
      const generic = createGenericThumb(it);
      generic.dataset.action = 'open';
      generic.dataset.id = it.id;
      thumbWrap.append(generic);
    }

    const info = document.createElement('div');
    info.className = 'media-info';
    info.innerHTML = `<div class="media-title">${esc(it.name)}</div><div class="media-meta">${it.category.toUpperCase()} | ${fsize(it.size)} | ${new Date(it.updatedAt).toLocaleString()}</div><div class="media-path">${esc(it.displayPath || it.relativePath)}</div>`;

    const a = document.createElement('div');
    a.className = 'media-actions';
    a.innerHTML = `<button type="button" data-action="open" data-id="${esc(it.id)}">查看</button>${makeFavoriteItemButton(it.id)}`;

    li.append(thumbWrap, info, a);
    ul.append(li);
  }
  return ul;
}

async function mountFolder(path, host, all = false) {
  try {
    const d = await folderItems(path, all);
    if (!(d.items || []).length) {
      host.innerHTML = '';
      host.classList.add('is-empty');
      return;
    }
    host.classList.remove('is-empty');
    host.innerHTML = '';
    host.append(itemList(d.items));
  } catch {
    host.innerHTML = '';
    host.classList.add('is-empty');
  }
}

function folderPreviewId(node) {
  if (!state.showFolderThumbs) return null;
  if (!mediaPreviewTypeSet()) return null;
  if ((node.filteredMediaCount || 0) <= 0) return null;
  return node.sampleMediaItemId || null;
}

function folderRow(node) {
  const row = document.createElement('div');
  row.className = 'folder-summary';
  const previewId = folderPreviewId(node);
  if (!previewId) row.classList.add('no-thumb');

  if (previewId) {
    const tw = document.createElement('div');
    tw.className = 'folder-thumb-wrap';
    const img = document.createElement('img');
    img.className = 'folder-thumb';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = node.name;
    img.src = purl(previewId);
    tw.append(img);
    row.append(tw);
  }

  const t = document.createElement('div');
  t.className = 'folder-summary-text';
  t.innerHTML = `<div class="folder-summary-title">${esc(node.path === '/' ? '根目錄' : node.name)}</div><div class="folder-summary-sub">${esc(node.path)}</div>`;

  const c = document.createElement('div');
  c.className = 'folder-count';
  c.textContent = String(node.filteredCount || 0);

  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.className = 'folder-fav-btn';
  favBtn.dataset.action = 'toggle-fav-folder';
  favBtn.dataset.path = node.path;
  favBtn.textContent = favorites.folders.has(node.path) ? '★' : '☆';

  row.append(t, c);
  row.append(favBtn);
  return row;
}

function updateFocusedClass() {
  const focused = String(state.focused || '');
  for (const [nodePath, d] of detailsMap.entries()) {
    const own = nodePath === focused;
    const branch = !!focused && (own || focused === '/' || nodePath.startsWith(`${focused}/`));
    d.classList.toggle('is-focused', own);
    d.classList.toggle('is-focused-branch', branch);
  }
}

function refreshCompactRows() {
  for (const d of detailsMap.values()) {
    const ownCount = Number(d.dataset.ownFilteredCount || 0);
    const childCount = Number(d.dataset.childCount || 0);
    const compact = d.open && ownCount === 0 && childCount > 0;
    d.classList.toggle('is-compact-parent', compact);
    const row = d.querySelector(':scope > summary > .folder-summary');
    if (row) row.classList.toggle('compact-name-only', compact);
  }
}

function setTreeBodyOpenHeight(detailsEl) {
  if (!detailsEl) return;
  const body = detailsEl.querySelector(':scope > .tree-body');
  if (!body) return;
  const raw = Math.ceil(body.scrollHeight || 0) + 8;
  const buffer = Math.max(180, Math.ceil((window.innerHeight || 0) * 0.35));
  const h = Math.max(48, raw + buffer);
  detailsEl.style.setProperty('--tree-open-h', `${h}px`);
}

function refreshOpenTreeHeights() {
  for (const d of detailsMap.values()) {
    if (!d.classList.contains('is-open')) continue;
    setTreeBodyOpenHeight(d);
  }
}

function refreshOpenTreeHeightsSoon() {
  if (treeHeightRaf) cancelAnimationFrame(treeHeightRaf);
  treeHeightRaf = requestAnimationFrame(() => {
    treeHeightRaf = 0;
    refreshOpenTreeHeights();
    requestAnimationFrame(() => refreshOpenTreeHeights());
  });
}

function buildNode(node, depth = 0) {
  const d = document.createElement('details');
  d.className = 'tree-node';
  d.dataset.nodePath = node.path;
  d.dataset.depth = String(depth);
  d.dataset.ownFilteredCount = String(node.filteredOwnCount || 0);
  d.dataset.childCount = String((node.children || []).length);
  d.open = state.open.has(node.path);
  d.classList.toggle('is-open', d.open);
  detailsMap.set(node.path, d);

  const s = document.createElement('summary');
  s.dataset.nodePath = node.path;
  s.append(folderRow(node));

  const body = document.createElement('div');
  body.className = 'tree-body';
  const host = document.createElement('div');
  host.className = 'folder-items-host';
  const kids = document.createElement('div');
  kids.className = 'tree-children';
  const mobileFactor = IS_MOBILE_CLIENT ? 0.5 : 1;
  const depthGap = Math.max(IS_MOBILE_CLIENT ? 0.5 : 1, (2.5 - depth * 0.25) * mobileFactor);
  const depthPad = Math.max(IS_MOBILE_CLIENT ? 1 : 2, (5.5 - depth * 0.35) * mobileFactor);
  const summaryPad = Math.max(IS_MOBILE_CLIENT ? 2 : 4, (7.5 - depth * 0.3) * mobileFactor);
  d.style.setProperty('--node-summary-pad', `${summaryPad}px`);
  body.style.setProperty('--node-body-gap', `${depthPad}px`);
  body.style.setProperty('--node-body-pad', `${depthPad}px`);
  kids.style.gap = `${depthGap}px`;
  kids.style.marginLeft = `${depthGap}px`;
  body.append(host, kids);
  d.append(s, body);

  let kidsBuilt = false;
  let itemsLoaded = false;

  const ensureKids = () => {
    if (kidsBuilt) return;
    kidsBuilt = true;
    const f = document.createDocumentFragment();
    for (const c of node.children || []) f.append(buildNode(c, depth + 1));
    kids.append(f);
    refreshOpenTreeHeightsSoon();
  };

  const ensureItems = async () => {
    if (itemsLoaded) return;
    itemsLoaded = true;
    await mountFolder(node.path, host, false);
    setTreeBodyOpenHeight(d);
    refreshOpenTreeHeightsSoon();
  };

  if (d.open) {
    setTreeBodyOpenHeight(d);
    ensureKids();
    d.classList.add('is-open');
    if (node.path === state.focused || depth === 0) ensureItems().catch(() => {});
  }

  d.addEventListener('toggle', () => {
    if (d.open) {
      setTreeBodyOpenHeight(d);
      state.open.add(node.path);
      ensureKids();
      ensureItems().catch(() => {});
      requestAnimationFrame(() => {
        d.classList.add('is-open');
        setTreeBodyOpenHeight(d);
        refreshOpenTreeHeightsSoon();
      });
    } else {
      setTreeBodyOpenHeight(d);
      state.open.delete(node.path);
      d.classList.remove('is-open');
      refreshOpenTreeHeightsSoon();
    }
    updateFocusedClass();
    refreshCompactRows();
    saveSoon();
  });

  return d;
}

async function renderTree(filtered) {
  E.tree.classList.remove('hidden');
  E.folderGrid.classList.add('hidden');
  E.tree.classList.remove('tree-grid-mode');
  detailsMap = new Map();
  const frag = document.createDocumentFragment();
  for (const n of filtered.children || []) frag.append(buildNode(n, 0));
  E.tree.replaceChildren(frag);
  updateFocusedClass();
  refreshCompactRows();
  refreshOpenTreeHeightsSoon();
  if (pendingFocus && detailsMap.has(pendingFocus)) {
    detailsMap.get(pendingFocus).scrollIntoView({ block: 'center', behavior: 'smooth' });
    pendingFocus = '';
  }
}

async function render() {
  if (!tree) {
    E.empty.classList.remove('hidden');
    E.tree.innerHTML = '';
    return;
  }
  const ft = filt(tree, state.search.trim().toLowerCase());
  lastFilteredTree = ft;
  if (!ft || !((ft.children && ft.children.length) || ft.path === '/')) {
    E.empty.classList.remove('hidden');
    E.tree.innerHTML = '';
    return;
  }
  E.empty.classList.add('hidden');
  await renderTree(ft);
}

function schedule(opt = {}) {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    const keepY = opt.preserveScroll ? window.scrollY : null;
    if (opt.resetAll) {
      folderCache = new Map();
      folderAllCache = new Map();
    } else {
      folderCache = new Map();
    }
    render().catch(() => {}).finally(() => {
      if (Number.isFinite(keepY)) {
        const nowY = window.scrollY;
        const moved = Math.abs(nowY - keepY);
        const isUserScrolling = Date.now() - lastUserScrollAt < 220;
        if (!isUserScrolling && moved <= 24 && moved > 1) window.scrollTo(0, keepY);
      }
      renderFavorites();
      saveSoon();
    });
  }, 120);
}

function bindOverlaySwipeNav() {
  if (!E.mediaWrap) return;

  const canSwipeNavigate = () => {
    if (E.overlay.classList.contains('hidden')) return false;
    const current = currentId ? itemStore.get(currentId) : null;
    if (!current) return false;
    return current.category === 'image' && imageZoomScale <= 1.01;
  };

  E.mediaWrap.addEventListener(
    'touchstart',
    (e) => {
      if (!canSwipeNavigate()) return;
      if (!e.touches?.length) return;
      const t = e.touches[0];
      overlaySwipeTracking = true;
      overlaySwipeStartX = t.clientX;
      overlaySwipeStartY = t.clientY;
      overlaySwipeCurrentX = t.clientX;
      overlaySwipeCurrentY = t.clientY;
      overlaySwipeStartedAt = Date.now();
    },
    { passive: true }
  );

  E.mediaWrap.addEventListener(
    'touchmove',
    (e) => {
      if (!overlaySwipeTracking) return;
      if (!canSwipeNavigate()) {
        finishSwipe();
        return;
      }
      if (!e.touches?.length) return;
      const t = e.touches[0];
      overlaySwipeCurrentX = t.clientX;
      overlaySwipeCurrentY = t.clientY;

      const dx = overlaySwipeCurrentX - overlaySwipeStartX;
      const dy = overlaySwipeCurrentY - overlaySwipeStartY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const elapsed = Date.now() - overlaySwipeStartedAt;
      if (Date.now() - overlaySwipeLastTriggerAt < 180) return;
      if (elapsed > 420) return;
      if (absX < 28) return;
      if (absX < absY * 1.15) return;

      overlaySwipeLastTriggerAt = Date.now();
      finishSwipe();
      openAdj(dx < 0 ? 1 : -1).catch(() => {});
    },
    { passive: true }
  );

  const finishSwipe = () => {
    overlaySwipeTracking = false;
  };

  E.mediaWrap.addEventListener(
    'touchend',
    () => {
      if (!overlaySwipeTracking) return;
      if (!canSwipeNavigate()) {
        finishSwipe();
        return;
      }
      const dx = overlaySwipeCurrentX - overlaySwipeStartX;
      const dy = overlaySwipeCurrentY - overlaySwipeStartY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const elapsed = Date.now() - overlaySwipeStartedAt;
      finishSwipe();

      if (Date.now() - overlaySwipeLastTriggerAt < 180) return;
      if (elapsed > 1200) return;
      if (absX < 34) return;
      if (absX < absY * 1.12) return;
      overlaySwipeLastTriggerAt = Date.now();
      openAdj(dx < 0 ? 1 : -1).catch(() => {});
    },
    { passive: true }
  );

  E.mediaWrap.addEventListener('touchcancel', finishSwipe, { passive: true });
}

function openMenu(path, details, x, y) {
  menuPath = path;
  menuDetails = details || null;
  E.menu.classList.remove('hidden');
  const w = 282;
  const h = 500;
  E.menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x))}px`;
  E.menu.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, y))}px`;
}

function closeMenu() {
  E.menu.classList.add('hidden');
}

function focusInTree(path, only) {
  state.layoutMode = 'tree';
  state.showFavorites = false;
  state.focused = path;
  state.open = new Set(ancestors(path));
  if (!only) state.open.add(path);
  pendingFocus = path;
  syncUI();
  schedule({ preserveScroll: true });
}

function resetView() {
  state.viewMode = DEFAULTS.viewMode;
  state.layoutMode = 'tree';
  state.gridSize = DEFAULTS.gridSize;
  state.showFolderThumbs = DEFAULTS.showFolderThumbs;
  state.showPaths = DEFAULTS.showPaths;
  state.showDetails = DEFAULTS.showDetails;
  state.showViewerTitle = DEFAULTS.showViewerTitle;
  state.showStrip = DEFAULTS.showStrip;
  state.showFavorites = DEFAULTS.showFavorites;
  state.types = new Set(DEFAULTS.types);
  state.sort = DEFAULTS.sort;
  state.search = DEFAULTS.search;
  state.open = new Set(DEFAULTS.open);
  state.focused = DEFAULTS.focused;
  state.lastY = DEFAULTS.lastY;
  syncUI();
  schedule({ preserveScroll: true, resetAll: true });
}

function bindLongPress(el, selector, resolver) {
  let timer = null;
  let sx = 0;
  let sy = 0;
  let lx = 0;
  let ly = 0;
  let target = null;
  let fired = false;

  const clear = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    target = null;
  };

  el.addEventListener('touchstart', (e) => {
    const t = e.target.closest(selector);
    if (!t || !e.touches?.length) return;
    const p = e.touches[0];
    target = t;
    sx = p.clientX;
    sy = p.clientY;
    lx = sx;
    ly = sy;
    fired = false;
    timer = setTimeout(() => {
      timer = null;
      if (!target) return;
      const m = resolver(target);
      if (m?.path) {
        fired = true;
        openMenu(m.path, m.details || null, lx, ly);
      }
    }, 550);
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!target || !e.touches?.length) return;
    const p = e.touches[0];
    lx = p.clientX;
    ly = p.clientY;
    if (Math.abs(lx - sx) > 12 || Math.abs(ly - sy) > 12) clear();
  }, { passive: true });

  el.addEventListener('touchend', () => {
    clear();
    if (fired) setTimeout(() => { fired = false; }, 220);
  }, { passive: true });
  el.addEventListener('touchcancel', clear, { passive: true });
  el.addEventListener('click', (e) => {
    if (!fired) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
function findNodeByPath(path, node = tree) {
  if (!node) return null;
  if (node.path === path) return node;
  for (const c of node.children || []) {
    const hit = findNodeByPath(path, c);
    if (hit) return hit;
  }
  return null;
}

function toggleFavoriteFolder(path) {
  if (!path) return;
  if (favorites.folders.has(path)) favorites.folders.delete(path);
  else favorites.folders.add(path);
  saveFavorites();
  schedule({ preserveScroll: true });
}

function toggleFavoriteItemById(id) {
  if (!id) return;
  if (favorites.items.has(id)) {
    favorites.items.delete(id);
  } else {
    const it = itemStore.get(id);
    if (!it) return;
    favorites.items.set(id, {
      id: it.id,
      name: it.name,
      category: it.category,
      extension: it.extension,
      size: it.size,
      updatedAt: it.updatedAt,
      displayPath: it.displayPath,
      displayFolder: it.displayFolder || folderByItem.get(it.id) || '',
      previewKey: it.previewKey,
      mediaUrl: it.mediaUrl,
      transcodeUrl: it.transcodeUrl,
      directPlayPreferred: it.directPlayPreferred,
      downloadUrl: it.downloadUrl,
    });
  }
  saveFavorites();
  renderFavorites();
  syncCurrentFavoriteButton();
  schedule({ preserveScroll: true });
}

function clearAllFavorites() {
  favorites.folders.clear();
  favorites.items.clear();
  saveFavorites();
  renderFavorites();
  syncCurrentFavoriteButton();
  schedule({ preserveScroll: true });
}

async function ensureItemLoaded(id) {
  if (itemStore.has(id)) return itemStore.get(id);
  if (favorites.items.has(id)) {
    const fav = favorites.items.get(id);
    itemStore.set(id, fav);
    if (fav.displayFolder) folderByItem.set(id, fav.displayFolder);
  }

  if (itemStore.has(id)) return itemStore.get(id);

  const r = await fetch(`/api/item?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!r.ok) return null;
  const data = await r.json();
  if (!data.item) return null;
  itemStore.set(id, data.item);
  folderByItem.set(id, data.item.displayFolder || '');
  return data.item;
}

async function openFavoriteItem(id) {
  const it = await ensureItemLoaded(id);
  if (!it) return;
  await openItem(id);
}

function renderFavorites() {
  if (!E.favoriteFolders || !E.favoriteItems) return;
  E.favoriteFolders.innerHTML = '';
  E.favoriteItems.innerHTML = '';

  const folderFrag = document.createDocumentFragment();
  for (const path of [...favorites.folders].sort((a, b) => a.localeCompare(b, 'zh-Hant'))) {
    const node = findNodeByPath(path);
    const card = document.createElement('article');
    card.className = 'favorite-card';

    const top = document.createElement('div');
    top.className = 'favorite-card-top';
    let hasTop = false;

    if (node && state.showFolderThumbs && mediaPreviewTypeSet() && Number(node.counts?.video || 0) + Number(node.counts?.image || 0) > 0 && node.sampleMediaItemId) {
      const img = document.createElement('img');
      img.className = 'favorite-thumb';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = path;
      img.src = purl(node.sampleMediaItemId);
      top.append(img);
      hasTop = true;
    }

    const title = document.createElement('div');
    title.className = 'favorite-title';
    title.textContent = path;

    const meta = document.createElement('div');
    meta.className = 'favorite-meta';
    meta.textContent = node ? `檔案數 ${typeCount(node.counts)}` : '路徑可能已不存在';

    const actions = document.createElement('div');
    actions.className = 'favorite-actions';
    actions.innerHTML = `<button type="button" data-action="open-favorite-folder" data-path="${esc(path)}">打開</button><button type="button" class="btn-secondary" data-action="remove-favorite-folder" data-path="${esc(path)}">移除</button>`;

    if (hasTop) card.append(top);
    card.append(title, meta, actions);
    folderFrag.append(card);
  }
  E.favoriteFolders.append(folderFrag);

  const itemFrag = document.createDocumentFragment();
  for (const item of [...favorites.items.values()]) {
    const card = document.createElement('article');
    card.className = 'favorite-card';

    const top = document.createElement('div');
    top.className = 'favorite-card-top';
    if (item.category === 'video' || item.category === 'image') {
      const img = document.createElement('img');
      img.className = 'favorite-thumb';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = item.name;
      img.src = purl(item);
      top.append(img);
    } else {
      top.append(createGenericThumb(item));
    }

    const title = document.createElement('div');
    title.className = 'favorite-title';
    title.textContent = item.name;

    const meta = document.createElement('div');
    meta.className = 'favorite-meta';
    meta.textContent = state.showPaths
      ? `${item.category?.toUpperCase() || 'FILE'} | ${item.displayFolder || ''}`
      : `${item.category?.toUpperCase() || 'FILE'}`;

    const actions = document.createElement('div');
    actions.className = 'favorite-actions';
    actions.innerHTML = `<button type="button" data-action="open-favorite-item" data-id="${esc(item.id)}">查看</button><button type="button" class="btn-secondary" data-action="remove-favorite-item" data-id="${esc(item.id)}">移除</button>`;

    card.append(top, title, meta, actions);
    itemFrag.append(card);
  }
  E.favoriteItems.append(itemFrag);
}

function clearPlayer() {
  stopVideoFastForward();
  resetVideoRightKeyState();
  resetVideoPointerHoldState();
  resetVideoSpaceKeyState();
  resetVideoTapState();
  resetImagePointerState();
  clearVideoTouchHoldTimer();
  hideMediaActionIndicator(true);
  hideVideoLoadIndicator();
  videoHasStartedPlaying = false;
  videoTouchHoldActive = false;
  E.video.pause();
  E.video.classList.add('hidden');
  E.video.removeAttribute('src');
  E.video.removeAttribute('data-fallback-queue');
  E.video.removeAttribute('data-fallback-used');
  clearVideoFallbackTimer();
  clearVideoDecodeGuardTimer();
  E.video.playbackRate = 1;
  E.video.load();
  E.audio.pause();
  E.audio.classList.add('hidden');
  E.audio.removeAttribute('src');
  E.audio.load();
  resetImageZoom();
  E.image.classList.remove('zoomable', 'zoomed');
  E.image.classList.add('hidden');
  E.image.removeAttribute('src');
  E.scrubWrap.classList.add('hidden');
  E.scrub.value = '0';
}

function ovOpen() {
  E.overlay.classList.remove('hidden');
  E.overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('overlay-open');
  lockOverlayScroll();
}

function ovClose() {
  clearPlayer();
  clearViewerNav();
  unlockOverlayScroll();
  E.overlay.classList.add('hidden');
  E.overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('overlay-open');
}

function navSet(items) {
  const ids = items.map((x) => x.id);
  const i = ids.indexOf(currentId);
  E.prev.disabled = i <= 0;
  E.next.disabled = i < 0 || i >= ids.length - 1;
}

async function stripRender(items, activeId, imageMode) {
  const ids = (items || []).map((x) => x.id);
  const stripKey = `${imageMode ? 'img' : 'all'}|${ids.join('|')}`;
  const sameStrip = stripKey === lastStripKey && lastStripImageMode === !!imageMode;
  E.strip.classList.toggle('image-strip', !!imageMode);

  if (!sameStrip) {
    E.strip.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'strip-item';
      b.dataset.itemId = it.id;
      if (it.id === activeId) b.classList.add('active');
      if (imageMode) b.classList.add('no-label');

      const w = document.createElement('div');
      w.className = 'thumb-wrap';
      if (it.category === 'video' || it.category === 'image') {
        const img = document.createElement('img');
        img.alt = it.name;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = purl(it);
        w.append(img);
      } else {
        w.append(createGenericThumb(it));
      }

      b.append(w);
      if (!imageMode) {
        const cap = document.createElement('span');
        cap.textContent = it.name;
        b.append(cap);
      }

      frag.append(b);
    }
    E.strip.append(frag);
    lastStripKey = stripKey;
    lastStripImageMode = !!imageMode;
  } else {
    for (const btn of E.strip.querySelectorAll('.strip-item[data-item-id]')) {
      btn.classList.toggle('active', btn.dataset.itemId === activeId);
    }
  }
  syncStripToggle();
}

function viewerItemsForCurrent(items, currentItem) {
  const list = Array.isArray(items) ? items : [];
  if (!currentItem) return list;
  if (currentItem.category !== 'image' && currentItem.category !== 'video') return list;
  const onlyMedia = list.filter((x) => x.category === 'image' || x.category === 'video');
  return onlyMedia.length ? onlyMedia : list;
}

function setViewerNav(folder, items) {
  viewerNavFolder = String(folder || '');
  viewerNavItems = Array.isArray(items) ? items : [];
  viewerNavIds = viewerNavItems.map((x) => x.id);
}

function clearViewerNav() {
  setViewerNav('', []);
}

async function resolveViewerNav(currentItem) {
  if (
    viewerNavFolder === currentFolder &&
    viewerNavItems.length &&
    viewerNavIds.includes(currentId)
  ) {
    return viewerNavItems;
  }
  const all = await folderItems(currentFolder, true);
  const navItems = viewerItemsForCurrent(all.items || [], currentItem);
  setViewerNav(currentFolder, navItems);
  return navItems;
}

function trimImagePreloadCache() {
  while (imagePreloadCache.size > IMAGE_PRELOAD_CACHE_LIMIT) {
    const oldestKey = imagePreloadCache.keys().next().value;
    if (!oldestKey) break;
    const entry = imagePreloadCache.get(oldestKey);
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    imagePreloadCache.delete(oldestKey);
  }
}

function clearImagePreloadState() {
  for (const entry of imagePreloadCache.values()) {
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  imagePreloadCache = new Map();
  imagePreloadQueue = [];
  imagePreloadQueued = new Set();
}

async function preloadImageItem(item) {
  if (!item || item.category !== 'image' || !item.id || !item.mediaUrl) return;
  if (imagePreloadCache.has(item.id)) return;
  if (imagePreloadInflight.has(item.id)) return imagePreloadInflight.get(item.id);

  const task = fetch(item.mediaUrl, { cache: 'force-cache' })
    .then(async (r) => {
      if (!r.ok) throw new Error(`image preload ${r.status}`);
      const blob = await r.blob();
      if (!blob || !blob.size) return;
      const objectUrl = URL.createObjectURL(blob);
      const prev = imagePreloadCache.get(item.id);
      if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
      imagePreloadCache.delete(item.id);
      imagePreloadCache.set(item.id, { objectUrl, ts: Date.now() });
      trimImagePreloadCache();
    })
    .catch(() => {})
    .finally(() => {
      imagePreloadInflight.delete(item.id);
      imagePreloadQueued.delete(item.id);
    });

  imagePreloadInflight.set(item.id, task);
  return task;
}

function pumpImagePreloadQueue() {
  while (imagePreloadWorkers < IMAGE_PRELOAD_CONCURRENCY && imagePreloadQueue.length) {
    const next = imagePreloadQueue.shift();
    if (!next || !next.id) continue;
    imagePreloadWorkers += 1;
    preloadImageItem(next)
      .catch(() => {})
      .finally(() => {
        imagePreloadWorkers = Math.max(0, imagePreloadWorkers - 1);
        pumpImagePreloadQueue();
      });
  }
}

function queueImagePreload(item) {
  if (!item || item.category !== 'image' || !item.id) return;
  if (imagePreloadCache.has(item.id)) return;
  if (imagePreloadInflight.has(item.id)) return;
  if (imagePreloadQueued.has(item.id)) return;
  imagePreloadQueued.add(item.id);
  imagePreloadQueue.push(item);
  pumpImagePreloadQueue();
}

function warmupNextImages(navItems, activeId) {
  const list = Array.isArray(navItems) ? navItems : [];
  if (!list.length) return;
  const idx = list.findIndex((x) => x.id === activeId);
  if (idx < 0) return;
  for (let step = 1; step <= IMAGE_PRELOAD_LOOKAHEAD; step += 1) {
    const next = list[idx + step];
    if (!next) break;
    queueImagePreload(next);
  }
}

function imageSrcForItem(item) {
  const cached = imagePreloadCache.get(item?.id || '');
  if (!cached?.objectUrl) return item?.mediaUrl || '';
  cached.ts = Date.now();
  imagePreloadCache.delete(item.id);
  imagePreloadCache.set(item.id, cached);
  return cached.objectUrl;
}

async function openItem(id, opt = {}) {
  let it = itemStore.get(id);
  if (!it && Array.isArray(opt.navItems)) {
    it = opt.navItems.find((x) => x.id === id) || null;
    if (it) {
      itemStore.set(it.id, it);
      folderByItem.set(it.id, it.displayFolder || currentFolder || '');
    }
  }
  if (!it) it = await ensureItemLoaded(id);
  if (!it) return;

  const enteringOverlay = E.overlay.classList.contains('hidden');
  if (enteringOverlay) state.lastY = window.scrollY;
  E.back.disabled = false;
  currentId = it.id;
  currentFolder = folderByItem.get(it.id) || it.displayFolder || state.focused || '';
  saveSoon();

  const sameImageSwitch = !E.overlay.classList.contains('hidden') && !E.image.classList.contains('hidden') && it.category === 'image';
  if (!sameImageSwitch) clearPlayer();
  ovOpen();
  E.download.href = it.downloadUrl;
  syncViewerTitle();
  syncCurrentFavoriteButton();

  if (it.category === 'video') {
    stopVideoFastForward();
    E.video.classList.remove('hidden');
    E.video.playbackRate = 1;
    playVideoWithFallback(it);
  } else if (it.category === 'audio') {
    E.audio.classList.remove('hidden');
    E.audio.src = it.mediaUrl;
    E.audio.play().catch(() => {});
  } else if (it.category === 'image') {
    resetImageZoom();
    E.image.classList.add('zoomable');
    E.image.classList.remove('hidden');
    E.image.src = imageSrcForItem(it);
  } else {
    resetImageZoom();
    E.image.classList.remove('zoomable', 'zoomed');
    E.image.classList.remove('hidden');
    E.image.src = purl(it);
  }

  const navItems = Array.isArray(opt.navItems) && opt.navItems.length ? opt.navItems : await resolveViewerNav(it);
  if (!(Array.isArray(opt.navItems) && opt.navItems.length)) setViewerNav(currentFolder, navItems);
  await stripRender(navItems, it.id, it.category === 'image' || it.category === 'video');
  navSet(navItems);
  if (it.category === 'image') warmupNextImages(navItems, it.id);
}

async function openAdj(off) {
  const current = itemStore.get(currentId);
  const arr = await resolveViewerNav(current);
  const ids = viewerNavFolder === currentFolder && viewerNavIds.length ? viewerNavIds : arr.map((x) => x.id);
  const i = ids.indexOf(currentId);
  const n = i + off;
  if (i < 0 || n < 0 || n >= ids.length) return;
  await openItem(ids[n], { navItems: arr });
}

async function onMenu(action) {
  if (!action) return;

  if (action === 'expand-siblings' && menuDetails?.parentElement) {
    for (const d of menuDetails.parentElement.querySelectorAll(':scope > details.tree-node')) {
      d.open = true;
      if (d.dataset.nodePath) state.open.add(d.dataset.nodePath);
    }
  } else if (action === 'collapse-siblings' && menuDetails?.parentElement) {
    for (const d of menuDetails.parentElement.querySelectorAll(':scope > details.tree-node')) {
      d.open = false;
      if (d.dataset.nodePath) state.open.delete(d.dataset.nodePath);
    }
  } else if (action === 'expand-children' && menuDetails) {
    for (const d of menuDetails.querySelectorAll('details.tree-node')) {
      d.open = true;
      if (d.dataset.nodePath) state.open.add(d.dataset.nodePath);
    }
  } else if (action === 'collapse-children' && menuDetails) {
    for (const d of menuDetails.querySelectorAll('details.tree-node')) {
      d.open = false;
      if (d.dataset.nodePath) state.open.delete(d.dataset.nodePath);
    }
  } else if (action === 'expand-all') {
    if (lastFilteredTree) state.open = new Set(allPaths(lastFilteredTree));
    schedule({ preserveScroll: true });
  } else if (action === 'collapse-all') {
    state.open = new Set();
    schedule({ preserveScroll: true });
  } else if (action === 'focus-folder') {
    focusInTree(menuPath, false);
  } else if (action === 'focus-tree') {
    focusInTree(menuPath, false);
  } else if (action === 'only-this-path') {
    focusInTree(menuPath, true);
  } else if (action === 'favorite-folder') {
    toggleFavoriteFolder(menuPath);
  } else if (action === 'toggle-folder-thumbs') {
    state.showFolderThumbs = !state.showFolderThumbs;
    syncUI();
    schedule({ preserveScroll: true });
  } else if (action === 'copy-path') {
    try {
      await navigator.clipboard.writeText(menuPath || '');
    } catch {}
  } else if (action === 'reset-view-state') {
    resetView();
  }

  saveSoon();
  closeMenu();
}

async function requestRescan() {
  const r = await fetch('/api/rescan', { method: 'POST' });
  if (!r.ok) throw new Error(`刷新失敗 (${r.status})`);
  await loadLib(true);
}
E.tree.addEventListener('contextmenu', (e) => {
  const s = e.target.closest('summary[data-node-path]');
  if (!s) return;
  e.preventDefault();
  openMenu(s.dataset.nodePath || '', s.parentElement, e.clientX, e.clientY);
});

bindLongPress(E.tree, 'summary[data-node-path]', (x) => ({ path: x.dataset.nodePath || '', details: x.parentElement || null }));

E.tree.addEventListener(
  'load',
  (e) => {
    const t = e.target;
    if (!(t instanceof HTMLImageElement)) return;
    const d = t.closest('details.tree-node');
    if (!d || !d.classList.contains('is-open')) return;
    setTreeBodyOpenHeight(d);
    refreshOpenTreeHeightsSoon();
  },
  true
);

E.menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-menu-action]');
  if (!b) return;
  onMenu(b.dataset.menuAction).catch(() => {});
});

document.addEventListener('click', (e) => {
  if (!E.menu.classList.contains('hidden') && !e.target.closest('#folder-menu')) closeMenu();
});

E.tree.addEventListener('click', (e) => {
  const openBtn = e.target.closest('[data-action="open"][data-id]');
  if (openBtn) {
    openItem(openBtn.dataset.id).catch(() => {});
    return;
  }

  const favItemBtn = e.target.closest('[data-action="toggle-fav-item"][data-id]');
  if (favItemBtn) {
    toggleFavoriteItemById(favItemBtn.dataset.id || '');
    return;
  }

  const favFolderBtn = e.target.closest('[data-action="toggle-fav-folder"][data-path]');
  if (favFolderBtn) {
    toggleFavoriteFolder(favFolderBtn.dataset.path || '');
    return;
  }

  const s = e.target.closest('summary[data-node-path]');
  if (s) {
    state.focused = s.dataset.nodePath || state.focused;
    updateFocusedClass();
    saveSoon();
  }
});

E.favoritesPanel.addEventListener('click', (e) => {
  const openFolder = e.target.closest('[data-action="open-favorite-folder"][data-path]');
  if (openFolder) {
    focusInTree(openFolder.dataset.path || '', false);
    return;
  }

  const removeFolder = e.target.closest('[data-action="remove-favorite-folder"][data-path]');
  if (removeFolder) {
    favorites.folders.delete(removeFolder.dataset.path || '');
    saveFavorites();
    renderFavorites();
    schedule({ preserveScroll: true });
    return;
  }

  const openItemBtn = e.target.closest('[data-action="open-favorite-item"][data-id]');
  if (openItemBtn) {
    openFavoriteItem(openItemBtn.dataset.id || '').catch(() => {});
    return;
  }

  const removeItem = e.target.closest('[data-action="remove-favorite-item"][data-id]');
  if (removeItem) {
    favorites.items.delete(removeItem.dataset.id || '');
    saveFavorites();
    renderFavorites();
    syncCurrentFavoriteButton();
    schedule({ preserveScroll: true });
  }
});

E.overlay.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-overlay"]')) ovClose();
});
E.close.addEventListener('click', ovClose);
E.prev.addEventListener('click', () => openAdj(-1).catch(() => {}));
E.next.addEventListener('click', () => openAdj(1).catch(() => {}));
E.favoriteCurrent.addEventListener('click', () => {
  if (!currentId) return;
  toggleFavoriteItemById(currentId);
});

E.toggleStrip.addEventListener('click', () => {
  state.showStrip = !state.showStrip;
  syncStripToggle();
  saveSoon();
});

E.strip.addEventListener('click', (e) => {
  const b = e.target.closest('.strip-item[data-item-id]');
  if (b) openItem(b.dataset.itemId).catch(() => {});
});

E.image.addEventListener(
  'pointerdown',
  (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    imagePointerId = e.pointerId;
    imagePointerStartX = e.clientX;
    imagePointerStartY = e.clientY;
    imagePointerMoved = false;
    imagePointerDragging = imageZoomScale > 1.01;
    imagePointerScrollLeft = E.mediaWrap.scrollLeft;
    imagePointerScrollTop = E.mediaWrap.scrollTop;
    if (imagePointerDragging) {
      E.image.classList.add('dragging');
      E.image.setPointerCapture?.(e.pointerId);
    }
  },
  { passive: true }
);

E.image.addEventListener(
  'pointermove',
  (e) => {
    if (imagePointerId !== e.pointerId) return;
    const dx = e.clientX - imagePointerStartX;
    const dy = e.clientY - imagePointerStartY;
    if (imagePointerDragging) {
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) imagePointerMoved = true;
      E.mediaWrap.scrollLeft = imagePointerScrollLeft - dx;
      E.mediaWrap.scrollTop = imagePointerScrollTop - dy;
      return;
    }
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
      imagePointerMoved = true;
    }
  },
  { passive: true }
);

E.image.addEventListener(
  'pointerup',
  (e) => {
    if (imagePointerId !== e.pointerId) return;
    const moved = imagePointerMoved;
    resetImagePointerState();
    if (moved) return;
    toggleImageZoomByClick({ clientX: e.clientX, clientY: e.clientY });
  },
  { passive: true }
);

E.image.addEventListener('pointercancel', resetImagePointerState, { passive: true });
E.image.addEventListener('dragstart', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (E.overlay.classList.contains('hidden')) return;
  if (e.key === 'Escape') {
    ovClose();
    return;
  }

  if (handleOverlayPageNavKey(e)) return;
  if (handleVideoSpaceKeyDown(e)) return;
  if (handleVideoArrowKeyDown(e)) return;

  const current = currentId ? itemStore.get(currentId) : null;
  if (!current) return;
  if (current.category === 'video') return;

  if (current.category === 'image') {
    if (e.key === 'ArrowLeft') openAdj(-1).catch(() => {});
    else if (e.key === 'ArrowRight') openAdj(1).catch(() => {});
  }
}, { capture: true });

window.addEventListener('keyup', (e) => {
  if (handleOverlayPageNavKeyUp(e)) return;
  if (handleVideoSpaceKeyUp(e)) return;
  if (handleVideoArrowKeyUp(e)) return;
}, { capture: true });

document.addEventListener(
  'keydown',
  (e) => {
    if (handleOverlayPageNavKey(e)) return;
    if (handleVideoSpaceKeyDown(e)) return;
    handleVideoArrowKeyDown(e);
  },
  { capture: true }
);

document.addEventListener(
  'keyup',
  (e) => {
    if (handleOverlayPageNavKeyUp(e)) return;
    if (handleVideoSpaceKeyUp(e)) return;
    handleVideoArrowKeyUp(e);
  },
  { capture: true }
);

E.video.addEventListener('loadedmetadata', () => {
  const d = Number(E.video.duration || 0);
  E.scrub.max = String(d || 0);
  E.scrub.value = '0';
  clearVideoFallbackTimer();
  updateVideoLoadIndicator();
});

E.video.addEventListener('timeupdate', () => {
  if (!E.scrub.matches(':active')) E.scrub.value = String(Number(E.video.currentTime || 0));
  if (!videoHasStartedPlaying) updateVideoLoadIndicator();
});

E.video.addEventListener('loadstart', () => {
  if (E.video.classList.contains('hidden')) return;
  videoHasStartedPlaying = false;
  clearVideoDecodeGuardTimer();
  setVideoLoadIndicator('正在載入...');
});

E.video.addEventListener('progress', () => {
  updateVideoLoadIndicator();
});

E.video.addEventListener('waiting', () => {
  if (E.video.classList.contains('hidden')) return;
  setVideoLoadIndicator('緩衝中...');
  updateVideoLoadIndicator();
  armVideoDecodeGuard();
});

E.video.addEventListener('stalled', () => {
  if (E.video.classList.contains('hidden')) return;
  setVideoLoadIndicator('網路較慢，持續載入中...');
  updateVideoLoadIndicator();
});

E.video.addEventListener('canplay', () => {
  clearVideoFallbackTimer();
  if (!videoHasStartedPlaying) updateVideoLoadIndicator();
  armVideoDecodeGuard();
});

E.video.addEventListener('playing', () => {
  clearVideoFallbackTimer();
  videoHasStartedPlaying = true;
  hideVideoLoadIndicator();
  armVideoDecodeGuard();
});

E.video.addEventListener('error', () => {
  if (E.video.classList.contains('hidden')) return;
  setVideoLoadIndicator('切換串流路徑中...');
  clearVideoDecodeGuardTimer();
  tryNextVideoFallback();
});

E.scrub.addEventListener('input', () => {
  const t = Number(E.scrub.value || 0);
  E.video.currentTime = t;
});

E.refresh.addEventListener('click', () => requestRescan().catch((e) => alert(e.message)));

E.theme.addEventListener('click', () => {
  const t = document.documentElement.getAttribute('data-theme') || 'light';
  setTheme(nextTheme(t));
});

E.pathToggle.addEventListener('click', () => {
  state.showPaths = !state.showPaths;
  syncUI();
  schedule({ preserveScroll: true, resetAll: true });
});

E.detailToggle.addEventListener('click', () => {
  state.showDetails = !state.showDetails;
  syncUI();
  schedule({ preserveScroll: true, resetAll: true });
});

E.viewerNameToggle.addEventListener('click', () => {
  state.showViewerTitle = !state.showViewerTitle;
  syncUI();
  saveSoon();
});

E.favoritesToggle.addEventListener('click', () => {
  state.showFavorites = !state.showFavorites;
  syncUI();
  if (state.showFavorites) renderFavorites();
  saveSoon();
});

E.favoritesBack.addEventListener('click', () => {
  state.showFavorites = false;
  syncUI();
  saveSoon();
});

E.favoritesClear.addEventListener('click', () => {
  if (!confirm('確定要清空所有收藏嗎？')) return;
  clearAllFavorites();
});

E.view.addEventListener('click', () => {
  state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
  syncUI();
  schedule({ preserveScroll: true });
});

E.thumbToggle.addEventListener('click', () => {
  state.showFolderThumbs = !state.showFolderThumbs;
  syncUI();
  schedule({ preserveScroll: true });
});

E.search.addEventListener('input', () => {
  state.search = E.search.value || '';
  schedule({ preserveScroll: true, resetAll: true });
});

E.sort.addEventListener('change', () => {
  state.sort = E.sort.value;
  schedule({ preserveScroll: true, resetAll: true });
});

E.gridSize.addEventListener('change', () => {
  state.gridSize = E.gridSize.value;
  syncUI();
  saveSoon();
});

E.typesWrap.addEventListener('change', () => {
  state.types = new Set(Array.from(E.typesWrap.querySelectorAll("input[type='checkbox']")).filter((i) => i.checked).map((i) => i.value));
  schedule({ preserveScroll: true, resetAll: true });
});

E.typesAll.addEventListener('click', () => {
  for (const i of E.typesWrap.querySelectorAll("input[type='checkbox']")) i.checked = true;
  state.types = new Set(TYPES);
  schedule({ preserveScroll: true, resetAll: true });
});

E.typesNone.addEventListener('click', () => {
  for (const i of E.typesWrap.querySelectorAll("input[type='checkbox']")) i.checked = false;
  state.types = new Set();
  schedule({ preserveScroll: true, resetAll: true });
});

E.top.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
E.back.addEventListener('click', () => {
  if (Number.isFinite(state.lastY)) window.scrollTo({ top: state.lastY, behavior: 'smooth' });
});

window.addEventListener(
  'scroll',
  () => {
    lastUserScrollAt = Date.now();
    saveSoon();
  },
  { passive: true }
);
window.addEventListener('resize', () => {
  closeMenu();
  refreshOpenTreeHeights();
});
window.addEventListener('blur', () => {
  resetVideoRightKeyState();
  resetVideoPointerHoldState();
  resetVideoSpaceKeyState();
  resetVideoTapState();
  resetImagePointerState();
});
window.addEventListener('beforeunload', () => {
  clearImagePreloadState();
  saveState();
  saveFavorites();
});

bindVideoFastForwardHold();
bindOverlaySwipeNav();
loadState();
loadFavorites();
initTheme();
syncUI();

loadLib()
  .then(() => {
    if (Number.isFinite(state.scrollY) && state.scrollY > 0) {
      setTimeout(() => window.scrollTo(0, state.scrollY), 60);
    }
  })
  .catch((e) => alert(`初始化失敗: ${e.message}`));
