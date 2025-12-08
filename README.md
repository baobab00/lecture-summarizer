# Lecture Summarizer

강의 영상을 로컬에서 자동 전사하고 GPT를 이용해 구조화된 학습 노트를 생성하는 Chrome 확장 프로그램입니다.

## 개요

Lecture Summarizer는 완전 로컬 환경에서 동작합니다:

- **음성 전사**: Faster-Whisper (CPU 모드) - 완전 로컬 실행
- **요약 생성**: OpenAI GPT-4o-mini API
- **프론트엔드**: Chrome Extension (Manifest v3)
- **백엔드**: Node.js + Python 마이크로서비스
- **관리 도구**: Windows 시스템 트레이 앱 (성능 모니터링 포함)

## 주요 기능

- YouTube 영상 자동 다운로드 및 처리 (yt-dlp)
- 로컬 음성 전사 (Faster-Whisper CPU 모드)
- GPT 기반 구조화된 노트 생성 (타임라인 + 학습 노트)
- 3탭 HTML 인터페이스 및 수식 렌더링 (KaTeX)
- 시스템 트레이 관리 (서버 제어, 웹 대시보드)
- 웹 기반 모니터링 대시보드 (로그 뷰어, 성능 모니터링)
- 실시간 진행도 추적 및 작업 취소

## 기술 스택

| 계층 | 기술 | 버전 |
|------|------|------|
| 프론트엔드 | Chrome Extension (Manifest v3) | - |
| 백엔드 | Node.js + Express | 18+ |
| 음성 전사 | Python + Faster-Whisper | 3.8+ |
| 서버 | FastAPI + Uvicorn | - |
| 오디오 처리 | FFmpeg | - |
| 영상 다운로드 | yt-dlp | 2025.11.12+ |
| AI 모델 | Whisper (base) | 1.1.0 |
| 요약 생성 | OpenAI API | gpt-4o-mini |

## 시스템 요구사항

### 필수

- OS: Windows 10/11 (64-bit)
- Python 3.8+
- Node.js 18+
- FFmpeg
- RAM: 최소 8GB (권장 16GB)
- 디스크: 2GB 여유
- 브라우저: Chrome

### API 및 비용

- OpenAI API Key (필수)
- 평균 비용: 1시간 강의 $0.002~0.005 (gpt-4o-mini 기준)

## 설치 및 실행

### Portable 버전 설치 (권장)

