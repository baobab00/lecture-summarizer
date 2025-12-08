# Lecture Summarizer v1.0.0 - 빠른 시작 가이드

> 강의 영상을 자동으로 전사하고 GPT를 이용해 구조화된 학습 노트를 생성하는 프로그램입니다.

---

## 📦 설치 (처음 1회)

### 1단계: 다운로드

[GitHub Releases](https://github.com/baobab00/lecture-summarizer/releases)에서 최신 버전 다운로드:

```
LectureSummarizer-Portable-v1.0.0.zip
```

### 2단계: 압축 해제

원하는 위치에 압축 해제 (예: `C:\LectureSummarizer\`)

### 3단계: Setup.exe 실행

```
📁 LectureSummarizer-Portable-v1.0.0/
   ├── Setup.exe           ← 이것을 실행 (처음 1회만)
   ├── LectureSummarizer.exe
   ├── extension/
   └── ...
```

- Python 패키지가 자동으로 설치됩니다
- FFmpeg, Node.js는 `runtime/` 폴더에 포함되어 있습니다

> ⚠️ **Setup.exe는 처음 설치 시 1회만 실행**하면 됩니다.

---

## 🚀 프로그램 실행

### 1단계: LectureSummarizer.exe 실행

더블클릭하면 **시스템 트레이**(작업 표시줄 우측)에 아이콘이 나타납니다.

| 아이콘 색상 | 상태 |
|------------|------|
| 🔵 파란색 | 서버 중지됨 |
| 🟢 녹색 | 서버 실행 중 |
| 🔴 빨간색 | 오류 발생 |

### 2단계: 서버 시작

트레이 아이콘 **우클릭** → **"서버 시작"** 클릭

아이콘이 🟢 **녹색**으로 바뀌면 준비 완료!

---

## 🌐 Chrome 확장 프로그램 설치

1. Chrome에서 `chrome://extensions/` 접속
2. 우측 상단 **"개발자 모드"** 활성화 (토글 ON)
3. **"압축해제된 확장 프로그램을 로드합니다"** 클릭
4. 압축 해제한 폴더 내 **`extension`** 폴더 선택

설치 완료 후 Chrome 툴바에 Lecture Summarizer 아이콘이 나타납니다.

---

## 🔑 OpenAI API Key 설정

### API Key 발급

1. [OpenAI Platform](https://platform.openai.com/api-keys) 접속 및 로그인
2. **"Create new secret key"** 클릭
3. 생성된 키 복사 (`sk-...`로 시작)

> 💡 키는 한 번만 표시되므로 안전한 곳에 저장하세요!

### 크레딧 충전

- [Billing 페이지](https://platform.openai.com/account/billing)에서 **최소 $5** 충전 권장
- 1시간 강의 처리 비용: 약 $0.002~0.005 (매우 저렴)

### Extension에 키 등록

1. Chrome 확장 아이콘 클릭
2. **Settings** 탭에서 OpenAI API Key 입력
3. **"저장"** 클릭

---

## 🎬 강의 요약 사용법

### YouTube 영상

1. YouTube 강의 영상 페이지 방문
2. Chrome 확장 아이콘 클릭
3. 감지된 영상 정보 확인 (📺 표시)
4. **"✓"** 버튼 클릭
5. 처리 완료 대기 (영상 길이에 따라 1~5분)
6. 완료 후 HTML 노트가 자동으로 열립니다

### 일반 웹페이지 영상 (e-learning, 강의 사이트 등)

1. 강의 영상이 있는 웹페이지 방문
2. **영상을 재생** 시작 (자동 감지를 위해)
3. Chrome 확장 아이콘 클릭
4. 감지된 영상 정보 확인 (🎥 표시)
5. **"✓"** 버튼 클릭

---

## 📊 대시보드 (선택)

서버 상태, 로그, 성능 통계를 확인할 수 있습니다:

트레이 아이콘 **우클릭** → **"대시보드 열기"**

또는 브라우저에서 직접 접속: `http://127.0.0.1:3000/dashboard`

---

## ❓ 문제 해결

| 증상 | 해결 방법 |
|------|----------|
| Setup.exe 실행 오류 | 관리자 권한으로 실행 |
| 서버가 시작되지 않음 | 대시보드에서 로그 확인, 포트(3000/5001) 충돌 확인 |
| 트레이 "서버 시작" 비활성화 | 대시보드 열기로 자동 시작, 또는 5초 후 메뉴 다시 열기 |
| API 키 오류 | OpenAI API Key 확인 및 크레딧 잔액 확인 |
| YouTube 다운로드 실패 | Setup.exe 재실행하여 yt-dlp 설치 확인 |
| 영상이 감지되지 않음 | 영상을 먼저 재생한 후 확장 아이콘 클릭 |
| 처리가 오래 걸림 | 정상 (30분 영상 = 약 2~3분 소요) |
| HTML 렌더링 안 됨 | logs/nodejs_error.log 확인, 브라우저 F12 Network 탭 확인 |

---

## 📁 생성되는 파일

처리 완료 후 HTML 파일이 자동으로 저장됩니다:

```
lecture-note-2025-12-07T12-34-56.html
```

파일에는 3개 탭이 포함됩니다:
- **📝 전체 스크립트**: 타임스탬프가 포함된 전체 전사본
- **⏱️ 타임라인 노트**: 시간대별 정리된 노트
- **📚 학습 노트**: 핵심 개념, 스터디 가이드, 퀴즈

---

**자세한 내용은 [README.md](README.md) 참조**

**GitHub**: https://github.com/baobab00/lecture-summarizer
