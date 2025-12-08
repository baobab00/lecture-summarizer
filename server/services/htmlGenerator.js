import MarkdownIt from "markdown-it";
import { formatTime as formatTimeHHMMSS } from "../utils/formatters.js";

// HTML 허용 (필요 시)
const md = new MarkdownIt({ html: true });

/**
 * 시간 포맷 헬퍼 (초 → MM:SS) - HTML 생성용
 */
export function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * HTML 이스케이프
 */
export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 세그먼트를 문장 단위로 병합
 */
export function segmentsToSentences(segments) {
  const sentences = [];
  let buffer = { start: null, end: null, text: "" };

  const endMarks = /[.!?;]\s*$/;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (buffer.start === null) {
      buffer.start = seg.start;
    }

    buffer.end = seg.end;
    buffer.text += (buffer.text ? " " : "") + seg.text.trim();

    // 문장 끝 마크가 있으면 완성된 문장으로 저장
    if (endMarks.test(buffer.text)) {
      sentences.push({ ...buffer });
      buffer = { start: null, end: null, text: "" };
    }
  }

  // 남은 버퍼가 있으면 추가
  if (buffer.text.trim()) {
    sentences.push(buffer);
  }

  return sentences;
}

/**
 * Markdown을 HTML로 변환 (Mermaid 블록 처리 포함)
 * - ```mermaid 코드 블록을 <div class="mermaid">로 직접 변환
 * - 나머지는 MarkdownIt으로 렌더링
 */
export function markdownToStyledHtml(markdown) {
  // 1단계: Mermaid 블록을 플레이스홀더로 치환하고 저장
  const mermaidBlocks = [];
  const withPlaceholders = markdown.replace(
    /```mermaid\s*\r?\n([\s\S]*?)\r?\n```/g,
    (match, code) => {
      // HTML 주석 형태의 플레이스홀더 (MarkdownIt이 그대로 둠)
      const placeholder = `<!--MERMAID_PLACEHOLDER_${mermaidBlocks.length}-->`;
      mermaidBlocks.push(code.trim());
      return placeholder;
    }
  );

  // 2단계: MarkdownIt으로 나머지 렌더링
  let html = md.render(withPlaceholders);

  // 3단계: 플레이스홀더를 실제 Mermaid div로 복원
  mermaidBlocks.forEach((code, index) => {
    const placeholder = `<!--MERMAID_PLACEHOLDER_${index}-->`;
    const mermaidDiv = `<div class="mermaid">\n${code}\n</div>`;
    html = html.replace(placeholder, mermaidDiv);
  });

  return html;
}

/**
 * 3탭 HTML 생성 (전체 스크립트 + 타임라인 노트 + 학습 노트)
 */
