// src/background/upload.js

import { log } from '../utils/log.js';
import { getFeishuCredentials, invalidateCredentials, getTenantDomain, buildApiUrl } from '../utils/credentials.js';
import { addFeishuApiRules } from './network.js';
import { v4 } from '../utils/uuid.js';
import {
    QUOTA_API_PATH,
    UPLOAD_PREPARE_PATH,
    BOX_UPLOAD_BLOCKS_PATH,
    BOX_STREAM_UPLOAD_MERGE_BLOCK_PATH,
    BOX_UPLOAD_FINISH_PATH,
    UPLOAD_FINISH_PATH
} from '../utils/constants.js';

// Helper function to calculate Adler32 checksum
// 直接复制自 adler-32 库的实现
function adler32_buf(buf, seed) {
    var a = 1, b = 0, L = buf.length, M = 0;
    if(typeof seed === 'number') { a = seed & 0xFFFF; b = (seed >>> 16) & 0xFFFF; }
    for(var i = 0; i < L;) {
        M = Math.min(L-i, 2654)+i;
        for(;i<M;i++) {
            a += buf[i]&0xFF;
            b += a;
        }
        a = (15*(a>>>16)+(a&65535));
        b = (15*(b>>>16)+(b&65535));
    }
    return ((b%65521) << 16) | (a%65521);
}

// Helper function to calculate Adler32 checksum using adler-32 library
function calculateBlockChecksum(buffer) {
    // 使用 adler-32 库计算校验和，与 test.js 一致
    const checksum = adler32_buf(buffer) >>> 0; // 转换为无符号整数
    return String(checksum);
}

// Helper function to calculate SHA256 hash
async function sha256(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return btoa(String.fromCharCode.apply(null, new Uint8Array(hashBuffer)));
}

// Generate random device ID for better privacy
function generateRandomDeviceId() {
    // 生成19位随机数字ID，避免使用固定值
    return Math.floor(Math.random() * 9000000000000000000) + 1000000000000000000;
}

