import express from "express";
import multer from "multer";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

// 미들웨어
import { corsMiddleware } from "./middleware/cors.js";

// 유틸리티
import { convertToMp3, splitAudio } from "./utils/audioConverter.js";
import { transcribeChunks } from "./utils/transcription.js";
import { PerformanceTracker } from "./utils/performanceTracker.js";
import { savePerformanceData } from "./utils/performanceLogger.js";

// 서비스
import { analyzeAndNormalizeTranscript, generateTimelineNote, generateStudyNote } from "./services/openaiService.js";
import { generate3TabHtml } from "./services/htmlGenerator.js";
import { readLogFile, getPerformanceData, getSystemMetrics, getServerStatus } from "./services/dashboardService.js";

// HTML 유틸리티
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

dotenv.config();

const app = express();

// KST 시간 포맷 함수
function getKSTTimestamp() {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  return kst.toISOString().replace('T', ' ').substring(0, 19);
}

// Multer 설정 (대용량 파일 지원)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    fieldSize: 500 * 1024 * 1024
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 미들웨어 등록
app.use(corsMiddleware);

// Body parser 크기 제한 증가
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// ===== GLOBAL PROCESSING STATE =====
const processingState = new Map();
const cancelledSessions = new Set();

/**
 * /api/cancel 엔드포인트 - 작업 취소
 */
app.post("/api/cancel/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  console.log(`[${getKSTTimestamp()}] [INFO] [Server] Cancelling session: ${sessionId}`);
  
  // 취소 목록에 추가
  cancelledSessions.add(sessionId);
  
  // 상태 업데이트
  if (processingState.has(sessionId)) {
    const state = processingState.get(sessionId);
    processingState.set(sessionId, {
      ...state,
      status: 'cancelled',
      message: 'Cancelled by user',
      progress: 0
    });
  }
  
  res.json({ success: true, message: 'Session cancelled' });
});

/**
 * /api/progress 엔드포인트 - 처리 진행도 조회
 */
app.get("/api/progress/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const state = processingState.get(sessionId);
  
  if (!state) {
    return res.json({ status: 'idle', progress: 0, message: 'Session not found' });
  }
  
  res.json(state);
});

/**
 * /process 엔드포인트 - 비디오 처리 및 요약 생성
 */
