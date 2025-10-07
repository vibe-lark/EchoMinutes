// src/utils/credentials.js

import { log } from './log.js';
// 移除debugger依赖，改用更安全的方式
import { FEATURES_ENABLE_PATH } from './constants.js';
import { addFeishuApiRules } from '../background/network.js';

export const feishuCredentials = {
  csrfToken: null,
  cookie: null,
  uploadToken: null,
  lastUpdated: 0,
  tenantDomain: null, // 添加租户域名存储
};

// 凭证过期时间（30分钟，进一步减少风险）
const CREDENTIAL_EXPIRY_TIME = 30 * 60 * 1000;

// 凭证验证函数
function validateCredentials(credentials) {
  if (!credentials) return false;

  // 检查必要字段
  if (!credentials.csrfToken || !credentials.cookie || !credentials.tenantDomain) {
    return false;
  }

  // 检查CSRF token格式（应该是一个长字符串）
  if (credentials.csrfToken.length < 10) {
    return false;
  }

  // 检查Cookie格式（应该包含认证相关信息）
  if (!credentials.cookie.includes('=')) {
    return false;
  }

  // 检查租户域名格式
  if (!credentials.tenantDomain.includes('feishu') && !credentials.tenantDomain.includes('lark')) {
    return false;
  }

  return true;
}

// 简单的Cookie值混淆（基础安全措施，不是真正的加密）
function obfuscateCookie(cookieString) {
  if (!cookieString) return cookieString;
  // 使用Base64编码作为基础混淆
  return btoa(cookieString);
}

function deobfuscateCookie(obfuscatedString) {
  if (!obfuscatedString) return obfuscatedString;
  try {
    return atob(obfuscatedString);
  } catch {
    return obfuscatedString; // 如果解码失败，返回原值
  }
}

// 尝试从本地存储加载凭证
async function loadCredentialsFromStorage() {
  try {
    const result = await chrome.storage.local.get(['feishuCredentials']);
    if (result.feishuCredentials) {
      const { csrfToken, cookie, uploadToken, lastUpdated, tenantDomain } = result.feishuCredentials;
      
      // 检查凭证是否过期（1小时内有效）
      const isExpired = lastUpdated && (Date.now() - lastUpdated > CREDENTIAL_EXPIRY_TIME);
      if (csrfToken && cookie && !isExpired) {
        const decodedCookie = deobfuscateCookie(cookie);
        const credentialsToValidate = {
          csrfToken,
          cookie: decodedCookie,
          tenantDomain
        };

        // 验证凭证完整性和格式
        if (validateCredentials(credentialsToValidate)) {
          feishuCredentials.csrfToken = csrfToken;
          feishuCredentials.cookie = decodedCookie;
          feishuCredentials.uploadToken = uploadToken;
          feishuCredentials.lastUpdated = lastUpdated;
          feishuCredentials.tenantDomain = tenantDomain;

          log("Loaded and validated credentials from local storage.", {
            hasCsrf: !!csrfToken,
            hasCookie: !!cookie,
            cookieObfuscatedLength: cookie.length,
            lastUpdated: new Date(lastUpdated).toISOString(),
            tenantDomain: tenantDomain
          });

          return true;
        } else {
          log("Stored credentials failed validation, clearing...");
          await chrome.storage.local.remove(['feishuCredentials']);
          return false;
        }
      } else if (isExpired) {
        log("Credentials in local storage have expired.");
        // 清理过期的凭证
        await chrome.storage.local.remove(['feishuCredentials']);
      } else {
        log("Credentials in local storage are incomplete.");
      }
    } else {
      log("No credentials found in local storage.");
    }
  } catch (error) {
    log("Error loading credentials from local storage:", error);
  }
  
  return false;
}

// 保存凭证到本地存储
async function saveCredentialsToStorage() {
  try {
    await chrome.storage.local.set({
      feishuCredentials: {
        csrfToken: feishuCredentials.csrfToken,
        cookie: obfuscateCookie(feishuCredentials.cookie), // 混淆Cookie后存储
        uploadToken: feishuCredentials.uploadToken,
        lastUpdated: feishuCredentials.lastUpdated,
        tenantDomain: feishuCredentials.tenantDomain // 保存租户域名
      }
    });
    
    log("Credentials saved to local storage.", {
      hasCsrf: !!feishuCredentials.csrfToken,
      hasCookie: !!feishuCredentials.cookie,
      cookieRawLength: feishuCredentials.cookie ? feishuCredentials.cookie.length : 0,
      lastUpdated: new Date(feishuCredentials.lastUpdated).toISOString(),
      tenantDomain: feishuCredentials.tenantDomain
    });
  } catch (error) {
    log("Error saving credentials to local storage:", error);
  }
}

