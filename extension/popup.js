// ===== TAB NAVIGATION =====
const tabBtns = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const tabName = btn.dataset.tab;
    tabBtns.forEach(b => b.classList.remove("active"));
    tabContents.forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(tabName).classList.add("active");
  });
});

// ===== GLOBAL STATE =====
let currentVideoData = null;
let activeSessions = [];
let activeSessionPolling = new Map(); // sessionId -> intervalId

// ===== INITIALIZE =====
function initializeTabs() {
  chrome.storage.local.get(["openaiApiKey"], (result) => {
    const hasApiKey = !!result.openaiApiKey;
    const mainTab = document.getElementById("main");
    const settingsTab = document.getElementById("settings");
    const mainTabBtn = document.querySelector('[data-tab="main"]');
    const settingsTabBtn = document.querySelector('[data-tab="settings"]');
    
    if (!hasApiKey) {
      tabBtns.forEach(b => b.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));
      settingsTabBtn.classList.add("active");
      settingsTab.classList.add("active");
    } else {
      tabBtns.forEach(b => b.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));
      mainTabBtn.classList.add("active");
      mainTab.classList.add("active");
      loadMainTabContent();
    }
  });
}

// ===== MAIN TAB CONTENT =====
function loadMainTabContent() {
  const withApiDiv = document.getElementById("with-api");
  const noApiDiv = document.getElementById("no-api");
  
  chrome.storage.local.get(["openaiApiKey"], (result) => {
    if (result.openaiApiKey) {
      withApiDiv.style.display = "block";
      noApiDiv.style.display = "none";
      
      // Load detected video
      loadDetectedVideo();
      
      // Load active sessions from storage
      loadActiveSessions();
    } else {
      withApiDiv.style.display = "none";
      noApiDiv.style.display = "block";
    }
  });
}

function loadDetectedVideo() {
  const videoDetectedDiv = document.getElementById("video-detected");
  const noVideoDiv = document.getElementById("no-video");
  
  // 로딩 상태 표시
  noVideoDiv.innerHTML = `
    <div class="empty-state-icon">⏳</div>
    <p><strong>동영상 검색 중...</strong></p>
    <p style="color: #9ca3af; font-size: 12px;">잠시만 기다려주세요</p>
  `;
  noVideoDiv.style.display = "block";
  videoDetectedDiv.style.display = "none";
  
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "GET_VIDEO_INFO" }, (response) => {
        // chrome.runtime.lastError 체크 (연결 실패 처리)
        if (chrome.runtime.lastError) {
          // Content script가 없는 페이지 (chrome://, about:blank 등)에서는 정상적으로 발생
          // 조용히 처리 (로그 없음)
          showNoVideo();
          return;
        }
        
        if (response && response.videoUrl) {
          currentVideoData = response;
          displayVideoCard(response);
        } else {
          showNoVideo();
        }
      });
    } else {
      showNoVideo();
    }
  });
}

function displayVideoCard(videoData) {
  const videoDetectedDiv = document.getElementById("video-detected");
  const noVideoDiv = document.getElementById("no-video");
  const videoTitle = document.getElementById("video-title");
  const videoUrl = document.getElementById("video-url");
  const submitBtn = document.getElementById("submit-btn");
  
  videoDetectedDiv.style.display = "block";
  noVideoDiv.style.display = "none";
  
  // YouTube vs 일반 비디오 구분
  if (videoData.type === 'youtube') {
    videoTitle.textContent = `${videoData.videoTitle || "YouTube 동영상"}`;
    videoUrl.textContent = `youtube.com/watch?v=${videoData.videoId}`;
  } else {
    videoTitle.textContent = videoData.videoTitle || "강의 동영상";
    videoUrl.textContent = shortenUrl(videoData.videoUrl);
  }
  
  submitBtn.classList.remove("checked");
  submitBtn.disabled = false;
  submitBtn.onclick = () => handleVideoSubmit(videoData);
}

function showNoVideo() {
  const videoDetectedDiv = document.getElementById("video-detected");
  const noVideoDiv = document.getElementById("no-video");
  videoDetectedDiv.style.display = "none";
  noVideoDiv.style.display = "block";
  
  // 원래 메시지로 복원
  noVideoDiv.innerHTML = `
    <div class="empty-state-icon">🎬</div>
    <p><strong>강의 동영상을 찾지 못했습니다</strong></p>
    <p style="color: #9ca3af; font-size: 12px;">현재 페이지에서 동영상을 재생하고<br>이 팝업을 다시 열어주세요</p>
  `;
}

function shortenUrl(url) {
  if (!url) return "알 수 없음";
  if (url.length > 50) return url.substring(0, 47) + "...";
  return url;
}