// 安全的fetch包装函数，包含超时和错误处理
async function secureFetch(url, options = {}, timeoutMs = 30000) {
    // 创建超时控制器
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            // 安全配置，但不覆盖用户提供的选项
            mode: 'cors',
            cache: 'no-cache',
            credentials: 'include',
            ...options, // 用户选项在后面，可以覆盖默认设置
        });

        clearTimeout(timeoutId);

        // 检查响应状态
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeoutMs}ms`);
        }

        throw error;
    }
}

// Main upload function, rewritten to follow test.js logic
async function uploadFile(message, sender) {
    const { url, title, albumName } = message; // 添加albumName参数
    log("Starting upload process for URL:", url);
    log("Received title:", title); // 添加调试日志
    log("Received album name:", albumName); // 添加调试日志
    log("Title type:", typeof title); // 添加调试日志
    log("Title length:", title ? title.length : 'undefined'); // 添加调试日志
    log("Full message object:", JSON.stringify(message)); // 添加调试日志

    // 发送状态更新到内容脚本
    function sendStatusUpdate(status, progress = null) {
        if (sender && sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
                action: 'updateUploadStatus',
                status: status,
                progress: progress
            }).catch(err => {
                log("Failed to send status update to content script:", err);
            });
        }
    }

    // 1. Fetch the audio file
    sendStatusUpdate('📥 正在下载音频...');
    const response = await secureFetch(url, {}, 60000); // 60秒超时，因为音频文件可能较大
    const arrayBuffer = await response.arrayBuffer();
    
    // 使用标题作为文件名，如果没有标题则使用URL中的文件名
    let fileName;
    if (title && title.trim()) {
        // 清理标题，移除不适合作为文件名的字符
        const cleanTitle = title.trim().replace(/[\\/:*?"<>|]/g, '').substring(0, 100);
        // 获取URL中的文件扩展名
        const urlPath = new URL(url).pathname;
        const extension = urlPath.split('.').pop() || 'mp3';
        
        // 如果有专辑名，将专辑名添加到文件名最前方，格式为 [专辑名] - 标题名
        if (albumName && albumName.trim()) {
            const cleanAlbumName = albumName.trim().replace(/[\\/:*?"<>|]/g, '').substring(0, 50);
            fileName = `[${cleanAlbumName}] - ${cleanTitle}.${extension}`;
        } else {
            fileName = `${cleanTitle}.${extension}`;
        }
        log("Using title as filename:", fileName); // 添加调试日志
    } else {
        fileName = new URL(url).pathname.split('/').pop() || 'audio.mp3';
        log("Using URL filename as fallback:", fileName); // 添加调试日志
    }
    
    const file = {
        name: fileName,
        size: arrayBuffer.byteLength,
        type: response.headers.get('content-type') || 'audio/mpeg',
        buffer: arrayBuffer
    };
    log("File downloaded:", file.name, `${(file.size / 1024 / 1024).toFixed(2)} MB`);

    // 2. Get Feishu credentials
    sendStatusUpdate('🔄 正在获取飞书登录态...');
    const credentials = await getFeishuCredentials();
    log("Got Feishu credentials.");
    
    // 获取租户域名
    const tenantDomain = credentials.tenantDomain || await getTenantDomain();
    log("Using tenant domain:", tenantDomain);
    
    // 确保网络规则已设置
    if (tenantDomain) {
        await addFeishuApiRules(tenantDomain);
    }

    // 3. Step 1 from PRD: Quota Check
    sendStatusUpdate('🔍 正在检查妙记额度...');
    const fileInfo = `${v4()}_${file.size}`;
    const quotaUrl = `${buildApiUrl(QUOTA_API_PATH, tenantDomain)}?file_info[]=${fileInfo}&language=zh_cn`;
    
    // 记录安全的请求信息（不包含敏感数据）
    log("Quota check request URL:", quotaUrl);
    log("Quota check request info:", {
        'Content-Type': 'application/json; charset=utf-8',
        'hasCsrfToken': !!credentials.csrfToken,
        'hasCookie': !!credentials.cookie,
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    });
    
    const quotaResponse = await secureFetch(quotaUrl, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'bv-csrf-token': credentials.csrfToken,
            'Cookie': credentials.cookie,
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }
    }).then(res => {
        // 记录响应信息（安全的）
        log("Quota check response status:", res.status);
        return res.json();
    }).then(data => {
        // 记录响应数据
        log("Quota check response data:", data);
        return data;
    }).catch(error => {
        // 记录错误信息
        log("Quota check request error:", error);
        throw error;
    });

    if (quotaResponse.code !== 0 || !quotaResponse.data.has_quota) {
        // 检查是否是认证错误，如果是则标记凭证为过期
        if (quotaResponse.code === 401 || quotaResponse.code === 403 || 
            (quotaResponse.msg && (quotaResponse.msg.includes('认证') || quotaResponse.msg.includes('登录') || quotaResponse.msg.includes('token')))) {
            log("Authentication error detected, invalidating credentials.");
            await invalidateCredentials();
        }
        sendStatusUpdate(`❌ 额度检查失败: ${quotaResponse.msg || 'Not enough quota'}`);
        throw new Error(`Quota check failed: ${quotaResponse.msg || 'Not enough quota'}`);
    }
    const uploadToken = quotaResponse.data.upload_token[fileInfo];
    if (!uploadToken) {
        sendStatusUpdate('❌ 获取上传令牌失败');
        throw new Error("Failed to get upload_token from quota API response.");
    }
    log("Step 1/6: Quota check passed, got upload_token.");

    // 4. Step 2 from PRD: Upload Prepare
    sendStatusUpdate('📤 正在上传 10%...');
    const fileHeader = btoa(String.fromCharCode.apply(null, new Uint8Array(file.buffer.slice(0, 256))));
    const preparePayload = {
        name: file.name,
        file_size: file.size,
        file_header: fileHeader,
        drive_upload: true,
        upload_token: uploadToken,
        language: "zh_cn"
    };
    
    // 记录安全的请求信息（不包含敏感数据）
    const prepareUrl = buildApiUrl(UPLOAD_PREPARE_PATH, tenantDomain);
    log("Upload prepare request URL:", prepareUrl);
    log("Upload prepare request payload:", preparePayload);
    log("Upload prepare request info:", {
        'Content-Type': 'application/json; charset=utf-8',
        'hasCsrfToken': !!credentials.csrfToken,
        'hasCookie': !!credentials.cookie,
    });
    
    const prepareResponse = await secureFetch(prepareUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'bv-csrf-token': credentials.csrfToken,
            'Cookie': credentials.cookie,
        },
        body: JSON.stringify(preparePayload)
    }).then(res => {
        // 记录响应信息
        log("Upload prepare response status:", res.status);
        log("Upload prepare response headers:", res.headers);
        return res.json();
    }).then(data => {
        // 记录响应数据
        log("Upload prepare response data:", data);
        return data;
    }).catch(error => {
        // 记录错误信息
        log("Upload prepare request error:", error);
        throw error;
    });

    if (prepareResponse.code !== 0) {
        // 检查是否是认证错误，如果是则标记凭证为过期
        if (prepareResponse.code === 401 || prepareResponse.code === 403 || 
            (prepareResponse.msg && (prepareResponse.msg.includes('认证') || prepareResponse.msg.includes('登录') || prepareResponse.msg.includes('token')))) {
            log("Authentication error detected in upload prepare, invalidating credentials.");
            await invalidateCredentials();
        }
        sendStatusUpdate(`❌ 上传准备失败: ${prepareResponse.msg}`);
        throw new Error(`Upload prepare failed: ${prepareResponse.msg}`);
    }
    const { upload_id, block_size, num_blocks, vhid, object_token } = prepareResponse.data;
    log("Step 2/6: Upload prepared.", { upload_id, num_blocks });

    // 5. Step 3 from PRD: Second-pass Upload Check
    sendStatusUpdate('📤 正在上传 20%...');
    const blocks = [];
    for (let i = 0; i < num_blocks; i++) {
        const start = i * block_size;
        const end = Math.min(start + block_size, file.size);
        const chunk = file.buffer.slice(start, end);
        const chunkUint8 = new Uint8Array(chunk);
        
        blocks.push({
            seq: i,
            size: chunk.byteLength,
            checksum: calculateBlockChecksum(chunkUint8),
            hash: await sha256(chunk)
        });
    }

    const blocksPayload = { upload_id, blocks };
    
    // 记录安全的请求信息（不包含敏感数据）
    const blocksUrl = buildApiUrl(BOX_UPLOAD_BLOCKS_PATH, tenantDomain);
    log("Blocks upload request URL:", blocksUrl);
    log("Blocks upload request payload:", blocksPayload);
    log("Blocks upload request info:", {
        'Content-Type': 'application/json; charset=utf-8',
        'hasCsrfToken': !!credentials.csrfToken,
        'hasCookie': !!credentials.cookie,
    });
    
    const blocksResponse = await secureFetch(blocksUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'bv-csrf-token': credentials.csrfToken,
            'Cookie': credentials.cookie,
        },
        body: JSON.stringify(blocksPayload)
    }).then(res => {
        // 记录响应信息
        log("Blocks upload response status:", res.status);
        log("Blocks upload response headers:", res.headers);
        return res.json();
    }).then(data => {
        // 记录响应数据
        log("Blocks upload response data:", data);
        return data;
    }).catch(error => {
        // 记录错误信息
        log("Blocks upload request error:", error);
        throw error;
    });

    if (blocksResponse.code !== 0) {
        // 检查是否是认证错误，如果是则标记凭证为过期
        if (blocksResponse.code === 401 || blocksResponse.code === 403 || 
            (blocksResponse.message && (blocksResponse.message.includes('认证') || blocksResponse.message.includes('登录') || blocksResponse.message.includes('token')))) {
            log("Authentication error detected in blocks check, invalidating credentials.");
            await invalidateCredentials();
        }
        sendStatusUpdate(`❌ 第二次检查失败: ${blocksResponse.message}`);
        throw new Error(`Second-pass check failed: ${blocksResponse.message}`);
    }
    const neededUploadBlocks = blocksResponse.data.needed_upload_blocks || [];
    log(`Step 3/6: Second-pass check complete. ${neededUploadBlocks.length} blocks need uploading.`);

    // 6. Step 4 from PRD: Chunked Upload (with batching and correct headers from test.js)
    if (neededUploadBlocks.length > 0) {
        log(`Starting upload of ${neededUploadBlocks.length} blocks.`);
        
        // 按照分块序号顺序进行上传，确保所有分块都被正确上传
        // 每批次上传4个分块，最后一批可能少于4个
        const batchSize = 4;
        const uploadOrder = [];
        
        // 按照分块序号排序
        const sortedBlocks = [...neededUploadBlocks].sort((a, b) => a.seq - b.seq);
        
        // 分批处理
        for (let i = 0; i < sortedBlocks.length; i += batchSize) {
            uploadOrder.push(sortedBlocks.slice(i, i + batchSize));
        }
        
        const neededBlocksInfo = new Map(blocks.map(b => [b.seq, b]));
        
        // 逐批次上传
        for (let i = 0; i < uploadOrder.length; i++) {
            const batch = uploadOrder[i];
            if (batch.length === 0) continue;
            
            // 更新进度
            const progress = 30 + Math.floor((i / uploadOrder.length) * 50);
            sendStatusUpdate(`📤 正在上传 ${progress}%...`, progress);
            
            // 创建当前批次的块序号列表，用于 x-seq-list
            const seqList = batch.map(block => block.seq).join(',');
            
            // 创建当前批次的 x-block-list-checksum，即当前批次中所有块的校验和的列表
            const batchFullInfo = batch.map(b => neededBlocksInfo.get(b.seq));
            const blockListChecksum = batchFullInfo.map(b => b.checksum).join(',');

            // 创建一个包含当前批次所有块数据的缓冲区
            let totalSize = 0;
            for (const block of batchFullInfo) {
                totalSize += block.size;
            }
            
            const allChunksBuffer = new Uint8Array(totalSize);
            let offset = 0;
            for (const block of batchFullInfo) {
                const start = block.seq * block_size;
                const end = start + block.size;
                const chunk = file.buffer.slice(start, end);
                
                // 将块数据复制到总缓冲区中
                allChunksBuffer.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
            }
            
            // 构造块上传的URL，使用/stream/upload/merge_block/端点并只包含upload_id参数
            const mergeUrl = `${buildApiUrl(BOX_STREAM_UPLOAD_MERGE_BLOCK_PATH, tenantDomain)}?upload_id=${upload_id}`;
            
            // 构造块上传的请求头，参考test.js中的说明
            const uploadHeaders = {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'zh-CN,zh;q=0.9',
                'bv-csrf-token': credentials.csrfToken,
                'content-type': 'application/octet-stream',
                'Cookie': credentials.cookie,
                'device-id': generateRandomDeviceId(),
                'origin': `https://${tenantDomain}`,
                'platform': 'web',
                'priority': 'u=1, i',
                'referer': `https://${tenantDomain}/minutes/home/`,
                'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"macOS"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-site',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
                'utc-bias': '480',
                'x-block-list-checksum': blockListChecksum, // 使用当前批次中所有块的校验和的列表
                'x-block-origin-size': String(neededUploadBlocks[0].size), // 始终使用 seq 0 块的大小值
                'x-lgw-os-type': '3',
                'x-lgw-terminal-type': '2',
                'x-seq-list': seqList, // 使用当前批次中所有需要上传的块序号列表
                'x-b-auth-token': uploadToken,
            };

            log(`Uploading batch (${allChunksBuffer.length} bytes) to ${mergeUrl}`);
        log(`Batch seq list: ${seqList}`);
        log(`Batch block list checksum: ${blockListChecksum}`);
        log(`Batch x-block-origin-size: ${neededUploadBlocks[0].size}`);
        
        // 记录安全的请求信息（不包含敏感数据）
        log(`Block upload request URL (batch ${i+1}):`, mergeUrl);
        log(`Block upload request info (batch ${i+1}):`, {
            'accept': uploadHeaders['accept'],
            'content-type': uploadHeaders['content-type'],
            'hasCsrfToken': !!uploadHeaders['bv-csrf-token'],
            'hasCookie': !!uploadHeaders['Cookie'],
            'origin': uploadHeaders['origin'],
            'referer': uploadHeaders['referer'],
            'x-seq-list': uploadHeaders['x-seq-list'],
            'dataSize': allChunksBuffer.length
        });
        
        const uploadBlockResponse = await secureFetch(mergeUrl, {
            method: 'POST',
            headers: uploadHeaders,
            body: allChunksBuffer.buffer
        }, 60000).then(res => { // 60秒超时，因为上传可能较慢
            // 记录响应信息
            log(`Block upload response status (batch ${i+1}):`, res.status);
            log(`Block upload response headers (batch ${i+1}):`, res.headers);
            return res;
        }).catch(error => {
            // 记录错误信息
            log(`Block upload request error (batch ${i+1}):`, error);
            throw error;
        });

            if (!uploadBlockResponse.ok) {
                const errorText = await uploadBlockResponse.text();
                log(`Upload error response text: ${errorText}`);
                
                // 检查是否是认证错误，如果是则标记凭证为过期
                if (uploadBlockResponse.status === 401 || uploadBlockResponse.status === 403 || 
                    (errorText && (errorText.includes('认证') || errorText.includes('登录') || errorText.includes('token')))) {
                    log("Authentication error detected in block upload, invalidating credentials.");
                    await invalidateCredentials();
                }
                
                sendStatusUpdate(`❌ 上传失败: ${errorText}`);
                throw new Error(`Upload failed with status ${uploadBlockResponse.status}: ${errorText}`);
            }

            const responseData = await uploadBlockResponse.json();
            if (responseData.code !== 0) {
                // 检查是否是认证错误，如果是则标记凭证为过期
                if (responseData.code === 401 || responseData.code === 403 || 
                    (responseData.message && (responseData.message.includes('认证') || responseData.message.includes('登录') || responseData.message.includes('token')))) {
                    log("Authentication error detected in block upload response, invalidating credentials.");
                    await invalidateCredentials();
                }
                sendStatusUpdate(`❌ 批次上传失败: ${responseData.message}`);
                throw new Error(`Failed to upload batch ${seqList}: ${responseData.message}`);
            }
            log(`Batch ${seqList} uploaded successfully.`);
        }
        log("Step 4/6: All required blocks uploaded.");
    } else {
        log("Step 4/6: No blocks needed uploading (all hit second-pass).");
    }

    // 7. Step 5 from PRD: Mark Box Upload Finish
    sendStatusUpdate('📤 正在上传 90%...');
    const boxFinishPayload = {
        upload_id: upload_id,
        num_blocks: num_blocks,
        vhid: vhid,
        risk_detection_extra: JSON.stringify({ file_operate_usage: 3, locale: "zh_cn" }),
        language: "zh_cn"
    };
    log("Step 5/6: Marking Box upload as finished with payload:", JSON.stringify(boxFinishPayload));
    const boxFinishResponse = await secureFetch(buildApiUrl(BOX_UPLOAD_FINISH_PATH, tenantDomain), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'bv-csrf-token': credentials.csrfToken,
            'Cookie': credentials.cookie,
        },
        body: JSON.stringify(boxFinishPayload)
    }).then(res => {
        log("Box finish response status:", res.status);
        return res.json();
    });

    log("Box finish response:", JSON.stringify(boxFinishResponse));
    if (boxFinishResponse.code !== 0) {
        // 检查是否是认证错误，如果是则标记凭证为过期
        if (boxFinishResponse.code === 401 || boxFinishResponse.code === 403 || 
            (boxFinishResponse.message && (boxFinishResponse.message.includes('认证') || boxFinishResponse.message.includes('登录') || boxFinishResponse.message.includes('token')))) {
            log("Authentication error detected in box finish, invalidating credentials.");
            await invalidateCredentials();
        }
        sendStatusUpdate(`❌ 标记上传完成失败: ${boxFinishResponse.message || boxFinishResponse.msg}`);
        throw new Error(`Marking Box upload finish failed: ${boxFinishResponse.message || boxFinishResponse.msg}`);
    }
    log("Step 5/6: Marked Box upload as finished.");

    // 8. Step 6 from PRD: Mark Minutes Upload Finish
    sendStatusUpdate('📤 正在上传 95%...');
    const minutesFinishPayload = {
        auto_transcribe: true,
        language: "mixed",
        num_blocks: num_blocks,
        object_token: object_token,
        upload_id: upload_id,
        upload_token: uploadToken,
        vhid: vhid
    };
    const minutesFinishResponse = await secureFetch(buildApiUrl(UPLOAD_FINISH_PATH, tenantDomain), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'bv-csrf-token': credentials.csrfToken,
            'Cookie': credentials.cookie,
        },
        body: JSON.stringify(minutesFinishPayload)
    }).then(res => res.json());

    if (minutesFinishResponse.code !== 0) {
        // 检查是否是认证错误，如果是则标记凭证为过期
        if (minutesFinishResponse.code === 401 || minutesFinishResponse.code === 403 || 
            (minutesFinishResponse.message && (minutesFinishResponse.message.includes('认证') || minutesFinishResponse.message.includes('登录') || minutesFinishResponse.message.includes('token')))) {
            log("Authentication error detected in minutes finish, invalidating credentials.");
            await invalidateCredentials();
        }
        sendStatusUpdate(`❌ 妙记上传完成失败: ${minutesFinishResponse.message || minutesFinishResponse.msg}`);
        throw new Error(`Marking Minutes upload finish failed: ${minutesFinishResponse.message || minutesFinishResponse.msg}`);
    }

    sendStatusUpdate('🎉 上传成功');
    log("Step 6/6: Upload finished successfully! File sent to Feishu Minutes.");
    return { success: true, data: minutesFinishResponse.data };
}

export function setupUploadListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'uploadFile') {
            log("Received uploadFile message.");
            log("Full message details:", JSON.stringify(message)); // 添加调试日志
            (async () => {
                try {
                    const result = await uploadFile(message, sender);
                    sendResponse(result);
                } catch (error) {
                    log("Error during upload process in background:", error);
                    sendResponse({ success: false, message: error.toString() });
                }
            })();
            return true; // Indicates that the response is sent asynchronously
        }
    });
}