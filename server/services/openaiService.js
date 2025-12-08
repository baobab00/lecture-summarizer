import { formatTime } from "../utils/formatters.js";

/**
 * JSON 응답에서 코드블록 마커 제거 및 순수 JSON 추출
 * @param {string} raw - GPT 응답 원문
 * @returns {string} - 순수 JSON 문자열
 */
function extractJSON(raw) {
  let cleaned = raw.trim();
  // 코드블록 마커 제거 (```json ... ``` 또는 ``` ... ```)
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  // 첫 { 부터 마지막 } 까지 슬라이스
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }
  return cleaned;
}

/**
 * 잘린 JSON 복구 시도
 * @param {string} jsonStr - 잘린 가능성이 있는 JSON 문자열
 * @returns {string} - 복구된 JSON 문자열
 */
function repairJSON(jsonStr) {
  let repaired = jsonStr.trim();
  
  // segments 배열이 끊긴 경우 복구
  if (repaired.includes('"segments"') && !repaired.endsWith('}')) {
    // 마지막 완전한 객체를 찾기
    const lastCompleteObj = repaired.lastIndexOf('},');
    if (lastCompleteObj > 0) {
      // 그 이후 불완전한 부분 제거하고 배열/객체 닫기
      repaired = repaired.substring(0, lastCompleteObj + 1);
      repaired += ']}'; // segments 배열 닫고 전체 객체 닫기
    }
  }
  
  // glossary 배열이 끊긴 경우
  if (repaired.includes('"glossary"') && repaired.includes('[') && !repaired.includes(']')) {
    const lastCompleteGloss = repaired.lastIndexOf('},');
    if (lastCompleteGloss > 0) {
      repaired = repaired.substring(0, lastCompleteGloss + 1);
      repaired += '],"segments":[]}';
    }
  }
  
  return repaired;
}

/**
 * 1차 전사 교정 & 도메인 분석
 * - Whisper 전사 결과(segments)를 받아서
 *   - 도메인 추론
 *   - 용어/오타 교정
 *   - 교정된 segments 반환
 *
 * @param {Array<{ start: number, end: number, text: string }>} segments
 * @param {import("openai").OpenAI} openaiClient
 * @returns {Promise<{ domain: string, glossary: Array<{original:string, corrected:string}>, segments: Array<{index:number,start:number,end:number,text:string}> }>}
 */