// ===== SESSION MANAGEMENT =====
function loadActiveSessions() {
  chrome.storage.local.get(["activeSessions"], (result) => {
    activeSessions = result.activeSessions || [];
    renderJobsList();
  });
}

function renderJobsList() {
  const jobsListDiv = document.getElementById("jobs-list");
  const noJobsDiv = document.getElementById("no-jobs");
  
  // Filter out completed jobs older than 5 minutes
  const now = Date.now();
  activeSessions = activeSessions.filter(job => {
    if (job.status === 'complete' && now - job.completeTime > 300000) {
      // Remove from polling
      if (activeSessionPolling.has(job.sessionId)) {
        clearInterval(activeSessionPolling.get(job.sessionId));
        activeSessionPolling.delete(job.sessionId);
      }
      return false;
    }
    return true;
  });
  
  // Save cleaned sessions
  chrome.storage.local.set({ activeSessions });
  
  if (activeSessions.length === 0) {
    jobsListDiv.style.display = "none";
    noJobsDiv.style.display = "block";
    return;
  }
  
  jobsListDiv.style.display = "block";
  noJobsDiv.style.display = "none";
  jobsListDiv.innerHTML = activeSessions.map(job => {
    const isError = job.status === 'error';
    const errorDetail = isError && job.error ? `
      <div class="job-error-detail">
        ${job.error}
      </div>
    ` : '';
    
    return `
      <div class="job-item ${isError ? 'job-error' : ''}" data-session-id="${job.sessionId}">
        <div class="job-header">
          <div class="job-header-left">
            <div class="job-title">${job.title}</div>
            <div class="job-status ${job.status}">${getStatusLabel(job.status)}</div>
          </div>
          <button class="job-delete-btn" data-session-id="${job.sessionId}" title="삭제">✕</button>
        </div>
        <div class="job-progress-bar">
          <div class="job-progress-fill" style="width: ${job.progress}%"></div>
        </div>
        <div class="job-info">
          <span>${job.message || getStatusMessage(job.status)}</span>
          <span class="job-percent">${job.progress}%</span>
        </div>
        ${errorDetail}
      </div>
    `;
  }).join('');
  
  // Add delete button listeners
  document.querySelectorAll('.job-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionId = btn.getAttribute('data-session-id');
      deleteJob(sessionId);
    });
  });
  
  // Start polling for active jobs
  activeSessions.forEach(job => {
    if (job.status !== 'complete' && job.status !== 'error') {
      if (!activeSessionPolling.has(job.sessionId)) {
        startJobPolling(job.sessionId);
      }
    }
  });
}

function getStatusLabel(status) {
  const labels = {
    'idle': '대기 중',
    'starting': '준비 중',
    'downloading': '다운로드',
    'processing': '처리 중',
    'saving': '저장 중',
    'complete': '완료',
    'error': '오류'
  };
  return labels[status] || status;
}

function getStatusMessage(status) {
  const messages = {
    'idle': '대기 중...',
    'starting': '시작 준비 중...',
    'downloading': '동영상 다운로드 중...',
    'processing': '강의 분석 중...',
    'saving': '파일 저장 중...',
    'complete': '완료됨',
    'error': '오류 발생'
  };
  return messages[status] || '처리 중...';
}

// ===== JOB MANAGEMENT =====
function deleteJob(sessionId) {
  // 현재 진행 중인 작업인지 확인
  const job = activeSessions.find(j => j.sessionId === sessionId);
  const isProcessing = job && job.status !== 'complete' && job.status !== 'error';
  
  // 진행 중이면 서버에 취소 요청
  if (isProcessing) {
    console.log('[Popup] Sending cancel request for session:', sessionId);
    chrome.runtime.sendMessage({
      action: "CANCEL_JOB",
      sessionId: sessionId
    });
  }
  
  // Stop polling if active
  if (activeSessionPolling.has(sessionId)) {
    clearInterval(activeSessionPolling.get(sessionId));
    activeSessionPolling.delete(sessionId);
  }
  
  // Remove from sessions list
  activeSessions = activeSessions.filter(job => job.sessionId !== sessionId);
  
  // Update storage
  chrome.storage.local.set({ activeSessions });
  
  // Re-render
  renderJobsList();
}

