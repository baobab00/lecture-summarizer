// 네트워크 기반 미디어 URL 캡처
console.log('[Content] Script loaded at', new Date().toISOString());
const MediaCapture = {
  urls: new Set(),
  
  add(url) {
    if (!url) return;
    if (/preloader|intro/i.test(url)) return;
    if (/(\.mp4|\.m3u8|\.mpd|\.webm|\.ts)(\?|$)/i.test(url)) {
      this.urls.add(url);
    }
  },
  
  getBest() {
    const arr = Array.from(this.urls);
    const priority = (u) => {
      if (/\.mp4(\?|$)/i.test(u)) return 1;
      if (/\.m3u8(\?|$)/i.test(u)) return 2;
      if (/\.mpd(\?|$)/i.test(u)) return 3;
      return 99;
    };
    return arr.sort((a, b) => priority(a) - priority(b))[0] || null;
  }
};

// Performance API 초기 스캔
function scanExistingResources() {
  try {
    performance.getEntriesByType('resource')
      .filter(e => /(\.mp4|\.m3u8|\.mpd|\.webm|\.ts)(\?|$)/i.test(e.name))
      .forEach(e => MediaCapture.add(e.name));
  } catch (e) {}
}

// PerformanceObserver
try {
  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest') {
        MediaCapture.add(entry.name);
      }
    }
  });
  obs.observe({ entryTypes: ['resource'] });
} catch (e) {}

// fetch 패치
(function patchFetch() {
  if (window.__lsFetchPatched) return;
  window.__lsFetchPatched = true;
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    MediaCapture.add(url);
    return origFetch.apply(this, args);
  };
})();

// XHR 패치
(function patchXHR() {
  if (window.__lsXhrPatched) return;
  window.__lsXhrPatched = true;
  const OrigXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function() {
    const xhr = new OrigXHR();
    const origOpen = xhr.open;
    xhr.open = function(method, url, ...rest) {
      MediaCapture.add(url);
      return origOpen.call(this, method, url, ...rest);
    };
    return xhr;
  };
})();

// 비디오 src 찾기
function findVideoSrc() {
  const videos = document.querySelectorAll("video");

  for (const v of videos) {
    if (v.currentSrc && !/^(blob:|data:)/.test(v.currentSrc)) {
      MediaCapture.add(v.currentSrc);
      return v.currentSrc;
    }
    if (v.src && !/^(blob:|data:)/.test(v.src)) {
      MediaCapture.add(v.src);
      return v.src;
    }
    const source = v.querySelector("source[src]");
    if (source?.src) {
      MediaCapture.add(source.src);
      return source.src;
    }
  }

  const sources = document.querySelectorAll('source[src]');
  for (const s of sources) {
    MediaCapture.add(s.src);
    return s.src;
  }

  const testPlayer = document.getElementById("test_player_html5_api");
  if (testPlayer) {
    if (testPlayer.currentSrc) {
      MediaCapture.add(testPlayer.currentSrc);
      return testPlayer.currentSrc;
    }
    if (testPlayer.src) {
      MediaCapture.add(testPlayer.src);
      return testPlayer.src;
    }
  }

  scanExistingResources();
  const best = MediaCapture.getBest();
  if (best) {
    return best;
  }

  return null;
}

// ===== REMOVED: Inline button injection =====
// The "강의 요약하기" button has been moved to the extension popup
// Users will now interact with the popup UI instead

// ===== MESSAGE LISTENER FOR POPUP =====
// Listen for GET_VIDEO_INFO request from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "GET_VIDEO_INFO") {
    // YouTube 영상 감지
    const youtubeInfo = getYouTubeVideoInfo();
    if (youtubeInfo) {
      sendResponse({
        type: 'youtube',
        ...youtubeInfo
      });
      return true;
    }
    
    // 일반 비디오 URL 감지 (기존 로직)
    let videoUrl = findVideoSrc();
    
    if (videoUrl) {
      sendResponse({
        type: 'direct',
        videoUrl: videoUrl,
        videoTitle: getVideoTitle()
      });
      return true;
    }
    
    // 비디오를 찾지 못한 경우: 재시도 로직 (최대 3초 대기)
    console.log('[Content] Video not found immediately, retrying...');
    let retryCount = 0;
    const maxRetries = 6; // 6회 × 500ms = 3초
    
    const retryInterval = setInterval(() => {
      retryCount++;
      scanExistingResources(); // 리소스 재스캔
      videoUrl = findVideoSrc();
      
      if (videoUrl) {
        console.log(`[Content] Video found after ${retryCount} retries`);
        clearInterval(retryInterval);
        sendResponse({
          type: 'direct',
          videoUrl: videoUrl,
          videoTitle: getVideoTitle()
        });
      } else if (retryCount >= maxRetries) {
        console.log('[Content] Video not found after max retries');
        clearInterval(retryInterval);
        sendResponse(null);
      }
    }, 500);
    
    return true; // Keep channel open for async response
  }
  
  // ERROR 메시지는 더 이상 alert로 표시하지 않음 (popup에서 처리)
  
  sendResponse({ received: true });
  return true;
});

// ===== YOUTUBE VIDEO DETECTION =====
function getYouTubeVideoInfo() {
  if (!window.location.hostname.includes('youtube.com')) {
    return null;
  }
  
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');
  
  if (!videoId) return null;
  
  // 제목 추출 (여러 선택자 시도)
  const titleSelectors = [
    'h1.ytd-watch-metadata yt-formatted-string',
    'h1.ytd-video-primary-info-renderer',
    'h1 yt-formatted-string',
    'meta[name="title"]'
  ];
  
  let title = '알 수 없는 제목';
  for (const selector of titleSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      title = el.getAttribute('content') || el.textContent || title;
      break;
    }
  }
  
  return {
    videoId: videoId,
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    videoTitle: title.trim(),
    thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
  };
}

// ===== HELPER: Get video title from page =====
function getVideoTitle() {
  // Try to get title from common sources
  const candidates = [
    document.querySelector("h1")?.textContent,
    document.querySelector("title")?.textContent,
    document.querySelector("meta[property='og:title']")?.content,
    document.title
  ];
  
  return candidates.find(t => t?.trim())?.trim().substring(0, 100) || "강의 동영상";
}