export async function analyzeAndNormalizeTranscript(segments, openaiClient) {
  // 세그먼트가 너무 많으면 샘플링 (토큰 제한 회피)
  let segmentsForPrompt = segments.map((seg, idx) => ({
    index: idx,
    start: seg.start,
    end: seg.end,
    text: seg.text,
  }));
  
  // 150개 이상이면 균등 샘플링으로 100개로 축소
  const MAX_SEGMENTS = 100;
  let samplingInfo = "";
  if (segmentsForPrompt.length > MAX_SEGMENTS) {
    const step = Math.ceil(segmentsForPrompt.length / MAX_SEGMENTS);
    const sampled = [];
    for (let i = 0; i < segmentsForPrompt.length; i += step) {
      sampled.push(segmentsForPrompt[i]);
    }
    samplingInfo = `\n[주의: 원본 ${segmentsForPrompt.length}개 세그먼트 중 ${sampled.length}개 샘플링하여 분석. 교정 적용 시 전체에 반영됨]\n`;
    segmentsForPrompt = sampled;
  }

  const prompt = `${samplingInfo}
당신은 강의 전사 텍스트를 교정하고 표준 용어로 정리하는 전문가입니다.

[목표]
- 전체 전사를 빠르게 읽고 강의의 도메인(예: 자료구조, 통계학, 미적분 등)을 파악한다.
- 도메인에 맞지 않는 오타/잘못된 용어를 교정한다.
- 가능한 한 **내용을 새로 만들어내지 말고**, 전사된 의미를 보존하면서 정제한다.

[규칙]
1. 각 segment는 반드시 그대로 유지하되, text만 교정한다.
2. start, end 값(초 단위)은 변경하지 않는다.
3. 아래와 같은 전형적인 오류를 교정한다 (맥락에 따라 적용):
   - "언더골기" → "언덕오르기"
   - "계랍" → "결합" (맥락상 자료구조일 때)
   - "비임탐색" → "빔(Beam) 탐색" (탐색 알고리즘 맥락일 때)
   - "데이타" → "데이터"
   - "프로그램만" → "프로그래밍" (맥락상 프로그래밍일 때)
   - "에이스타" → "A* 알고리즘" 또는 "A-star 알고리즘" (경로 탐색 알고리즘 맥락일 때)
   - 그 외 컴퓨터공학, 통계, 수학 용어는 가장 기술적인 표준 용어로 통일
4. 확실하지 않을 땐, 의미가 보존되는 범위에서 가장 기술적인 표현을 선택한다.
5. 문장이 끊겨 있으면 자연스러운 문장으로 다듬되, 새로운 내용은 추가하지 않는다.

[출력 형식(JSON)]
다음과 같은 JSON 객체를 **반드시** 반환하라.

{
  "domain": "예: 알고리즘 / 자료구조 / 통계 / 선형대수 / 기타 등",
  "glossary": [
    { "original": "언더골기", "corrected": "언덕오르기" },
    { "original": "데이타", "corrected": "데이터" }
  ],
  "segments": [
    {
      "index": 0,
      "start": 0.0,
      "end": 5.0,
      "text": "교정된 문장..."
    }
  ]
}

[입력 segments]
${JSON.stringify(segmentsForPrompt, null, 2)}
`;

  const completion = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You normalize noisy ASR transcripts into clean, technical Korean lecture transcripts without hallucinating new content. You MUST return valid JSON.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.0,
    max_tokens: 16000,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || "{}";

  // JSON 파싱 실패 시 원본 segments를 그대로 돌려주는 안전장치
  try {
    let jsonStr = extractJSON(raw);
    jsonStr = repairJSON(jsonStr);
    const parsed = JSON.parse(jsonStr);
    
    if (!parsed.segments || !Array.isArray(parsed.segments)) {
      throw new Error("Invalid JSON shape");
    }
    
    // 샘플링한 경우, glossary만 사용하고 전체 segments에 용어 교정 적용
    if (segmentsForPrompt.length < segments.length && parsed.glossary && parsed.glossary.length > 0) {
      console.log(`[analyzeAndNormalizeTranscript] Applying glossary (${parsed.glossary.length} terms) to all ${segments.length} segments`);
      
      const correctedSegments = segments.map((seg, idx) => {
        let correctedText = seg.text;
        // glossary 기반으로 전체 segments 교정
        parsed.glossary.forEach(({ original, corrected }) => {
          const regex = new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          correctedText = correctedText.replace(regex, corrected);
        });
        
        return {
          index: idx,
          start: seg.start,
          end: seg.end,
          text: correctedText,
        };
      });
      
      return {
        domain: parsed.domain || "unknown",
        glossary: parsed.glossary,
        segments: correctedSegments,
      };
    }
    
    return parsed;
  } catch (e) {
    console.warn("[analyzeAndNormalizeTranscript] JSON parse failed:", e);
    console.warn("[analyzeAndNormalizeTranscript] Raw response (first 500 chars):", raw.substring(0, 500));

    return {
      domain: "unknown",
      glossary: [],
      segments: segments.map((seg, idx) => ({
        index: idx,
        start: seg.start,
        end: seg.end || seg.start,
        text: seg.text,
      })),
    };
  }
}

/**
 * 타임라인 노트 생성 (대주제+시간 표기)
 * - 반드시 analyzeAndNormalizeTranscript 의 segments 결과를 넣어주는 것을 권장
 *
 * @param {Array<{ start: number, text: string }>} normalizedSegments
 * @param {import("openai").OpenAI} openaiClient
 * @param {{ domain?: string, glossary?: Array<{original:string,corrected:string}> }} meta
 *   (옵션) 도메인/용어 정보. 있으면 프롬프트에 참고용으로 넣어줌
 */
