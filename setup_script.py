#!/usr/bin/env python3
"""
Lecture Summarizer Setup Script
포터블 환경에서 필수 의존성 설치
"""

import os
import sys
import subprocess
import shutil
import time
from pathlib import Path


def get_base_path():
    """실행 파일 기준 경로 반환"""
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    return Path(__file__).parent.parent


def get_startupinfo():
    """Windows에서 subprocess 창 숨기기"""
    if sys.platform == 'win32':
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        return startupinfo
    return None


def find_python():
    """시스템에 설치된 Python 찾기"""
    base = get_base_path()
    
    # 1. runtime/python 확인
    runtime_python = base / "runtime" / "python" / "python.exe"
    if runtime_python.exists():
        return str(runtime_python)
    
    # 2. PATH에서 python 찾기
    python_path = shutil.which("python")
    if python_path:
        return python_path
    
    # 3. py launcher 시도
    py_path = shutil.which("py")
    if py_path:
        return py_path
    
    return None


def check_python():
    """Python 설치 확인"""
    python_exe = find_python()
    if not python_exe:
        return False, None
    
    try:
        result = subprocess.run(
            [python_exe, "--version"],
            capture_output=True,
            timeout=5,
            startupinfo=get_startupinfo()
        )
        if result.returncode == 0:
            return True, python_exe
    except Exception as e:
        print(f"  Error checking Python: {e}")
    
    return False, None


def install_python_packages(python_exe):
    """Python 패키지 설치"""
    base = get_base_path()
    
    packages = [
        "requests>=2.28.0",
        "pystray>=0.19.0",
        "Pillow>=10.0.0",
        "python-dotenv>=1.0.0",
        "faster-whisper>=1.0.0",
        "ctranslate2>=3.0.0",
        "yt-dlp>=2023.0.0",
        "fastapi>=0.100.0",
        "uvicorn[standard]>=0.22.0",
        "python-multipart>=0.0.6"
    ]
    
    max_retries = 2
    
    for attempt in range(max_retries):
        try:
            print(f"  Attempt {attempt + 1}/{max_retries}...")
            
            result = subprocess.run(
                [python_exe, "-m", "pip", "install", "--upgrade", "pip"],
                capture_output=True,
                timeout=60,
                startupinfo=get_startupinfo()
            )
            
            for package in packages:
                result = subprocess.run(
                    [python_exe, "-m", "pip", "install", package],
                    capture_output=True,
                    timeout=120,
                    startupinfo=get_startupinfo()
                )
                
                if result.returncode != 0:
                    error_msg = result.stderr[:500].decode('utf-8', errors='ignore') if result.stderr else "Unknown error"
                    print(f"    Package {package} failed: {error_msg}")
                else:
                    print(f"    ✓ {package}")
            
            print("  Python packages installed successfully!")
            return True
            
        except subprocess.TimeoutExpired:
            print(f"  Attempt {attempt + 1} timeout - network may be slow")
        except Exception as e:
            print(f"  Attempt {attempt + 1} error: {e}")
        
        if attempt < max_retries - 1:
            print("  Retrying in 5 seconds...")
            time.sleep(5)
    
    print("  WARNING: Package installation may have failed.")
    return False


def check_ffmpeg():
    """FFmpeg 설치 확인"""
    base = get_base_path()
    ffmpeg_path = base / "runtime" / "ffmpeg" / "ffmpeg.exe"
    
    if ffmpeg_path.exists():
        return True
    
    return shutil.which("ffmpeg") is not None


def check_node():
    """Node.js 설치 확인"""
    base = get_base_path()
    node_path = base / "runtime" / "node" / "node.exe"
    
    if node_path.exists():
        return True
    
    return shutil.which("node") is not None


def main():
    print("=" * 50)
    print("  Lecture Summarizer Setup")
    print("=" * 50)
    print()
    
    base = get_base_path()
    print(f"Installation path: {base}")
    print()
    
    # 1. Python 확인
    print("[1/4] Checking Python...")
    python_found, python_exe = check_python()
    if python_found:
        print(f"  OK: Python found at {python_exe}")
    else:
        print("  ERROR: Python is not installed")
        print("  Please install Python 3.8+ from python.org")
        input("\nPress Enter to exit...")
        return 1
    
    # 2. Python 패키지 설치
    print()
    print("[2/4] Installing Python packages...")
    if not install_python_packages(python_exe):
        print("  WARNING: Some packages may not be installed")
    
    # 3. FFmpeg 확인
    print()
    print("[3/4] Checking FFmpeg...")
    if check_ffmpeg():
        print("  OK: FFmpeg is available")
    else:
        print("  WARNING: FFmpeg not found")
        print("  Please check that ffmpeg is in runtime/ffmpeg/")
    
    # 4. Node.js 확인
    print()
    print("[4/4] Checking Node.js...")
    if check_node():
        print("  OK: Node.js is available")
    else:
        print("  WARNING: Node.js not found")
    
    print()
    print("=" * 50)
    print("  Setup Complete!")
    print("=" * 50)
    print()
    print("You can now run LectureSummarizer.exe to start the program.")
    print()
    
    input("Press Enter to exit...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
