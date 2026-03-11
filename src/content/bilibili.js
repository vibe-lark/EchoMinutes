/**
 * Bilibili Content Script
 * 用于在 Bilibili 视频页面注入上传到飞书妙记的按钮
 * 使用 browser-sdk/bilibili-sdk.js 获取视频数据
 */

(function () {
'use strict';

const ANALYTICS_EVENTS = {
  ButtonView: 'em_button_view',
  StartClick: 'em_start_click',
  StartSuccess: 'em_start_success',
};

const DEBUG_ENABLED = Boolean(globalThis.__ECHO_BAT_DEBUG__);
const onceLoggedKeys = new Set();
let buttonViewTracked = false;
let lastKnownPath = null;
let lastKnownHref = null;

/**
 * 检查 BilibiliSDK 是否已加载
 */
function isBilibiliSDKLoaded() {
  return typeof window.BilibiliSDK !== 'undefined' || 
         typeof globalThis.BilibiliSDK !== 'undefined' ||
         typeof BilibiliSDK !== 'undefined';
}

/**
 * 获取 BilibiliSDK 实例
 */
function getBilibiliSDK() {
  if (typeof BilibiliSDK !== 'undefined') return BilibiliSDK;
  if (typeof window.BilibiliSDK !== 'undefined') return window.BilibiliSDK;
  if (typeof globalThis.BilibiliSDK !== 'undefined') return globalThis.BilibiliSDK;
  return null;
}

/**
 * 日志工具
 */
function emitLog(level, ...args) {
  if (!DEBUG_ENABLED) {
    return;
  }
  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug(`[EchoBat-Bilibili][${String(level).toUpperCase()}]`, ...args);
  }
}

function logOnce(key, level, ...args) {
  if (onceLoggedKeys.has(key)) {
    return;
  }
  onceLoggedKeys.add(key);
  emitLog(level, ...args);
}

function generateClickId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `click_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sendAnalyticsEvent(name, payload = {}) {
  if (window.EchoBatAnalytics && typeof window.EchoBatAnalytics.trackEvent === 'function') {
    window.EchoBatAnalytics.trackEvent(name, payload);
  }
}

/**
 * 检查是否为 Bilibili 视频页面
 */
function isBilibiliVideoPage() {
  const path = window.location.pathname;
  return path.startsWith('/video/') && (path.includes('BV') || path.includes('av'));
}

/**
 * 获取当前视频的 URL
 */
function getCurrentVideoUrl() {
  return window.location.href;
}

/**
 * 从页面提取视频信息（作为 SDK 的备选方案）
 */
function extractVideoInfoFromPage() {
  const titleElement = document.querySelector('h1.video-title') || 
                       document.querySelector('.video-title') ||
                       document.querySelector('[class*="title"]');
  const authorElement = document.querySelector('.up-name') ||
                        document.querySelector('[class*="up-name"]') ||
                        document.querySelector('.username');
  
  return {
    title: titleElement?.textContent?.trim() || document.title.replace(/_哔哩哔哩.*$/, '').trim(),
    author: authorElement?.textContent?.trim() || 'Bilibili'
  };
}

/**
 * 创建上传按钮容器
 */
function createUploadButton() {
  const container = document.createElement('div');
  container.className = 'echo-bat-bilibili-container';
  container.id = 'echo-bat-bilibili-button';
  
  const statusContainer = document.createElement('div');
  statusContainer.className = 'echo-bat-bilibili-status';
  
  const statusText = document.createElement('span');
  statusText.className = 'echo-bat-bilibili-text';
  statusText.textContent = '上传到飞书妙记';
  
  const viewLink = document.createElement('a');
  viewLink.className = 'echo-bat-bilibili-link';
  viewLink.textContent = '去查看';
  viewLink.href = 'https://feishu.cn/minutes/home';
  viewLink.target = '_blank';
  viewLink.rel = 'noopener noreferrer';
  viewLink.style.display = 'none';
  
  statusContainer.appendChild(statusText);
  statusContainer.appendChild(viewLink);
  container.appendChild(statusContainer);
  
  return { container, statusContainer, statusText, viewLink };
}

/**
 * 注入 CSS 样式
 */
function injectStyles() {
  if (document.getElementById('echo-bat-bilibili-css')) {
    return;
  }
  
  const style = document.createElement('style');
  style.id = 'echo-bat-bilibili-css';
  style.textContent = `
    .echo-bat-bilibili-container {
      display: inline-flex;
      align-items: center;
      margin-left: 12px;
      vertical-align: middle;
    }
    
    .echo-bat-bilibili-status {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      background: linear-gradient(135deg, #fb7299 0%, #ff9db5 100%);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(251, 114, 153, 0.3);
    }
    
    .echo-bat-bilibili-status:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(251, 114, 153, 0.4);
    }
    
    .echo-bat-bilibili-status:active {
      transform: translateY(0);
    }
    
    .echo-bat-bilibili-status.active {
      pointer-events: none;
      opacity: 0.8;
    }
    
    .echo-bat-bilibili-status.success {
      background: linear-gradient(135deg, #52c41a 0%, #73d13d 100%);
    }
    
    .echo-bat-bilibili-status.error {
      background: linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%);
    }
    
    .echo-bat-bilibili-text {
      color: #fff;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }
    
    .echo-bat-bilibili-link {
      color: #fff;
      font-size: 12px;
      margin-left: 8px;
      text-decoration: underline;
    }
    
    .echo-bat-bilibili-link:hover {
      color: #ffe4ec;
    }
    
  `;
  
  document.head.appendChild(style);
}



/**
 * 处理上传点击事件
 */
async function handleUploadClick(elements) {
  const { statusContainer, statusText, viewLink } = elements;
  
  if (statusContainer.classList.contains('active') || 
      statusContainer.classList.contains('success')) {
    return;
  }
  
  const clickId = generateClickId();
  const pageTitle = document.title;
  const pageUrl = window.location.href;
  
  emitLog('info', '开始上传流程', { pageUrl, pageTitle });
  
  sendAnalyticsEvent(ANALYTICS_EVENTS.StartClick, {
    em_click_id: clickId,
    em_page_title: pageTitle,
    em_page_url: pageUrl,
    em_source: 'bilibili'
  });
  
  statusContainer.classList.add('active');
  statusContainer.classList.remove('error', 'success');
  statusText.textContent = '📥 正在获取视频信息...';
  viewLink.style.display = 'none';
  
  try {
    const sdk = getBilibiliSDK();
    if (!sdk) {
      emitLog('error', 'BilibiliSDK 未加载，检查状态:', {
        windowSDK: typeof window.BilibiliSDK,
        globalSDK: typeof globalThis.BilibiliSDK,
        directSDK: typeof BilibiliSDK
      });
      throw new Error('BilibiliSDK 未加载，请刷新页面重试');
    }
    
    emitLog('info', 'BilibiliSDK 已加载');
    
    const videoUrl = getCurrentVideoUrl();
    emitLog('info', '视频 URL:', videoUrl);
    
    const infoResult = await sdk.getVideoInfo(videoUrl);
    emitLog('info', '视频信息获取结果:', infoResult);
    
    if (!infoResult.success) {
      throw new Error(infoResult.error || '获取视频信息失败');
    }
    
    const videoInfo = infoResult.data;
    statusText.textContent = `📥 正在下载: ${videoInfo.title}`;
    
    const binaryResult = await sdk.getVideoBinary(videoUrl, {
      quality: 80,
      merge: true,
      onProgress: (progress, loaded, total, type) => {
        const loadedMB = (loaded / 1024 / 1024).toFixed(1);
        const totalMB = (total / 1024 / 1024).toFixed(1);
        statusText.textContent = `📥 下载${type === 'video' ? '视频' : '音频'}: ${loadedMB}/${totalMB} MB`;
      },
      onMergeProgress: (progress, message) => {
        statusText.textContent = `🔄 ${message}`;
      }
    });
    
    emitLog('info', '视频二进制数据获取结果:', {
      success: binaryResult.success,
      merged: binaryResult.data?.merged,
      size: binaryResult.data?.size
    });
    
    if (!binaryResult.success) {
      throw new Error(binaryResult.error || '获取视频数据失败');
    }
    
    statusText.textContent = '📤 正在上传到飞书妙记...';
    
    let videoBuffer;
    let mimeType;
    let fileName;
    
    if (binaryResult.data.merged && binaryResult.data.buffer) {
      videoBuffer = binaryResult.data.buffer;
      mimeType = binaryResult.data.mimeType || 'video/mp4';
      fileName = `${binaryResult.data.safeTitle}.mp4`;
      emitLog('info', '使用合并后的视频文件');
    } else if (binaryResult.data.video && binaryResult.data.audio) {
      emitLog('warn', '合并失败，尝试手动合并');
      const muxer = window.BrowserMuxer || globalThis.BrowserMuxer;
      if (muxer) {
        const mergedBuffer = await muxer.mergeAudioVideo(
          binaryResult.data.video.buffer,
          binaryResult.data.audio.buffer
        );
        videoBuffer = mergedBuffer;
        mimeType = 'video/mp4';
        fileName = `${binaryResult.data.safeTitle}.mp4`;
      } else {
        videoBuffer = binaryResult.data.video.buffer;
        mimeType = binaryResult.data.video.mimeType || 'video/mp4';
        fileName = `${binaryResult.data.safeTitle}_video.mp4`;
      }
    } else if (binaryResult.data.video) {
      videoBuffer = binaryResult.data.video.buffer;
      mimeType = binaryResult.data.video.mimeType || 'video/mp4';
      fileName = `${binaryResult.data.safeTitle}_video.mp4`;
    } else {
      throw new Error('无法获取视频数据');
    }
    
    emitLog('info', '准备上传文件:', {
      fileName,
      mimeType,
      size: videoBuffer.byteLength
    });
    
    const statusListener = (request, sender, sendResponse) => {
      if (request.action === 'updateUploadStatus') {
        if (request.clickId && request.clickId !== clickId) {
          return;
        }
        
        if (request.progress !== null && request.progress !== undefined) {
          statusText.textContent = `📤 上传中 ${Math.round(request.progress)}%`;
        } else if (request.status) {
          statusText.textContent = request.status;
        }
      }
      
      if (request.action === 'requestVideoChunk') {
        if (request.clickId !== clickId) {
          return;
        }
        
        const start = request.start;
        const end = Math.min(request.end, videoBuffer.byteLength);
        const chunk = videoBuffer.slice(start, end);
        const chunkArray = Array.from(new Uint8Array(chunk));
        
        emitLog('info', `发送视频分块: ${start}-${end}, 大小: ${chunkArray.length}`);
        
        sendResponse({
          success: true,
          chunk: chunkArray,
          start: start,
          end: end,
          total: videoBuffer.byteLength
        });
        return true;
      }
    };
    
    chrome.runtime.onMessage.addListener(statusListener);
    
    const uploadMessage = {
      action: 'uploadBilibiliVideo',
      videoSize: videoBuffer.byteLength,
      fileName: fileName,
      mimeType: mimeType,
      title: videoInfo.title,
      author: videoInfo.author,
      albumName: `Bilibili - ${videoInfo.author}`,
      clickId: clickId,
      pageTitle: pageTitle,
      pageUrl: pageUrl,
      duration: videoInfo.duration,
      cover: videoInfo.cover
    };
    
    emitLog('info', '发送上传消息到 background:', {
      action: uploadMessage.action,
      fileName: uploadMessage.fileName,
      title: uploadMessage.title,
      videoSize: uploadMessage.videoSize
    });
    
    chrome.runtime.sendMessage(uploadMessage, (response) => {
      chrome.runtime.onMessage.removeListener(statusListener);
      
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        emitLog('error', '上传消息发送失败:', runtimeError);
        statusContainer.classList.remove('active');
        statusContainer.classList.add('error');
        statusText.textContent = `❌ 上传失败: ${runtimeError.message || '后台未响应'}`;
        return;
      }
      
      if (response && response.success) {
        statusContainer.classList.remove('active');
        statusContainer.classList.add('success');
        statusText.textContent = '🎉 上传成功';
        viewLink.style.display = 'inline';
        
        sendAnalyticsEvent(ANALYTICS_EVENTS.StartSuccess, {
          em_click_id: clickId,
          em_page_title: pageTitle,
          em_page_url: pageUrl,
          em_source: 'bilibili'
        });
      } else {
        statusContainer.classList.remove('active');
        statusContainer.classList.add('error');
        statusText.textContent = `❌ 上传失败: ${response?.message || '未知错误'}`;
      }
    });
    
  } catch (error) {
    emitLog('error', '上传过程出错:', error);
    statusContainer.classList.remove('active');
    statusContainer.classList.add('error');
    statusText.textContent = `❌ ${error.message || '上传失败'}`;
  }
}

/**
 * 尝试添加上传按钮到页面
 */
function tryAddButton() {
  if (!isBilibiliVideoPage()) {
    logOnce('notVideoPage', 'debug', '当前不是 Bilibili 视频页面');
    return false;
  }
  
  if (document.getElementById('echo-bat-bilibili-button')) {
    return true;
  }
  
  const targetSelectors = [
    '.video-toolbar-left',
    '.video-toolbar-container .left',
    '.toolbar-left',
    '#arc_toolbar_report .video-toolbar-left-main',
    '.video-toolbar-left-main'
  ];
  
  let targetContainer = null;
  for (const selector of targetSelectors) {
    targetContainer = document.querySelector(selector);
    if (targetContainer) {
      emitLog('debug', '找到目标容器:', selector);
      break;
    }
  }
  
  if (!targetContainer) {
    logOnce('noTargetContainer', 'debug', '未找到目标容器，等待页面加载完成');
    return false;
  }
  
  injectStyles();
  
  const elements = createUploadButton();
  
  elements.statusContainer.addEventListener('click', () => {
    handleUploadClick(elements);
  });
  
  targetContainer.appendChild(elements.container);
  
  if (!buttonViewTracked) {
    const pageInfo = extractVideoInfoFromPage();
    sendAnalyticsEvent(ANALYTICS_EVENTS.ButtonView, {
      em_page_title: pageInfo.title,
      em_page_url: window.location.href,
      em_source: 'bilibili'
    });
    buttonViewTracked = true;
  }
  
  emitLog('info', '上传按钮已添加到页面');
  return true;
}

/**
 * 清理导航时的状态
 */
function cleanupForNavigation() {
  const existingButton = document.getElementById('echo-bat-bilibili-button');
  if (existingButton) {
    existingButton.remove();
  }
  
  buttonViewTracked = false;
}

/**
 * 设置 URL 变化监听
 * 使用轮询方式检测 URL 变化，避免覆盖 history 方法干扰 Vue Router
 */
function setupUrlChangeObserver() {
  lastKnownPath = window.location.pathname;
  lastKnownHref = window.location.href;
  
  const checkUrlChange = () => {
    if (window.location.pathname === lastKnownPath && 
        window.location.href === lastKnownHref) {
      return;
    }
    
    cleanupForNavigation();
    lastKnownPath = window.location.pathname;
    lastKnownHref = window.location.href;
    
    setTimeout(() => tryAddButton(), 500);
  };
  
  window.addEventListener('popstate', checkUrlChange);
  
  setInterval(checkUrlChange, 1000);
}

/**
 * 初始化
 */
function initialize() {
  if (window.echoBatBilibiliInitialized) {
    logOnce('alreadyInitialized', 'debug', 'Bilibili content script 已初始化');
    return;
  }
  
  window.echoBatBilibiliInitialized = true;
  emitLog('info', 'Bilibili content script 开始初始化');
  
  emitLog('info', 'SDK 加载状态检查:', {
    BilibiliSDK: typeof BilibiliSDK,
    windowBilibiliSDK: typeof window.BilibiliSDK,
    globalBilibiliSDK: typeof globalThis.BilibiliSDK,
    BrowserMuxer: typeof BrowserMuxer,
    windowBrowserMuxer: typeof window.BrowserMuxer
  });
  
  setupUrlChangeObserver();
  
  tryAddButton();
  
  const observer = new MutationObserver(() => {
    if (!document.getElementById('echo-bat-bilibili-button')) {
      tryAddButton();
    }
  });
  
  const observerTarget = document.body || document.documentElement;
  if (observerTarget) {
    observer.observe(observerTarget, {
      childList: true,
      subtree: true
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => tryAddButton(), 500);
    }, { once: true });
  } else {
    setTimeout(() => tryAddButton(), 500);
  }
  
  emitLog('info', 'Bilibili content script 初始化完成');
}

setTimeout(initialize, 2000);

})();
