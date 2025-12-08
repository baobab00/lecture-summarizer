// Service Worker
console.log('[Background] Service worker started at', new Date().toISOString());
const processingUrls = new Set();

/**
 * 서버 상태 확인
 */
async function checkServerStatus() {
  try {
    const response = await fetch('http://localhost:3000/health', {
      method: 'GET',
      signal: AbortSignal.timeout(2000) // 2초 타임아웃
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ===== GLOBAL PROGRESS STATE (Multiple sessions) =====
const processingStates = new Map();
let currentSessionId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Received message:', message.action || message.type, 'from tab:', sender?.tab?.id);
  
  if (message.action === "PROCESS_LECTURE") {
    // New message format from popup (direct video URL)
    const originTabId = sender?.tab?.id;
    handleProcessLectureFromPopup(message, originTabId, sendResponse);
    return true; // Keep channel open for async response
  } else if (message.action === "PROCESS_YOUTUBE") {
    // YouTube video processing
    const originTabId = sender?.tab?.id;
    handleProcessYouTube(message, originTabId, sendResponse);
    return true;
  } else if (message.type === "PROCESS_LECTURE") {
    // Legacy message format
    const originTabId = sender?.tab?.id;
    handleProcessLecture(message.videoSrc, originTabId);
  } else if (message.action === "GET_PROGRESS") {
    // Return current session's progress
    const state = currentSessionId ? processingStates.get(currentSessionId) : null;
    sendResponse(state || { status: 'idle', progress: 0, message: '대기 중' });
  } else if (message.action === "CANCEL_JOB") {
    // Cancel processing job
    const { sessionId } = message;
    console.log('[Background] Cancelling job:', sessionId);
    
    // 서버에 취소 요청
    fetch(`http://localhost:3000/api/cancel/${sessionId}`, {
      method: 'POST'
    }).then(() => {
      console.log('[Background] Cancel request sent to server');
    }).catch(err => {
      console.error('[Background] Failed to send cancel request:', err);
    });
    
    sendResponse({ success: true });
  }
});

function sendToContent(tabId, payload) {
  if (!tabId) {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const target = tabs.find(t => t.active && t.url && !t.url.startsWith("chrome:") && !t.url.startsWith("about:"));
      if (!target) return;
      chrome.tabs.sendMessage(target.id, payload, () => {
        if (chrome.runtime.lastError) {
          // Ignore
        }
      });
    });
    return;
  }
  chrome.tabs.sendMessage(tabId, payload, () => {
    if (chrome.runtime.lastError) {
      // Ignore
    }
  });
}

// ===== NEW: Handle messages from popup =====
async function handleProcessLectureFromPopup(message, originTabId, sendResponse) {
  const { videoUrl, videoTitle } = message;
  console.log('[Background] handleProcessLectureFromPopup:', { videoUrl: videoUrl?.substring(0, 50), videoTitle, originTabId });
  
  // Initialize processing state
  const sessionId = Date.now().toString();
  currentSessionId = sessionId;
  
  const initialState = {
    sessionId,
    progress: 0,
    status: 'starting',
    message: '시작 준비 중...',
    error: null,
    startTime: Date.now()
  };
  processingStates.set(sessionId, initialState);
  
  // Also save to Chrome Storage for persistence
  chrome.storage.local.get(["activeSessions"], (result) => {
    const activeSessions = result.activeSessions || [];
    activeSessions.push({
      sessionId,
      title: videoTitle || "강의 동영상",
      progress: 0,
      status: 'starting',
      message: '시작 준비 중...',
      startTime: Date.now(),
      completeTime: null
    });
    chrome.storage.local.set({ activeSessions });
  });
  
  sendResponse({ success: true, sessionId });
  
  // Process in background
  try {
    await handleProcessLecture(videoUrl, originTabId, sessionId);
  } catch (err) {
    console.error('[Background] Error in handleProcessLectureFromPopup:', err);
  }
}