app.post("/process", upload.fields([{ name: 'file' }, { name: 'apiKey' }, { name: 'sessionId' }]), async (req, res) => {
  const startTime = Date.now();
  const sessionId = req.body.sessionId || `session-${Date.now()}`;
  
  // 성능 추적 시작
  const perfTracker = new PerformanceTracker(sessionId);
  
  // Initialize progress state
  const updateProgress = (progress, status, message) => {
    // 취소된 세션은 상태 업데이트 안 함
    if (cancelledSessions.has(sessionId)) {
      return;
    }
    
    processingState.set(sessionId, {
      sessionId,
      progress,
      status,
      message,
      timestamp: Date.now(),
      elapsedMs: Date.now() - startTime
    });
  };
  
  updateProgress(5, 'starting', '처리 준비 중...');
  
  console.log(`[${getKSTTimestamp()}] POST /process - Request received (sessionId: ${sessionId})`);
  
  try {
    // 취소 체크
    if (cancelledSessions.has(sessionId)) {
      console.log(`[/process] Session ${sessionId} was cancelled, aborting`);
      cancelledSessions.delete(sessionId);
      return res.status(499).send('Request cancelled by client');
    }
    
    // 1. 입력 검증
    if (!req.files || !req.files.file || !req.files.file[0]) {
      console.log(`[${getKSTTimestamp()}] [ERROR] [Server] No file provided`);
      return res.status(400).send("No file provided");
    }
    
    const apiKey = req.body.apiKey;
    if (!apiKey) {
      console.log(`[${getKSTTimestamp()}] [ERROR] [Server] No API key provided`);
      return res.status(400).send("OpenAI API Key not provided");
    }
    
    const videoFile = req.files.file[0];
    console.log(`[${getKSTTimestamp()}] [INFO] [Server] File received: ${videoFile.originalname}, size: ${videoFile.size} bytes`);
    
    // 비디오 정보 저장
    const videoInfo = {
      filename: videoFile.originalname,
      format: path.extname(videoFile.originalname).substring(1),
      sizeBytes: videoFile.size
    };
    
    // 2. OpenAI 클라이언트 생성
    const openaiClient = new OpenAI({ apiKey });

    // 3. 임시 파일 경로 설정
    const tmpDir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const timestamp = Date.now();
    const isAlreadyMp3 = videoFile.originalname.toLowerCase().endsWith('.mp3');
    const mp4Path = isAlreadyMp3 ? null : path.join(tmpDir, `raw-${timestamp}.mp4`);
    const mp3Path = path.join(tmpDir, `audio-${timestamp}.mp3`);
    const chunkDir = path.join(tmpDir, `chunks-${timestamp}`);

    // 4. 비디오/오디오 저장
    perfTracker.markStage('download', 'File processing');
    if (isAlreadyMp3) {
      // 이미 MP3인 경우 직접 저장
      updateProgress(10, 'processing', '오디오 파일 처리 중...');
      fs.writeFileSync(mp3Path, videoFile.buffer);
      console.log(`[${getKSTTimestamp()}] [INFO] [Audio] MP3 file saved directly: ${mp3Path}`);
      perfTracker.endStage('download');
    } else {
      // MP4인 경우 저장 후 변환
      updateProgress(10, 'downloading', '비디오 처리 중...');
      fs.writeFileSync(mp4Path, videoFile.buffer);
      perfTracker.endStage('download');

      // 5. 오디오 변환
      perfTracker.markStage('audioConversion', 'Audio extraction');
      console.log(`[${getKSTTimestamp()}] [INFO] [Audio] Converting video to MP3...`);
      updateProgress(15, 'processing', '오디오 추출 중...');
      
      // 취소 체크
      if (cancelledSessions.has(sessionId)) {
        console.log(`[${getKSTTimestamp()}] [WARN] [Server] Cancelled during audio conversion`);
        throw new Error('CANCELLED');
      }
      
      await convertToMp3(mp4Path, mp3Path);
      console.log(`[${getKSTTimestamp()}] [INFO] [Audio] MP3 ready: ${mp3Path}`);
      perfTracker.endStage('audioConversion');
    }

    // 6. 오디오 분할
    perfTracker.markStage('audioSplit', 'Audio splitting');
    console.log(`[${getKSTTimestamp()}] [INFO] [Audio] Splitting audio into chunks...`);
    updateProgress(20, 'processing', '오디오 분할 중...');
    const chunks = await splitAudio(mp3Path, chunkDir);
    console.log(`[${getKSTTimestamp()}] [INFO] [Audio] Chunks created: ${chunks.length}`);
    perfTracker.endStage('audioSplit');

    // 7. 전사 (Whisper)
    perfTracker.markStage('transcription', 'Speech recognition (Whisper)');
    console.log(`[${getKSTTimestamp()}] [INFO] [Transcribe] Transcribing chunks via Whisper...`);
    updateProgress(30, 'processing', '음성 인식 중...');
    
    // 취소 체크
    if (cancelledSessions.has(sessionId)) {
      console.log(`[${getKSTTimestamp()}] [WARN] [Server] Cancelled during transcription`);
      throw new Error('CANCELLED');
    }
    
    const result = await transcribeChunks(chunks);
    console.log(`[${getKSTTimestamp()}] [INFO] [Transcribe] Transcription completed (chars=${result.text?.length || 0}, segments=${result.segments?.length || 0})`);
    const transcript = result.text;
    const segments = result.segments;
    
    // 영상 길이 정보 저장 (마지막 세그먼트의 end 시간 = 실제 영상 길이)
    if (segments && segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      videoInfo.durationSeconds = Math.round(lastSegment.end);
      console.log(`[${getKSTTimestamp()}] [INFO] [Transcribe] Video duration: ${Math.floor(lastSegment.end / 60)}m ${Math.round(lastSegment.end % 60)}s`);
    }
    
    perfTracker.endStage('transcription');

    // 8. 전사 교정 및 도메인 분석
    perfTracker.markStage('analysis', 'Content analysis');
    console.log(`[${getKSTTimestamp()}] [INFO] [OpenAI] Analyzing & normalizing transcript...`);
    updateProgress(50, 'processing', '내용 분석 중...');
    
    // 취소 체크
    if (cancelledSessions.has(sessionId)) {
      console.log(`[${getKSTTimestamp()}] [WARN] [Server] Cancelled during analysis`);
      throw new Error('CANCELLED');
    }
    
    let domain = '';
    let glossary = [];
    let normalizedSegments = segments;
    let normalizedTranscript = transcript;
    try {
      const normStart = Date.now();
      const NORM_TIMEOUT = 150000; // 150초 (2.5분)
      const normPromise = analyzeAndNormalizeTranscript(segments, openaiClient);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Normalization timeout')), NORM_TIMEOUT)
      );
      const norm = await Promise.race([normPromise, timeoutPromise]);
      domain = norm.domain || '';
      glossary = norm.glossary || [];
      normalizedSegments = norm.segments || segments;
      normalizedTranscript = normalizedSegments.map(seg => seg.text).join('\n');
      console.log(`[${getKSTTimestamp()}] [INFO] [OpenAI] Normalization done in ${Date.now()-normStart}ms (domain=${domain}, glossary=${glossary?.length || 0}, segments=${normalizedSegments?.length || 0})`);
    } catch (e) {
      console.warn(`[${getKSTTimestamp()}] [WARN] [OpenAI] Normalization failed, proceeding with raw transcript (reason: ${e?.message || e})`);
    }
    perfTracker.endStage('analysis');

    // 9. GPT 요약 생성 (교정된 세그먼트와 메타 정보 사용)
    perfTracker.markStage('generation', 'Note generation (GPT)');
    const meta = { domain, glossary };
    console.log(`[${getKSTTimestamp()}] [INFO] [OpenAI] Generating notes (timeline & study)...`);
    updateProgress(65, 'processing', '노트 생성 중...');
    
    // 취소 체크
    if (cancelledSessions.has(sessionId)) {
      console.log(`[${getKSTTimestamp()}] [WARN] [Server] Cancelled before note generation`);
      throw new Error('CANCELLED');
    }
    
    let timelineNote = '';
    let studyNote = '';
    try {
      const noteStart = Date.now();
      const NOTE_TIMEOUT = 120000; // 120초
      const notePromise = Promise.all([
        generateTimelineNote(normalizedSegments, openaiClient, meta),
        generateStudyNote(normalizedSegments, openaiClient, meta)
      ]);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Note generation timeout')), NOTE_TIMEOUT)
      );
      [timelineNote, studyNote] = await Promise.race([notePromise, timeoutPromise]);
      console.log(`[${getKSTTimestamp()}] [INFO] [OpenAI] Notes generated in ${Date.now()-noteStart}ms (timeline=${timelineNote?.length || 0}, study=${studyNote?.length || 0})`);
    } catch (e) {
      console.warn(`[${getKSTTimestamp()}] [WARN] [OpenAI] Note generation failed, continuing with placeholders (reason: ${e?.message || e})`);
      timelineNote = '## Timeline Note Generation Failed\\nFailed due to processing error.';
      studyNote = '## 📚 Study Note Generation Failed\\nFailed due to processing error.';
    }
    perfTracker.endStage('generation');

    // 10. HTML 생성 (원본 transcript/segments 대신 교정된 버전 사용)
    perfTracker.markStage('rendering', 'HTML rendering');
    console.log(`[${getKSTTimestamp()}] [INFO] [Server] Rendering HTML...`);
    console.log(`[${getKSTTimestamp()}] [DEBUG] [HTML] Input sizes: transcript=${normalizedTranscript?.length || 0}, segments=${normalizedSegments?.length || 0}, timeline=${timelineNote?.length || 0}, study=${studyNote?.length || 0}`);
    updateProgress(85, 'processing', 'HTML 생성 중...');
    
    let styledHtml = '';
    try {
      styledHtml = generate3TabHtml(normalizedTranscript, normalizedSegments, timelineNote || '', studyNote || '');
      console.log(`[${getKSTTimestamp()}] [INFO] [Server] HTML generated: ${styledHtml.length} chars`);
      
      // HTML 파일 백업 저장 (디버깅용 - VirtualBox 환경 문제 추적)
      const debugHtmlPath = path.join(__dirname, 'tmp', `debug_${sessionId}.html`);
      try {
        fs.writeFileSync(debugHtmlPath, styledHtml, 'utf-8');
        const savedSize = fs.statSync(debugHtmlPath).size;
        console.log(`[${getKSTTimestamp()}] [DEBUG] [HTML] Saved to ${debugHtmlPath} (${savedSize} bytes)`);
      } catch (writeErr) {
        console.error(`[${getKSTTimestamp()}] [ERROR] [HTML] Failed to save debug HTML:`, writeErr);
      }
    } catch (htmlErr) {
      console.error(`[${getKSTTimestamp()}] [ERROR] [HTML] Generation failed:`, htmlErr);
      styledHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body><h1>HTML Generation Error</h1><pre>${escapeHtml(String(htmlErr))}</pre></body></html>`;
    }
    perfTracker.endStage('rendering');

    // 11. 임시 파일 정리
    updateProgress(95, 'saving', '파일 저장 중...');
    cleanupFiles(mp4Path, mp3Path, chunks, chunkDir);
    console.log(`[${getKSTTimestamp()}] [INFO] [Server] Temp files cleaned up`);

    // 12. 성능 데이터 저장
    try {
      const perfData = perfTracker.toJSON();
      await savePerformanceData(perfData, videoInfo);
      console.log(`[${getKSTTimestamp()}] [INFO] [Performance] Performance data saved`);
    } catch (perfErr) {
      console.error(`[${getKSTTimestamp()}] [ERROR] [Performance] Failed to save performance data:`, perfErr);
    }

    // 13. 응답 전송
    updateProgress(100, 'complete', '완료!');
    console.log(`[${getKSTTimestamp()}] [DEBUG] [Server] Sending HTML response: ${styledHtml.length} bytes, Content-Type: text/html; charset=utf-8`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(styledHtml, 'utf-8'));
    res.send(styledHtml);
    
    console.log(`[${getKSTTimestamp()}] [INFO] [Server] Process completed in ${Date.now() - startTime}ms (sessionId: ${sessionId})`);
    console.log(`[${getKSTTimestamp()}] [INFO] [Server] Response sent successfully - check browser DevTools Network tab if rendering fails`);

  } catch (err) {
    console.error(`[${getKSTTimestamp()}] [ERROR] [Server] Process error:`, err);
    console.error(`[${getKSTTimestamp()}] [ERROR] [Server] Stack trace:`, err.stack);
    
    // 취소된 경우 특별 처리
    if (err.message === 'CANCELLED') {
      console.log(`[${getKSTTimestamp()}] [WARN] [Server] Session ${sessionId} was cancelled`);
      cancelledSessions.delete(sessionId);
      updateProgress(0, 'cancelled', 'Cancelled by user');
      
      // 임시 파일 정리
      try {
        if (mp4Path) fs.unlinkSync(mp4Path);
        if (mp3Path) fs.unlinkSync(mp3Path);
        if (chunks) cleanupFiles(null, null, chunks, chunkDir);
      } catch {}
      
      return res.status(499).send('Request cancelled by client');
    }
    
    updateProgress(0, 'error', 'Error occurred: ' + (err?.message || String(err)));
    
    // HTML 형식 오류 응답 (브라우저에서 표시 가능)
    const errorHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>오류 발생</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #d32f2f; }
    pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
    .info { background: #e3f2fd; padding: 15px; border-left: 4px solid #2196f3; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>⚠️ 처리 중 오류가 발생했습니다</h1>
  <p><strong>오류 메시지:</strong></p>
  <pre>${escapeHtml(err?.message || String(err))}</pre>
  <div class="info">
    <p><strong>트러블슈팅:</strong></p>
    <ul>
      <li>로그 파일을 확인하세요: <code>logs/nodejs_error.log</code></li>
      <li>VirtualBox 환경에서 실행 중이라면 권한 문제일 수 있습니다</li>
      <li>브라우저 DevTools (F12) Network 탭에서 응답 상태를 확인하세요</li>
      <li>재시도하거나 서버를 재시작하세요</li>
    </ul>
  </div>
  <p><small>SessionId: ${sessionId}</small></p>
</body>
</html>`;
    
    try {
      res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8').send(errorHtml);
    } catch {}
  }
});