// 从 URL 中提取租户域名
function extractTenantDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname; // 返回完整的域名，如 bytedance.larkoffice.com
  } catch (error) {
    log("Error extracting tenant domain from URL:", url, error);
    return null;
  }
}

// 构建 API 端点 URL
export function buildApiUrl(path, tenantDomain) {
  if (!tenantDomain) {
    log("Warning: No tenant domain provided, using default domain");
    return `https://digitalsolution.feishu.cn${path}`; // 默认域名
  }
  
  // 根据路径类型决定使用哪个域名
  if (path.startsWith('/space/api/')) {
    // Box API 使用特定的域名前缀，根据租户域名的后缀决定
    if (tenantDomain.endsWith('.feishu.cn')) {
      return `https://internal-api-space.feishu.cn${path}`;
    } else if (tenantDomain.endsWith('.larkoffice.com')) {
      return `https://internal-api-space.larkoffice.com${path}`;
    } else {
      // 其他情况，默认使用 feishu.cn 的域名
      log("Warning: Unknown tenant domain suffix for Box API, using feishu.cn domain");
      return `https://internal-api-space.feishu.cn${path}`;
    }
  } else {
    // 其他 API 直接使用租户域名
    return `https://${tenantDomain}${path}`;
  }
}

// 关闭指定的飞书妙记页面
async function closeFeishuTab(tabId) {
  try {
    if (tabId) {
      log(`Closing Feishu Minutes tab with ID: ${tabId}`);
      await chrome.tabs.remove(tabId);
    }
  } catch (error) {
    log("Error closing Feishu tab:", error);
  }
}

// Listen for network requests to capture the CSRF token and tenant domain
chrome.webRequest.onBeforeSendHeaders.addListener(
    async (details) => {
        // 只监听飞书相关域名的 get_features_enable 请求
        if (details.url.includes('/minutes/api/get_features_enable') &&
            (details.url.includes('.feishu.cn') || details.url.includes('.larkoffice.com'))) {
            log("Found matching request to get_features_enable, looking for CSRF token and tenant domain.");
            log("Request URL:", details.url);
            
            // 提取租户域名
            const tenantDomain = extractTenantDomain(details.url);
            if (tenantDomain) {
                // 检查是否是用户期望的租户域名（bytedance.larkoffice.com）
                if (tenantDomain === 'bytedance.larkoffice.com' || feishuCredentials.tenantDomain !== tenantDomain) {
                    feishuCredentials.tenantDomain = tenantDomain;
                    feishuCredentials.lastUpdated = Date.now();
                    log("Successfully captured/updated tenant domain.", {
                        tenantDomain: tenantDomain,
                        lastUpdated: new Date(feishuCredentials.lastUpdated).toISOString()
                    });
                    
                    // 保存更新后的凭证
                    await saveCredentialsToStorage();
                    
                    // 动态添加飞书API请求规则
                    await addFeishuApiRules(tenantDomain);
                }
            }
            
            // 查找 CSRF token
            const csrfHeader = details.requestHeaders.find(h => h.name.toLowerCase() === 'bv-csrf-token');

            if (csrfHeader && csrfHeader.value) {
                if (feishuCredentials.csrfToken !== csrfHeader.value) {
                    feishuCredentials.csrfToken = csrfHeader.value;
                    feishuCredentials.lastUpdated = Date.now();
                    log("Successfully captured/updated bv-csrf-token.", {
                        hasCsrf: !!feishuCredentials.csrfToken,
                        lastUpdated: new Date(feishuCredentials.lastUpdated).toISOString()
                    });
                    
                    // 保存更新后的凭证
                    await saveCredentialsToStorage();
                }
            } else {
                log("bv-csrf-token header not found in request to get_features_enable.");
                log("Available headers:", details.requestHeaders.map(h => h.name));
            }
        }
    },
  { urls: [
    "https://*.feishu.cn/*",
    "https://*.larkoffice.com/*"
  ]},
  ["requestHeaders"]
);