// ===== NEW: Handle YouTube video processing =====
async function handleProcessYouTube(message, originTabId, sendResponse) {
  const { videoUrl, videoTitle, videoId } = message;
  console.log('[Background] handleProcessYouTube:', { videoUrl, videoTitle, videoId, originTabId });
  
  // Initialize processing state
  const sessionId = Date.now().toString();
  currentSessionId = sessionId;
  
  const initialState = {
    sessionId,
    progress: 0,
    status: 'starting',
    message: 'YouTube 다운로드 준비 중...',
    error: null,
    startTime: Date.now()
  };
  processingStates.set(sessionId, initialState);
  
  // Save to Chrome Storage
  chrome.storage.local.get(["activeSessions"], (result) => {
    const activeSessions = result.activeSessions || [];
    activeSessions.push({
      sessionId,
      title: videoTitle || "YouTube 동영상",
      progress: 0,
      status: 'starting',
      message: 'YouTube 다운로드 준비 중...',
      startTime: Date.now(),
      completeTime: null
    });
    chrome.storage.local.set({ activeSessions });
  });
  
  sendResponse({ success: true, sessionId });
  
  // Process YouTube video
  try {
    await processYouTubeVideo(videoUrl, sessionId);
  } catch (err) {
    console.error('[Background] Error in handleProcessYouTube:', err);
  }
}

