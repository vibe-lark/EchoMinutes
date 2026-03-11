/**
 * Bilibili 视频下载 SDK
 * 适用于浏览器环境（包括浏览器插件）
 * 提供获取视频二进制数据的能力，支持自动合并音视频
 */

(function() {
'use strict';

var _BrowserMuxer = (typeof window !== 'undefined' && window.BrowserMuxer) || null;

const BILIBILI_API = {
    VIDEO_INFO: 'https://api.bilibili.com/x/web-interface/view',
    PLAY_URL: 'https://api.bilibili.com/x/player/playurl'
};

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com',
    'Origin': 'https://www.bilibili.com'
};

/**
 * 日志工具
 */
const logger = {
    enabled: true,
    prefix: '[BilibiliSDK]',
    
    log(...args) {
        if (this.enabled) console.log(this.prefix, ...args);
    },
    error(...args) {
        if (this.enabled) console.error(this.prefix, ...args);
    },
    warn(...args) {
        if (this.enabled) console.warn(this.prefix, ...args);
    }
};

/**
 * 从 Bilibili 链接中提取 BV 号或 AV 号
 * @param {string} url - Bilibili 视频链接
 * @returns {Object|null} 包含 bvid 或 aid 的对象
 */
function extractVideoId(url) {
    logger.log(`解析视频ID: ${url}`);
    
    const bvMatch = url.match(/BV[a-zA-Z0-9]+/);
    if (bvMatch) {
        logger.log(`提取到 BV号: ${bvMatch[0]}`);
        return { bvid: bvMatch[0] };
    }
    
    const avMatch = url.match(/av(\d+)/i);
    if (avMatch) {
        logger.log(`提取到 AV号: ${avMatch[1]}`);
        return { aid: avMatch[1] };
    }
    
    logger.error(`无法从链接中提取视频ID`);
    return null;
}

/**
 * 验证是否为有效的 Bilibili 链接
 * @param {string} url - 待验证的链接
 * @returns {boolean} 是否为有效的 Bilibili 链接
 */
function isValidBilibiliUrl(url) {
    const patterns = [
        /bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/,
        /bilibili\.com\/video\/av(\d+)/,
        /b23\.tv\//
    ];
    return patterns.some(pattern => pattern.test(url));
}

/**
 * 发起 HTTP 请求（兼容浏览器环境）
 * @param {string} url - 请求 URL
 * @param {Object} options - 请求选项
 * @returns {Promise<Object>} 响应数据
 */
async function httpRequest(url, options = {}) {
    const { params, headers = {}, responseType = 'json' } = options;
    
    let requestUrl = url;
    if (params) {
        const searchParams = new URLSearchParams(params);
        requestUrl = `${url}?${searchParams.toString()}`;
    }
    
    logger.log(`HTTP 请求: ${requestUrl}`);
    
    const response = await fetch(requestUrl, {
        method: 'GET',
        headers: { ...DEFAULT_HEADERS, ...headers },
        credentials: 'include'
    });
    
    logger.log(`HTTP 响应状态: ${response.status}`);
    
    if (!response.ok) {
        throw new Error(`HTTP 请求失败: ${response.status} ${response.statusText}`);
    }
    
    if (responseType === 'arraybuffer') {
        return await response.arrayBuffer();
    }
    
    return await response.json();
}

/**
 * 获取视频基本信息
 * @param {string} url - Bilibili 视频链接
 * @returns {Promise<Object>} 视频信息
 */
async function getVideoInfo(url) {
    logger.log(`开始获取视频信息: ${url}`);
    
    const videoId = extractVideoId(url);
    if (!videoId) {
        return {
            success: false,
            error: '无效的 Bilibili 链接'
        };
    }
    
    try {
        const params = videoId.bvid ? { bvid: videoId.bvid } : { aid: videoId.aid };
        
        logger.log(`请求视频信息 API: ${BILIBILI_API.VIDEO_INFO}`);
        logger.log(`请求参数: ${JSON.stringify(params)}`);
        
        const response = await httpRequest(BILIBILI_API.VIDEO_INFO, { params });
        
        logger.log(`API 响应码: ${response.code}`);
        
        if (response.code !== 0) {
            logger.error(`API 返回错误: ${response.message}`);
            return {
                success: false,
                error: response.message
            };
        }
        
        const data = response.data;
        const videoDetails = {
            title: data.title,
            bvid: data.bvid,
            aid: data.aid,
            cid: data.cid,
            duration: data.duration,
            author: data.owner.name,
            viewCount: data.stat.view,
            description: data.desc,
            cover: data.pic,
            pages: data.pages.map(p => ({
                cid: p.cid,
                page: p.page,
                part: p.part,
                duration: p.duration
            }))
        };
        
        logger.log(`视频信息解析成功:`);
        logger.log(`  - 标题: ${videoDetails.title}`);
        logger.log(`  - 作者: ${videoDetails.author}`);
        logger.log(`  - 时长: ${Math.floor(videoDetails.duration / 60)}分${videoDetails.duration % 60}秒`);
        logger.log(`  - 分P数量: ${videoDetails.pages.length}`);
        
        return {
            success: true,
            data: videoDetails
        };
    } catch (error) {
        logger.error(`获取视频信息失败: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 获取视频播放地址
 * @param {Object} videoInfo - 视频信息对象
 * @param {number} pageIndex - 分P索引（从0开始）
 * @param {number} quality - 视频质量
 * @returns {Promise<Object>} 播放地址信息
 */
async function getPlayUrl(videoInfo, pageIndex = 0, quality = 80) {
    logger.log(`获取播放地址`);
    logger.log(`分P索引: ${pageIndex}, 请求质量: ${quality}`);
    
    const page = videoInfo.pages[pageIndex];
    if (!page) {
        return {
            success: false,
            error: `分P ${pageIndex + 1} 不存在`
        };
    }
    
    try {
        const params = {
            bvid: videoInfo.bvid,
            cid: page.cid,
            qn: quality,
            fnval: 16,
            fourk: 1
        };
        
        logger.log(`请求播放地址 API: ${BILIBILI_API.PLAY_URL}`);
        logger.log(`请求参数: ${JSON.stringify(params)}`);
        
        const response = await httpRequest(BILIBILI_API.PLAY_URL, { params });
        
        logger.log(`API 响应码: ${response.code}`);
        
        if (response.code !== 0) {
            logger.error(`API 返回错误: ${response.message}`);
            return {
                success: false,
                error: response.message
            };
        }
        
        const data = response.data;
        
        let videoUrl = null;
        let audioUrl = null;
        let videoInfo_dash = null;
        let audioInfo_dash = null;
        
        if (data.dash) {
            const videos = data.dash.video || [];
            const audios = data.dash.audio || [];
            
            if (videos.length > 0) {
                videoInfo_dash = videos[0];
                videoUrl = videos[0].baseUrl || videos[0].base_url;
            }
            if (audios.length > 0) {
                audioInfo_dash = audios[0];
                audioUrl = audios[0].baseUrl || audios[0].base_url;
            }
            
            logger.log(`DASH 格式 - 视频流: ${videos.length}个, 音频流: ${audios.length}个`);
        } else if (data.durl) {
            videoUrl = data.durl[0].url;
            logger.log(`DURL 格式 - 视频地址已获取`);
        }
        
        const result = {
            success: true,
            data: {
                quality: data.quality,
                format: data.format,
                videoUrl,
                audioUrl,
                videoInfo: videoInfo_dash,
                audioInfo: audioInfo_dash,
                acceptQuality: data.accept_quality,
                acceptDescription: data.accept_description,
                isDash: !!data.dash
            }
        };
        
        logger.log(`实际质量: ${data.quality}`);
        logger.log(`格式: ${data.format}`);
        
        return result;
    } catch (error) {
        logger.error(`获取播放地址失败: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 下载二进制数据
 * @param {string} url - 下载地址
 * @param {Function} onProgress - 进度回调
 * @returns {Promise<ArrayBuffer>} 二进制数据
 */
async function downloadBinary(url, onProgress) {
    logger.log(`开始下载二进制数据: ${url.substring(0, 100)}...`);
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            ...DEFAULT_HEADERS,
            'Referer': 'https://www.bilibili.com'
        }
    });
    
    if (!response.ok) {
        throw new Error(`下载失败: ${response.status} ${response.statusText}`);
    }
    
    const contentLength = parseInt(response.headers.get('content-length'), 10);
    logger.log(`文件大小: ${(contentLength / 1024 / 1024).toFixed(2)} MB`);
    
    if (!response.body) {
        return await response.arrayBuffer();
    }
    
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;
    
    while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        if (onProgress && contentLength) {
            const progress = (receivedLength / contentLength) * 100;
            onProgress(progress, receivedLength, contentLength);
        }
    }
    
    const allChunks = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
    }
    
    logger.log(`下载完成，总大小: ${(receivedLength / 1024 / 1024).toFixed(2)} MB`);
    
    return allChunks.buffer;
}

