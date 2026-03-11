/**
 * 浏览器端音视频合并模块
 * 正确处理 Bilibili DASH fMP4 格式的音视频合并
 * 
 * fMP4 结构说明：
 * - ftyp: 文件类型标识
 * - moov: 元数据容器，包含 mvhd 和 trak
 * - sidx: 段索引（可选）
 * - moof + mdat: 媒体片段（可重复）
 */

(function() {
'use strict';

async function mergeAudioVideo(videoBuffer, audioBuffer, options = {}) {
    const { onProgress } = options;
    
    console.log('[Muxer] 开始合并音视频');
    console.log(`[Muxer] 视频大小: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[Muxer] 音频大小: ${(audioBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
    
    if (onProgress) onProgress(5, '解析视频流');
    
    const videoData = new Uint8Array(videoBuffer);
    const audioData = new Uint8Array(audioBuffer);
    
    const videoBoxes = parseMP4Boxes(videoData);
    const audioBoxes = parseMP4Boxes(audioData);
    
    console.log('[Muxer] 视频 Box 结构:', videoBoxes.map(b => `${b.type}(${b.size})`).join(', '));
    console.log('[Muxer] 音频 Box 结构:', audioBoxes.map(b => `${b.type}(${b.size})`).join(', '));
    
    if (onProgress) onProgress(15, '解析音频流');
    
    const outputChunks = [];
    
    if (onProgress) onProgress(25, '构建文件头');
    
    const ftypBox = videoBoxes.find(b => b.type === 'ftyp');
    if (ftypBox) {
        outputChunks.push(ftypBox.data);
    } else {
        outputChunks.push(createFtypBox());
    }
    
    if (onProgress) onProgress(35, '合并元数据');
    
    const videoMoov = videoBoxes.find(b => b.type === 'moov');
    const audioMoov = audioBoxes.find(b => b.type === 'moov');
    
    if (videoMoov && audioMoov) {
        console.log('[Muxer] 合并 moov boxes');
        const mergedMoov = mergeMoovBoxes(videoMoov.data, audioMoov.data);
        outputChunks.push(mergedMoov);
    } else if (videoMoov) {
        console.log('[Muxer] 仅使用视频 moov');
        outputChunks.push(videoMoov.data);
    }
    
    if (onProgress) onProgress(50, '处理视频片段');
    
    const videoFragments = videoBoxes.filter(b => b.type === 'moof' || b.type === 'mdat');
    const audioFragments = audioBoxes.filter(b => b.type === 'moof' || b.type === 'mdat');
    
    console.log(`[Muxer] 视频片段数: ${videoFragments.length}`);
    console.log(`[Muxer] 音频片段数: ${audioFragments.length}`);
    
    let videoMoofIndex = 0;
    let audioMoofIndex = 0;
    
    for (let i = 0; i < videoFragments.length; i++) {
        const box = videoFragments[i];
        if (box.type === 'moof') {
            const modifiedMoof = updateMoofTrackId(box.data, 1, ++videoMoofIndex);
            outputChunks.push(modifiedMoof);
        } else {
            outputChunks.push(box.data);
        }
    }
    
    if (onProgress) onProgress(70, '处理音频片段');
    
    for (let i = 0; i < audioFragments.length; i++) {
        const box = audioFragments[i];
        if (box.type === 'moof') {
            const modifiedMoof = updateMoofTrackId(box.data, 2, ++audioMoofIndex);
            outputChunks.push(modifiedMoof);
        } else {
            outputChunks.push(box.data);
        }
    }
    
    if (onProgress) onProgress(90, '生成输出文件');
    
    const totalLength = outputChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of outputChunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    
    if (onProgress) onProgress(100, '合并完成');
    
    console.log(`[Muxer] 合并完成，输出大小: ${(result.byteLength / 1024 / 1024).toFixed(2)} MB`);
    
    return result.buffer;
}

function createFtypBox() {
    const ftyp = new Uint8Array([
        0x00, 0x00, 0x00, 0x18,
        0x66, 0x74, 0x79, 0x70,
        0x69, 0x73, 0x6F, 0x6D,
        0x00, 0x00, 0x02, 0x00,
        0x69, 0x73, 0x6F, 0x6D,
        0x69, 0x73, 0x6F, 0x32,
    ]);
    return ftyp;
}

function parseMP4Boxes(data) {
    const boxes = [];
    let offset = 0;
    
    while (offset < data.length) {
        if (offset + 8 > data.length) break;
        
        let size = readUint32(data, offset);
        const type = readString(data, offset + 4, 4);
        
        let headerSize = 8;
        
        if (size === 1) {
            if (offset + 16 > data.length) break;
            size = readUint64(data, offset + 8);
            headerSize = 16;
        } else if (size === 0) {
            size = data.length - offset;
        }
        
        if (size < headerSize || offset + size > data.length) {
            console.warn(`[Muxer] 无效的 box: type=${type}, size=${size}, offset=${offset}`);
            break;
        }
        
        boxes.push({
            type,
            size,
            headerSize,
            offset,
            data: data.slice(offset, offset + size)
        });
        
        offset += size;
    }
    
    return boxes;
}

function mergeMoovBoxes(videoMoov, audioMoov) {
    const videoChildren = parseChildBoxes(videoMoov, 8);
    const audioChildren = parseChildBoxes(audioMoov, 8);
    
    const mvhd = videoChildren.find(b => b.type === 'mvhd');
    const videoTrak = videoChildren.find(b => b.type === 'trak');
    const audioTrak = audioChildren.find(b => b.type === 'trak');
    const mvex = videoChildren.find(b => b.type === 'mvex') || audioChildren.find(b => b.type === 'mvex');
    
    if (!videoTrak || !audioTrak) {
        console.warn('[Muxer] 缺少 trak box，返回原始视频 moov');
        return videoMoov;
    }
    
    const modifiedVideoTrak = modifyTrackId(videoTrak.data, 1);
    const modifiedAudioTrak = modifyTrackId(audioTrak.data, 2);
    
    let modifiedMvhd = null;
    if (mvhd) {
        modifiedMvhd = modifyMvhdNextTrackId(mvhd.data, 3);
    }
    
    let mergedMvex = null;
    if (mvex) {
        const videoMvex = videoChildren.find(b => b.type === 'mvex');
        const audioMvex = audioChildren.find(b => b.type === 'mvex');
        mergedMvex = mergeMvexBoxes(videoMvex?.data, audioMvex?.data);
    }
    
    const chunks = [];
    if (modifiedMvhd) chunks.push(modifiedMvhd);
    chunks.push(modifiedVideoTrak);
    chunks.push(modifiedAudioTrak);
    if (mergedMvex) chunks.push(mergedMvex);
    
    const contentSize = chunks.reduce((sum, c) => sum + c.length, 0);
    const newSize = 8 + contentSize;
    
    const result = new Uint8Array(newSize);
    writeUint32(result, 0, newSize);
    writeString(result, 4, 'moov');
    
    let offset = 8;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    
    return result;
}

function mergeMvexBoxes(videoMvex, audioMvex) {
    if (!videoMvex && !audioMvex) return null;
    
    const chunks = [];
    
    if (videoMvex) {
        const videoTrex = extractChildBox(videoMvex, 'trex');
        if (videoTrex) {
            const modifiedTrex = modifyTrexTrackId(videoTrex, 1);
            chunks.push(modifiedTrex);
        }
    }
    
    if (audioMvex) {
        const audioTrex = extractChildBox(audioMvex, 'trex');
        if (audioTrex) {
            const modifiedTrex = modifyTrexTrackId(audioTrex, 2);
            chunks.push(modifiedTrex);
        }
    }
    
    if (chunks.length === 0) return null;
    
    const contentSize = chunks.reduce((sum, c) => sum + c.length, 0);
    const newSize = 8 + contentSize;
    
    const result = new Uint8Array(newSize);
    writeUint32(result, 0, newSize);
    writeString(result, 4, 'mvex');
    
    let offset = 8;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    
    return result;
}

function modifyTrexTrackId(trex, newId) {
    const result = new Uint8Array(trex);
    writeUint32(result, 12, newId);
    return result;
}

function parseChildBoxes(data, startOffset) {
    const boxes = [];
    let offset = startOffset;
    
    while (offset < data.length) {
        if (offset + 8 > data.length) break;
        
        let size = readUint32(data, offset);
        const type = readString(data, offset + 4, 4);
        
        if (size === 1) {
            if (offset + 16 > data.length) break;
            size = readUint64(data, offset + 8);
        } else if (size === 0) {
            size = data.length - offset;
        }
        
        if (size < 8 || offset + size > data.length) break;
        
        boxes.push({
            type,
            size,
            offset,
            data: data.slice(offset, offset + size)
        });
        
        offset += size;
    }
    
    return boxes;
}

function extractChildBox(data, type) {
    const children = parseChildBoxes(data, 8);
    const box = children.find(b => b.type === type);
    return box ? box.data : null;
}

function modifyMvhdNextTrackId(mvhd, nextTrackId) {
    const result = new Uint8Array(mvhd);
    const version = result[8];
    
    const nextTrackIdOffset = version === 1 ? 104 : 96;
    
    if (nextTrackIdOffset + 4 <= result.length) {
        writeUint32(result, nextTrackIdOffset, nextTrackId);
    }
    
    return result;
}

function modifyTrackId(trak, newId) {
    const result = new Uint8Array(trak);
    
    modifyBoxTrackId(result, 8, 'tkhd', newId);
    
    const mdiaOffset = findBoxOffset(result, 8, 'mdia');
    if (mdiaOffset !== -1) {
        const minfOffset = findBoxOffset(result, mdiaOffset + 8, 'minf');
        if (minfOffset !== -1) {
            const stblOffset = findBoxOffset(result, minfOffset + 8, 'stbl');
            if (stblOffset !== -1) {
                modifyStsdTrackRef(result, stblOffset + 8);
            }
        }
    }
    
    return result;
}

function modifyBoxTrackId(data, startOffset, boxType, newId) {
    let offset = startOffset;
    
    while (offset < data.length) {
        if (offset + 8 > data.length) break;
        
        const size = readUint32(data, offset);
        const type = readString(data, offset + 4, 4);
        
        if (size < 8) break;
        
        if (type === boxType) {
            if (boxType === 'tkhd') {
                const version = data[offset + 8];
                const idOffset = version === 1 ? offset + 20 : offset + 12;
                writeUint32(data, idOffset, newId);
            }
            return;
        }
        
        offset += size;
    }
}

function findBoxOffset(data, startOffset, boxType) {
    let offset = startOffset;
    
    while (offset < data.length) {
        if (offset + 8 > data.length) break;
        
        const size = readUint32(data, offset);
        const type = readString(data, offset + 4, 4);
        
        if (size < 8) break;
        
        if (type === boxType) {
            return offset;
        }
        
        offset += size;
    }
    
    return -1;
}

function modifyStsdTrackRef(data, startOffset) {
}

function updateMoofTrackId(moof, trackId, sequenceNumber) {
    const result = new Uint8Array(moof);
    
    let offset = 8;
    
    while (offset < result.length) {
        if (offset + 8 > result.length) break;
        
        const size = readUint32(result, offset);
        const type = readString(result, offset + 4, 4);
        
        if (size < 8) break;
        
        if (type === 'mfhd') {
            writeUint32(result, offset + 12, sequenceNumber);
        } else if (type === 'traf') {
            updateTrafTrackId(result, offset + 8, offset + size, trackId);
        }
        
        offset += size;
    }
    
    return result;
}

function updateTrafTrackId(data, startOffset, endOffset, trackId) {
    let offset = startOffset;
    
    while (offset < endOffset) {
        if (offset + 8 > endOffset) break;
        
        const size = readUint32(data, offset);
        const type = readString(data, offset + 4, 4);
        
        if (size < 8) break;
        
        if (type === 'tfhd') {
            writeUint32(data, offset + 12, trackId);
        }
        
        offset += size;
    }
}

function readUint32(data, offset) {
    return ((data[offset] << 24) >>> 0) + 
           ((data[offset + 1] << 16) >>> 0) + 
           ((data[offset + 2] << 8) >>> 0) + 
           (data[offset + 3] >>> 0);
}

function readUint64(data, offset) {
    const high = readUint32(data, offset);
    const low = readUint32(data, offset + 4);
    return high * 0x100000000 + low;
}

function writeUint32(data, offset, value) {
    data[offset] = (value >>> 24) & 0xff;
    data[offset + 1] = (value >>> 16) & 0xff;
    data[offset + 2] = (value >>> 8) & 0xff;
    data[offset + 3] = value & 0xff;
}

function readString(data, offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
        str += String.fromCharCode(data[offset + i]);
    }
    return str;
}

function writeString(data, offset, str) {
    for (let i = 0; i < str.length; i++) {
        data[offset + i] = str.charCodeAt(i);
    }
}

const BrowserMuxer = {
    mergeAudioVideo,
    parseMP4Boxes
};

if (typeof window !== 'undefined') {
    window.BrowserMuxer = BrowserMuxer;
}

})();
