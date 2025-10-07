// src/background/network.js

import { log } from '../utils/log.js';

// 存储当前配置的租户域名
let currentTenantDomain = null;

// 设置声明式网络请求规则
export async function setupDeclarativeNetRequestRules() {
  try {
    log("Setting up initial declarative net request rules...");
    
    // 首先移除所有现有的规则
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules.map(rule => rule.id);
    if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: removeRuleIds
        });
    }
    
    // 添加新规则，为小宇宙音频文件请求设置请求头
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              {
                header: 'Accept',
                operation: 'set',
                value: 'audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5'
              },
              {
                header: 'Referer',
                operation: 'set',
                value: 'https://www.xiaoyuzhoufm.com/'
              },
              {
                header: 'User-Agent',
                operation: 'set',
                value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
              },
              {
                header: 'Accept-Language',
                operation: 'set',
                value: 'zh-CN,zh;q=0.9,en;q=0.8'
              }
            ]
          },
          condition: {
            urlFilter: '*://*.xyzcdn.net/*',
            resourceTypes: ['xmlhttprequest']
          }
        }
      ]
    });
    
    log("Initial declarative Net Request rules set up successfully.");
  } catch (error) {
    log("Error setting up Declarative Net Request rules:", error);
  }
}

// 根据租户域名动态添加飞书API请求规则
export async function addFeishuApiRules(tenantDomain) {
  try {
    if (!tenantDomain) {
      log("No tenant domain provided, skipping Feishu API rules setup.");
      return;
    }
    
    if (currentTenantDomain === tenantDomain) {
      log("Tenant domain unchanged, skipping Feishu API rules update.");
      return;
    }
    
    log(`Updating Feishu API rules for new tenant domain: ${tenantDomain}`);
    
    // 移除现有的飞书API规则（ID为2和3的规则）
    const feishuRuleIds = [2, 3];
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: feishuRuleIds
    });
    log(`Removed existing Feishu API rules: ${feishuRuleIds.join(', ')}`);
    
    // 打印更新前的规则
    const rulesBeforeUpdate = await chrome.declarativeNetRequest.getDynamicRules();
    log("Rules before update:", JSON.stringify(rulesBeforeUpdate, null, 2));

    // 确定API域名
    let apiDomain = tenantDomain;
    if (tenantDomain.endsWith('.feishu.cn')) {
      apiDomain = 'internal-api.feishu.cn';
    } else if (tenantDomain.endsWith('.larkoffice.com')) {
      apiDomain = 'internal-api.larkoffice.com';
    }
    
    // 添加新的飞书API规则
    const newRules = [];
    
    // 规则2：为租户域名设置Referer头
    newRules.push({
      id: 2,
      priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            header: 'Referer',
            operation: 'set',
            value: `https://${tenantDomain}/minutes/home/`
          },
          {
            header: 'Origin',
            operation: 'set',
            value: `https://${tenantDomain}`
          }
        ]
      },
      condition: {
        urlFilter: `*://${tenantDomain}/*`,
        resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']
      }
    });
    
    // 规则3：为API域名设置Referer头
    newRules.push({
      id: 3,
      priority: 3,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          {
            header: 'Referer',
            operation: 'set',
            value: `https://${tenantDomain}/minutes/home/`
          },
          {
            header: 'Origin',
            operation: 'set',
            value: `https://${tenantDomain}`
          }
        ]
      },
      condition: {
        urlFilter: `*://${apiDomain}/*`,
        resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other']
      }
    });
    
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: newRules
    });
    
    // 打印更新后的规则
    const rulesAfterUpdate = await chrome.declarativeNetRequest.getDynamicRules();
    log("Rules after update:", JSON.stringify(rulesAfterUpdate, null, 2));
    
    // 更新当前租户域名
    currentTenantDomain = tenantDomain;
    
    log(`Feishu API rules added successfully for tenant domain: ${tenantDomain} and API domain: ${apiDomain}`);

  } catch (error) {
    log("Error adding Feishu API rules:", error);
  }
}