# 프로젝트 구조

## 개요

Lecture Summarizer는 강의 영상을 자동으로 전사하고 GPT를 이용해 구조화된 학습 노트를 생성하는 시스템입니다. Chrome Extension, Node.js/Python 백엔드, 시스템 트레이 관리 앱으로 구성됩니다.

### 시스템 아키텍처

```text
┌─────────────────────────────────────┐
│  Chrome Extension                   │
│  - YouTube 영상 자동 감지           │
│  - 웹페이지 비디오 자동 감지        │
│  - 진행도 모니터링                  │
└─────────────────────────────────────┘
       ↓ HTTP
┌─────────────────────────────────────┐
│  Node.js Server (Express)           │
│  - 파일 처리 및 변환                │
│  - Whisper 서버 호출                │
│  - GPT API 호출                     │
│  - HTML 생성 및 반환                │
└─────────────────────────────────────┘
       ↓ HTTP
┌─────────────────────────────────────┐
│  Python Whisper Server (FastAPI)    │
│  - Faster-Whisper 전사              │
│  - CPU 모드 (모든 시스템 지원)      │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  System Tray App (Windows)          │
│  - 서버 시작/중지                   │
│  - 웹 대시보드 자동 시작            │
│  - 성능 모니터링 & 로그 조회        │
└─────────────────────────────────────┘
       ↓ HTTP (Browser)
┌─────────────────────────────────────┐
│  Web Dashboard (Responsive UI)      │
│  - Whisper/Node.js 로그             │
│  - 성능 통계 (30분 기준 정규화)    │
│  - CPU/메모리 메트릭                │
└─────────────────────────────────────┘
```

## 디렉터리 구조

```text
lecture-summarizer/
├── extension/                    # Chrome Extension
│   ├── manifest.json            # Manifest v3 설정
│   ├── popup.html/js            # 설정 UI
│   ├── content.js               # YouTube 영상 감지
│   ├── background.js            # Service Worker
│   └── icon*.png                # 확장 아이콘
│
├── server/                       # 백엔드 서버
│   ├── server.js                # Express 메인 서버 (포트 3000)
│   ├── whisper_server.py        # Whisper 전사 서버 (포트 5001, FastAPI)
│   ├── requirements.txt         # Python 의존성
│   ├── package.json             # Node.js 의존성
│   │
│   ├── config/
│   │   └── config.js            # 서버 설정
│   ├── middleware/
│   │   └── cors.js              # CORS 미들웨어
│   ├── services/
│   │   ├── openaiService.js     # GPT-4o-mini API 호출
│   │   ├── htmlGenerator.js     # HTML 생성 (3탭 인터페이스)
│   │   └── dashboardService.js  # 대시보드 데이터 서비스
│   ├── views/
│   │   └── dashboard.html       # 웹 대시보드 UI (반응형 디자인)
│   ├── utils/
│   │   ├── audioConverter.js    # FFmpeg 오디오 변환
│   │   ├── transcription.js     # Whisper 클라이언트 호출
│   │   ├── performanceTracker.js # 성능 측정 (각 단계별 시간)
│   │   ├── performanceLogger.js  # 통계 저장 (30분 기준 정규화)
│   │   └── formatters.js        # 유틸리티 함수
│   ├── fonts/                   # 폰트 파일
│   │   ├── NotoSansKR-*.otf    # 한글 폰트
│   │   └── OFL.txt             # 라이선스
│   ├── logs/
│   │   ├── whisper.log         # Whisper 서버 로그
│   │   ├── whisper_error.log   # Whisper 에러 로그 (UTF-8)
│   │   ├── nodejs.log          # Node.js 서버 로그
│   │   ├── nodejs_error.log    # Node.js 에러 로그
│   │   └── performance.json    # 성능 통계 (세션 200개 보관)
│   └── tmp/                    # 임시 파일 (다운로드, 변환)
│
├── tray_app/                    # 시스템 트레이 앱 (Windows pystray)
│   ├── tray_manager.py         # 트레이 메인 (서버 제어, 대시보드 자동 시작)
│   ├── log_viewer.py           # (Deprecated) tkinter 대시보드
│   └── icon_*.ico              # 상태별 아이콘 (idle/running/error)
│
├── runtime/ (개발 중 생성됨)      # Portable 빌드 런타임
│   ├── python/                 # Python 런타임 (3.11.9)
│   ├── node/                   # Node.js 런타임 (18.19.0)
│   ├── ffmpeg/                 # FFmpeg 바이너리
│   └── whisper-models/         # Whisper 모델 캐시 (base 모델)
│
├── logs/                        # 로그 파일 (대시보드에서 실시간 조회)
│   ├── whisper.log             # Whisper 서버 로그
│   ├── whisper_error.log       # Whisper 에러 로그
│   ├── nodejs.log              # Node.js 서버 로그
│   ├── nodejs_error.log        # Node.js 에러 로그
│   └── performance.json        # 성능 통계 (JSON)
│
├── docs/
│   └── project-structure.md    # 프로젝트 구조 문서
├── README.md                   # 메인 문서
└── QUICK_START.md              # 빠른 시작 가이드
```