/**
 * /health 엔드포인트 - 서버 상태 확인
 */
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    whisperServer: process.env.WHISPER_SERVER_URL || "http://127.0.0.1:5001"
  });
});

/**
 * /download-youtube 엔드포인트 - YouTube URL을 MP3로 직접 다운로드하여 반환
 */
app.post("/download-youtube", express.json(), async (req, res) => {
  const { videoUrl, sessionId } = req.body;
  
  console.log(`[${getKSTTimestamp()}] POST /download-youtube - sessionId: ${sessionId}`);
  console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] URL: ${videoUrl}`);
  
  const tmpDir = path.join(process.cwd(), "tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  const mp3Path = path.join(tmpDir, `youtube-${sessionId}.mp3`);
  
  try {
    // yt-dlp로 YouTube 오디오 직접 다운로드 (MP3)
    console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] Downloading audio with yt-dlp...`);
    
    // yt-dlp 경로 찾기 (포터블 환경 대응)
    let ytDlpPath = 'yt-dlp';
    
    // 1. 포터블 번들의 runtime/yt-dlp 확인
    const runtimeYtDlp = path.join(__dirname, '..', 'runtime', 'yt-dlp', 'yt-dlp.exe');
    if (fs.existsSync(runtimeYtDlp)) {
      ytDlpPath = runtimeYtDlp;
      console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] Using bundled yt-dlp: ${ytDlpPath}`);
    } else {
      // 2. Python Scripts 폴더 확인 (Setup 후 설치됨)
      const pythonScripts = path.join(__dirname, '..', 'runtime', 'python', 'Scripts', 'yt-dlp.exe');
      if (fs.existsSync(pythonScripts)) {
        ytDlpPath = pythonScripts;
        console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] Using Python Scripts yt-dlp: ${ytDlpPath}`);
      } else {
        // 3. PATH에서 찾기 (시스템 설치)
        try {
          const { stdout } = await execPromise('where yt-dlp', { shell: true });
          ytDlpPath = stdout.trim().split('\n')[0];
          console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] Using system yt-dlp: ${ytDlpPath}`);
        } catch (e) {
          console.log(`[${getKSTTimestamp()}] [ERROR] [YouTube] yt-dlp not found in any location`);
          throw new Error('yt-dlp not found. Please run Setup.exe first or install yt-dlp manually.');
        }
      }
    }
    
    // ffmpeg 경로 찾기 (포터블 환경 대응)
    let ffmpegLocation = '';
    const runtimeFfmpeg = path.join(__dirname, '..', 'runtime', 'ffmpeg', 'ffmpeg.exe');
    if (fs.existsSync(runtimeFfmpeg)) {
      ffmpegLocation = `--ffmpeg-location "${path.join(__dirname, '..', 'runtime', 'ffmpeg')}"`;
      console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] Using bundled ffmpeg: ${runtimeFfmpeg}`);
    } else {
      console.log(`[${getKSTTimestamp()}] [WARN] [YouTube] Bundled ffmpeg not found, relying on system PATH`);
    }
    
    const ytDlpCommand = `"${ytDlpPath}" -x --audio-format mp3 --audio-quality 0 ${ffmpegLocation} -o "${mp3Path}" "${videoUrl}"`;
    console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] Executing: ${ytDlpCommand.substring(0, 150)}...`);
    
    const { stdout, stderr } = await execPromise(ytDlpCommand, {
      timeout: 300000,  // 5분 타임아웃 (대용량 영상 대응)
      maxBuffer: 50 * 1024 * 1024  // 50MB 버퍼 (긴 로그 대응)
    });
    
    console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] Audio download completed`);
    if (stderr && !stderr.includes('Deleting original file')) {
      console.log(`[${getKSTTimestamp()}] [WARN] [YouTube] ${stderr.substring(0, 500)}`);
    }
    
    // 파일 존재 확인
    if (!fs.existsSync(mp3Path)) {
      throw new Error('Downloaded file not found. yt-dlp may have failed.');
    }
    
    const fileSize = fs.statSync(mp3Path).size;
    console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] Downloaded file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    
    // 파일을 blob으로 읽어서 반환
    const audioBuffer = fs.readFileSync(mp3Path);
    
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    res.send(audioBuffer);
    
    console.log(`[${getKSTTimestamp()}] [INFO] [YouTube] Audio sent to client (${audioBuffer.length} bytes)`);
    
    // 임시 파일 삭제
    try {
      fs.unlinkSync(mp3Path);
    } catch (e) {
      console.warn(`[${getKSTTimestamp()}] [WARN] [YouTube] Failed to delete temp file:`, e);
    }
    
  } catch (err) {
    console.error(`[${getKSTTimestamp()}] [ERROR] [YouTube] Download failed:`, err);
    
    // 상세 에러 정보 제공
    let errorMessage = 'YouTube download failed';
    if (err.message.includes('not found')) {
      errorMessage = 'yt-dlp not found. Please run Setup.exe to install dependencies.';
    } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
      errorMessage = 'Download timeout. The video may be too large or network is slow.';
    } else if (err.message.includes('Video unavailable') || err.message.includes('Private video')) {
      errorMessage = 'Video is unavailable, private, or region-locked.';
    } else if (err.message.includes('This video is not available')) {
      errorMessage = 'Video not available (deleted, private, or copyright claim).';
    } else {
      errorMessage = `YouTube download failed: ${err.message}`;
    }
    
    res.status(500).json({ error: errorMessage });
    
    // 임시 파일 정리
    try {
      if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
    } catch (e) {
      console.warn(`[${getKSTTimestamp()}] [WARN] [YouTube] Failed to cleanup temp file`);
    }
  }
});