async function processYouTubeVideo(videoUrl, sessionId) {
  console.log('[Background] processYouTubeVideo called:', { videoUrl, sessionId });
  
  const updateState = (progress, status, message, error = null) => {
    const state = {
      sessionId,
      progress,
      status,
      message,
      error,
      startTime: processingStates.get(sessionId)?.startTime || Date.now()
    };
    processingStates.set(sessionId, state);
    
    // Update Chrome Storage
    chrome.storage.local.get(["activeSessions"], (result) => {
      const activeSessions = result.activeSessions || [];
      const index = activeSessions.findIndex(s => s.sessionId === sessionId);
      if (index !== -1) {
        activeSessions[index] = {
          ...activeSessions[index],
          progress,
          status,
          message,
          error
        };
        if (status === 'complete') {
          activeSessions[index].completeTime = Date.now();
        }
        chrome.storage.local.set({ activeSessions });
      }
    });
  };
  
  // 중복 요청 방지
  if (processingUrls.has(videoUrl)) {
    updateState(0, 'error', '❌ 이미 처리 중입니다', '→ 현재 진행 중인 작업이 완료될 때까지 기다려주세요!');
    return;
  }
  
  // 서버 상태 확인
  const serverRunning = await checkServerStatus();
  if (!serverRunning) {
    updateState(0, 'error', '❌ 서버가 실행되지 않았습니다', '→ 시스템 트레이에서 서버를 시작해주세요!');
    return;
  }
  
  // API Key 확인
  const settings = await chrome.storage.local.get(["openaiApiKey", "saveFolderPath"]);
  if (!settings.openaiApiKey) {
    updateState(0, 'error', '❌ API Key가 설정되지 않았습니다', '→ Settings 탭에서 OpenAI API Key를 설정해주세요!');
    return;
  }
  
  // 처리 중 목록에 추가
  processingUrls.add(videoUrl);
  
  try {
    updateState(5, 'starting', '준비 중');
    
    // 서버에 YouTube 오디오 다운로드 요청 (MP3 직접 다운로드)
    console.log('[Background] Requesting YouTube audio download from server:', videoUrl);
    const downloadRes = await fetch('http://localhost:3000/download-youtube', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        videoUrl: videoUrl,
        sessionId: sessionId
      })
    });
    
    console.log('[Background] YouTube download response:', downloadRes.ok, downloadRes.status);
    if (!downloadRes.ok) {
      const errorData = await downloadRes.json();
      throw new Error(errorData.error || "YouTube download failed");
    }
    
    updateState(10, 'downloading', '다운로드 중');
    
    console.log('[Background] Converting downloaded audio to blob...');
    const audioBlob = await downloadRes.blob();
    console.log('[Background] Blob size:', audioBlob.size, 'type:', audioBlob.type);
    
    // 기존 /process 엔드포인트로 전송 (MP3 파일)
    const formData = new FormData();
    formData.append("file", audioBlob, "youtube-audio.mp3");
    formData.append("apiKey", settings.openaiApiKey);
    formData.append("sessionId", sessionId);
    
    updateState(15, 'processing', '강의 분석 중...');
    
    // 서버 진행도 폴링 시작 (백그라운드에서 실시간 업데이트)
    let lastProgress = 15; // 마지막 진행도 추적
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:3000/api/progress/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.progress >= 20 && data.progress !== lastProgress) { // 진행도가 변경된 경우에만
            console.log('[Background] Progress update:', data);
            lastProgress = data.progress;
            updateState(data.progress, data.status, data.message);
          }
        }
      } catch (err) {
        // Polling 오류는 무시
      }
    }, 1000);
    
    console.log('[Background] Sending to /process endpoint...');
    const response = await fetch('http://localhost:3000/process', {
      method: 'POST',
      body: formData
    });
    
    // 폴링 중지
    clearInterval(pollInterval);
    
    console.log('[Background] Server response:', response.ok, response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error (${response.status}): ${errorText}`);
    }
    
    // HTML 응답 받기
    console.log('[Background] Getting HTML response...');
    const htmlText = await response.text();
    console.log('[Background] HTML length:', htmlText.length);
    
    updateState(90, 'saving', '파일 저장 중...');
    
    // HTML 저장 및 열기
    console.log('[Background] Saving and opening HTML...');
    await saveAndOpenHtml(htmlText, settings.saveFolderPath);
    
    updateState(100, 'complete', '✓ 강의 요약 완료!');
    
  } catch (error) {
    console.error('[Background] YouTube processing error:', error);
    const errorMsg = error.message || String(error);
    updateState(0, 'error', '❌ 처리 실패', errorMsg);
  } finally {
    // 처리 완료 시 목록에서 제거
    processingUrls.delete(videoUrl);
  }
}

async function handleProcessLecture(videoSrc, originTabId, sessionId = null) {
  console.log('[Background] handleProcessLecture called:', { videoSrc: videoSrc?.substring(0, 50), originTabId, sessionId });
  
  // Helper to update state
  const updateState = (progress, status, message, error = null) => {
    if (sessionId) {
      const state = {
        sessionId,
        progress,
        status,
        message,
        error,
        startTime: processingStates.get(sessionId)?.startTime || Date.now()
      };
      processingStates.set(sessionId, state);
      
      // Also update Chrome Storage for persistence
      chrome.storage.local.get(["activeSessions"], (result) => {
        const activeSessions = result.activeSessions || [];
        const index = activeSessions.findIndex(s => s.sessionId === sessionId);
        if (index !== -1) {
          activeSessions[index] = {
            ...activeSessions[index],
            progress,
            status,
            message,
            error
          };
          if (status === 'complete') {
            activeSessions[index].completeTime = Date.now();
          }
          chrome.storage.local.set({ activeSessions });
        }
      });
    }
  };
  if (processingUrls.has(videoSrc)) {
    updateState(0, 'error', '❌ 이미 처리 중입니다', '→ 현재 진행 중인 작업이 완료될 때까지 기다려주세요!');
    return;
  }

  // 서버 상태 확인
  console.log('[Background] Checking server status...');
  const serverRunning = await checkServerStatus();
  console.log('[Background] Server status:', serverRunning);
  if (!serverRunning) {
    updateState(0, 'error', '❌ 서버가 실행되지 않았습니다', '→ 시스템 트레이에서 서버를 시작해주세요!');
    return;
  }

  // Chrome Storage에서 설정 가져오기
  console.log('[Background] Getting settings from storage...');
  const settings = await chrome.storage.local.get(["openaiApiKey", "saveFolderPath"]);
  console.log('[Background] Settings:', { hasApiKey: !!settings.openaiApiKey, savePath: settings.saveFolderPath });
  
  if (!settings.openaiApiKey) {
    updateState(0, 'error', '❌ API Key가 설정되지 않았습니다', '→ Settings 탭에서 OpenAI API Key를 설정해주세요!');
    return;
  }

  processingUrls.add(videoSrc);

  try {
    updateState(10, 'downloading', '동영상 다운로드 중...');
    
    console.log('[Background] Fetching video from:', videoSrc.substring(0, 100));
    const videoRes = await fetch(videoSrc, {
      credentials: "include"
    });

    console.log('[Background] Video fetch response:', videoRes.ok, videoRes.status);
    if (!videoRes.ok) {
      throw new Error("Video download failed (status: " + videoRes.status + ")");
    }

    updateState(15, 'processing', '서버로 전송 중...');
    
    console.log('[Background] Converting to blob...');
    const videoBlob = await videoRes.blob();
    console.log('[Background] Blob size:', videoBlob.size, 'type:', videoBlob.type);

    const formData = new FormData();
    formData.append("file", videoBlob, "lecture.mp4");
    formData.append("apiKey", settings.openaiApiKey);
    formData.append("sessionId", sessionId);

    updateState(20, 'processing', '오디오 추출 중...');
    
    // 서버 진행도 폴링 시작 (백그라운드에서 실시간 업데이트)
    let lastProgress = 20; // 마지막 진행도 추적
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:3000/api/progress/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.progress >= 20 && data.progress !== lastProgress) { // 진행도가 변경된 경우에만
            console.log('[Background] Progress update:', data);
            lastProgress = data.progress;
            updateState(data.progress, data.status, data.message);
          }
        }
      } catch (err) {
        // Polling 오류는 무시
      }
    }, 1000);
    
    console.log('[Background] Sending to server...');
    const res = await fetch("http://localhost:3000/process", {
      method: "POST",
      body: formData,
      // 타임아웃 없음 (Chrome extension fetch는 기본 타임아웃 없음)
    });
    
    // 폴링 중지
    clearInterval(pollInterval);

    console.log('[Background] Server response:', res.ok, res.status);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Server error (${res.status}): ${errorText}`);
    }

    console.log('[Background] Getting HTML response...');
    const htmlText = await res.text();
    console.log('[Background] HTML length:', htmlText.length);

    updateState(90, 'saving', '파일 저장 중...');
    
    console.log('[Background] Saving and opening HTML...');
    await saveAndOpenHtml(htmlText, settings.saveFolderPath);

    updateState(100, 'complete', '✓ 강의 요약 완료!');
  } catch (err) {
    console.error('[Background] Error in handleProcessLecture:', err);
    const errorMsg = err.message || String(err);
    updateState(0, 'error', '❌ 처리 실패', errorMsg);
  } finally {
    processingUrls.delete(videoSrc);
  }
}