export function generate3TabHtml(transcript, segments, timelineNote, studyNote) {
  const sentences = segmentsToSentences(segments);
  const scriptLines = sentences
    .map(
      (s, idx) => `
    <div class="script-line">
      <span class="line-number">${idx + 1}</span>
      <span class="timestamp">${formatTime(s.start)}</span>
      <span class="text">${escapeHtml(s.text)}</span>
    </div>`
    )
    .join("\n");

  const timelineHtml = markdownToStyledHtml(timelineNote);
  const studyHtml = markdownToStyledHtml(studyNote);

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>강의 노트</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
    }
    
    .header {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 20px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    
    .header h1 { font-size: 24px; font-weight: 600; margin-bottom: 10px; }
    
    .tabs { display: flex; gap: 8px; margin-top: 15px; }
    
    .tab {
      padding: 10px 20px;
      background: #f5f5f5;
      border: none;
      border-radius: 6px 6px 0 0;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
      color: #666;
    }
    
    .tab:hover { background: #e8e8e8; }
    .tab.active { background: #4CAF50; color: white; }
    
    .content-wrapper { max-width: 1200px; margin: 0 auto; padding: 30px 20px; }
    
    .tab-content {
      display: none;
      background: white;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .tab-content.active { display: block; }
    
    .script-line {
      display: flex;
      padding: 12px;
      border-bottom: 1px solid #f0f0f0;
      gap: 15px;
      align-items: flex-start;
    }
    
    .script-line:hover { background: #fafafa; }
    
    .line-number { min-width: 40px; color: #999; font-size: 13px; font-weight: 500; }
    .timestamp { min-width: 60px; color: #4CAF50; font-size: 13px; font-weight: 600; font-family: monospace; }
    .text { flex: 1; line-height: 1.7; }
    
    .note-content h1 {
      font-size: 28px;
      margin-top: 30px;
      margin-bottom: 15px;
      color: #111;
      border-bottom: 2px solid #333;
      padding-bottom: 8px;
    }
    
    .note-content h2 { font-size: 22px; margin-top: 25px; margin-bottom: 12px; color: #222; }
    .note-content h3 { font-size: 18px; margin-top: 20px; margin-bottom: 10px; color: #333; }
    .note-content h4 { font-size: 16px; margin-top: 15px; margin-bottom: 8px; color: #444; }
    
    .note-content p { margin-bottom: 12px; line-height: 1.8; }
    
    .note-content ul, .note-content ol { margin: 12px 0 12px 25px; }
    .note-content li { margin-bottom: 6px; line-height: 1.7; }
    .note-content ul ul, .note-content ol ul { margin: 8px 0 8px 20px; }
    
    .note-content hr { border: none; border-top: 1px solid #ddd; margin: 25px 0; }
    
    .note-content strong { font-weight: 600; color: #111; }
    .note-content em { font-style: italic; color: #555; }
    .note-content code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: monospace; font-size: 0.9em; }
    
    .note-content pre {
      background: #f8f8f8;
      padding: 15px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 15px 0;
      border-left: 3px solid #4CAF50;
    }
    
    .note-content pre code { background: none; padding: 0; }
    
    .note-content blockquote {
      border-left: 4px solid #4CAF50;
      padding-left: 20px;
      margin: 15px 0;
      color: #555;
      font-style: italic;
    }
    
    .note-content table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    
    .note-content th, .note-content td {
      border: 1px solid #ddd;
      padding: 10px;
      text-align: left;
    }
    
    .note-content th { background: #f5f5f5; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎓 강의 노트</h1>
    <div class="tabs">
      <button class="tab active" onclick="switchTab(0)">📝 전체 스크립트</button>
      <button class="tab" onclick="switchTab(1)">⏱️ 타임라인 노트</button>
      <button class="tab" onclick="switchTab(2)">📚 학습 노트</button>
    </div>
  </div>
  
  <div class="content-wrapper">
    <div id="tab-0" class="tab-content active">
      <h2 style="margin-bottom: 20px; color: #4CAF50;">📝 전체 스크립트</h2>
      ${scriptLines}
    </div>
    
    <div id="tab-1" class="tab-content note-content">
      ${timelineHtml}
    </div>
    
    <div id="tab-2" class="tab-content note-content">
      ${studyHtml}
    </div>
  </div>
  
  <script>
    let mermaidInitialized = false;

    function initMermaidOnce() {
      if (typeof mermaid === "undefined") {
        console.error("[Mermaid] Library not loaded");
        return false;
      }
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "loose",
        });
        mermaidInitialized = true;
      }
      return true;
    }

    // 특정 탭(index)의 .mermaid 들만 한 번 렌더링
    function renderMermaidInTab(index) {
      if (!initMermaidOnce()) return;

      // 🔧 템플릿 리터럴 대신 문자열 연결 사용
      var tabId = "tab-" + index;
      var tab = document.getElementById(tabId);
      if (!tab) return;

      // 이미 렌더링한 탭이면 스킵
      if (tab.dataset.mermaidRendered === "true") return;

      var selector = "#" + tabId + " .mermaid";

      try {
        if (typeof mermaid.run === "function") {
          mermaid.run({ querySelector: selector });
        } else if (typeof mermaid.init === "function") {
          mermaid.init(undefined, selector);
        }
        // 이 탭은 렌더 완료 표시
        tab.dataset.mermaidRendered = "true";
      } catch (e) {
        console.error("[Mermaid] Render error:", e);
      }
    }

    function switchTab(index) {
      const tabs = document.querySelectorAll(".tab");
      const contents = document.querySelectorAll(".tab-content");

      tabs.forEach((btn, i) => btn.classList.toggle("active", i === index));
      contents.forEach((content, i) =>
        content.classList.toggle("active", i === index)
      );

      // 탭 전환 후, 해당 탭에서 최초 1회만 mermaid 렌더
      setTimeout(function () {
        renderMermaidInTab(index);
      }, 0);
    }

    // DOM 로드 완료 후 초기화
    document.addEventListener("DOMContentLoaded", function () {
      console.log("[Init] DOM Content Loaded");

      // KaTeX 렌더링
      if (typeof renderMathInElement !== "undefined") {
        renderMathInElement(document.body, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
          ],
        });
      }

      // 초기 활성 탭(0번)에 mermaid가 있다면 렌더 시도
      setTimeout(function () {
        renderMermaidInTab(0);
      }, 0);
    });
  </script>

</body>
</html>
`;
}
