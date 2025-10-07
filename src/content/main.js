// src/content/main.js

// Check if the script has already been injected
if (window.echoBatContentScriptInitialized) {
  console.log('[EchoBat Content Script] Content script already initialized.');
} else {
  window.echoBatContentScriptInitialized = true;
  console.log('[EchoBat Content Script] Content script loaded.');

  initializeUI();

  function initializeUI() {
    // 立即尝试添加按钮，不等待 MutationObserver
    tryAddButton();
    
    // 同时使用 MutationObserver 监听 DOM 变化
    const observer = new MutationObserver(() => {
      tryAddButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
  
  function tryAddButton() {
    // 添加明显的调试信息
    console.log('[EchoBat Content Script] tryAddButton called');
    
    const audioElement = document.querySelector('audio[src^="https://media.xyzcdn.net/"]');
    const albumNameElement = document.querySelector('#__next > div > main > header > div.jsx-399326063.podcast-title > a.jsx-399326063.name');
    const titleElement = document.querySelector('#__next > div > main > header > h1.jsx-399326063.title');
    const podcastTitleContainer = document.querySelector('#__next > div > main > header > div.jsx-399326063.podcast-title');
    
    // 添加调试日志
    console.log('[EchoBat Content Script] Audio element found:', !!audioElement);
    console.log('[EchoBat Content Script] Album name element found:', !!albumNameElement);
    console.log('[EchoBat Content Script] Title element found:', !!titleElement);
    console.log('[EchoBat Content Script] Podcast title container found:', !!podcastTitleContainer);
    
    if (albumNameElement) {
      console.log('[EchoBat Content Script] Album name element details:', {
        className: albumNameElement.className,
        textContent: albumNameElement.textContent,
        hasAttribute: albumNameElement.hasAttribute('data-echo-bat-button-added'),
        attributeValue: albumNameElement.getAttribute('data-echo-bat-button-added'),
        innerHTML: albumNameElement.innerHTML.substring(0, 100) + '...', // 显示部分HTML内容
        outerHTML: albumNameElement.outerHTML.substring(0, 200) + '...' // 显示部分外部HTML内容
      });
    }
    
    if (titleElement) {
      console.log('[EchoBat Content Script] Title element details:', {
        className: titleElement.className,
        textContent: titleElement.textContent,
        innerHTML: titleElement.innerHTML.substring(0, 100) + '...', // 显示部分HTML内容
        outerHTML: titleElement.outerHTML.substring(0, 200) + '...' // 显示部分外部HTML内容
      });
    }
    
    if (podcastTitleContainer) {
      console.log('[EchoBat Content Script] Podcast title container details:', {
        className: podcastTitleContainer.className,
        innerHTML: podcastTitleContainer.innerHTML.substring(0, 200) + '...' // 显示部分HTML内容
      });
    }

    if (audioElement && albumNameElement && titleElement && podcastTitleContainer && !albumNameElement.dataset.echoBatButtonAdded) {
      console.log('[EchoBat Content Script] Required elements found. Injecting button.');
      albumNameElement.dataset.echoBatButtonAdded = 'true';

      // 获取专辑名称和标题文本
      const albumName = albumNameElement.textContent.trim();
      const titleText = titleElement.textContent.trim();
      
      // 获取"展开Show Notes"元素的样式
      const expandElement = document.querySelector('div.jsx-3916805124.expand');
      let expandStyles = null;
      
      if (expandElement) {
        console.log('[EchoBat Content Script] Expand element found, extracting styles...');
        const computedStyle = window.getComputedStyle(expandElement);
        expandStyles = {
          backgroundColor: computedStyle.backgroundColor,
          color: computedStyle.color,
          padding: computedStyle.padding,
          borderRadius: computedStyle.borderRadius,
          fontSize: computedStyle.fontSize,
          fontWeight: computedStyle.fontWeight,
          border: computedStyle.border,
          boxShadow: computedStyle.boxShadow
        };
        console.log('[EchoBat Content Script] Extracted expand styles:', expandStyles);
      } else {
        console.log('[EchoBat Content Script] Expand element not found, using default styles');
      }
      
      console.log('[EchoBat Content Script] Album name found:', `"${albumName}"`); // 添加调试日志
      console.log('[EchoBat Content Script] Title text found:', `"${titleText}"`); // 添加调试日志
      console.log('[EchoBat Content Script] Album name length:', albumName.length); // 添加调试日志
      console.log('[EchoBat Content Script] Title text length:', titleText.length); // 添加调试日志
      console.log('[EchoBat Content Script] Album name type:', typeof albumName); // 添加调试日志
      console.log('[EchoBat Content Script] Title text type:', typeof titleText); // 添加调试日志
      
      const button = createUploadButton(audioElement.src, titleText, albumName, expandStyles);
      
      // 直接将按钮添加到podcast-title容器中，与标题处于同一行
      podcastTitleContainer.appendChild(button);
      console.log('[EchoBat Content Script] Button successfully added to the page.');
    } else if (albumNameElement && albumNameElement.dataset.echoBatButtonAdded) {
      console.log('[EchoBat Content Script] Button already added to this album name element.');
    } else {
      console.log('[EchoBat Content Script] Cannot add button. Missing elements:', {
        hasAudio: !!audioElement,
        hasAlbumName: !!albumNameElement,
        hasTitle: !!titleElement,
        hasPodcastTitleContainer: !!podcastTitleContainer,
        buttonAlreadyAdded: albumNameElement ? !!albumNameElement.dataset.echoBatButtonAdded : false
      });
    }
  }
  
  // 将 createUploadButton 函数内联到 main.js 中
  function createUploadButton(mediaUrl, titleText = '', albumName = '', expandStyles = null) {
    console.log('[EchoBat Content Script] createUploadButton called with title:', `"${titleText}"`); // 添加调试日志
    console.log('[EchoBat Content Script] createUploadButton called with album name:', `"${albumName}"`); // 添加调试日志
    console.log('[EchoBat Content Script] createUploadButton title type:', typeof titleText); // 添加调试日志
    console.log('[EchoBat Content Script] createUploadButton title length:', titleText.length); // 添加调试日志
    
    // 创建主容器 - 这个容器将包含文案容器
    const container = document.createElement('div');
    container.className = 'echo-bat-container';
    
    // 创建状态显示区域 - 这个区域将直接作为主要交互元素
    const statusContainer = document.createElement('div');
    statusContainer.className = 'echo-bat-status-container';
    // 状态容器现在始终显示，不再初始隐藏
    
    // 创建状态文本元素
    const statusText = document.createElement('div');
    statusText.className = 'echo-bat-status-text';
    statusText.textContent = '上传到飞书妙记'; // 设置默认文案
    statusContainer.appendChild(statusText);
    
    // 创建"去查看"链接元素（初始隐藏）
    const viewLink = document.createElement('a');
    viewLink.className = 'echo-bat-view-link';
    viewLink.textContent = '去查看';
    viewLink.href = 'https://feishu.cn/minutes/home';
    viewLink.target = '_blank'; // 在新标签页中打开
    viewLink.style.display = 'none'; // 初始隐藏
    statusContainer.appendChild(viewLink);
    
    // 创建进度条容器
    const progressContainer = document.createElement('div');
    progressContainer.className = 'echo-bat-progress-container';
    progressContainer.style.display = 'none'; // 初始隐藏
    
    // 创建进度条
    const progressBar = document.createElement('div');
    progressBar.className = 'echo-bat-progress-bar';
    progressContainer.appendChild(progressBar);
    
    // 将所有元素添加到主容器
    container.appendChild(statusContainer);
    container.appendChild(progressContainer);

    // 内联 injectCSS 函数
    injectCSS(expandStyles);
    
    // 点击事件 - 直接在文案容器上添加点击事件
    statusContainer.addEventListener('click', () => {
      // 如果上传成功或失败，则不允许再次点击（除非刷新页面）
      if (statusContainer.classList.contains('upload-success') || statusContainer.classList.contains('upload-error')) {
        return;
      }
      
      // 如果正在处理中，则不重复点击
      if (statusContainer.classList.contains('active')) {
        return;
      }
      
      // 设置激活状态
      statusContainer.classList.add('active');
      progressContainer.style.display = 'none';
      statusText.textContent = '📥 正在下载音频...';
      viewLink.style.display = 'none'; // 隐藏"去查看"链接
      
      console.log(`[EchoBat Content Script] Sending upload request for URL: ${mediaUrl} with title: "${titleText}" and album name: "${albumName}"`);
      console.log('[EchoBat Content Script] Title type:', typeof titleText); // 添加调试日志
      console.log('[EchoBat Content Script] Title length:', titleText.length); // 添加调试日志

      // 发送URL和标题给background script，让background script处理文件下载和命名
      const message = { 
        action: 'uploadFile', 
        url: mediaUrl,
        title: titleText,
        albumName: albumName // 添加专辑名称
      };
      console.log('[EchoBat Content Script] Message to be sent:', JSON.stringify(message)); // 添加调试日志
      console.log('[EchoBat Content Script] Message title field:', message.title); // 添加调试日志
      console.log('[EchoBat Content Script] Message albumName field:', message.albumName); // 添加调试日志
      console.log('[EchoBat Content Script] Message title type:', typeof message.title); // 添加调试日志
      
      // 监听来自后台脚本的状态更新
      const statusListener = (request, sender, sendResponse) => {
        if (request.action === 'updateUploadStatus') {
          updateStatus(request.status, request.progress);
        }
      };
      
      // 添加状态监听器
      chrome.runtime.onMessage.addListener(statusListener);
      
      // 更新状态的函数
      function updateStatus(status, progress = null) {
        statusText.textContent = status;
        
        // 如果有进度信息，显示进度条
        if (progress !== null) {
          progressContainer.style.display = 'block';
          progressBar.style.width = `${progress}%`;
        } else {
          progressContainer.style.display = 'none';
        }
        
        // 根据状态更新样式
        if (status.includes('成功')) {
          statusText.classList.add('success');
          statusContainer.classList.add('upload-success'); // 添加成功状态类
          
          // 显示"去查看"链接
          viewLink.style.display = 'inline-block';
          
          // 不再自动重置状态，永久显示上传成功状态
        } else if (status.includes('错误') || status.includes('失败')) {
          statusText.classList.add('error');
          statusContainer.classList.add('upload-error'); // 添加错误状态类
          
          // 不再自动重置状态，永久显示上传失败状态，但允许重新点击尝试
          statusContainer.classList.remove('active'); // 移除激活状态，允许重新点击
        }
      }
      
      // 重置按钮状态的函数 - 仅在成功或失败时调用
      function resetButton() {
        statusContainer.classList.remove('active');
        progressContainer.style.display = 'none';
        statusText.classList.remove('success', 'error');
        progressBar.style.width = '0%';
        statusText.textContent = '上传到飞书妙记'; // 重置为默认文案
        viewLink.style.display = 'none'; // 隐藏"去查看"链接
        
        // 移除状态监听器
        chrome.runtime.onMessage.removeListener(statusListener);
      }
      
      chrome.runtime.sendMessage(message, (response) => {
        if (response && response.success) {
          updateStatus('🎉 上传成功');
        } else {
          updateStatus(`❌ 上传失败: ${response ? response.message : '未知错误'}`);
        }
      });
    });

    return container;
  }
  
  // 内联 injectCSS 函数
  function injectCSS(expandStyles = null) {
    // 检查CSS是否已经注入
    if (document.getElementById('echo-bat-css')) {
      return;
    }
    
    const iconUrl = chrome.runtime.getURL('images/logo.png');
    const styleSheet = document.createElement("style");
    styleSheet.id = 'echo-bat-css';
    
    // 根据expandStyles动态生成状态容器的样式
    let statusContainerStyles = '';
    let bubbleTailColor = 'rgba(200, 180, 255, 0.2)'; // 默认淡紫色
    
    if (expandStyles) {
      // 提取原始颜色值
      const originalColor = expandStyles.color;
      
      // 将RGB颜色转换为RGBA，并降低透明度以创建浅色背景
      function createLightBackground(color) {
        // 如果是RGB格式
        const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1]);
          const g = parseInt(rgbMatch[2]);
          const b = parseInt(rgbMatch[3]);
          return `rgba(${r}, ${g}, ${b}, 0.15)`; // 使用15%的透明度
        }
        
        // 如果是RGBA格式
        const rgbaMatch = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
        if (rgbaMatch) {
          const r = parseInt(rgbaMatch[1]);
          const g = parseInt(rgbaMatch[2]);
          const b = parseInt(rgbaMatch[3]);
          return `rgba(${r}, ${g}, ${b}, 0.15)`; // 使用15%的透明度
        }
        
        // 如果是十六进制格式
        const hexMatch = color.match(/#([0-9a-f]{6})/i);
        if (hexMatch) {
          const hex = hexMatch[1];
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          return `rgba(${r}, ${g}, ${b}, 0.15)`; // 使用15%的透明度
        }
        
        // 默认返回淡紫色背景
        return 'rgba(200, 180, 255, 0.2)';
      }
      
      const lightBackground = createLightBackground(originalColor);
      bubbleTailColor = lightBackground; // 保存背景颜色用于对话气泡尾部
      
      statusContainerStyles = `
        background-color: ${lightBackground}; /* 使用同色系的浅色背景 */
        color: ${originalColor}; /* 使用原始颜色作为字体颜色 */
        padding: 6px 9px; /* 从8px 12px缩小到6px 9px，缩小到0.75倍 */
        border-radius: 6px; /* 从8px缩小到6px，缩小到0.75倍 */
        font-size: 12px; /* 修改为12px加粗 */
        font-weight: bold; /* 设置为加粗 */
        border: none;
        box-shadow: none; /* 去掉阴影效果 */
        cursor: pointer; /* 添加指针样式，表示可点击 */
        transition: all 0.2s ease; /* 添加过渡效果 */
      `;
    } else {
      // 如果没有获取到expandStyles，使用默认样式
      statusContainerStyles = `
        background-color: rgba(200, 180, 255, 0.2); /* 淡紫色背景 */
        color: #663399; /* 暗紫色字体 */
        padding: 6px 9px; /* 从8px 12px缩小到6px 9px，缩小到0.75倍 */
        border-radius: 6px; /* 从8px缩小到6px，缩小到0.75倍 */
        font-size: 12px; /* 修改为12px加粗 */
        font-weight: bold; /* 设置为加粗 */
        border: none;
        box-shadow: none; /* 去掉阴影效果 */
        cursor: pointer; /* 添加指针样式，表示可点击 */
        transition: all 0.2s ease; /* 添加过渡效果 */
      `;
    }
    
    styleSheet.textContent = `
      .echo-bat-container {
        position: relative;
        display: inline-flex; /* 使用inline-flex确保在同一行显示 */
        align-items: center;
        vertical-align: middle;
        margin-left: 10px; /* 添加左边距，与标题有一定间隔 */
      }
      
      .echo-bat-status-container {
        position: relative; /* 使用relative定位，相对于父容器定位 */
        left: 0; /* 重置left值 */
        top: 0; /* 重置top值 */
        transform: none; /* 重置transform */
        ${statusContainerStyles}
        white-space: nowrap; /* 防止文本换行 */
        overflow: hidden; /* 隐藏溢出内容 */
        text-overflow: ellipsis; /* 使用省略号表示溢出文本 */
        z-index: 2147483647; /* 使用最大可能的z-index值 */
        width: auto; /* 自动适应内容宽度 */
        min-width: auto; /* 移除最小宽度限制 */
        max-width: none; /* 移除最大宽度限制，完全自适应 */
        text-align: center; /* 文本居中对齐 */
        display: inline-flex; /* 使用inline-flex确保内部元素在同一行显示 */
        align-items: center; /* 垂直居中对齐 */
        line-height: 1.5; /* 增加行高，提高可读性 */
        margin-left: 4px; /* 减小左边距，缩小与按钮的间隙 */
      }
       
      .echo-bat-status-text {
        color: inherit; /* 继承父容器的颜色 */
      }
      
      .echo-bat-view-link {
        color: inherit; /* 继承父容器的颜色 */
        text-decoration: underline; /* 添加下划线 */
        margin-left: 5px; /* 添加左边距 */
        font-weight: inherit; /* 继承父容器的字体粗细 */
      }
      
      .echo-bat-progress-container {
        width: 100%;
        height: 4px;
        background-color: rgba(0, 0, 0, 0.1);
        border-radius: 2px;
        margin-top: 4px;
        overflow: hidden;
      }
      
      .echo-bat-progress-bar {
        height: 100%;
        background-color: #663399; /* 使用与字体相同的颜色 */
        border-radius: 2px;
        transition: width 0.3s ease;
      }
      
      .echo-bat-status-text.success {
        color: #4caf50; /* 成功状态使用绿色 */
      }
      
      .echo-bat-status-text.error {
        color: #f44336; /* 错误状态使用红色 */
      }
    `;
    document.head.appendChild(styleSheet);
  }
}