/**
 * 임시 파일 정리 헬퍼
 */
function cleanupFiles(mp4Path, mp3Path, chunks, chunkDir) {
  try {
    const toDelete = new Set();
    toDelete.add(mp4Path);
    
    if (!chunks.includes(mp3Path)) {
      toDelete.add(mp3Path);
    }
    
    chunks.forEach(c => toDelete.add(c));

    toDelete.forEach(p => {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (e) {}
    });

    try {
      if (fs.existsSync(chunkDir)) {
        fs.rmdirSync(chunkDir, { recursive: true });
      }
    } catch (e) {}
  } catch (cleanupErr) {}
}

// ===== DASHBOARD API ENDPOINTS =====

/**
 * /dashboard - 웹 대시보드 페이지
 */
app.get("/dashboard", (req, res) => {
  const dashboardPath = path.join(__dirname, 'views', 'dashboard.html');
  if (fs.existsSync(dashboardPath)) {
    res.sendFile(dashboardPath);
  } else {
    res.status(404).send('Dashboard not found');
  }
});

/**
 * /api/logs/:type - 로그 파일 조회
 * @param type - whisper, whisper_error, nodejs, nodejs_error
 */
app.get("/api/logs/:type", (req, res) => {
  const { type } = req.params;
  const maxLines = parseInt(req.query.maxLines) || 500;
  const logData = readLogFile(type, maxLines);
  res.json(logData);
});

/**
 * /api/metrics - 성능 및 시스템 메트릭 조회
 */
app.get("/api/metrics", async (req, res) => {
  try {
    const [performance, system, serverStatus] = await Promise.all([
      Promise.resolve(getPerformanceData()),
      Promise.resolve(getSystemMetrics()),
      getServerStatus()
    ]);

    res.json({
      performance,
      system,
      serverStatus,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error(`[${getKSTTimestamp()}] [ERROR] [Dashboard] Failed to get metrics:`, err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * /api/performance - 성능 데이터만 조회
 */
app.get("/api/performance", (req, res) => {
  const performanceData = getPerformanceData();
  res.json(performanceData);
});

// 서버 시작
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[${getKSTTimestamp()}] [INFO] [Server] Server running on http://localhost:${PORT}`);
  console.log(`[${getKSTTimestamp()}] [INFO] [Server] Health check: http://localhost:${PORT}/health`);
});

// 타임아웃 설정 (30분)
server.timeout = 1800000;
server.keepAliveTimeout = 1800000;
server.headersTimeout = 1810000;
