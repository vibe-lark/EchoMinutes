// src/background/main.js

globalThis.__ECHO_BAT_DEBUG__ = true;

import { setupDeclarativeNetRequestRules } from './network.js';
import { setupUploadListener } from './upload.js';
import { ensureTelemetryUserId, setupTelemetryListeners } from './telemetry.js';
import { log } from '../utils/log.js';
import { feishuCredentials } from '../utils/credentials.js';

async function injectContentScripts(tabId) {
  if (typeof tabId !== 'number') {
    log('Skipping content script injection: invalid tab id.');
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [
        'src/content/analytics.js',
        'src/content/main.js',
      ],
      injectImmediately: true,
    });
    log(`Content scripts injected into tab ${tabId}.`);
  } catch (error) {
    log('Failed to inject content scripts:', error);
    throw error;
  }
}

function setupActionInjection() {
  chrome.action.onClicked.addListener(async (tab) => {
    if (!tab || typeof tab.id !== 'number') {
      log('Action clicked without a valid tab context.');
      return;
    }
    try {
      await injectContentScripts(tab.id);
    } catch (error) {
      // 错误已在 injectContentScripts 中记录，这里不再额外处理
    }
  });
}

// Initialize the extension
async function main() {
  log("Initializing Echo Bat extension...");
  await ensureTelemetryUserId();
  await setupDeclarativeNetRequestRules();
  setupTelemetryListeners();
  setupUploadListener();
  setupActionInjection();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'injectEchoBat') {
      const tabId = sender?.tab?.id;
      if (typeof tabId !== 'number') {
        log('injectEchoBat: invalid tab id, skip.');
        return;
      }
      injectContentScripts(tabId).catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  });

  // 设置扩展关闭时的清理函数
  chrome.runtime.onSuspend.addListener(() => {
    log("Extension is being suspended, cleaning up sensitive data...");
    // 清理内存中的敏感数据
    if (feishuCredentials) {
      feishuCredentials.cookie = null;
      feishuCredentials.csrfToken = null;
    }
  });

  log("Echo Bat extension initialized.");
}

main();
