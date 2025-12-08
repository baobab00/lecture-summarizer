#!/usr/bin/env python3
"""
Faster-Whisper 로컬 전사 서버
- CPU 기본 모드로 모든 시스템에서 동작 가능
- 저 메모리 환경에 최적화된 성능
- OpenAI Whisper API 호환 인터페이스
"""

import os
import sys
import tempfile
import logging
import asyncio
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import uvicorn

# Windows 콘솔 인코딩 설정 (한글 깨짐 방지)
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 로깅 설정 (표준화된 형식)
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [Whisper] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Uvicorn access log에서 health check 요청 필터링
class HealthCheckFilter(logging.Filter):
    def filter(self, record):
        # "GET / HTTP" 또는 "GET /health" 요청은 로그에서 제외
        message = record.getMessage()
        if '"GET / HTTP' in message or '"GET /health HTTP' in message:
            return False
        return True

# ConnectionResetError 등 연결 관련 에러 필터링 (타임아웃된 클라이언트)
class ConnectionErrorFilter(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        # 연결 끊김 관련 무해한 에러 필터링
        if 'ConnectionResetError' in message:
            return False
        if '_call_connection_lost' in message:
            return False
        if 'WinError 10054' in message:
            return False
        return True

# uvicorn access 로거에 필터 적용
logging.getLogger("uvicorn.access").addFilter(HealthCheckFilter())

# asyncio 에러 로거에 ConnectionError 필터 적용
logging.getLogger("asyncio").addFilter(ConnectionErrorFilter())

# 전역 모델 (서버 시작 시 한 번만 로드)
model: Optional[WhisperModel] = None

# 설정 (환경 변수로 오버라이드 가능)
MODEL_SIZE = os.getenv("WHISPER_MODEL", "base")  # tiny, base, small, medium, large-v3
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")      # cpu (로컬 완전 실행을 위해 기본값 변경)
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "int8")  # int8 (CPU 최적화)

# 포터블 환경 모델 캐시 경로 설정
def get_model_cache_dir():
    """포터블 환경에서 모델 캐시 디렉토리 설정"""
    # 1. runtime 폴더에 whisper-models 있는지 확인
    runtime_models = Path(__file__).parent.parent / 'runtime' / 'whisper-models'
    if runtime_models.exists():
        return str(runtime_models)
    
    # 2. 포터블 앱 내 캐시 폴더
    cache_dir = Path(__file__).parent.parent / '.cache' / 'huggingface' / 'hub'
    cache_dir.mkdir(parents=True, exist_ok=True)
    return str(cache_dir)

MODEL_CACHE_DIR = os.getenv("WHISPER_CACHE", get_model_cache_dir())


@asynccontextmanager
async def lifespan(app: FastAPI):
    """서버 라이프사이클 관리 - 안정적 모델 로드"""
    global model
    
    logger.info(f"Loading Whisper model (size={MODEL_SIZE}, device=CPU, compute={COMPUTE_TYPE})")
    logger.info(f"Model cache directory: {MODEL_CACHE_DIR}")
    
    max_retries = 3
    retry_count = 0
    
    while retry_count < max_retries:
        try:
            model = WhisperModel(
                MODEL_SIZE,
                device=DEVICE,
                compute_type=COMPUTE_TYPE,
                download_root=MODEL_CACHE_DIR,
                local_files_only=False  # 첫 실행 시 다운로드 허용
            )
            logger.info(f"Model loaded successfully (CPU mode)")
            break
        except Exception as e:
            retry_count += 1
            logger.error(f"Failed to load model (attempt {retry_count}/{max_retries}): {e}")
            if retry_count < max_retries:
                logger.info(f"Retrying in 5 seconds...")
                await asyncio.sleep(5)
            else:
                logger.critical(f"Failed to load model after {max_retries} retries")
                raise
    
    yield
    
    # 종료 시 정리
    logger.info("Server shutting down...")


# FastAPI 앱 초기화 (lifespan 적용)
app = FastAPI(title="Faster-Whisper Transcription Server", lifespan=lifespan)

# CORS 허용 (로컬 개발용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def health_check():
    """헬스 체크 엔드포인트"""
    return {
        "status": "running",
        "model": MODEL_SIZE,
        "device": "cpu",
        "ready": model is not None
    }


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    오디오 파일 전사
    
    Args:
        file: MP3/WAV/M4A 등 오디오 파일
    
    Returns:
        {"text": "전사된 텍스트"}
    """
    global model
    
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")
    
    # 파일 확장자 검증
    allowed_extensions = {'.mp3', '.wav', '.m4a', '.flac', '.ogg', '.opus'}
    file_ext = Path(file.filename).suffix.lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format: {file_ext}"
        )
    
    # 임시 파일로 저장
    temp_file = None
    try:
        # 임시 파일 생성 (자동 삭제 방지)
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as temp_file:
            # 업로드된 파일 내용을 임시 파일에 쓰기
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name
        
        logger.info(f"Transcription started: {file.filename} ({len(content)} bytes, type={file.content_type})")

        def do_transcribe():
            segs, info = model.transcribe(
                temp_path,
                language="ko",  # 한국어 명시 (정확도 향상)
                beam_size=5,
                vad_filter=True,  # Voice Activity Detection (침묵 구간 제거)
                vad_parameters=dict(
                    min_silence_duration_ms=500  # 0.5초 이상 침묵 제거
                ),
                word_timestamps=True  # 단어별 타임스탬프 활성화
            )
            segments_with_time = []
            full_text_parts = []
            for segment in segs:
                segments_with_time.append({
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": segment.text.strip()
                })
                full_text_parts.append(segment.text)
            full_text = " ".join(full_text_parts)
            logger.info(
                f"Transcription completed: {file.filename} "
                f"(lang={info.language}, prob={info.language_probability:.2%}, "
                f"segments={len(segments_with_time)}, chars={len(full_text)})"
            )
            return {
                "text": full_text,
                "segments": segments_with_time,
                "language": info.language,
                "duration": round(info.duration, 2)
            }

        # 1차 시도 (CPU 모드)
        try:
            return JSONResponse(content=do_transcribe())
        except Exception as e1:
            msg = str(e1)
            logger.error(f"Transcription failed: {msg}")
            raise HTTPException(status_code=500, detail={
                "error": "Transcription failed",
                "message": msg
            })
        
    finally:
        # 임시 파일 정리
        if temp_file is not None:
            try:
                os.unlink(temp_path)
            except Exception as e:
                logger.warning(f"Failed to delete temp file: {temp_path} - {e}")


if __name__ == "__main__":
    # Uvicorn으로 서버 실행
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=5001,
        log_level="info"
    )