## 주요 컴포넌트 상세

### Chrome Extension

| 파일 | 역할 |
|------|------|
| `manifest.json` | 확장 프로그램 설정 (권한, 스크립트) |
| `popup.html/js` | 설정 UI (API Key, 저장 경로) |
| `content.js` | YouTube 영상 감지 |
| `background.js` | 메인 로직 (다운로드, 서버 통신) |

### Node.js 서버

**주요 엔드포인트:**

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/process` | POST | 비디오 처리 (multipart/form-data) |
| `/download-youtube` | POST | YouTube 영상 다운로드 (MP3) |
| `/api/progress/:sessionId` | GET | 진행도 조회 |
| `/api/cancel/:sessionId` | POST | 작업 취소 |
| `/health` | GET | 서버 상태 확인 |

**기술 스택:** Express, Multer, OpenAI SDK, yt-dlp, FFmpeg

### Python Whisper 서버

**엔드포인트:**

- `/transcribe` (POST): 음성 파일 → 텍스트 전사
- `/health` (GET): 서버 상태 확인

**모델 설정:**

- MODEL_SIZE: base (~140MB)
- DEVICE: cpu (모든 시스템에서 동작)
- COMPUTE_TYPE: int8 (CPU 최적화)

## 처리 파이프라인

### 1. 초기 설정

```text
Chrome Extension 설정
  → OpenAI API Key 입력
  → 저장 폴더 경로 지정
  → Chrome Storage에 저장
```

### 2. 영상 처리 흐름

**YouTube 영상:**

```text
1. YouTube 페이지 방문
2. Extension에서 영상 정보 자동 감지
3. 확인 버튼 클릭
4. 서버에서 yt-dlp로 MP3 다운로드
5. 처리 파이프라인 진입
```

**일반 웹페이지 영상:**

```text
1. 강의 영상이 있는 웹페이지 방문
2. 영상 재생 (DOM에서 비디오 자동 감지)
3. Extension 팝업에서 감지된 영상 확인
4. 확인 버튼 클릭
5. 서버에서 URL로 직접 다운로드
6. 처리 파이프라인 진입
```

### 3. 서버 처리 단계 (7단계)

```text
1. 동영상 처리
   - YouTube: yt-dlp로 MP3 직접 다운로드
   - 웹페이지 영상: URL에서 직접 다운로드

2. 음성 추출
   - MP4 → MP3 변환 (32kbps, 16kHz)
   - MP3 파일은 변환 생략

3. 음성 분할
   - 20MB 초과 시 자동 분할

4. 음성 인식 (Whisper)
   - Faster-Whisper 로컬 전사
   - 타임스탬프 세그먼트 생성

5. 내용 분석
   - 텍스트 정제
   - 도메인 분석
   - 전문 용어 교정

6. 노트 생성 (GPT)
   - 타임라인 노트
   - 학습 노트

7. HTML 렌더링
   - 3탭 HTML 생성
   - KaTeX 수식 렌더링
```

### 4. 시스템 트레이 관리

```text
tray_manager.py 실행
  → 서버 시작/중지 제어
  → 모니터링 대시보드 (성능 통계)
  → 개발자 로그 뷰어