/**
 * HTML을 로컬에 저장하고 새 탭으로 열기
 */
async function saveAndOpenHtml(htmlText, saveFolderPath) {
  console.log('[Background] saveAndOpenHtml called, savePath:', saveFolderPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const baseName = `lecture-note-${timestamp}`.replace(/[\\/:*?"<>|]/g, '-');
  const filename = `${baseName}.html`;
  try {
    // 크기 진단 로그
    console.log('[Background] HTML text length:', htmlText.length);
    const utf8Bytes = new TextEncoder().encode(htmlText);
    console.log('[Background] UTF-8 byte length:', utf8Bytes.length);
    let binaryString = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binaryString += String.fromCharCode(utf8Bytes[i]);
    }
    const base64 = btoa(binaryString);
    console.log('[Background] Base64 length:', base64.length);
    const dataUrl = `data:text/html;charset=utf-8;base64,${base64}`;
    console.log('[Background] Data URL length:', dataUrl.length);
    
    let downloadOptions = {
      url: dataUrl,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify'
    };
    if (saveFolderPath) {
      const normalized = saveFolderPath.replace(/\\/g, '/');
      const isAbsolute = /^([A-Za-z]:\/|\/)/.test(normalized);
      if (isAbsolute) {
        downloadOptions.saveAs = true;
        downloadOptions.filename = filename;
      } else {
        downloadOptions.filename = `${normalized}/${filename}`.replace(/\/+/g, '/');
      }
    }
    console.log('[Background] Download options:', downloadOptions);
    const downloadId = await chrome.downloads.download(downloadOptions);
    console.log('[Background] Download started, ID:', downloadId);
    await waitForDownloadComplete(downloadId);
    console.log('[Background] Download complete');
    const downloads = await chrome.downloads.search({ id: downloadId });
    if (downloads.length > 0) {
      const filePath = downloads[0].filename;
      const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
      console.log('[Background] Opening file:', fileUrl);
      await chrome.tabs.create({ url: fileUrl });
    }
  } catch (error) {
    console.error('[Background] Error in saveAndOpenHtml:', error);
    throw error;
  }
}

/**
 * 다운로드 완료 대기
 */
function waitForDownloadComplete(downloadId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Download timeout'));
    }, 30000); // 30초 타임아웃
    
    function checkDownload() {
      chrome.downloads.search({ id: downloadId }, (results) => {
        if (results.length === 0) {
          clearTimeout(timeout);
          reject(new Error('Download not found'));
          return;
        }
        
        const download = results[0];
        
        if (download.state === 'complete') {
          clearTimeout(timeout);
          resolve();
        } else if (download.state === 'interrupted') {
          clearTimeout(timeout);
          reject(new Error('Download interrupted: ' + download.error));
        } else {
          // 아직 진행 중이면 100ms 후 재확인
          setTimeout(checkDownload, 100);
        }
      });
    }
    
    checkDownload();
  });
}