export async function generateTimelineNote(
  normalizedSegments,
  openaiClient,
  meta = {}
) {
  const segmentsText = normalizedSegments
    .map((seg) => `[${formatTime(seg.start)}] ${seg.text}`)
    .join("\n");

  const domainHint = meta.domain
    ? `도메인 힌트: 이 강의는 "${meta.domain}" 분야입니다.\n`
    : "";

  const glossaryHint =
    meta.glossary && meta.glossary.length
      ? `용어 교정 예시:\n${meta.glossary
          .slice(0, 10)
          .map((g) => `- "${g.original}" → "${g.corrected}"`)
          .join("\n")}\n`
      : "";

  const prompt = `
You are an expert at organizing **already-corrected** lecture transcripts into hierarchical Korean timeline notes.

${domainHint}${glossaryHint}

입력 텍스트는 이미 전사 오류와 용어가 교정된 상태이다.  
당신의 역할은,
- 주제 전환 지점을 찾고,
- 적절한 타임스탬프를 선택하고,
- 구조화된 타임라인 노트를 만드는 것이다.

CRITICAL RULES - TIMESTAMP FORMAT AND SELECTION:
1. Timestamps MUST use HH:MM:SS format (or MM:SS if under 1 hour)
   - 예: [00:00:30], [00:02:15], [01:15:00]
2. Major topics (##) 는 최소 2~3분 이상 간격으로 배치
3. 새로운 대주제가 실제로 시작되는 시점의 타임스탬프를 사용 (반올림 금지)
4. 25분 강의라면 대략 5~8개의 대주제가 적절

FORMATTING REQUIREMENTS:
1. Major topics: "## [HH:MM:SS] 주제명"
   - 주제명은 5~12 단어, 핵심 개념/알고리즘/방법을 포함
2. 하위 내용은 bullet/indentation 으로 계층 구조 표현
3. "대주제 1", "소주제 1-1" 같은 숫자 라벨 금지
4. 잘린 문장/중복된 표현은 자연스럽게 합쳐서 한 문장/한 bullet 로 정리
5. Major topic 사이에는 "---" 한 줄 삽입
6. 중요한 용어는 **bold**, 정의나 간단한 설명은 *italic* 로 표시
7. 수식은 $...$ LaTeX 형식 사용

[Corrected Transcript]
${segmentsText}

Output only the timeline note in Markdown (no preamble).
`;

  const completion = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You create precise lecture timeline notes given a clean, corrected transcript. You must obey the timestamp and formatting rules.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.3,
  });

  return completion.choices[0]?.message?.content || "";
}

/**
 * 학습 노트 생성 (강의 개요, 핵심 개념 맵, 스터디 가이드, Self-Check Quiz, 자주 헷갈리는 포인트)
 * - 기본적으로 analyzeAndNormalizeTranscript 의 segments 결과를 넣어주는 것을 추천
 * - 하위 호환을 위해 string transcript 도 허용
 *
 * @param {Array<{ start: number, text: string }> | string} source
 *   - Array: 교정된 segments 배열
 *   - string: 이미 합쳐진 transcript 전체 문자열
 * @param {import("openai").OpenAI} openaiClient
 * @param {{ domain?: string, glossary?: Array<{original:string,corrected:string}> }} meta
 */