```

## 환경 설정

### Node.js 서버

**config/config.js:**

```javascript
PORT = 3000
WHISPER_SERVER_URL = "http://127.0.0.1:5001"
AUDIO_OPTIONS = { bitrate: "32k", frequency: 16000 }
```

### Python Whisper 서버

**환경 변수:**

```bash
WHISPER_MODEL=base     # tiny, base, small, medium
WHISPER_DEVICE=cpu     # CPU 모드 (기본값)
WHISPER_COMPUTE=int8   # int8 (CPU 최적화)
```

## 의존성

### Python (requirements.txt)

| 패키지 | 용도 |
|--------|------|
| faster-whisper | 음성 전사 |
| fastapi | Whisper 서버 API |
| uvicorn | ASGI 서버 |
| python-multipart | 파일 업로드 |
| yt-dlp | YouTube 다운로드 |
| pystray | 트레이 앱 |
| pillow | 이미지 처리 |
| requests | HTTP 클라이언트 |

### Node.js (package.json)

| 패키지 | 용도 |
|--------|------|
| express | HTTP 서버 |
| multer | 파일 업로드 |
| openai | GPT API 클라이언트 |
| fluent-ffmpeg | FFmpeg 래퍼 |
| axios | HTTP 클라이언트 |
| form-data | Multipart 데이터 |
| markdown-it | Markdown 파싱 |

## 개발 환경

### 로컬 개발

```powershell
# Python 환경
cd server
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Node.js 환경
npm install

# 서버 실행 (트레이 앱 사용 권장)
cd ..
python tray_app/tray_manager.py
```

### Portable 빌드

```powershell
.\build-portable.ps1
# 결과: build/LectureSummarizer-Portable-v{version}/
```



## 주요 변경사항 (최근 업데이트)

### 웹 대시보드 완성

- **`server/views/dashboard.html`** - 반응형 웹 대시보드 UI
- **`server/services/dashboardService.js`** - 대시보드 데이터 API
- 기존 tkinter 대시보드 (log_viewer.py)는 deprecated
- 로그 실시간 조회, 성능 분석, 시스템 메트릭 제공

### 트레이 앱 개선

- **자동 대시보드 시작**: 서버 꺼져있으면 자동으로 시작 후 브라우저에 오픈
- **종료 기능 수정**: `os._exit(0)`으로 강제 종료 (daemon 스레드 정리)
- **메뉴 단순화**: 이모지 제거, 가독성 개선

### 성능 통계 정규화

- **`server/utils/performanceLogger.js`** - 30분 기준 정규화 적용
- `averageTime`, `minTime`, `maxTime` 모두 정규화됨
- 각 세션의 실제 영상 길이에 따라 자동 계산
- 예: 10분 영상 × 3 = 30분 기준 시간

### 진행도 메시지 표준화

- **`extension/background.js`** - YouTube와 일반 웹 영상 경로 통일
- 초기 진행도: 10% (웹), 5% (YouTube)
- 서버 폴링 시작: 20% (기존 30%에서 변경)
- 서버 메시지: 30% → 50% → 65% → 85% → 95% → 100%

### 에러 로깅 개선

- **`server/whisper_server.py`** - Windows UTF-8 인코딩 설정
- 헬스체크 로그 필터링 (GET / 제외)
- 타임아웃 연결 에러 필터링 (WinError 10054 제외)

## 주요 기능 상세

### Chrome Extension

- YouTube 영상 자동 감지 및 다운로드 (yt-dlp)
- 일반 웹페이지 비디오 자동 감지
- 진행도 실시간 추적 및 업데이트
- 중복 요청 방지

### Node.js 서버 기능

- 멀티파트 파일 업로드 (최대 500MB)
- FFmpeg 오디오 변환 (MP4 → MP3)
- Whisper 서버 호출
- GPT 기반 콘텐츠 분석 및 노트 생성
- 웹 대시보드 API 제공

### Python Whisper 서버 기능

- Faster-Whisper CPU 모드 (모든 시스템 지원)
- Base 모델 (~140MB)
- Int8 최적화
- 비동기 음성 전사

### 시스템 트레이 앱

- 서버 원클릭 시작/중지
- 웹 대시보드 자동 시작
- 실시간 상태 확인
- Windows 시스템 트레이 통합

### 웹 대시보드

- **Whisper Logs 탭**: 서버 & 에러 로그 실시간 조회
- **Node.js Logs 탭**: API & 에러 로그 조회
- **Performance 탭**:
  - 총 처리 건수, 평균/최소/최대 시간
  - 7단계별 소요 시간 차트
  - CPU/메모리 메트릭
  - 시스템 정보 (OS, CPU, 메모리, 가동시간)
  - 영상 길이 자동 정규화
  - 5초 간격 자동 새로고침

## 관련 문서

- [README.md](../README.md) - 상세 사용 가이드
- [QUICK_START.md](../QUICK_START.md) - 빠른 시작 안내
