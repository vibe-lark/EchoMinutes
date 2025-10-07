// src/background/main.js

import { setupDeclarativeNetRequestRules } from './network.js';
import { setupUploadListener } from './upload.js';
import { log } from '../utils/log.js';
import { feishuCredentials } from '../utils/credentials.js';

// Initialize the extension
async function main() {
  log("Initializing Echo Bat extension...");
  await setupDeclarativeNetRequestRules();
  setupUploadListener();

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