1. **다운로드**: [GitHub Releases](https://github.com/baobab00/lecture-summarizer/releases)에서 `LectureSummarizer-Portable-vX.X.X.zip` 다운로드
2. **압축 해제**: 원하는 위치에 압축 해제
3. **Setup.exe 실행**: 폴더 안의 `Setup.exe` 실행
   - Python, Node.js, FFmpeg 등 필수 프로그램 자동 설치
   - ⚠️ **처음 1회만 실행**
4. **트레이 앱 실행**: `LectureSummarizer.exe` 더블클릭
5. **서버 시작**: 트레이 아이콘 우클릭 → "서버 시작"

### 개발 환경 설정 (개발자용)

Python 패키지 설치:

```bash
cd server
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Node 패키지 설치:

```bash
cd server
npm install
```

### Chrome Extension 로드

1. Chrome에서 `chrome://extensions/` 접속
2. 우측 상단 "개발자 모드" 활성화
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. 프로젝트 폴더의 `extension/` 선택

### 3단계: Extension 설정

1. Chrome 우측 상단 확장 프로그램 아이콘 클릭
2. "Lecture Summarizer" 클릭
3. 다음 정보 입력:
   - OpenAI API Key (필수)
   - HTML 저장 폴더 (선택)
4. "저장" 클릭

### 4단계: 서버 시작

**시스템 트레이 앱 사용 (권장):**

```bash
cd tray_app
python tray_manager.py
```

트레이 아이콘 우클릭 → "🟢 서버 시작" 클릭

**트레이 앱 주요 기능:**
- 서버 원클릭 시작/중지
- 📊 **대시보드 열기**: 성능 모니터링 및 개발자 로그
- 서버 상태 실시간 확인
- 로그 폴더 바로 가기

**또는 수동 실행:**

```bash
# 터미널 1 - Whisper 서버
cd server
python whisper_server.py

# 터미널 2 - Node.js 서버
cd server
node server.js
```

## 사용 방법

### 강의 요약 생성

**방법 1: YouTube 영상**
1. YouTube 영상 페이지 방문
2. Chrome 확장 프로그램 아이콘 클릭
3. 영상 정보 확인 (📺 아이콘 표시)
4. "✓" 버튼 클릭
5. 자동 다운로드 및 처리 대기 (1~5분)
6. 완료 후 자동 오픈 및 저장

**방법 2: 일반 웹페이지 영상**
1. 강의 영상이 있는 웹페이지 방문 (e-learning, 강의 사이트 등)
2. 영상 재생 시작 (DOM에서 비디오 감지를 위해)
3. Chrome 확장 프로그램 아이콘 클릭
4. 감지된 영상 정보 확인 (🎥 아이콘 표시)
5. "✓" 버튼 클릭
6. 처리 대기 (1~5분)
7. 완료 후 자동 오픈 및 저장

### 처리 흐름 (7단계 파이프라인)

```text
1. 비디오 선택 (YouTube 또는 웹페이지 영상)
   ↓
2. 💾 동영상 처리 (Video processing)
   - YouTube: yt-dlp로 MP3 직접 다운로드
   - 웹페이지 영상: URL에서 직접 다운로드
   ↓
3. 🎵 음성 추출 (Audio extraction)
   - MP4 → MP3 변환 (32kbps, 16kHz)
   - MP3 파일은 변환 생략
   ↓
4. ✂️ 음성 분할 (Audio splitting)
   - 분할 (20MB 초과 시)
   ↓
5. 🎤 음성 인식 (Speech recognition - Whisper)
   - Faster-Whisper 로컬 전사
   - 타임스탬프 세그먼트 생성
   - 영상 길이 자동 추출
   ↓
6. 🔍 내용 분석 (Content analysis)
   - 텍스트 정제 및 도메인 분석
   - 전문 용어 교정
   ↓
7. 📝 노트 생성 (Note generation - GPT)
   - 타임라인 노트 생성
   - 학습 노트 생성
   ↓
8. 🎨 HTML 렌더링 (HTML rendering)
   - 3탭 HTML 생성 (스크립트/타임라인/요약)
   - KaTeX 수식 렌더링
   ↓
9. 저장 및 브라우저 오픈
   - 성능 데이터 저장 (performance.json)
```

**성능 추적:**
- 각 단계별 소요 시간 측정
- 30분 강의 기준 정규화 통계
- 최대 200개 세션 이력 보관

## 환경 변수 및 설정

### Node.js 서버 (`.env`)

```ini
PORT=3000
WHISPER_API_URL=http://127.0.0.1:5001
WHISPER_MODEL=base
GPT_MODEL=gpt-4o-mini
```

### Python Whisper 서버 (환경 변수)

```bash
WHISPER_MODEL=base           # tiny, base, small, medium
WHISPER_COMPUTE=int8         # int8 (CPU 최적화)
```

## 프로젝트 구조

```text
lecture-summarizer/
├── extension/                 # Chrome Extension
│   ├── manifest.json
│   ├── popup.html/js         # 설정 UI
│   ├── content.js            # YouTube 영상 감지
│   ├── background.js         # Service Worker
│   └── icon*.png             # 확장 아이콘
├── server/                    # 백엔드
│   ├── server.js             # Express 서버 (포트 3000)
│   ├── whisper_server.py     # Whisper 전사 서버 (포트 5001)
│   ├── requirements.txt      # Python 의존성
│   ├── package.json          # Node.js 의존성
│   ├── config/               # 서버 설정
│   ├── middleware/           # CORS 미들웨어
│   ├── services/             # 비즈니스 로직
│   │   ├── openaiService.js  # GPT API 서비스
│   │   ├── htmlGenerator.js  # HTML 생성
│   │   └── dashboardService.js  # 대시보드 API 서비스
│   ├── views/                # 웹 페이지
│   │   └── dashboard.html    # 웹 대시보드 UI
│   ├── utils/                # 유틸리티
│   │   ├── audioConverter.js # 오디오 변환
│   │   ├── transcription.js  # Whisper 클라이언트
│   │   ├── performanceTracker.js  # 성능 측정
│   │   ├── performanceLogger.js   # 통계 저장
│   │   └── formatters.js     # 포맷터
│   ├── fonts/                # 한글 폰트 (Noto Sans KR)
│   ├── logs/                 # 성능 데이터
│   │   └── performance.json  # 세션별 처리 시간
│   └── tmp/                  # 임시 파일
├── tray_app/                 # 시스템 트레이 앱
│   ├── tray_manager.py       # 서버 제어
│   └── icon_*.ico            # 상태별 아이콘
├── logs/                     # 서버 로그
│   ├── whisper.log
│   ├── whisper_error.log
│   ├── nodejs.log
│   └── nodejs_error.log
├── docs/
│   └── project-structure.md  # 상세 구조 문서
├── README.md                 # 메인 문서
└── QUICK_START.md            # 빠른 시작 가이드
```

자세한 구조는 `docs/project-structure.md` 참조.

## 웹 대시보드

시스템 트레이 앱에서 **"대시보드 열기"** 메뉴를 클릭하면 기본 브라우저에서 웹 대시보드(`http://127.0.0.1:3000/dashboard`)가 열립니다.

### 대시보드 탭 구성

웹 대시보드는 다음 3개의 탭으로 구성되어 있습니다:

1. **Whisper Logs**: Whisper 서버 로그 및 에러 로그 조회
2. **Node.js Logs**: Node.js 서버 로그 및 에러 로그 조회
3. **Performance**: 성능 모니터링 및 시스템 메트릭 조회

### Performance 탭

성능 분석 (30분 강의 기준):

- 총 처리 건수, 평균/최소/최대 시간 표시
- 7단계별 소요 시간 시각화 (막대 그래프)
- 전체 처리 시간 비율 (30분 대비)
- CPU/메모리 사용량 실시간 모니터링

특징:

- 영상 길이 자동 정규화 (예: 10분 영상 → ×3, 60분 영상 → ÷2)
- 최대 200개 세션 이력 보관
- 자동 새로고침 (5초 간격)

### 로그 형식

```text
[2025-12-05 04:19:20] [INFO] [Server] Server running on http://localhost:3000
[2025-12-05 04:19:22] [INFO] [Audio] Converting video to MP3...
[2025-12-05 04:20:48] [INFO] [Transcribe] Video duration: 14m 5s
```

## Whisper 모델 선택

CPU 모드에서:

| 모델 | 크기 | 메모리 | 속도 | 정확도 |
|------|------|--------|------|--------|
| tiny | 75MB | 500MB | 매우 빠름 | 낮음 |
| base | 140MB | 1GB | 보통 | 보통 |
| small | 460MB | 2GB | 느림 | 높음 |
| medium | 1.5GB | 5GB | 매우 느림 | 매우 높음 |

모델 변경:

```python
# server/whisper_server.py
MODEL_SIZE = "small"  # base → small
```

또는 환경 변수:

```bash
$env:WHISPER_MODEL='small'
python server/whisper_server.py
```

## 보안 및 개인정보

- OpenAI API Key: Chrome Storage에만 저장
- 영상 데이터: 로컬 서버에서만 처리
- Whisper 전사: 로컬 CPU에서 실행
- GPT 호출: 정제된 텍스트만 전송

## 문제 해결

### Whisper 서버 연결 실패

```
✓ 첫 실행 시 모델 다운로드 (~140MB)
✓ http://127.0.0.1:5001 접속 확인
✓ 방화벽에서 포트 5001 허용 확인
```

### OpenAI API Key 오류

```
✓ Extension 설정에서 Key 재확인
✓ platform.openai.com에서 유효성 확인
✓ API 사용 가능 여부 확인
```

### 전사 품질 개선

```
✓ 더 큰 모델 사용 (base → small)
✓ 원본 음질 확인
✓ 배경 소음 최소화
```

### HTML 파일 저장 안 됨

```
✓ 폴더 경로 확인
✓ 폴더 쓰기 권한 확인
✓ Chrome 다운로드 권한 확인 (chrome://settings/downloads)
```

## 개발 환경

### 로컬 개발

```bash
# Python venv
cd server
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Node 의존성
npm install

# 각각 터미널에서 실행
python whisper_server.py    # 터미널 1
node server.js              # 터미널 2
```

### Portable 빌드 (배포용)

```bash
# 모든 개발 완료 후
.\build-portable.ps1
# 결과: dist/LectureSummarizer-Portable-v1.0.0/
```

## 버전 관리 및 릴리즈

- 개발: main 브랜치
- 정식 릴리즈: v1.0.0 Portable 빌드 (Python, Node.js, FFmpeg, Whisper 모델 포함)
- 배포: GitHub Releases

## 빠른 참조

### 서버 포트

| 서비스 | 포트 | 주소 |
|--------|------|------|
| Node.js API | 3000 | `http://127.0.0.1:3000` |
| Whisper | 5001 | `http://127.0.0.1:5001` |

### 주요 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/process` | POST | 비디오 처리 요청 (multipart/form-data) |
| `/download-youtube` | POST | YouTube 영상 다운로드 (MP3) |
| `/api/progress/:sessionId` | GET | 진행도 조회 (0-100%) |
| `/api/cancel/:sessionId` | POST | 작업 취소 |
| `/dashboard` | GET | 웹 대시보드 페이지 |
| `/api/logs/:type` | GET | 로그 조회 (whisper, nodejs, whisper_error, nodejs_error) |
| `/api/metrics` | GET | 성능 및 시스템 메트릭 조회 |
| `/api/performance` | GET | 성능 데이터 조회 |
| `/transcribe` | POST | 음성 전사 (Whisper 서버) |
| `/health` | GET | 서버 상태 확인 |

### 성능 데이터 구조

`server/logs/performance.json`:
```json
{
  "sessions": [
    {
      "sessionId": "1764876082507",
      "timestamp": "2025-12-05T04:19:20.512Z",
      "videoInfo": {
        "filename": "lecture.mp4",
        "format": "mp4",
        "sizeBytes": 33232037,
        "durationSeconds": 845
      },
      "stages": {
        "download": { "label": "Video processing", "duration": 16 },
        "audioConversion": { "label": "Audio extraction", "duration": 3661 },
        "audioSplit": { "label": "Audio splitting", "duration": 1 },
        "transcription": { "label": "Speech recognition (Whisper)", "duration": 88851 },
        "analysis": { "label": "Content analysis", "duration": 150006 },
        "generation": { "label": "Note generation (GPT)", "duration": 34043 },
        "rendering": { "label": "HTML rendering", "duration": 7 }
      },
      "totalTime": 276591
    }
  ],
  "statistics": {
    "totalProcessed": 3,
    "averageTime": 325432,
    "normalized30min": {
      "transcription": { "average": 170234, "count": 3 },
      "analysis": { "average": 200010, "count": 3 }
    }
  }
}
```

### 추천 폴더 경로

```text
C:\LectureSummaries\     # HTML 저장
C:\ffmpeg\bin\           # FFmpeg 바이너리
```

---

## 관련 문서

- [프로젝트 구조](docs/project-structure.md)
- [빠른 시작 가이드](QUICK_START.md)

**문의 및 버그**: [Issues](https://github.com/baobab00/lecture-summarizer/issues)