// ===== VIDEO SUBMISSION =====
function handleVideoSubmit(videoData) {
  const submitBtn = document.getElementById("submit-btn");
  submitBtn.classList.add("checked");
  submitBtn.disabled = true;
  
  // YouTube vs 일반 비디오 처리 분기
  const action = videoData.type === 'youtube' ? "PROCESS_YOUTUBE" : "PROCESS_LECTURE";
  
  chrome.runtime.sendMessage(
    {
      action: action,
      videoUrl: videoData.videoUrl,
      videoTitle: videoData.videoTitle,
      videoId: videoData.videoId, // YouTube만 해당
      thumbnail: videoData.thumbnail // YouTube만 해당
    },
    (response) => {
      if (response && response.success) {
        const sessionId = response.sessionId;
        
        // Add to active sessions
        const newSession = {
          sessionId,
          title: videoData.videoTitle || "강의 동영상",
          progress: 0,
          status: 'starting',
          message: '시작 준비 중...',
          startTime: Date.now(),
          completeTime: null
        };
        
        activeSessions.push(newSession);
        chrome.storage.local.set({ activeSessions });
        
        renderJobsList();
        startJobPolling(sessionId);
      } else {
        submitBtn.classList.remove("checked");
        submitBtn.disabled = false;
      }
    }
  );
}

// ===== JOB POLLING =====
function startJobPolling(sessionId) {
  let pollCount = 0;
  const maxPollCount = 3600; // 30분
  
  const pollInterval = setInterval(() => {
    pollCount++;
    
    chrome.runtime.sendMessage(
      { action: "GET_PROGRESS" },
      (state) => {
        if (!state || state.sessionId !== sessionId) return;
        
        // Update session in list
        const sessionIndex = activeSessions.findIndex(s => s.sessionId === sessionId);
        if (sessionIndex === -1) return;
        
        activeSessions[sessionIndex] = {
          ...activeSessions[sessionIndex],
          progress: state.progress,
          status: state.status,
          message: state.message,
          error: state.error
        };
        
        // If complete, set completion time
        if (state.status === 'complete') {
          activeSessions[sessionIndex].completeTime = Date.now();
        }
        
        chrome.storage.local.set({ activeSessions });
        renderJobsList();
        
        // Stop polling on complete/error or max polls
        if (state.status === 'complete' || state.status === 'error' || pollCount >= maxPollCount) {
          clearInterval(pollInterval);
          activeSessionPolling.delete(sessionId);
        }
      }
    );
  }, 500);
  
  activeSessionPolling.set(sessionId, pollInterval);
}

// ===== SETTINGS TAB =====
const apiKeyInput = document.getElementById("apiKey");
const savePathInput = document.getElementById("savePath");
const currentPathDiv = document.getElementById("currentPath");
const selectFolderBtn = document.getElementById("selectFolder");
const saveBtn = document.getElementById("saveBtn");
const statusDiv = document.getElementById("status");

chrome.storage.local.get(["openaiApiKey", "saveFolderPath"], (result) => {
  if (result.openaiApiKey) {
    apiKeyInput.value = result.openaiApiKey;
  }
  if (result.saveFolderPath) {
    savePathInput.value = result.saveFolderPath;
    currentPathDiv.textContent = result.saveFolderPath;
    currentPathDiv.style.display = "block";
  }
});

selectFolderBtn.addEventListener("click", async () => {
  const folderPath = prompt(
    "저장할 폴더 경로를 입력하세요:\n\n예시) C:\\Users\\USER\\Documents\\LectureNotes\n\n※ 폴더가 존재하지 않으면 자동 생성됩니다.",
    savePathInput.value || "C:\\Users\\USER\\Documents\\LectureNotes"
  );
  
  if (folderPath) {
    savePathInput.value = folderPath.trim();
    currentPathDiv.textContent = folderPath.trim();
    currentPathDiv.style.display = "block";
  }
});

saveBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  const savePath = savePathInput.value.trim();
  
  if (!apiKey) {
    showStatus("error", "OpenAI API Key를 입력해주세요");
    return;
  }
  
  if (!apiKey.startsWith("sk-")) {
    showStatus("error", "올바른 API Key 형식이 아닙니다 (sk-로 시작해야 함)");
    return;
  }
  
  chrome.storage.local.set({
    openaiApiKey: apiKey,
    saveFolderPath: savePath || ""
  }, () => {
    if (chrome.runtime.lastError) {
      showStatus("error", "저장 실패: " + chrome.runtime.lastError.message);
    } else {
      showStatus("success", "✓ 설정이 저장되었습니다");
      
      setTimeout(() => {
        tabBtns.forEach(b => b.classList.remove("active"));
        tabContents.forEach(c => c.classList.remove("active"));
        document.querySelector('[data-tab="main"]').classList.add("active");
        document.getElementById("main").classList.add("active");
        
        loadMainTabContent();
      }, 500);
    }
  });
});

function showStatus(type, message) {
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = message;
  statusDiv.style.display = "block";
  
  if (type === "error") {
    setTimeout(() => {
      statusDiv.style.display = "none";
    }, 5000);
  }
}

apiKeyInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    saveBtn.click();
  }
});

// ===== INITIALIZATION =====
initializeTabs();

// Refresh sessions periodically when popup is open
setInterval(() => {
  loadActiveSessions();
}, 1000);