// 获取租户域名的函数
export async function getTenantDomain() {
  // 首先尝试从本地存储加载凭证
  const loadedFromStorage = await loadCredentialsFromStorage();
  if (loadedFromStorage && feishuCredentials.tenantDomain) {
    log("Using tenant domain from local storage:", feishuCredentials.tenantDomain);
    
    // 动态添加飞书API请求规则
    await addFeishuApiRules(feishuCredentials.tenantDomain);
    
    return feishuCredentials.tenantDomain;
  }
  
  // 如果本地存储中没有租户域名，则尝试从当前活动标签页获取
  log("No tenant domain in local storage. Trying to detect from active tab...");
  
  try {
    const activeTabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (activeTabs && activeTabs.length > 0) {
      const activeTab = activeTabs[0];
      if (activeTab.url && (activeTab.url.includes('.feishu.cn') || activeTab.url.includes('.larkoffice.com'))) {
        const urlObj = new URL(activeTab.url);
        const tenantDomain = urlObj.hostname;
        log("Detected tenant domain from active tab:", tenantDomain);
        
        // 保存租户域名
        feishuCredentials.tenantDomain = tenantDomain;
        await saveCredentialsToStorage();
        
        // 动态添加飞书API请求规则
        await addFeishuApiRules(tenantDomain);
        
        return tenantDomain;
      }
    }
  } catch (e) {
    log("Error getting active tab URL:", e);
  }
  
  // 如果无法从活动标签页获取，则使用默认域名
  log("Could not detect tenant domain from active tab. Using default domain.");
  feishuCredentials.tenantDomain = "digitalsolution.feishu.cn";
  await saveCredentialsToStorage();
  
  return feishuCredentials.tenantDomain;
}

