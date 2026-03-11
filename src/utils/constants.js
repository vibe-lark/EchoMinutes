// src/utils/constants.js

// 飞书妙记 API 路径（不包含域名，域名将动态获取）
export const FEATURES_ENABLE_PATH = "/minutes/api/get_features_enable";
export const QUOTA_API_PATH = "/minutes/api/quota";
export const UPLOAD_PREPARE_PATH = "/minutes/api/upload/prepare";
export const UPLOAD_FINISH_PATH = "/minutes/api/upload/finish";

// 飞书妙记文件上传 API 路径（不包含域名，域名将动态获取）
export const BOX_UPLOAD_BLOCKS_PATH = "/space/api/box/upload/blocks";
export const BOX_STREAM_UPLOAD_MERGE_BLOCK_PATH = "/space/api/box/stream/upload/merge_block/";
export const BOX_UPLOAD_FINISH_PATH = "/space/api/box/upload/finish/";

// 上传相关常量
export const BLOCK_SIZE = 4 * 1024 * 1024; // 4MB per block, as required by Feishu API

// Telemetry configuration
export const TELEMETRY_ENDPOINT = null; // Configure with your collector endpoint if remote reporting is required