export async function generateStudyNote(
  source,
  openaiClient,
  meta = {}
) {
  let transcript = "";

  if (Array.isArray(source)) {
    // normalizedSegments 배열인 경우
    transcript = source.map((seg) => seg.text).join("\n");
  } else if (typeof source === "string") {
    // 하위 호환: 기존처럼 transcript 문자열이 직접 넘어오는 경우
    transcript = source;
  } else {
    throw new Error(
      "generateStudyNote: source must be either normalizedSegments[] or transcript string"
    );
  }

  const domainHint = meta.domain
    ? `- 도메인: ${meta.domain}\n`
    : "";

  const prompt = `
You are an expert educator who creates comprehensive Korean study materials from lecture transcripts.

입력 텍스트는 이미 전사 오류와 용어가 교정된 상태의 강의 전체 스크립트이다.

[컨텍스트]
${domainHint}

CRITICAL RULES:
- 70% 강의 내용 기반, 30% 학습 도구로서 외부 지식 확장 가능 (단, 강의에서 다룬 개념만)
- 환각 금지: 강의에서 언급되지 않은 완전히 새로운 개념 추가 금지
- 명료하고 구조화된 학습 자료로 작성
- 수식(수학/과학 공식, 회로식, 통계식 등)은 반드시 LaTeX 형식으로 작성하고, 인라인 수식은 \`$...$\`, 블록 수식은 \`$$...$$\` 로 감싼다.
- **아래 5개 섹션을 반드시 모두 포함해야 함** (하나라도 빠뜨리면 안 됨)

OUTPUT STRUCTURE (Korean Markdown):

## 📚 강의 개요
강의의 핵심 주제와 흐름을 3~5줄로 압축 요약.
각 줄은 한 문장으로, 전체적으로 강의가 무엇을 다루는지 명확히 전달.

---

## 🗺️ 핵심 개념 맵
**[필수]** 강의에서 다룬 개념들을 계층 구조로 시각화.
**반드시** Mermaid.js 코드 블록을 사용하여 트리 구조 생성.

\`\`\`mermaid
graph TD
    A[강의 주제] --> B[주요 개념 1]
    A --> C[주요 개념 2]
    B --> D[세부 내용 1-1]
    B --> E[세부 내용 1-2]
    C --> F[세부 내용 2-1]
\`\`\`

**중요:** 위 예시처럼 반드시 \`\`\`mermaid 코드 블록을 작성해야 함.
노드명은 간결하게 (5~12자), 계층은 2~4단계 권장.
강의에서 실제 다룬 개념만 포함.

---

## 📖 스터디 가이드
강의에서 언급된 개념 또는 내용에 대해 **참고서 수준**의 배경 설명 제공. 구조화된 내용을 바탕으로 구체적인 설명 작성. 풍부한 예시와 비유 활용.
- 강의에서 다룬 내용을 70% 기반으로 하되, 30%는 외부 지식으로 확장
  - 예: 강의에서 "헤더 레코드"만 언급 → 실제 OS/로더에서 헤더의 역할, ELF/PE 포맷 예시, 일반적 필드(entry point, segment info) 설명
- 수학/과학/공학 관련 공식은 가능한 한 LaTeX 수식으로 표현하라.
- 표(table)는 아래 조건을 모두 만족할 때에만 작성한다.
  1) 서로 비교되는 항목이 최소 3개 이상 있을 때
     (예: 테스트 단계 4가지, 회로 종류 3가지, 알고리즘 3종 비교 등)
  2) 표가 없으면 한눈에 비교하기 어렵다고 판단되는 경우
  3) 한 섹션 전체에서 표는 최대 1개까지만 사용
- 위 조건을 만족하지 않으면 **표를 만들지 말고**, bullet 리스트로만 설명한다.
- 표를 만들 때는 Markdown 표 형식만 사용한다. (HTML table 태그 금지)
  - 예:
    | 항목 | 의미 | 특징 |
    | --- | --- | --- |
    | 직렬 회로 | ... | ... |
    | 병렬 회로 | ... | ... |

형식:
### ...
- ...
- ...

### ...
- ...
- ...

필요한 경우 소제목 추가 가능. 주요 개념 또는 내용이 생략되는 부분 없이 작성.

자유롭게 작성: 강의에서 다룬 주요 개념 또는 내용에 대해, 강의 내용을 벗어나지 않으면서 학습에 도움이 되는 가이드를 자유롭게 작성해 주세요. 외부 지식은 30% 이내로 확장하되, 반드시 강의에서 다룬 내용에 한정합니다.

---

## ✅ Self-Check Quiz
강의 내용 **기반**으로만 핵심 3문항 생성 (강의에서 다루지 않은 지식 문제 금지).

**1번 문항 (주관식)**
- Q. ...
- A. ...

**2번 문항 (주관식)**
- Q. ...
- A. ...

**3번 문항 (O/X)**
- Q. ...
- A. O (또는 X) - 이유: ...

---

## ⚠️ 자주 헷갈리는 포인트
강의에서 언급된 "주의", "오해 방지", "구분 필요" 개념이 있다면 우선 활용.
없다면 GPT가 강의 내용 분석하여 학습자가 헷갈릴만한 개념 1~2개 정리.

### Point 1: ...
- ...
- ...

### Point 2: ...
- ...
- ...

[Corrected Transcript]
${transcript}

Output only the study note in Markdown (no preamble).
`;

  const completion = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You create comprehensive Korean study materials from lecture transcripts. You balance lecture content (70%) with educational enhancements (30%) without hallucinating.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 1.0,
  });

  return completion.choices[0]?.message?.content || "";
}