// Function to get credentials. It's now async and uses chrome.debugger API for HttpOnly cookies.
export async function getFeishuCredentials() {
    log("getFeishuCredentials called. Current CSRF state:", {
        hasCsrf: !!feishuCredentials.csrfToken,
        tenantDomain: feishuCredentials.tenantDomain
    });

    // 首先尝试从本地存储加载凭证
    const loadedFromStorage = await loadCredentialsFromStorage();
    if (loadedFromStorage) {
        // 只要有凭证就使用，不检查有效期
        if (feishuCredentials.csrfToken && feishuCredentials.cookie) {
            log("Using credentials from local storage.");
            
            // 确保网络规则已设置
            if (feishuCredentials.tenantDomain) {
                await addFeishuApiRules(feishuCredentials.tenantDomain);
            }
            
            return {
                cookie: feishuCredentials.cookie,
                csrfToken: feishuCredentials.csrfToken,
                uploadToken: feishuCredentials.uploadToken,
                tenantDomain: feishuCredentials.tenantDomain
            };
        }
    }

    // 如果本地存储中没有凭证，则获取新的凭证
    log("No credentials in local storage. Fetching new credentials...");
    
    // 声明 feishuTabId 变量，使其在整个函数中可用
    let feishuTabId = null;
    
    // 如果没有CSRF令牌，等待一段时间尝试获取
    if (!feishuCredentials.csrfToken) {
        log("CSRF Token not found. Waiting for it to be captured...");
        
        // 尝试打开飞书妙记页面以获取CSRF令牌
        try {
            log("Opening Feishu Minutes page in background to capture CSRF token...");
            
            // 首先尝试获取当前活动标签页的URL，以确定租户域名
            let tenantDomain = feishuCredentials.tenantDomain;
            if (!tenantDomain) {
                try {
                    const activeTabs = await chrome.tabs.query({active: true, currentWindow: true});
                    if (activeTabs && activeTabs.length > 0) {
                        const activeTab = activeTabs[0];
                        if (activeTab.url && (activeTab.url.includes('.feishu.cn') || activeTab.url.includes('.larkoffice.com'))) {
                            const urlObj = new URL(activeTab.url);
                            tenantDomain = urlObj.hostname;
                            log("Detected tenant domain from active tab:", tenantDomain);
                            
                            // 保存租户域名
                            feishuCredentials.tenantDomain = tenantDomain;
                            await saveCredentialsToStorage();
                        }
                    }
                } catch (e) {
                    log("Error getting active tab URL:", e);
                }
            }
            
            // 根据租户域名构建飞书妙记页面URL
            let feishuUrl;
            if (tenantDomain) {
                feishuUrl = `https://${tenantDomain}/minutes/home`;
                log("Using tenant-specific Feishu Minutes URL:", feishuUrl);
            } else {
                feishuUrl = "https://feishu.cn/minutes/home";
                log("Using default Feishu Minutes URL:", feishuUrl);
            }
            
            // 在后台打开页面，不激活，并且设置较小的窗口尺寸使其更加隐蔽
            const tab = await chrome.tabs.create({ 
                url: feishuUrl,
                active: false,  // 不激活标签页，保持在后台
                index: 999  // 将标签页放在最后，减少被用户注意到的可能性
            });
            feishuTabId = tab.id;
            
            // 等待页面加载和CSRF令牌捕获
            let attempts = 0;
            const maxAttempts = 15; // 增加尝试次数，因为需要等待页面加载
            
            while (attempts < maxAttempts) {
                // 检查是否已经获取到CSRF令牌
                if (feishuCredentials.csrfToken) {
                    log("CSRF Token successfully captured after opening Feishu Minutes page.");
                    break;
                }
                
                // 等待2秒，给页面更多加载时间
                await new Promise(resolve => setTimeout(resolve, 2000));
                attempts++;
                
                log(`Waiting for CSRF Token... Attempt ${attempts}/${maxAttempts}`);
            }
            
            // 如果仍然没有获取到CSRF令牌，提示用户登录
            if (!feishuCredentials.csrfToken) {
                log("Failed to capture CSRF Token after opening Feishu Minutes page.");
                return Promise.reject("无法获取飞书妙记的登录信息，请确保您已登录飞书妙记。如果已登录，请刷新页面后重试。");
            }
        } catch (e) {
            log("Error opening Feishu Minutes page:", e);
            return Promise.reject("无法打开飞书妙记页面，请检查网络连接或手动打开飞书妙记页面。");
        }
    }

    // 使用更安全的 chrome.cookies API 获取 Cookie
    try {
        // 使用租户域名获取必要的 cookies（仅获取认证相关的Cookie）
        const domain = feishuCredentials.tenantDomain || "feishu.cn";
        const cookies = await chrome.cookies.getAll({domain: domain});

        // 过滤只获取飞书特定的必要认证相关Cookie
        const feishuEssentialCookiePatterns = [
            /^session/i,
            /^sessionid/i,
            /^csrftoken/i,
            /^_csrf/i,
            /^bv_session/i,
            /^bv_csrf/i,
            /^uid/i,
            /^sid/i,
            /^ssoid/i,
            /^passport/i,
            /^auth/i,
            /^login/i,
            /^feishu/i,
            /^lark/i,
            // 飞书特定的Cookie名称
            /^t_/i,
            /^lk_/i
        ];

        const filteredCookies = cookies.filter(cookie => {
            // 使用正则表达式进行更精确的匹配
            return feishuEssentialCookiePatterns.some(pattern =>
                pattern.test(cookie.name)
            ) &&
            // 排除明显的跟踪和广告Cookie
            !cookie.name.toLowerCase().includes('_ga') &&
            !cookie.name.toLowerCase().includes('_gid') &&
            !cookie.name.toLowerCase().includes('_fbp') &&
            !cookie.name.toLowerCase().includes('_utm') &&
            !cookie.name.toLowerCase().includes('analytics');
        });

        if (filteredCookies.length > 0) {
            const cookieString = filteredCookies.map(c => `${c.name}=${c.value}`).join('; ');
            log("Successfully retrieved essential cookies using chrome.cookies API. Details:", {
                totalCount: cookies.length,
                filteredCount: filteredCookies.length,
                filteredCookieNames: filteredCookies.map(c => c.name),
                domain: domain
            });

            feishuCredentials.cookie = cookieString;
            feishuCredentials.lastUpdated = Date.now();

            // 保存凭证到本地存储
            await saveCredentialsToStorage();

            // 关闭飞书妙记页面（如果 feishuTabId 存在）
            if (feishuTabId) {
                await closeFeishuTab(feishuTabId);
            }

            return {
                cookie: cookieString,
                csrfToken: feishuCredentials.csrfToken,
                uploadToken: feishuCredentials.uploadToken,
                tenantDomain: feishuCredentials.tenantDomain
            };
        } else {
            log("No cookies found for domain:", domain);
            throw new Error(`No Feishu cookies found for domain: ${domain}. Please ensure you are logged in.`);
        }
    } catch (error) {
        log("Cookie retrieval failed:", error);

        // 关闭飞书妙记页面（如果 feishuTabId 存在）
        if (feishuTabId) {
            await closeFeishuTab(feishuTabId);
        }

        return Promise.reject(`无法获取飞书Cookie，请确保您已登录飞书妙记。错误信息: ${error.toString()}`);
    }
}

// 标记凭证为过期，通常在请求失败时调用
export async function invalidateCredentials() {
    log("Invalidating credentials due to failed request.");
    feishuCredentials.csrfToken = null;
    feishuCredentials.cookie = null;
    feishuCredentials.uploadToken = null;
    feishuCredentials.tenantDomain = null; // 清除租户域名
    feishuCredentials.lastUpdated = 0;
    
    try {
        await chrome.storage.local.remove(['feishuCredentials']);
        log("Credentials removed from local storage.");
    } catch (error) {
        log("Error removing credentials from local storage:", error);
    }
}