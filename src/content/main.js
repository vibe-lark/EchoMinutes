// src/content/main.js
(function () {

const ANALYTICS_EVENTS = {
  ButtonView: 'em_button_view',
  EmBatchView: 'em_batch_view',
  StartClick: 'em_start_click',
  StartSuccess: 'em_start_success',
};

const analyticsEventQueue = [];
let latestClickId = null;
let buttonViewTracked = false;
let batchViewTracked = false;
let batchSessionId = null;
const onceLoggedKeys = new Set();
const throttledLogTimestamps = new Map();
const LOG_THROTTLE_INTERVAL = 5000;
let lastXiaoyuzhouMissingSignature = null;
const DEBUG_ENABLED = Boolean(globalThis.__ECHO_BAT_DEBUG__);

const audioBatchRegistry = new Map();
const batchState = {
  running: false,
  queue: [],
  currentId: null,
  sessionId: null,
  realCount: 0,
};
let batchController = null;
const XML_NS = 'http://www.w3.org/1999/xhtml';
let lastKnownPath = null;
let lastKnownHref = null;
let rssUploadButton = null;

function isXmlDocument() {
  return (document.contentType || '').includes('xml');
}

function emitLog(level, ...args) {
  if (!DEBUG_ENABLED) {
    return;
  }
  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug(`[EchoBat][${String(level).toUpperCase()}]`, ...args);
  }
}

function createElement(tagName) {
  if (isXmlDocument()) {
    try {
      return document.createElementNS(XML_NS, tagName);
    } catch (error) {
      emitLog('warn', '[EchoBat Content Script] Failed to create namespaced element:', tagName, error);
    }
  }
  return document.createElement(tagName);
}

function toDataAttributeName(key) {
  return `data-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

function dataGet(element, key) {
  if (!element) {
    return undefined;
  }
  if (element.dataset && typeof element.dataset === 'object') {
    return element.dataset[key];
  }
  if (typeof element.getAttribute === 'function') {
    return element.getAttribute(toDataAttributeName(key));
  }
  return undefined;
}

function dataSet(element, key, value) {
  if (!element) {
    return;
  }
  if (element.dataset && typeof element.dataset === 'object') {
    element.dataset[key] = value;
  } else if (typeof element.setAttribute === 'function') {
    element.setAttribute(toDataAttributeName(key), value);
  }
}

function dataHas(element, key) {
  if (!element) {
    return false;
  }
  if (element.dataset && typeof element.dataset === 'object') {
    return key in element.dataset;
  }
  if (typeof element.hasAttribute === 'function') {
    return element.hasAttribute(toDataAttributeName(key));
  }
  return false;
}

function logOnce(key, level, ...args) {
  if (onceLoggedKeys.has(key)) {
    return;
  }
  onceLoggedKeys.add(key);
  emitLog(level, ...args);
}

function logThrottled(key, level, ...args) {
  const now = Date.now();
  const lastLogged = throttledLogTimestamps.get(key) || 0;
  if (now - lastLogged < LOG_THROTTLE_INTERVAL) {
    return;
  }
  throttledLogTimestamps.set(key, now);
  emitLog(level, ...args);
}

function setClass(element, className) {
  if (!element) {
    return;
  }
  if ('className' in element) {
    element.className = className;
  }
  if (typeof element.setAttribute === 'function') {
    element.setAttribute('class', className);
  }
}

function setElementId(element, id) {
  if (!element) {
    return;
  }
  if ('id' in element) {
    element.id = id;
  }
  if (typeof element.setAttribute === 'function') {
    element.setAttribute('id', id);
  }
}

function getClassList(element) {
  if (!element) {
    return [];
  }
  const classAttr = typeof element.getAttribute === 'function' ? element.getAttribute('class') : null;
  if (element.classList && typeof element.classList.contains === 'function') {
    return Array.from(element.classList);
  }
  return classAttr ? classAttr.split(/\s+/).filter(Boolean) : [];
}

function addClass(element, className) {
  if (!element || !className) {
    return;
  }
  if (element.classList && typeof element.classList.add === 'function') {
    element.classList.add(className);
    return;
  }
  const classes = new Set(getClassList(element));
  classes.add(className);
  setClass(element, Array.from(classes).join(' '));
}

function removeClass(element, className) {
  if (!element || !className) {
    return;
  }
  if (element.classList && typeof element.classList.remove === 'function') {
    element.classList.remove(className);
    return;
  }
  const classes = new Set(getClassList(element));
  classes.delete(className);
  setClass(element, Array.from(classes).join(' '));
}

function hasClass(element, className) {
  if (!element || !className) {
    return false;
  }
  if (element.classList && typeof element.classList.contains === 'function') {
    return element.classList.contains(className);
  }
  return getClassList(element).includes(className);
}

function generateClickId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `click_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function generateBatchId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `batch_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ensureBatchSessionId() {
  if (!batchSessionId) {
    batchSessionId = generateBatchId();
  }
  if (!batchState.sessionId) {
    batchState.sessionId = batchSessionId;
  }
  return batchSessionId;
}

function maybeTrackBatchView(entries) {
  if (batchViewTracked) {
    return;
  }
  if (!Array.isArray(entries) || entries.length <= 1) {
    return;
  }

  const batchId = ensureBatchSessionId();
  const payload = {
    em_batch_count: entries.length,
    em_batch_id: batchId,
  };
  const userId =
    window.EchoBatAnalytics && typeof window.EchoBatAnalytics.getUserId === 'function'
      ? window.EchoBatAnalytics.getUserId()
      : null;
  if (userId) {
    payload.em_user_id = userId;
  }

  batchViewTracked = true;
  sendAnalyticsEvent(ANALYTICS_EVENTS.EmBatchView, { ...payload });

  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
    try {
      chrome.runtime.sendMessage({
        action: 'trackTelemetryEvent',
        event: {
          name: ANALYTICS_EVENTS.EmBatchView,
          payload: { ...payload },
        },
      });
    } catch (error) {
      emitLog('warn', '[EchoBat Content Script] Failed to send batch view telemetry:', error);
    }
  }
}

function flushAnalyticsQueue() {
  if (!window.EchoBatAnalytics || typeof window.EchoBatAnalytics.trackEvent !== 'function') {
    return;
  }
  while (analyticsEventQueue.length) {
    const { name, payload } = analyticsEventQueue.shift();
    window.EchoBatAnalytics.trackEvent(name, payload);
  }
}

function sendAnalyticsEvent(name, payload = {}) {
  if (window.EchoBatAnalytics && typeof window.EchoBatAnalytics.trackEvent === 'function') {
    window.EchoBatAnalytics.trackEvent(name, payload);
  } else {
    analyticsEventQueue.push({ name, payload });
  }
}

window.addEventListener('EchoBatAnalyticsReady', () => {
  flushAnalyticsQueue();
});

// Check if the script has already been injected
if (window.echoBatContentScriptInitialized) {
  logOnce(
    'contentScriptAlreadyInitialized',
    'debug',
    '[EchoBat Content Script] Content script already initialized.'
  );
} else {
  window.echoBatContentScriptInitialized = true;
  logOnce(
    'contentScriptLoaded',
    'info',
    '[EchoBat Content Script] Content script loaded.'
  );

  initializeUI();

  function initializeUI() {
    setupUrlChangeObserver();

    // 立即尝试添加按钮，不等待 MutationObserver
    void tryAddButton();
    
    // 同时使用 MutationObserver 监听 DOM 变化
    const observer = new MutationObserver(() => {
      void tryAddButton();
    });

    const observerTarget = document.body || document.documentElement;
    if (!observerTarget) {
      emitLog('warn', '[EchoBat Content Script] Unable to initialize MutationObserver: no document body or root.');
      return;
    }

    observer.observe(observerTarget, {
      childList: true,
      subtree: true,
    });

    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          void tryAddButton();
        },
        { once: true }
      );
    } else {
      // 确保在初始解析完成后再尝试一次，避免过早扫描到空的 XML
      setTimeout(() => {
        void tryAddButton();
      }, 0);
    }
  }
  
  function setupUrlChangeObserver() {
    lastKnownPath = window.location.pathname;
    lastKnownHref = window.location.href;

    const fireChange = () => {
      if (window.location.pathname === lastKnownPath && window.location.href === lastKnownHref) {
        return;
      }
      cleanupForNavigation();
      lastKnownPath = window.location.pathname;
      lastKnownHref = window.location.href;
      setTimeout(() => tryAddButton(), 0);
    };

    const wrapHistoryMethod = (type) => {
      const original = history[type];
      if (typeof original !== 'function') {
        return;
      }
      history[type] = function (...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('echoBat:historyChange'));
        return result;
      };
    };

    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');

    window.addEventListener('popstate', fireChange);
    window.addEventListener('echoBat:historyChange', fireChange);
  }
  
  function cleanupForNavigation() {
    audioBatchRegistry.clear();
    batchState.running = false;
    batchState.queue = [];
    batchState.currentId = null;
    batchState.sessionId = null;
    batchState.realCount = 0;
    batchController = null;
    lastXiaoyuzhouMissingSignature = null;

    const rssPanel = document.getElementById('echo-bat-rss-panel');
    if (rssPanel && typeof rssPanel.remove === 'function') {
      rssPanel.remove();
    }
    const batchPanel = document.getElementById('echo-bat-batch-controller');
    if (batchPanel && typeof batchPanel.remove === 'function') {
      batchPanel.remove();
    }

    const flagHost = document.body || document.documentElement;
      if (flagHost) {
        flagHost.removeAttribute('data-echo-bat-rss-initialized');
        flagHost.removeAttribute('data-echo-bat-rss-mode');
        flagHost.removeAttribute('data-echo-bat-rss-pending');
        flagHost.removeAttribute('data-echo-bat-special-page');
        flagHost.removeAttribute('data-echo-bat-xyz-podcast-initialized');
        flagHost.removeAttribute('data-echo-bat-toast-shown');
      }
    }
  
  async function tryAddButton() {
    // 添加明显的调试信息
    logOnce('tryAddButtonInvoked', 'debug', '[EchoBat Content Script] tryAddButton triggered.');
    const currentPath = window.location.pathname;
    const currentHref = window.location.href;
    if (currentPath !== lastKnownPath || currentHref !== lastKnownHref) {
      cleanupForNavigation();
      lastKnownPath = currentPath;
      lastKnownHref = currentHref;
    }

    const beforeCount = audioBatchRegistry.size;
    let handledAny = false;

    if (await handleXiaoyuzhouPodcastListing()) {
      handledAny = true;
      return;
    }

    if (handleRssFeed()) {
      handledAny = true;
      return;
    }

    const handledDetail = handleXiaoyuzhouPage();
    if (handledDetail) {
      handledAny = true;
      return;
    }

    handleGenericAudioElements();
    const afterCount = audioBatchRegistry.size;
    if (afterCount > beforeCount) {
      handledAny = true;
    }

    const hasEntries = audioBatchRegistry.size > 0;
    const flagHost = document.body || document.documentElement;
    const isXiaoyuzhouSite = window.location.hostname.includes('xiaoyuzhoufm.com');
    if (!hasEntries && flagHost && dataGet(flagHost, 'echoBatToastShown') !== 'true' && !isXiaoyuzhouSite) {
      showToast('未发现可上传的音频');
      dataSet(flagHost, 'echoBatToastShown', 'true');
    }
  }

  async function handleXiaoyuzhouPodcastListing() {
    const flagHost = document.body || document.documentElement;
    if (!flagHost) {
      return false;
    }

    const path = window.location && typeof window.location.pathname === 'string'
      ? window.location.pathname
      : '';
    const isPodcastList = path.startsWith('/podcast/');
    if (!isPodcastList) {
      return false;
    }

    if (dataGet(flagHost, 'echoBatXyzPodcastInitialized') === 'true') {
      return true;
    }

    const entries = await loadXyzPodcastEntries(path);
    if (entries && entries.length) {
      renderRssPanel(entries, `检测到小宇宙专辑，找到 ${entries.length} 条音频`);
      dataSet(flagHost, 'echoBatXyzPodcastInitialized', 'true');
      return true;
    }

    // 即便没解析到，也避免 fallback 误判为单集
    dataSet(flagHost, 'echoBatXyzPodcastInitialized', 'true');
    return true;
  }

  async function loadXyzPodcastEntries(pathname) {
    const podcastData = await getXyzPodcastData(pathname);
    const episodes = Array.isArray(podcastData?.episodes) ? podcastData.episodes : [];
    const albumName = typeof podcastData?.title === 'string' && podcastData.title.trim()
      ? podcastData.title.trim()
      : '小宇宙播客';

    const entries = episodes.map((episode, index) => {
      const mediaUrl =
        episode?.enclosure?.url ||
        episode?.media?.source?.url ||
        episode?.media?.backupSource?.url ||
        episode?.url ||
        '';
      if (!mediaUrl) {
        return null;
      }
      const titleText = typeof episode?.title === 'string' && episode.title.trim()
        ? episode.title.trim()
        : `节目 ${index + 1}`;
      return {
        mediaUrl,
        titleText,
        albumName,
      };
    }).filter(Boolean);

    return entries;
  }

  async function getXyzPodcastData(pathname) {
    // 1) 尝试从 __NEXT_DATA__ script 解析
    const inlineData = parseNextDataScript();
    if (inlineData?.props?.pageProps?.podcast) {
      return inlineData.props.pageProps.podcast;
    }

    // 2) 使用 buildId 拉取对应 JSON
    const buildId = inlineData?.buildId || window.__NEXT_DATA__?.buildId || null;
    const id = pathname.split('/').filter(Boolean)[1];
    if (buildId && id) {
      try {
        const res = await fetch(`/_next/data/${buildId}/podcast/${id}.json`, { credentials: 'same-origin' });
        if (res.ok) {
          const json = await res.json();
          if (json?.pageProps?.podcast) {
            return json.pageProps.podcast;
          }
        } else {
          emitLog('warn', '[EchoBat Content Script] Failed to fetch podcast data JSON:', res.status);
        }
      } catch (error) {
        emitLog('warn', '[EchoBat Content Script] Error fetching podcast data JSON:', error);
      }
    }

    // 3) 退回到 schema:podcast-show 的 JSON-LD
    const schemaPodcast = parseSchemaPodcast();
    if (schemaPodcast?.episodes?.length) {
      return schemaPodcast;
    }

    emitLog('warn', '[EchoBat Content Script] Unable to resolve podcast data for path:', pathname);
    return null;
  }

  function parseNextDataScript() {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script || !script.textContent) {
      return null;
    }
    try {
      return JSON.parse(script.textContent);
    } catch (error) {
      emitLog('warn', '[EchoBat Content Script] Failed to parse __NEXT_DATA__ JSON.', error);
      return null;
    }
  }

  function parseSchemaPodcast() {
    try {
      const script = document.querySelector('script[name="schema:podcast-show"]');
      if (!script || !script.textContent) {
        return null;
      }
      const json = JSON.parse(script.textContent);
      if (json && Array.isArray(json.workExample)) {
        return {
          title: json.name || '',
          episodes: json.workExample.map((item) => ({
            title: item?.name || '',
            enclosure: { url: item?.audio || item?.url || '' },
          })),
        };
      }
      return null;
    } catch (error) {
      emitLog('warn', '[EchoBat Content Script] Failed to parse schema:podcast-show JSON.', error);
      return null;
    }
  }

  function showToast(message = '') {
    if (!message) return;
    const toast = createElement('div');
    setClass(toast, 'echo-bat-toast');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.padding = '10px 14px';
    toast.style.background = 'rgba(0,0,0,0.8)';
    toast.style.color = '#fff';
    toast.style.borderRadius = '6px';
    toast.style.boxShadow = '0 8px 16px rgba(0,0,0,0.2)';
    toast.style.zIndex = '2147483647';
    toast.style.fontSize = '13px';
    toast.style.maxWidth = '240px';
    toast.style.lineHeight = '1.4';

    const host = document.body || document.documentElement;
    if (!host) {
      return;
    }
    host.appendChild(toast);
    setTimeout(() => {
      if (toast && toast.remove) {
        toast.remove();
      }
    }, 3000);
  }

  function handleRssFeed() {
    const flagHost = document.body || document.documentElement;
    if (!flagHost) {
      return false;
    }

    if (dataGet(flagHost, 'echoBatRssInitialized') === 'true') {
      return true;
    }

    const contentType = document.contentType || '';
    const rootTag = document.documentElement ? document.documentElement.tagName.toLowerCase() : '';
    const rssLikeRoot = rootTag === 'rss' || rootTag === 'rdf' || rootTag === 'feed';
    const itemNodes = document.querySelectorAll('item, entry');

    if (!rssLikeRoot && !contentType.includes('xml') && itemNodes.length === 0) {
      return false;
    }

    const feedEntries = extractRssEntries(Array.from(itemNodes));
    if (!feedEntries.length) {
      if (dataGet(flagHost, 'echoBatRssPending') !== 'true') {
        emitLog('info', '[EchoBat Content Script] RSS feed detected, waiting for audio entries to load...');
        dataSet(flagHost, 'echoBatRssPending', 'true');
      }
      return false;
    }

    renderRssPanel(feedEntries);
    dataSet(flagHost, 'echoBatRssMode', 'true');
    dataSet(flagHost, 'echoBatRssInitialized', 'true');
    dataSet(flagHost, 'echoBatRssPending', 'false');
    return true;
  }

  function extractRssEntries(itemNodes) {
    const feedTitle =
      getFirstMatchingText(document, [
        'channel > title',
        'rss > channel > title',
        'feed > title',
      ]) || document.title || window.location.hostname || '';

    const feedAuthor = getFirstMatchingText(document, [
      'channel > itunes\\:author',
      'channel > author',
      'feed > author > name',
    ]);
    const baseUrl = document.baseURI || window.location.href;

    const entries = [];

    itemNodes.forEach((itemNode, index) => {
      const audioUrl = resolveFeedAudioUrl(itemNode, baseUrl);
      if (!audioUrl) {
        return;
      }

      const title =
        getFirstMatchingText(itemNode, [
          'title',
          'itunes\\:title',
          'media\\:title',
        ]) || `${feedTitle} - 第 ${index + 1} 集`;

      const author =
        getFirstMatchingText(itemNode, [
          'author',
          'author > name',
          'itunes\\:author',
          'dc\\:creator',
          'media\\:credit',
        ]) || feedAuthor || '';

      const albumName =
        getFirstMatchingText(itemNode, [
          'itunes\\:album',
          'itunes\\:collection',
          'media\\:group > media\\:title',
        ]) || feedTitle;

      entries.push({
        mediaUrl: audioUrl,
        titleText: sanitizeFeedText(title),
        albumName: sanitizeFeedText(albumName || feedTitle),
        author: sanitizeFeedText(author),
      });
    });

    return entries;
  }

  function resolveFeedAudioUrl(itemNode, baseUrl) {
    const enclosure = itemNode.querySelector('enclosure[url]');
    if (enclosure) {
      const url = enclosure.getAttribute('url') || '';
      const type = enclosure.getAttribute('type') || '';
      if (isAudioMime(type) || looksLikeAudioUrl(url)) {
        return normalizeFeedUrl(url, baseUrl);
      }
    }

    const atomEnclosure = itemNode.querySelector('link[rel="enclosure"][href]');
    if (atomEnclosure) {
      const url = atomEnclosure.getAttribute('href') || '';
      const type = atomEnclosure.getAttribute('type') || '';
      if (isAudioMime(type) || looksLikeAudioUrl(url)) {
        return normalizeFeedUrl(url, baseUrl);
      }
    }

    const mediaContent = itemNode.querySelector('media\\:content[url], media\\:content');
    if (mediaContent) {
      const url = mediaContent.getAttribute('url') || mediaContent.textContent || '';
      const type = mediaContent.getAttribute('type') || '';
      if (url && (isAudioMime(type) || looksLikeAudioUrl(url))) {
        return normalizeFeedUrl(url, baseUrl);
      }
    }

    const guidElement = itemNode.querySelector('guid');
    if (guidElement && looksLikeAudioUrl(guidElement.textContent)) {
      return normalizeFeedUrl(guidElement.textContent, baseUrl);
    }

    const linkElement = itemNode.querySelector('link');
    if (linkElement && looksLikeAudioUrl(linkElement.getAttribute('href') || linkElement.textContent)) {
      const raw = linkElement.getAttribute('href') || linkElement.textContent || '';
      return normalizeFeedUrl(raw, baseUrl);
    }

    return null;
  }

  function normalizeFeedUrl(url, baseUrl) {
    if (!url) {
      return null;
    }
    try {
      return new URL(url, baseUrl).href;
    } catch (error) {
      emitLog('warn', '[EchoBat Content Script] Failed to normalize feed URL:', url, error);
      return url;
    }
  }

  function isAudioMime(mimeType) {
    if (!mimeType) {
      return false;
    }
    const normalized = mimeType.toLowerCase();
    return normalized.startsWith('audio/') || normalized.includes('mpeg') || normalized.includes('aac');
  }

  function looksLikeAudioUrl(url) {
    if (!url) {
      return false;
    }
    const lower = url.toLowerCase();
    return /\.(mp3|m4a|aac|flac|wav|ogg|opus|m4b)(\?|#|$)/.test(lower);
  }

  function sanitizeFeedText(text) {
    if (!text) {
      return '';
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function getFirstMatchingText(root, selectors = []) {
    if (!root || !selectors.length) {
      return '';
    }
    for (const selector of selectors) {
      try {
        const element = root.querySelector(selector);
        if (element && element.textContent) {
          const value = element.textContent.trim();
          if (value) {
            return value;
          }
        }
      } catch (error) {
        // 忽略非法选择器错误，例如命名空间在老页面缺失时
      }
    }
    return '';
  }

  function renderRssPanel(entries, headerText = '') {
    if (!entries.length) {
      return;
    }

    // 获取页面主题色
    let expandStyles = null;
    const themeColorSelectors = [
      '.expand:not(.expand-wrap):not([class*="expand-wrap"])',
      'label.active',
      '.highlight-word',
      '[class*="slider"]'
    ];
    
    for (const selector of themeColorSelectors) {
      const themeElement = document.querySelector(selector);
      if (themeElement) {
        const computedStyle = window.getComputedStyle(themeElement);
        const color = computedStyle.color;
        const backgroundColor = computedStyle.backgroundColor;
        
        const isValidColor = (c) => c && !c.includes('0, 0, 0') && !c.includes('255, 255, 255') && c !== 'rgba(0, 0, 0, 0)';
        
        if (isValidColor(color) || isValidColor(backgroundColor)) {
          expandStyles = {
            backgroundColor: backgroundColor,
            color: isValidColor(color) ? color : (isValidColor(backgroundColor) ? backgroundColor : color),
            padding: computedStyle.padding,
            borderRadius: computedStyle.borderRadius,
            fontSize: computedStyle.fontSize,
            fontWeight: computedStyle.fontWeight,
            border: computedStyle.border,
            boxShadow: computedStyle.boxShadow
          };
          break;
        }
      }
    }
    
    // 注入 CSS（如果有主题色则更新）
    injectCSS(expandStyles);

    let panel = document.getElementById('echo-bat-rss-panel');
    if (panel) {
      panel.remove();
    }

    panel = createElement('div');
    setElementId(panel, 'echo-bat-rss-panel');
    setClass(panel, 'echo-bat-rss-panel');

    const header = createElement('div');
    setClass(header, 'echo-bat-rss-header');
    header.textContent = headerText || `检测到播客 RSS，找到 ${entries.length} 条音频`;
    panel.appendChild(header);

    const rssEntryControls = [];

    const actions = createElement('div');
    setClass(actions, 'echo-bat-rss-actions');

    const selectAllButton = createElement('button');
    selectAllButton.type = 'button';
    if (selectAllButton.setAttribute) {
      selectAllButton.setAttribute('type', 'button');
    }
    selectAllButton.textContent = '全选';
    selectAllButton.addEventListener('click', () => {
      rssEntryControls.forEach(({ checkbox, entry }) => {
        if (entry.button && entry.button.echoBat.hasSucceeded()) {
          return;
        }
        entry.selected = true;
        checkbox.checked = true;
        entry.button.echoBat.setSelected(true);
      });
      updateBatchController();
    });

    const clearButton = createElement('button');
    clearButton.type = 'button';
    if (clearButton.setAttribute) {
      clearButton.setAttribute('type', 'button');
    }
    clearButton.textContent = '全不选';
    clearButton.addEventListener('click', () => {
      rssEntryControls.forEach(({ checkbox, entry }) => {
        if (entry.button && entry.button.echoBat.hasSucceeded()) {
          return;
        }
        entry.selected = false;
        checkbox.checked = false;
        entry.button.echoBat.setSelected(false);
      });
      updateBatchController();
    });

    const uploadSelectedButton = createElement('button');
    uploadSelectedButton.type = 'button';
    if (uploadSelectedButton.setAttribute) {
      uploadSelectedButton.setAttribute('type', 'button');
    }
    setClass(uploadSelectedButton, 'echo-bat-rss-upload');
    uploadSelectedButton.textContent = '上传已选音频';
    uploadSelectedButton.addEventListener('click', () => {
      startBatchUpload();
    });

    actions.appendChild(selectAllButton);
    actions.appendChild(clearButton);
    actions.appendChild(uploadSelectedButton);
    panel.appendChild(actions);

    const list = createElement('div');
    setClass(list, 'echo-bat-rss-list');
    panel.appendChild(list);

    entries.forEach((entry, index) => {
      const itemRow = createElement('div');
      setClass(itemRow, 'echo-bat-rss-entry');

      const checkbox = createElement('input');
      checkbox.type = 'checkbox';
      if (checkbox.setAttribute) {
        checkbox.setAttribute('type', 'checkbox');
      }
      setClass(checkbox, 'echo-bat-rss-entry-checkbox');
      checkbox.checked = false;

      const info = createElement('div');
      setClass(info, 'echo-bat-rss-entry-info');

      const titleEl = createElement('div');
      setClass(titleEl, 'echo-bat-rss-entry-title');
      titleEl.textContent = entry.titleText || `音频 ${index + 1}`;

      info.appendChild(titleEl);

      if (entry.albumName || entry.author) {
        const metaEl = createElement('div');
        setClass(metaEl, 'echo-bat-rss-entry-meta');
        const parts = [];
        if (entry.albumName) {
          parts.push(entry.albumName);
        }
        if (entry.author) {
          parts.push(entry.author);
        }
        metaEl.textContent = parts.join(' · ');
        info.appendChild(metaEl);
      }

      const action = createElement('div');
      setClass(action, 'echo-bat-rss-entry-action');

      const placeholder = createElement('div');
      setClass(placeholder, 'echo-bat-rss-entry-button');

      const button = createUploadButton(
        entry.mediaUrl,
        entry.titleText,
        entry.albumName,
        expandStyles,
        { variant: 'rss' }
      );

      placeholder.appendChild(button);
      action.appendChild(placeholder);

      itemRow.appendChild(info);
      itemRow.appendChild(action);
      list.appendChild(itemRow);

      itemRow.insertBefore(checkbox, info);

      const entryRef = registerAudioForBatch(placeholder, button, entry);
      if (entryRef) {
        entryRef.selected = false;
        entryRef.checkbox = checkbox;
        rssEntryControls.push({ checkbox, entry: entryRef });
        checkbox.addEventListener('change', () => {
          const isSelected = checkbox.checked;
          entryRef.selected = isSelected;
          entryRef.button.echoBat.setSelected(
            isSelected && !entryRef.button.echoBat.hasSucceeded()
          );
          updateBatchController();
        });
      }
    });

    const target = document.body || document.documentElement;
    if (!target) {
      return;
    }
    target.appendChild(panel);

    // 确保批量控制器刷新，避免路由返回后控件失效
    batchState.running = false;
    batchState.queue = [];
    batchState.currentId = null;
    ensureBatchController();
    if (batchController) {
      batchController.selectionVisible = false;
      if (batchController.selectionPanel) {
        addClass(batchController.selectionPanel, 'hidden');
      }
      if (batchController.startButton) {
        batchController.startButton.disabled = false;
        batchController.startButton.textContent = `上传已选音频 (${entries.length})`;
      }
      updateBatchController();
    }
  }

  function handleXiaoyuzhouPage() {
    const flagHost = document.body || document.documentElement;

    const audioElement = document.querySelector('audio[src^="https://media.xyzcdn.net/"]');
    const podcastTitleContainer = document.querySelector('#__next > div > main > header div[class*="podcast-title"]');
    const albumNameElement = podcastTitleContainer ? podcastTitleContainer.querySelector('a[class*="name"]') : null;
    const titleElement = document.querySelector('#__next > div > main > header h1[class*="title"]');
    
    logThrottled(
      'xiaoyuzhouElementScan',
      'debug',
      '[EchoBat Content Script] Xiaoyuzhou element scan:',
      {
        hasAudio: Boolean(audioElement),
        hasAlbumName: Boolean(albumNameElement),
        hasTitle: Boolean(titleElement),
        hasTitleContainer: Boolean(podcastTitleContainer),
      }
    );
    
    if (albumNameElement && !dataHas(albumNameElement, 'echoBatDetailLogged')) {
      dataSet(albumNameElement, 'echoBatDetailLogged', 'true');
      emitLog('debug', '[EchoBat Content Script] Album name element details:', {
        className: albumNameElement.className,
        textContent: albumNameElement.textContent,
      });
    }
    
    if (titleElement && !dataHas(titleElement, 'echoBatDetailLogged')) {
      dataSet(titleElement, 'echoBatDetailLogged', 'true');
      emitLog('debug', '[EchoBat Content Script] Title element details:', {
        className: titleElement.className,
        textContent: titleElement.textContent,
      });
    }
    
    if (podcastTitleContainer && !dataHas(podcastTitleContainer, 'echoBatDetailLogged')) {
      dataSet(podcastTitleContainer, 'echoBatDetailLogged', 'true');
      emitLog('debug', '[EchoBat Content Script] Podcast title container details:', {
        className: podcastTitleContainer.className,
      });
    }

    if (audioElement && albumNameElement && titleElement && podcastTitleContainer && !dataGet(albumNameElement, 'echoBatButtonAdded')) {
      emitLog('info', '[EchoBat Content Script] Required elements found. Injecting button.');
      dataSet(albumNameElement, 'echoBatButtonAdded', 'true');

      // 获取专辑名称和标题文本
      const albumName = albumNameElement.textContent.trim();
      const titleText = titleElement.textContent.trim();
      
      // 获取页面主题色
      // 优先从 expand 元素获取（单集页面），否则从其他主题色元素获取（播客列表页面）
      let expandStyles = null;
      const themeColorSelectors = [
        '.expand:not(.expand-wrap):not([class*="expand-wrap"])',
        'label.active',
        '.highlight-word',
        '[class*="slider"]'
      ];
      
      for (const selector of themeColorSelectors) {
        const themeElement = document.querySelector(selector);
        if (themeElement) {
          const computedStyle = window.getComputedStyle(themeElement);
          const color = computedStyle.color;
          const backgroundColor = computedStyle.backgroundColor;
          
          // 检查颜色是否有效（非黑色、非白色、非透明）
          const isValidColor = (c) => c && !c.includes('0, 0, 0') && !c.includes('255, 255, 255') && c !== 'rgba(0, 0, 0, 0)';
          
          if (isValidColor(color) || isValidColor(backgroundColor)) {
            expandStyles = {
              backgroundColor: backgroundColor,
              color: isValidColor(color) ? color : (isValidColor(backgroundColor) ? backgroundColor : color),
              padding: computedStyle.padding,
              borderRadius: computedStyle.borderRadius,
              fontSize: computedStyle.fontSize,
              fontWeight: computedStyle.fontWeight,
              border: computedStyle.border,
              boxShadow: computedStyle.boxShadow
            };
            logOnce('themeColorFound', 'debug', '[EchoBat Content Script] Theme color found from selector:', selector, expandStyles.color);
            break;
          }
        }
      }
      
      if (!expandStyles) {
        logThrottled('themeColorMissing', 'debug', '[EchoBat Content Script] Theme color element not found, using default styles.');
      }
      
      logOnce('xiaoyuzhouContentMetadata', 'info', '[EchoBat Content Script] Xiaoyuzhou content metadata:', {
        albumName,
        titleText,
        albumNameLength: albumName.length,
        titleTextLength: titleText.length,
        albumNameType: typeof albumName,
        titleTextType: typeof titleText,
      });
      
      const button = createUploadButton(audioElement.src, titleText, albumName, expandStyles);
      
      // 直接将按钮添加到podcast-title容器中，与标题处于同一行
      podcastTitleContainer.appendChild(button);
      dataSet(audioElement, 'echoBatButtonAdded', 'true');
      if (flagHost) {
        dataSet(flagHost, 'echoBatSpecialPage', 'xiaoyuzhou');
      }
      registerAudioForBatch(audioElement, button, { mediaUrl: audioElement.src, titleText, albumName });
      emitLog('info', '[EchoBat Content Script] Button successfully added to the page.');
      return true;
    } else if (albumNameElement && dataGet(albumNameElement, 'echoBatButtonAdded')) {
      emitLog('debug', '[EchoBat Content Script] Button already added to this album name element.');
      return true;
    } else {
      const missingState = {
        hasAudio: !!audioElement,
        hasAlbumName: !!albumNameElement,
        hasTitle: !!titleElement,
        hasPodcastTitleContainer: !!podcastTitleContainer,
        buttonAlreadyAdded: albumNameElement ? !!dataGet(albumNameElement, 'echoBatButtonAdded') : false
      };
      const signature = JSON.stringify(missingState);
      if (signature !== lastXiaoyuzhouMissingSignature) {
        lastXiaoyuzhouMissingSignature = signature;
        emitLog('debug', '[EchoBat Content Script] Cannot add button. Missing elements:', missingState);
      }
    }

    return false;
  }

  function handleGenericAudioElements() {
    const flagHost = document.body || document.documentElement;
    if (flagHost && dataGet(flagHost, 'echoBatSpecialPage') === 'xiaoyuzhou') {
      return;
    }
    
    const isXiaoyuzhouSite = window.location.hostname.includes('xiaoyuzhoufm.com');
    if (isXiaoyuzhouSite) {
      return;
    }

    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach((audioElement) => {
      if (dataGet(audioElement, 'echoBatButtonAdded') === 'true') {
        return;
      }

      const mediaUrl = extractAudioSrc(audioElement);
      if (!mediaUrl) {
        emitLog('debug', '[EchoBat Content Script] Skipping audio element without resolvable src.', audioElement);
        return;
      }

      const { titleText, albumName } = extractGenericAudioMetadata(audioElement);
      const button = createUploadButton(mediaUrl, titleText, albumName, null, { variant: 'generic' });
      emitLog('debug', '[EchoBat Content Script] Generic metadata resolved:', {
        mediaUrl,
        titleText,
        albumName,
      });

      if (audioElement.parentElement && audioElement.parentElement.tagName.toLowerCase() === 'figure') {
        const caption = audioElement.parentElement.querySelector('figcaption');
        if (caption) {
          caption.insertAdjacentElement('beforebegin', button);
        } else {
          audioElement.insertAdjacentElement('afterend', button);
        }
      } else {
        audioElement.insertAdjacentElement('afterend', button);
      }

      dataSet(audioElement, 'echoBatButtonAdded', 'true');
      registerAudioForBatch(audioElement, button, { mediaUrl, titleText, albumName });
      emitLog('debug', '[EchoBat Content Script] Generic button successfully added after audio element.');
    });
  }

  function registerAudioForBatch(audioElement, button, metadata) {
    if (!audioElement || !button || !button.echoBat) {
      return;
    }

    if (!dataGet(audioElement, 'echoBatAudioId')) {
      dataSet(audioElement, 'echoBatAudioId', generateAudioId());
    }

    const audioId = dataGet(audioElement, 'echoBatAudioId');
    const entry = audioBatchRegistry.get(audioId) || {
      id: audioId,
      selected: true,
      status: 'idle',
    };

    entry.audioElement = audioElement;
    entry.button = button;
    entry.metadata = metadata;

    audioBatchRegistry.set(audioId, entry);

    dataSet(button, 'echoBatAudioId', audioId);
    button.echoBat.setSelected(entry.selected);
    button.echoBat.onStatusChange = (payload) => {
      handleBatchStatusChange(audioId, payload);
    };

    ensureBatchController();
    updateBatchController();

    return entry;
  }

  function generateAudioId() {
    return `echo-bat-audio-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  }

  function handleBatchStatusChange(audioId, payload) {
    const entry = audioBatchRegistry.get(audioId);
    if (!entry) {
      return;
    }

    const statusText = payload?.status || '';
    if (statusText.includes('🎉') || statusText.includes('成功')) {
      entry.status = 'success';
      entry.selected = false;
      entry.button.echoBat.setSelected(false);
      if (entry.button && entry.button.echoBat && typeof entry.button.echoBat.setBatchContext === 'function') {
        entry.button.echoBat.setBatchContext(null);
      }
    } else if (statusText.includes('❌') || statusText.includes('错误') || statusText.includes('失败')) {
      entry.status = 'error';
      if (entry.button && entry.button.echoBat && typeof entry.button.echoBat.setBatchContext === 'function') {
        entry.button.echoBat.setBatchContext(null);
      }
    } else if (statusText.includes('📥') || statusText.includes('正在')) {
      entry.status = 'uploading';
    } else {
      entry.status = 'pending';
    }

    if (entry.checkbox) {
      entry.checkbox.checked = entry.selected !== false;
      entry.checkbox.disabled = entry.status === 'uploading' || entry.status === 'success';
    }

    updateBatchController();

    if (batchState.running && batchState.currentId === audioId) {
      if (entry.status === 'success' || entry.status === 'error') {
        processNextBatchItem();
      }
    }
  }

  function ensureBatchController() {
    if (batchController) {
      return batchController;
    }

    const container = createElement('div');
    setElementId(container, 'echo-bat-batch-controller');
    setClass(container, 'echo-bat-batch-controller hidden');

    const info = createElement('div');
    setClass(info, 'echo-bat-batch-info');
    container.appendChild(info);

    const actions = createElement('div');
    setClass(actions, 'echo-bat-batch-actions');

    const startButton = createElement('button');
    setClass(startButton, 'echo-bat-batch-start');
    startButton.textContent = '上传已选音频';
    startButton.addEventListener('click', startBatchUpload);
    if (startButton.setAttribute) {
      startButton.setAttribute('type', 'button');
    }

    const toggleButton = createElement('button');
    setClass(toggleButton, 'echo-bat-batch-toggle');
    toggleButton.textContent = '选择音频';
    toggleButton.addEventListener('click', () => toggleBatchSelectionPanel());
    if (toggleButton.setAttribute) {
      toggleButton.setAttribute('type', 'button');
    }

    actions.appendChild(startButton);
    actions.appendChild(toggleButton);
    container.appendChild(actions);

    const selectionPanel = createElement('div');
    setClass(selectionPanel, 'echo-bat-batch-selection hidden');
    container.appendChild(selectionPanel);

    const host = document.body || document.documentElement;
    if (!host) {
      return null;
    }

    host.appendChild(container);

    batchController = {
      container,
      info,
      actions,
      startButton,
      toggleButton,
      selectionPanel,
      selectionVisible: false,
    };

    return batchController;
  }

  function toggleBatchSelectionPanel(forceState) {
    if (!batchController) {
      return;
    }
    const nextState = typeof forceState === 'boolean' ? forceState : !batchController.selectionVisible;
    batchController.selectionVisible = nextState;
    if (nextState) {
      removeClass(batchController.selectionPanel, 'hidden');
      batchController.toggleButton.textContent = '收起选择';
    } else {
      addClass(batchController.selectionPanel, 'hidden');
      batchController.toggleButton.textContent = '选择音频';
    }
  }

  function updateBatchController() {
    if (!batchController) {
      return;
    }

    const entries = Array.from(audioBatchRegistry.values());
    if (entries.length <= 1) {
      addClass(batchController.container, 'hidden');
      return;
    }

    removeClass(batchController.container, 'hidden');
    maybeTrackBatchView(entries);

    const selectableEntries = entries.filter((entry) => !entry.button.echoBat.hasSucceeded());
    const selectedEntries = selectableEntries.filter((entry) => entry.selected === true);

    batchController.info.textContent = `已检测到 ${entries.length} 个音频（已选 ${selectedEntries.length} 个）`;
    const startLabel = batchState.running
      ? `正在批量上传 (${selectedEntries.length || batchState.realCount || entries.length})`
      : `上传已选音频 (${selectedEntries.length})`;
    batchController.startButton.textContent = startLabel;
    batchController.startButton.disabled = batchState.running || selectedEntries.length === 0;

    renderBatchSelectionList(entries);
  }

  function renderBatchSelectionList(entries) {
    if (!batchController) {
      return;
    }

    const panel = batchController.selectionPanel;
    panel.innerHTML = '';

    entries.forEach((entry) => {
      if (entry) {
        entry.checkbox = null;
        entry.checkboxEl = null;
      }
    });

    if (entries.length) {
    const controls = createElement('div');
    setClass(controls, 'echo-bat-batch-selection-controls');

    const selectAllButton = createElement('button');
    selectAllButton.type = 'button';
      if (selectAllButton.setAttribute) {
        selectAllButton.setAttribute('type', 'button');
      }
      setClass(selectAllButton, 'echo-bat-batch-selection-button');
      selectAllButton.textContent = '全选';
      selectAllButton.addEventListener('click', () => {
        entries.forEach((entry) => {
          if (!entry || !entry.button || !entry.button.echoBat) {
            return;
          }
          if (entry.button.echoBat.hasSucceeded()) {
            return;
          }
          entry.selected = true;
          entry.button.echoBat.setSelected(true);
          const checkboxEl = entry.checkboxEl || entry.checkbox;
          if (checkboxEl) {
            checkboxEl.checked = true;
          }
        });
        updateBatchController();
      });

      const clearButton = createElement('button');
      clearButton.type = 'button';
      if (clearButton.setAttribute) {
        clearButton.setAttribute('type', 'button');
      }
      setClass(clearButton, 'echo-bat-batch-selection-button');
      clearButton.textContent = '全不选';
      clearButton.addEventListener('click', () => {
        entries.forEach((entry) => {
          if (!entry || !entry.button || !entry.button.echoBat) {
            return;
          }
          if (entry.button.echoBat.hasSucceeded()) {
            return;
          }
          entry.selected = false;
          entry.button.echoBat.setSelected(false);
          const checkboxEl = entry.checkboxEl || entry.checkbox;
          if (checkboxEl) {
            checkboxEl.checked = false;
          }
        });
        updateBatchController();
      });

      controls.appendChild(selectAllButton);
      controls.appendChild(clearButton);
      panel.appendChild(controls);
    }

    entries.forEach((entry) => {
      const item = createElement('label');
      setClass(item, 'echo-bat-batch-item');
      dataSet(item, 'status', entry.status);

      const checkbox = createElement('input');
      checkbox.type = 'checkbox';
      if (checkbox.setAttribute) {
        checkbox.setAttribute('type', 'checkbox');
      }
      checkbox.checked = entry.selected !== false;
      checkbox.disabled = batchState.running || entry.button.echoBat.hasSucceeded();
      checkbox.addEventListener('change', () => {
        entry.selected = checkbox.checked;
        entry.button.echoBat.setSelected(entry.selected && !entry.button.echoBat.hasSucceeded());
        updateBatchController();
      });
      entry.checkbox = checkbox;
      entry.checkboxEl = checkbox;

      const text = createElement('span');
      setClass(text, 'echo-bat-batch-item-text');
      text.textContent = formatBatchItemLabel(entry);

      item.appendChild(checkbox);
      item.appendChild(text);
      panel.appendChild(item);
    });
  }

  function formatBatchItemLabel(entry) {
    const { metadata } = entry;
    if (!metadata) {
      return '未命名音频';
    }

    if (metadata.titleText) {
      return metadata.albumName ? `${metadata.albumName} - ${metadata.titleText}` : metadata.titleText;
    }

    if (metadata.albumName) {
      return metadata.albumName;
    }

    try {
      const url = new URL(metadata.mediaUrl);
      return url.pathname.split('/').pop() || url.hostname;
    } catch (error) {
      return metadata.mediaUrl || '音频';
    }
  }

  function startBatchUpload() {
    emitLog('info', '[EchoBat Content Script] startBatchUpload invoked.', {
      running: batchState.running,
      registrySize: audioBatchRegistry.size,
    });
    if (batchState.running) {
      return;
    }

    const entries = Array.from(audioBatchRegistry.values())
      .filter((entry) => entry.selected === true)
      .filter((entry) => !entry.button.echoBat.hasSucceeded());

    if (!entries.length) {
      emitLog('info', '[EchoBat Content Script] No eligible audio items for batch upload.');
      if (batchController && batchController.startButton) {
        batchController.startButton.disabled = true;
        batchController.startButton.textContent = '上传已选音频 (0)';
      }
      return;
    }

    const batchId = ensureBatchSessionId();
    batchState.sessionId = batchId;
    batchState.realCount = entries.length;
    entries.forEach((entry, index) => {
      if (!entry || entry.selected !== true) {
        return;
      }
      const context = {
        isBatch: true,
        batchId,
        batchIndex: index + 1,
        batchRealCount: entries.length,
        isBatchEnd: index === entries.length - 1,
      };
      if (entry.button && entry.button.echoBat && typeof entry.button.echoBat.setBatchContext === 'function') {
        entry.button.echoBat.setBatchContext(context);
      } else {
        entry.batchContext = context;
      }
    });

    batchState.running = true;
    batchState.queue = entries.filter((entry) => entry.selected === true).map((entry) => entry.id);
    batchState.currentId = null;
    if (batchController && batchController.startButton) {
      batchController.startButton.disabled = true;
      batchController.startButton.textContent = `正在批量上传 (${entries.length})`;
    }
    toggleBatchSelectionPanel(false);
    updateBatchController();
    processNextBatchItem();
  }

  function processNextBatchItem() {
    if (!batchState.running) {
      return;
    }

    if (!batchState.queue.length) {
      finishBatchUpload();
      return;
    }

    const nextId = batchState.queue.shift();
    const entry = audioBatchRegistry.get(nextId);

    if (!entry) {
      processNextBatchItem();
      return;
    }

    if (entry.button.echoBat.hasSucceeded()) {
      processNextBatchItem();
      return;
    }

    batchState.currentId = nextId;
    entry.status = 'uploading';
    const batchContext =
      entry.button &&
      entry.button.echoBat &&
      typeof entry.button.echoBat.getBatchContext === 'function'
        ? entry.button.echoBat.getBatchContext()
        : entry.batchContext || null;
    const triggerContext = batchContext
      ? { ...batchContext }
      : {
          isBatch: true,
          batchId: ensureBatchSessionId(),
          batchIndex: null,
          batchRealCount: batchState.realCount || null,
          isBatchEnd: false,
        };
    entry.button.echoBat.startUpload(triggerContext);
    updateBatchController();
  }

  function finishBatchUpload() {
    batchState.running = false;
    batchState.queue = [];
    batchState.currentId = null;
    batchState.realCount = 0;
    if (batchController && batchController.startButton) {
      batchController.startButton.disabled = false;
      batchController.startButton.textContent = '上传已选音频';
    }
    updateBatchController();
  }

  function extractAudioSrc(audioElement) {
    if (!audioElement) {
      return null;
    }

    if (audioElement.currentSrc) {
      return audioElement.currentSrc;
    }

    if (audioElement.src) {
      return audioElement.src;
    }

    const dataSrc = dataGet(audioElement, 'src');
    if (dataSrc) {
      return dataSrc;
    }

    const sourceElement = audioElement.querySelector('source[src]');
    if (sourceElement) {
      return sourceElement.src || sourceElement.getAttribute('src');
    }

    return null;
  }

  function extractGenericAudioMetadata(audioElement) {
    const pageTitle = document.title ? document.title.trim() : '';
    const metaTitle = getMetaContent('meta[property="og:title"]');
    const metaSiteName = getMetaContent('meta[property="og:site_name"]');
    const hostname = window.location.hostname ? window.location.hostname.replace(/^www\./, '') : '';

    let titleText = (
      audioElement.getAttribute('data-title') ||
      audioElement.getAttribute('title') ||
      audioElement.getAttribute('aria-label') ||
      dataGet(audioElement, 'title') ||
      ''
    ).trim();

    if (!titleText) {
      const figure = audioElement.closest('figure');
      if (figure) {
        const caption = figure.querySelector('figcaption');
        if (caption && caption.textContent) {
          titleText = caption.textContent.trim();
        }
      }
    }

    if (!titleText) {
      titleText = findNearestHeadingText(audioElement);
    }

    if (!titleText) {
      titleText = metaTitle || pageTitle;
    }

    let albumName = metaSiteName || hostname;
    if (!albumName) {
      albumName = pageTitle || window.location.href;
    }

    return {
      titleText,
      albumName,
    };
  }

  function getMetaContent(selector) {
    const element = document.querySelector(selector);
    if (!element) {
      return '';
    }
    const content = element.getAttribute('content');
    return content ? content.trim() : '';
  }

  function findNearestHeadingText(startElement) {
    const headingSelector = 'h1, h2, h3, h4, h5, h6';
    let current = startElement;

    while (current && current !== document.body) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.matches(headingSelector)) {
          const headingText = sibling.textContent.trim();
          if (headingText) {
            return headingText;
          }
        }

        const nestedHeading = sibling.querySelector(headingSelector);
        if (nestedHeading && nestedHeading.textContent) {
          const nestedText = nestedHeading.textContent.trim();
          if (nestedText) {
            return nestedText;
          }
        }
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }

    const globalHeading = document.querySelector(headingSelector);
    return globalHeading && globalHeading.textContent ? globalHeading.textContent.trim() : '';
  }
  
  // 将 createUploadButton 函数内联到 main.js 中
  function createUploadButton(mediaUrl, titleText = '', albumName = '', expandStyles = null, options = {}) {
    const { variant = 'default' } = options;
    emitLog('info', '[EchoBat Content Script] createUploadButton metadata:', {
      mediaUrl,
      title: titleText,
      albumName,
      titleType: typeof titleText,
      titleLength: titleText.length,
    });
    
    const pageTitle = titleText || document.title || '';
    const pageUrl = window.location.href;

    function sendPageEvent(eventName, extraPayload = {}) {
      const payload = {
        em_page_title: pageTitle,
        em_page_url: pageUrl,
        ...extraPayload,
      };
      sendAnalyticsEvent(eventName, payload);
    }

    // 创建主容器 - 这个容器将包含文案容器
    const container = createElement('div');
    setClass(container, 'echo-bat-container');
    if (variant !== 'default') {
      addClass(container, `echo-bat-container--${variant}`);
    }
    
    // 创建状态显示区域 - 这个区域将直接作为主要交互元素
    const statusContainer = createElement('div');
    setClass(statusContainer, 'echo-bat-status-container');
    statusContainer.style.pointerEvents = 'auto';
    // 状态容器现在始终显示，不再初始隐藏
    
    // 创建状态文本元素
    const statusText = createElement('div');
    setClass(statusText, 'echo-bat-status-text');
    statusText.textContent = '上传到飞书妙记'; // 设置默认文案
    statusContainer.appendChild(statusText);
    
    // 创建"去查看"链接元素（初始隐藏）
    const viewLink = createElement('a');
    setClass(viewLink, 'echo-bat-view-link');
    viewLink.textContent = '去查看';
    viewLink.href = 'https://feishu.cn/minutes/home';
    viewLink.target = '_blank'; // 在新标签页中打开
    if (viewLink.setAttribute) {
      viewLink.setAttribute('href', 'https://feishu.cn/minutes/home');
      viewLink.setAttribute('target', '_blank');
      viewLink.setAttribute('rel', 'noopener noreferrer');
    }
    viewLink.style.display = 'none'; // 初始隐藏
    statusContainer.appendChild(viewLink);
    
    // 将所有元素添加到主容器
    container.appendChild(statusContainer);

    // 内联 injectCSS 函数
    injectCSS(expandStyles);
    
    if (!buttonViewTracked) {
      sendPageEvent(ANALYTICS_EVENTS.ButtonView);
      buttonViewTracked = true;
      emitLog('info', '[EchoBat Content Script] Button view event sent.');
    }

    // 点击事件 - 直接在文案容器上添加点击事件
    let successReported = false;

    let currentClickId = null;

    statusContainer.addEventListener('click', () => {
      const isCompleted = hasClass(statusContainer, 'upload-success');
      const isFailed = hasClass(statusContainer, 'upload-error');
      const isActive = hasClass(statusContainer, 'active');
      const clickPayload = {
        blocked: false,
      };

      const triggerContext =
        container.echoBat && container.echoBat.batchTriggerContext
          ? { ...container.echoBat.batchTriggerContext }
          : null;
      if (container.echoBat) {
        container.echoBat.batchTriggerContext = null;
      }

      const isBatch = Boolean(triggerContext?.isBatch);
      let batchId = null;
      let batchIndex = null;
      let batchRealCount = null;
      const batchIsEnd = isBatch && triggerContext?.isBatchEnd === true;

      if (isBatch) {
        batchId = triggerContext?.batchId || ensureBatchSessionId();
        const parsedBatchIndex = Number(triggerContext?.batchIndex);
        if (Number.isFinite(parsedBatchIndex)) {
          batchIndex = parsedBatchIndex;
        }
        const parsedBatchRealCount = Number(triggerContext?.batchRealCount);
        if (Number.isFinite(parsedBatchRealCount)) {
          batchRealCount = parsedBatchRealCount;
        }
      }

      clickPayload.em_is_batch = isBatch;
      if (isBatch) {
        if (batchId) {
          clickPayload.em_batch_id = batchId;
        }
        if (batchIndex != null) {
          clickPayload.em_batch_index = batchIndex;
        }
        if (batchRealCount != null) {
          clickPayload.em_batch_realcount = batchRealCount;
        }
      }

      if (isCompleted) {
        emitLog('info', '[EchoBat Content Script] Click ignored because upload already succeeded.');
        return;
      }
      
      if (isActive) {
        emitLog('info', '[EchoBat Content Script] Click ignored because upload is in progress.');
        return;
      }

      if (isFailed) {
        clickPayload.retry = true;
        clickPayload.reason = 'retry_after_failure';
        removeClass(statusContainer, 'upload-error');
        removeClass(statusText, 'error');
        viewLink.style.display = 'none';
        statusText.textContent = '上传到飞书妙记';
      }

      const clickId = generateClickId();
      latestClickId = clickId;
      currentClickId = clickId;
      successReported = false;
      clickPayload.em_click_id = clickId;

      const activeContext = {
        em_is_batch: isBatch,
      };
      if (isBatch) {
        if (batchId) {
          activeContext.em_batch_id = batchId;
        }
        if (batchIndex != null) {
          activeContext.em_batch_index = batchIndex;
        }
        if (batchIsEnd) {
          activeContext.em_is_batch_end = true;
        }
        if (batchRealCount != null) {
          activeContext.em_batch_realcount = batchRealCount;
        }
      }
      container.echoBat.activeUploadContext = activeContext;

      sendPageEvent(ANALYTICS_EVENTS.StartClick, clickPayload);

      // 设置激活状态
      addClass(statusContainer, 'active');
      statusContainer.style.pointerEvents = 'none';
      statusText.textContent = '📥 正在下载音频...';
      viewLink.style.display = 'none'; // 隐藏"去查看"链接
      
      // 发送URL和标题给background script，让background script处理文件下载和命名
      const message = { 
        action: 'uploadFile', 
        url: mediaUrl,
        title: titleText,
        albumName: albumName, // 添加专辑名称
        clickId: clickId,
        pageTitle: pageTitle,
        pageUrl: pageUrl,
      };
      message.em_is_batch = isBatch;
      if (isBatch) {
        if (batchId) {
          message.em_batch_id = batchId;
        }
        if (batchIndex != null) {
          message.em_batch_index = batchIndex;
        }
        if (batchRealCount != null) {
          message.em_batch_realcount = batchRealCount;
        }
        if (batchIsEnd) {
          message.em_is_batch_end = true;
        }
      }
      emitLog('info', '[EchoBat Content Script] Prepared upload request payload:', {
        mediaUrl,
        title: titleText,
        albumName,
        payload: message,
      });

      // 监听来自后台脚本的状态更新
      const statusListener = (request, sender, sendResponse) => {
        if (request.action === 'updateUploadStatus') {
          if (request.clickId && request.clickId !== currentClickId) {
            return;
          }
          updateStatus(request.status, request.progress);
        }
      };
      
      // 添加状态监听器
      chrome.runtime.onMessage.addListener(statusListener);
      
      // 更新状态的函数
      function updateStatus(status, progress = null) {
        // 如果有进度信息，统一文案格式
        if (progress !== null) {
          const pct = Math.min(100, Math.max(0, Math.round(progress)));
          statusText.textContent = `📤 上传中 ${pct}%`;
        } else {
          statusText.textContent = status;
        }
        
        // 根据状态更新样式
        if (status.includes('成功')) {
          addClass(statusText, 'success');
          addClass(statusContainer, 'upload-success'); // 添加成功状态类
          removeClass(statusContainer, 'active');
          statusContainer.style.pointerEvents = 'auto';
          
          // 显示"去查看"链接
          viewLink.style.display = 'inline-block';
          
          // 不再自动重置状态，永久显示上传成功状态
          if (!successReported) {
            const activeContext =
              (container.echoBat && container.echoBat.activeUploadContext) || { em_is_batch: false };
            const successPayload = {
              em_click_id: latestClickId,
              em_is_batch: Boolean(activeContext.em_is_batch),
            };
            if (successPayload.em_is_batch) {
              if (activeContext.em_batch_id) {
                successPayload.em_batch_id = activeContext.em_batch_id;
              }
              if (typeof activeContext.em_batch_index === 'number') {
                successPayload.em_batch_index = activeContext.em_batch_index;
              }
              if (activeContext.em_is_batch_end) {
                successPayload.em_is_batch_end = true;
              }
            }
            sendPageEvent(ANALYTICS_EVENTS.StartSuccess, successPayload);
            successReported = true;
          }
          if (container.echoBat) {
            container.echoBat.activeUploadContext = null;
          }
        } else if (status.includes('错误') || status.includes('失败')) {
          addClass(statusText, 'error');
          addClass(statusContainer, 'upload-error'); // 添加错误状态类
          
          // 不再自动重置状态，永久显示上传失败状态，但允许重新点击尝试
          removeClass(statusContainer, 'active'); // 移除激活状态，允许重新点击
          statusContainer.style.pointerEvents = 'auto';
          if (container.echoBat) {
            container.echoBat.activeUploadContext = null;
          }
        }

        if (container.echoBat && typeof container.echoBat.onStatusChange === 'function') {
          container.echoBat.onStatusChange({ status, progress, clickId: currentClickId });
        }

        if ((status.includes('成功') || status.includes('错误') || status.includes('失败')) && statusListener) {
          chrome.runtime.onMessage.removeListener(statusListener);
        }
      }
      
      // 重置按钮状态的函数 - 仅在成功或失败时调用
      function resetButton() {
        removeClass(statusContainer, 'active');
        statusContainer.style.pointerEvents = 'auto';
        removeClass(statusText, 'success');
        removeClass(statusText, 'error');
        statusText.textContent = '上传到飞书妙记'; // 重置为默认文案
        viewLink.style.display = 'none'; // 隐藏"去查看"链接
        
        // 移除状态监听器
        chrome.runtime.onMessage.removeListener(statusListener);
      }
      
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          emitLog('warn', '[EchoBat Content Script] Upload message failed:', runtimeError);
          if (chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
            chrome.storage.local.get(['em_last_upload_error'], (debugInfo) => {
              if (chrome.runtime.lastError) {
                emitLog('warn', '[EchoBat Content Script] Failed to read last upload error:', chrome.runtime.lastError);
              } else if (debugInfo?.em_last_upload_error) {
                emitLog('warn', '[EchoBat Content Script] Last background upload error:', debugInfo.em_last_upload_error);
              }
            });
          }
          updateStatus(`❌ 上传失败: ${runtimeError.message || '后台未响应'}`);
          return;
        }

        if (response && response.success) {
          updateStatus('🎉 上传成功');
        } else {
          updateStatus(`❌ 上传失败: ${response ? response.message : '未知错误'}`);
        }
      });
    });

    container.echoBat = {
      startUpload: (triggerContext = null) => {
        if (hasClass(statusContainer, 'upload-success')) {
          return;
        }
        let contextToUse = triggerContext;
        if (!contextToUse && typeof container.echoBat.getBatchContext === 'function') {
          contextToUse = container.echoBat.getBatchContext();
        }
        if (contextToUse) {
          container.echoBat.batchTriggerContext = {
            ...contextToUse,
            isBatch: contextToUse.isBatch === undefined ? true : Boolean(contextToUse.isBatch),
          };
        } else {
          container.echoBat.batchTriggerContext = { isBatch: false };
        }
        statusContainer.click();
      },
      isUploading: () => hasClass(statusContainer, 'active'),
      hasSucceeded: () => hasClass(statusContainer, 'upload-success'),
      hasError: () => hasClass(statusContainer, 'upload-error'),
      setSelected: (selected) => {
        dataSet(container, 'echoBatSelected', selected ? 'true' : 'false');
      },
      getMetadata: () => ({
        titleText,
        albumName,
        mediaUrl,
      }),
      setBatchContext: (context) => {
        container.echoBat.savedBatchContext = context
          ? {
              ...context,
              isBatch: context.isBatch === undefined ? true : Boolean(context.isBatch),
            }
          : null;
      },
      getBatchContext: () => {
        if (!container.echoBat.savedBatchContext) {
          return null;
        }
        return { ...container.echoBat.savedBatchContext };
      },
      batchTriggerContext: null,
      activeUploadContext: null,
      savedBatchContext: null,
      onStatusChange: null,
    };

    dataSet(container, 'echoBatSelected', 'true');

    return container;
  }
  
  // 内联 injectCSS 函数
  function parseColorToRGB(color) {
    if (!color) return null;
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1]),
        g: parseInt(rgbMatch[2]),
        b: parseInt(rgbMatch[3])
      };
    }
    const rgbaMatch = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (rgbaMatch) {
      return {
        r: parseInt(rgbaMatch[1]),
        g: parseInt(rgbaMatch[2]),
        b: parseInt(rgbaMatch[3])
      };
    }
    const hexMatch = color.match(/#([0-9a-f]{6})/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
      };
    }
    return null;
  }

  function lightenColor(r, g, b, amount = 40) {
    return {
      r: Math.min(255, r + amount),
      g: Math.min(255, g + amount),
      b: Math.min(255, b + amount)
    };
  }

  function updateThemeColor(expandStyles) {
    let themeColor = { r: 102, g: 51, b: 153 };
    
    if (expandStyles && expandStyles.color) {
      const parsed = parseColorToRGB(expandStyles.color);
      if (parsed) {
        themeColor = parsed;
      }
    }
    
    const { r, g, b } = themeColor;
    const lighter = lightenColor(r, g, b, 50);
    
    const root = document.documentElement;
    root.style.setProperty('--echo-bat-theme-r', r);
    root.style.setProperty('--echo-bat-theme-g', g);
    root.style.setProperty('--echo-bat-theme-b', b);
    root.style.setProperty('--echo-bat-theme-lighter-r', lighter.r);
    root.style.setProperty('--echo-bat-theme-lighter-g', lighter.g);
    root.style.setProperty('--echo-bat-theme-lighter-b', lighter.b);
    
    emitLog('debug', '[EchoBat Content Script] Theme color updated:', { r, g, b, lighter });
  }

  function injectCSS(expandStyles = null) {
    if (document.getElementById('echo-bat-css')) {
      if (expandStyles) {
        updateThemeColor(expandStyles);
      }
      return;
    }
    
    const styleSheet = createElement('style');
    setElementId(styleSheet, 'echo-bat-css');
    
    let themeColor = { r: 102, g: 51, b: 153 };
    
    if (expandStyles && expandStyles.color) {
      const parsed = parseColorToRGB(expandStyles.color);
      if (parsed) {
        themeColor = parsed;
      }
    }
    
    const { r, g, b } = themeColor;
    const lighter = lightenColor(r, g, b, 50);
    
    const root = document.documentElement;
    root.style.setProperty('--echo-bat-theme-r', r);
    root.style.setProperty('--echo-bat-theme-g', g);
    root.style.setProperty('--echo-bat-theme-b', b);
    root.style.setProperty('--echo-bat-theme-lighter-r', lighter.r);
    root.style.setProperty('--echo-bat-theme-lighter-g', lighter.g);
    root.style.setProperty('--echo-bat-theme-lighter-b', lighter.b);
    
    const gradientStart = `rgb(var(--echo-bat-theme-r), var(--echo-bat-theme-g), var(--echo-bat-theme-b))`;
    const gradientEnd = `rgb(var(--echo-bat-theme-lighter-r), var(--echo-bat-theme-lighter-g), var(--echo-bat-theme-lighter-b))`;
    const shadowColor = `rgba(var(--echo-bat-theme-r), var(--echo-bat-theme-g), var(--echo-bat-theme-b), 0.3)`;
    const shadowColorHover = `rgba(var(--echo-bat-theme-r), var(--echo-bat-theme-g), var(--echo-bat-theme-b), 0.4)`;
    
    styleSheet.textContent = `
      .echo-bat-container {
        position: relative;
        display: inline-flex;
        align-items: center;
        vertical-align: middle;
        margin-left: 12px;
      }

      .echo-bat-container--generic {
        margin-left: 0;
        margin-top: 8px;
        display: inline-flex;
      }

      .echo-bat-container--generic .echo-bat-status-container {
        margin-left: 0;
      }

      .echo-bat-container--rss {
        margin: 0;
        display: inline-flex;
      }

      .echo-bat-container--rss .echo-bat-status-container {
        margin-left: 0;
      }

      .echo-bat-container[data-echo-bat-selected="false"] .echo-bat-status-container {
        opacity: 0.6;
      }

      .echo-bat-batch-controller {
        position: fixed;
        right: 16px;
        bottom: 24px;
        background-color: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(${r}, ${g}, ${b}, 0.2);
        border-radius: 12px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
        padding: 12px 16px;
        z-index: 2147483647;
        width: 260px;
        font-family: inherit;
      }

      .echo-bat-batch-controller.hidden {
        display: none;
      }

      .echo-bat-batch-info {
        font-size: 12px;
        margin-bottom: 8px;
        color: #444;
      }

      .echo-bat-batch-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }

      .echo-bat-batch-actions button {
        flex: 1;
        padding: 6px 8px;
        font-size: 12px;
        border-radius: 6px;
        border: none;
        background: linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%);
        color: #fff;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 6px ${shadowColor};
      }

      .echo-bat-batch-actions button:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 10px ${shadowColorHover};
      }

      .echo-bat-batch-actions button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .echo-bat-batch-selection {
        max-height: 200px;
        overflow-y: auto;
        border-top: 1px solid rgba(${r}, ${g}, ${b}, 0.1);
        padding-top: 8px;
      }

      .echo-bat-batch-selection-controls {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }

      .echo-bat-batch-selection-button {
        flex: 1;
        padding: 4px 6px;
        font-size: 12px;
        border-radius: 6px;
        border: 1px solid rgba(${r}, ${g}, ${b}, 0.3);
        background: rgba(${r}, ${g}, ${b}, 0.1);
        color: ${gradientStart};
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .echo-bat-batch-selection-button:hover {
        background: rgba(${r}, ${g}, ${b}, 0.2);
      }

      .echo-bat-batch-selection-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .echo-bat-batch-selection.hidden {
        display: none;
      }

      .echo-bat-batch-item {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        margin-bottom: 6px;
        color: #333;
      }

      .echo-bat-batch-item[data-status="success"] .echo-bat-batch-item-text {
        color: #52c41a;
      }

      .echo-bat-batch-item[data-status="error"] .echo-bat-batch-item-text {
        color: #ff4d4f;
      }

      .echo-bat-batch-item-text {
        flex: 1;
        line-height: 1.4;
      }

      .echo-bat-rss-panel {
        position: fixed;
        right: 16px;
        bottom: 24px;
        width: 320px;
        max-height: 70vh;
        overflow-y: auto;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(${r}, ${g}, ${b}, 0.2);
        border-radius: 12px;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.16);
        padding: 14px 16px;
        z-index: 2147483647;
        font-family: inherit;
      }

      .echo-bat-rss-header {
        font-size: 13px;
        font-weight: 600;
        color: ${gradientStart};
        margin-bottom: 12px;
      }

      .echo-bat-rss-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }

      .echo-bat-rss-actions button {
        flex: 1;
        padding: 6px 8px;
        font-size: 12px;
        border-radius: 6px;
        border: none;
        background: linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%);
        color: #fff;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 6px ${shadowColor};
      }

      .echo-bat-rss-actions button:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 10px ${shadowColorHover};
      }

      .echo-bat-rss-actions button:active {
        transform: translateY(0);
      }

      .echo-bat-rss-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .echo-bat-rss-entry {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid rgba(${r}, ${g}, ${b}, 0.12);
        border-radius: 8px;
        background: rgba(${r}, ${g}, ${b}, 0.04);
      }

      .echo-bat-rss-entry-info {
        flex: 1;
        min-width: 0;
      }

      .echo-bat-rss-entry-checkbox {
        margin-top: 4px;
        flex-shrink: 0;
      }

      .echo-bat-rss-entry-title {
        font-size: 13px;
        font-weight: 600;
        color: #333;
        margin-bottom: 4px;
      }

      .echo-bat-rss-entry-meta {
        font-size: 12px;
        color: #666;
      }

      .echo-bat-rss-entry-action {
        flex-shrink: 0;
      }

      .echo-bat-rss-entry-button .echo-bat-container {
        margin-left: 0;
      }

      .echo-bat-status-container {
        display: inline-flex;
        align-items: center;
        padding: 6px 12px;
        background: linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px ${shadowColor};
        white-space: nowrap;
        z-index: 2147483647;
      }

      .echo-bat-status-container:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px ${shadowColorHover};
      }

      .echo-bat-status-container:active {
        transform: translateY(0);
      }

      .echo-bat-status-container.active {
        pointer-events: none;
        opacity: 0.8;
      }

      .echo-bat-status-container.upload-success {
        background: linear-gradient(135deg, #52c41a 0%, #73d13d 100%);
        box-shadow: 0 2px 8px rgba(82, 196, 26, 0.3);
      }

      .echo-bat-status-container.upload-error {
        background: linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%);
        box-shadow: 0 2px 8px rgba(255, 77, 79, 0.3);
      }
       
      .echo-bat-status-text {
        color: #fff;
        font-size: 12px;
        font-weight: 500;
      }
      
      .echo-bat-view-link {
        color: #fff;
        font-size: 12px;
        margin-left: 8px;
        text-decoration: underline;
      }
      
      .echo-bat-view-link:hover {
        opacity: 0.9;
      }
      
      .echo-bat-status-text.success,
      .echo-bat-status-text.error {
        color: #fff;
      }
    `;
    const styleTarget = document.head || document.documentElement || document.body;
  if (!styleTarget) {
    return;
  }
  styleTarget.appendChild(styleSheet);
}

} // close EchoBat content script scope
})(); // end EchoBat content script