/**
 * 获取视频的二进制数据（主要接口）
 * @param {string} url - Bilibili 视频链接
 * @param {Object} options - 下载选项
 * @param {number} options.page - 分P序号（从1开始）
 * @param {number} options.quality - 视频质量 (16: 360P, 32: 480P, 64: 720P, 80: 1080P)
 * @param {Function} options.onProgress - 进度回调 (progress, loaded, total, type)
 * @param {boolean} options.merge - 是否合并音视频为单文件（默认 true）
 * @param {Function} options.onMergeProgress - 合并进度回调 (progress, message)
 * @returns {Promise<Object>} 包含二进制数据的结果
 */
async function getVideoBinary(url, options = {}) {
    logger.log(`开始获取视频二进制数据: ${url}`);
    logger.log(`下载选项: ${JSON.stringify({ ...options, onProgress: !!options.onProgress })}`);
    
    const shouldMerge = options.merge !== false;
    
    try {
        const infoResult = await getVideoInfo(url);
        if (!infoResult.success) {
            return infoResult;
        }
        
        const videoInfo = infoResult.data;
        const pageIndex = options.page ? options.page - 1 : 0;
        const quality = options.quality || 80;
        
        const playUrlResult = await getPlayUrl(videoInfo, pageIndex, quality);
        if (!playUrlResult.success) {
            return playUrlResult;
        }
        
        const playUrl = playUrlResult.data;
        const safeTitle = videoInfo.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
        
        if (playUrl.isDash && playUrl.videoUrl && playUrl.audioUrl) {
            logger.log(`DASH 格式 - 分别下载视频和音频`);
            
            const videoProgressCallback = options.onProgress 
                ? (p, l, t) => options.onProgress(p, l, t, 'video')
                : null;
            const audioProgressCallback = options.onProgress 
                ? (p, l, t) => options.onProgress(p, l, t, 'audio')
                : null;
            
            logger.log(`开始下载视频流...`);
            const videoBuffer = await downloadBinary(playUrl.videoUrl, videoProgressCallback);
            
            logger.log(`开始下载音频流...`);
            const audioBuffer = await downloadBinary(playUrl.audioUrl, audioProgressCallback);
            
            const muxer = _BrowserMuxer || (typeof window !== 'undefined' && window.BrowserMuxer);
            
            if (shouldMerge && muxer) {
                logger.log(`开始合并音视频...`);
                try {
                    const mergedBuffer = await muxer.mergeAudioVideo(videoBuffer, audioBuffer, {
                        onProgress: options.onMergeProgress
                    });
                    
                    return {
                        success: true,
                        data: {
                            title: videoInfo.title,
                            safeTitle,
                            author: videoInfo.author,
                            duration: videoInfo.duration,
                            cover: videoInfo.cover,
                            quality: playUrl.quality,
                            isDash: true,
                            merged: true,
                            buffer: mergedBuffer,
                            size: mergedBuffer.byteLength,
                            mimeType: 'video/mp4'
                        }
                    };
                } catch (mergeError) {
                    logger.warn(`合并失败，返回分离的音视频: ${mergeError.message}`);
                }
            }
            
            return {
                success: true,
                data: {
                    title: videoInfo.title,
                    safeTitle,
                    author: videoInfo.author,
                    duration: videoInfo.duration,
                    cover: videoInfo.cover,
                    quality: playUrl.quality,
                    isDash: true,
                    merged: false,
                    video: {
                        buffer: videoBuffer,
                        size: videoBuffer.byteLength,
                        mimeType: 'video/mp4',
                        info: playUrl.videoInfo
                    },
                    audio: {
                        buffer: audioBuffer,
                        size: audioBuffer.byteLength,
                        mimeType: 'audio/mp4',
                        info: playUrl.audioInfo
                    }
                }
            };
        } else if (playUrl.videoUrl) {
            logger.log(`非 DASH 格式 - 直接下载视频`);
            
            const progressCallback = options.onProgress 
                ? (p, l, t) => options.onProgress(p, l, t, 'video')
                : null;
            
            const videoBuffer = await downloadBinary(playUrl.videoUrl, progressCallback);
            
            return {
                success: true,
                data: {
                    title: videoInfo.title,
                    safeTitle,
                    author: videoInfo.author,
                    duration: videoInfo.duration,
                    cover: videoInfo.cover,
                    quality: playUrl.quality,
                    isDash: false,
                    merged: true,
                    buffer: videoBuffer,
                    size: videoBuffer.byteLength,
                    mimeType: 'video/mp4'
                }
            };
        } else {
            return {
                success: false,
                error: '无法获取视频下载地址'
            };
        }
    } catch (error) {
        logger.error(`获取视频二进制数据失败: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 获取视频直链（不下载）
 * @param {string} url - Bilibili 视频链接
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 包含直链的结果
 */
async function getDirectUrl(url, options = {}) {
    logger.log(`获取视频直链: ${url}`);
    
    try {
        const infoResult = await getVideoInfo(url);
        if (!infoResult.success) {
            return infoResult;
        }
        
        const videoInfo = infoResult.data;
        const pageIndex = options.page ? options.page - 1 : 0;
        const quality = options.quality || 80;
        
        const playUrlResult = await getPlayUrl(videoInfo, pageIndex, quality);
        if (!playUrlResult.success) {
            return playUrlResult;
        }
        
        const playUrl = playUrlResult.data;
        
        return {
            success: true,
            data: {
                title: videoInfo.title,
                author: videoInfo.author,
                duration: videoInfo.duration,
                cover: videoInfo.cover,
                videoUrl: playUrl.videoUrl,
                audioUrl: playUrl.audioUrl,
                isDash: playUrl.isDash,
                quality: playUrl.quality,
                format: playUrl.format,
                acceptQuality: playUrl.acceptQuality,
                acceptDescription: playUrl.acceptDescription
            }
        };
    } catch (error) {
        logger.error(`获取直链失败: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 配置 SDK
 * @param {Object} config - 配置项
 * @param {boolean} config.enableLog - 是否启用日志
 */
function configure(config = {}) {
    if (typeof config.enableLog === 'boolean') {
        logger.enabled = config.enableLog;
    }
}

/**
 * 将 ArrayBuffer 转换为 Blob
 * @param {ArrayBuffer} buffer - 二进制数据
 * @param {string} mimeType - MIME 类型
 * @returns {Blob} Blob 对象
 */
function bufferToBlob(buffer, mimeType = 'video/mp4') {
    return new Blob([buffer], { type: mimeType });
}

/**
 * 将 ArrayBuffer 转换为 Base64
 * @param {ArrayBuffer} buffer - 二进制数据
 * @returns {string} Base64 字符串
 */
function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * 创建下载链接
 * @param {ArrayBuffer} buffer - 二进制数据
 * @param {string} filename - 文件名
 * @param {string} mimeType - MIME 类型
 * @returns {string} 下载 URL
 */
function createDownloadUrl(buffer, filename, mimeType = 'video/mp4') {
    const blob = bufferToBlob(buffer, mimeType);
    return URL.createObjectURL(blob);
}

const BilibiliSDK = {
    getVideoInfo,
    getVideoBinary,
    getDirectUrl,
    getPlayUrl,
    
    isValidBilibiliUrl,
    extractVideoId,
    configure,
    
    utils: {
        bufferToBlob,
        bufferToBase64,
        createDownloadUrl
    }
};

if (typeof window !== 'undefined') {
    window.BilibiliSDK = BilibiliSDK;
}

})();
