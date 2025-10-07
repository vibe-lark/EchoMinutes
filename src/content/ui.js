// src/content/ui.js

import { log } from '../utils/log.js';

const iconUrl = chrome.runtime.getURL('images/Crobat.png');

injectCSS();

function injectCSS() {
  const styleSheet = document.createElement("style");
  styleSheet.textContent = `
    .echo-bat-upload-container {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      margin-left: 16px;
      border-radius: 50%;
      background: transparent;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      vertical-align: middle;
      flex-shrink: 0;
      z-index: 2147483647; /* 使用最大可能的z-index值 */
    }
    .echo-bat-upload-button {
      width: 100%;
      height: 100%;
      padding: 0;
      border: none;
      background-color: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .echo-bat-icon {
      width: 24px;
      height: 24px;
      background-image: url(${iconUrl});
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      transition: transform 0.3s;
    }
    .echo-bat-button-text {
      white-space: nowrap; /* 防止文本换行 */
      overflow: hidden; /* 隐藏溢出内容 */
      text-overflow: ellipsis; /* 使用省略号表示溢出文本 */
      position: fixed; /* 使用fixed定位，相对于视口定位 */
      left: 45px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 12px;
      font-weight: 500;
      opacity: 1; /* 文本始终显示 */
      transition: opacity 0.2s, transform 0.3s;
      color: #333;
      background-color: rgba(255, 255, 255, 0.98); /* 增加不透明度 */
      padding: 12px 18px; /* 增加内边距 */
      border-radius: 6px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2); /* 增强阴影效果 */
      z-index: 2147483647; /* 使用最大可能的z-index值 */
      width: auto; /* 自动适应内容宽度 */
      min-width: 140px; /* 增加最小宽度 */
      max-width: 350px; /* 增加最大宽度 */
      text-align: center; /* 文本居中对齐 */
      line-height: 1.5; /* 增加行高，提高可读性 */
      border: 1px solid rgba(0, 0, 0, 0.1); /* 添加边框，增强可见性 */
    }
    .echo-bat-upload-container.expanded {
      width: auto; /* 自动适应内容宽度 */
      min-width: 150px; /* 设置最小宽度 */
      max-width: 300px; /* 设置最大宽度，防止过长 */
      border-radius: 20px;
      background-color: #f0f0f0;
    }
    .echo-bat-upload-container.expanded .echo-bat-button-text {
      opacity: 1;
      transform: translateX(0);
      white-space: normal; /* 允许文本换行 */
      word-wrap: break-word; /* 允许长单词换行 */
      word-break: break-word; /* 允许在任何字符处换行 */
    }
    .echo-bat-upload-container.loading .echo-bat-icon {
      animation: spin 1s linear infinite;
    }
    .echo-bat-upload-container.success {
      background-color: #4CAF50;
    }
     .echo-bat-upload-container.success .echo-bat-button-text {
      color: white;
    }
    .echo-bat-upload-container.error {
      background-color: #F44336;
    }
    .echo-bat-upload-container.error .echo-bat-button-text {
      color: white;
    }
    .echo-bat-wrapper {
      display: flex;
      align-items: center;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleSheet);
}

export function createUploadButton(mediaUrl, titleText = '', albumText = '') {
  console.log('[EchoBat Content Script] createUploadButton called with title:', `"${titleText}"`); // 添加调试日志
  console.log('[EchoBat Content Script] createUploadButton called with album:', `"${albumText}"`); // 添加调试日志
  console.log('[EchoBat Content Script] createUploadButton title type:', typeof titleText); // 添加调试日志
  console.log('[EchoBat Content Script] createUploadButton title length:', titleText.length); // 添加调试日志
  
  const container = document.createElement('div');
  container.className = 'echo-bat-upload-container';

  const button = document.createElement('button');
  button.className = 'echo-bat-upload-button';
  button.innerHTML = `
    <div class="echo-bat-icon"></div>
    <span class="echo-bat-button-text">上传到飞书妙记</span>
  `;
  container.appendChild(button);

  // 文本始终显示，不需要hover效果
  // container.addEventListener('mouseenter', () => container.classList.add('expanded'));
  // container.addEventListener('mouseleave', () => container.classList.remove('expanded'));

  button.addEventListener('click', () => {
    container.classList.add('loading');
    container.classList.remove('expanded');
    
    // 更新按钮文本为上传状态
    const buttonText = container.querySelector('.echo-bat-button-text');
    buttonText.textContent = '📥 正在上传...';
    
    console.log(`[EchoBat Content Script] Sending upload request for URL: ${mediaUrl} with title: "${titleText}" and album: "${albumText}"`);
    console.log('[EchoBat Content Script] Title type:', typeof titleText); // 添加调试日志
    console.log('[EchoBat Content Script] Title length:', titleText.length); // 添加调试日志

    // 发送URL和标题给background script，让background script处理文件下载和命名
    const message = { 
      action: 'uploadFile', 
      url: mediaUrl,
      title: titleText,
      albumName: albumText // 添加专辑名称
    };
    console.log('[EchoBat Content Script] Message to be sent:', JSON.stringify(message)); // 添加调试日志
    console.log('[EchoBat Content Script] Message title field:', message.title); // 添加调试日志
    console.log('[EchoBat Content Script] Message albumName field:', message.albumName); // 添加调试日志
    console.log('[EchoBat Content Script] Message title type:', typeof message.title); // 添加调试日志
    
    chrome.runtime.sendMessage(message, (response) => {
      container.classList.remove('loading');
      if (response && response.success) {
        container.classList.add('success');
        buttonText.textContent = '🎉 上传成功';
        
        // 创建"去查看"链接
        const viewLink = document.createElement('a');
        viewLink.textContent = '去查看';
        viewLink.href = 'https://feishu.cn/minutes/home';
        viewLink.target = '_blank';
        viewLink.style.color = '#2196F3';
        viewLink.style.textDecoration = 'none';
        viewLink.style.fontWeight = '500';
        viewLink.style.marginLeft = '8px';
        viewLink.style.padding = '2px 6px';
        viewLink.style.borderRadius = '4px';
        viewLink.style.transition = 'all 0.3s';
        
        // 添加悬停效果
        viewLink.addEventListener('mouseenter', () => {
          viewLink.style.color = '#1976D2';
          viewLink.style.textDecoration = 'underline';
          viewLink.style.backgroundColor = 'rgba(33, 150, 243, 0.1)';
        });
        
        viewLink.addEventListener('mouseleave', () => {
          viewLink.style.color = '#2196F3';
          viewLink.style.textDecoration = 'none';
          viewLink.style.backgroundColor = 'transparent';
        });
        
        // 将链接添加到按钮文本后面
        buttonText.parentNode.appendChild(viewLink);
        
        console.log('[EchoBat Content Script] Upload successful:', response.data);
      } else {
        container.classList.add('error');
        buttonText.textContent = '❌ 上传失败';
        console.log('[EchoBat Content Script] Upload failed:', response ? response.message : 'No response from background script.');
      }
      // Reset state after a few seconds
      setTimeout(() => {
        container.classList.remove('success', 'error');
        buttonText.textContent = '上传到飞书妙记'; // 重置为默认文本
        
        // 移除"去查看"链接（如果存在）
        const existingLink = buttonText.parentNode.querySelector('a');
        if (existingLink) {
          existingLink.remove();
        }
      }, 10000); // 增加时间以便用户点击链接
    });
  });

  return container;
}