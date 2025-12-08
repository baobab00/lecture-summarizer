# ============================================================
# Lecture Summarizer - Portable Build Script (v1.0.0)
# PyInstaller onedir
# ============================================================

param(
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"

# 색상 출력 함수
function Write-Step { param($msg) Write-Host "`n[STEP] $msg" -ForegroundColor Cyan }
function Write-Info { param($msg) Write-Host "  [INFO] $msg" -ForegroundColor Gray }
function Write-Success { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warning { param($msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }

# 기본 경로 설정
$ProjectRoot = $PSScriptRoot
$DistDir = Join-Path $ProjectRoot "dist"
$BuildDir = Join-Path $DistDir "LectureSummarizer-Portable-v$Version"

Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  Lecture Summarizer Portable Build" -ForegroundColor Magenta
Write-Host "  Version: v$Version (onedir mode)" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta

# ============================================================
# Step 1: 이전 빌드 정리
# ============================================================
Write-Step "이전 빌드 정리"

if (Test-Path $BuildDir) {
    Remove-Item -Recurse -Force $BuildDir
    Write-Info "기존 빌드 폴더 삭제됨"
}

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
Write-Success "빌드 폴더 생성"

# ============================================================
# Step 2: 프로젝트 파일 복사
# ============================================================
Write-Step "프로젝트 파일 복사"

# extension 폴더
Copy-Item -Recurse -Force (Join-Path $ProjectRoot "extension") (Join-Path $BuildDir "extension")
Write-Info "extension 폴더 복사됨"

# server 폴더 (node_modules 제외)
$ServerSrc = Join-Path $ProjectRoot "server"
$ServerDst = Join-Path $BuildDir "server"
New-Item -ItemType Directory -Force -Path $ServerDst | Out-Null

Get-ChildItem -Path $ServerSrc -Exclude "node_modules", "tmp", "logs", ".env" | ForEach-Object {
    Copy-Item -Recurse -Force $_.FullName (Join-Path $ServerDst $_.Name)
}
Write-Info "server 폴더 복사됨"

# server/tmp, server/logs 생성
New-Item -ItemType Directory -Force -Path (Join-Path $ServerDst "tmp") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ServerDst "logs") | Out-Null

# .env.example → .env
Copy-Item -Force (Join-Path $ServerSrc ".env.example") (Join-Path $ServerDst ".env") -ErrorAction SilentlyContinue
Write-Info ".env 복사됨"

# tray_app 폴더
$TraySrc = Join-Path $ProjectRoot "tray_app"
$TrayDst = Join-Path $BuildDir "tray_app"
New-Item -ItemType Directory -Force -Path $TrayDst | Out-Null

@("tray_manager.py", "icon_idle.ico", "icon_running.ico", "icon_error.ico") | ForEach-Object {
    Copy-Item -Force (Join-Path $TraySrc $_) (Join-Path $TrayDst $_) -ErrorAction SilentlyContinue
}
Write-Info "tray_app 폴더 복사됨"

# logs, docs 폴더
New-Item -ItemType Directory -Force -Path (Join-Path $BuildDir "logs") | Out-Null
Copy-Item -Recurse -Force (Join-Path $ProjectRoot "docs") (Join-Path $BuildDir "docs") -ErrorAction SilentlyContinue
Copy-Item -Force (Join-Path $ProjectRoot "QUICK_START.md") (Join-Path $BuildDir "QUICK_START.md")
Copy-Item -Force (Join-Path $ProjectRoot "README.md") (Join-Path $BuildDir "README.md")
Write-Info "문서 파일 복사됨"

# ============================================================
# Step 3: Runtime 환경 복사
# ============================================================
Write-Step "Runtime 환경 복사"

$RuntimeSrc = Join-Path $ProjectRoot "runtime"
$RuntimeDst = Join-Path $BuildDir "runtime"

if (Test-Path $RuntimeSrc) {
    Copy-Item -Recurse -Force $RuntimeSrc $RuntimeDst
    Write-Success "runtime 폴더 복사됨"
}

# ============================================================
# Step 3.5: yt-dlp 다운로드
# ============================================================
Write-Step "yt-dlp 다운로드 (YouTube 다운로더)"

$YtDlpDir = Join-Path $RuntimeDst "yt-dlp"
$YtDlpExe = Join-Path $YtDlpDir "yt-dlp.exe"

New-Item -ItemType Directory -Force -Path $YtDlpDir | Out-Null

try {
    Write-Info "yt-dlp.exe 다운로드 중..."
    $YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    Invoke-WebRequest -Uri $YtDlpUrl -OutFile $YtDlpExe -UseBasicParsing
    Write-Success "yt-dlp.exe 다운로드 완료"
} catch {
    Write-Warning "yt-dlp.exe 다운로드 실패: $_"
}

# ============================================================
# Step 4: Node.js 의존성 설치
# ============================================================
Write-Step "Node.js 의존성 설치"

$NodeExe = Join-Path $RuntimeDst "node\node.exe"
$NpmCmd = Join-Path $RuntimeDst "node\npm.cmd"

if (Test-Path $NodeExe) {
    Push-Location $ServerDst
    try {
        & $NpmCmd install --production 2>&1 | Out-Null
        Write-Success "node_modules 설치됨"
    } catch {
        Write-Warning "npm install 실패"
    }
    Pop-Location
}

# ============================================================
# Step 5: Python Build Script 생성
# ============================================================
Write-Step "Setup.exe용 Python 스크립트 생성"

$PythonBuildScript = Join-Path $ProjectRoot "setup_script.py"
$TempSetupScript = Join-Path $BuildDir "setup_for_build.py"

Copy-Item -Force $PythonBuildScript $TempSetupScript
Write-Success "Setup 스크립트 준비됨"

# ============================================================
# Step 6: PyInstaller 빌드 - Setup.exe는 onefile로 유지
# ============================================================
Write-Step "Setup.exe 생성 (PyInstaller - onefile)"

Push-Location $BuildDir

# 임시 빌드 정리
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $BuildDir "build")
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $BuildDir "dist")

try {
    # Setup.exe는 단순 스크립트이므로 onefile 사용 (문제없음)
    pyinstaller --onefile --console --name "Setup" `
        --hidden-import=requests `
        --hidden-import=urllib3 `
        "$TempSetupScript" 2>&1 | Out-Null
    
    $SetupExe = Join-Path $BuildDir "dist\Setup.exe"
    if (Test-Path $SetupExe) {
        # dist/Setup.exe를 최상위로 이동
        Move-Item -Force $SetupExe (Join-Path $BuildDir "Setup.exe")
        Write-Success "Setup.exe 생성됨 (onefile - 단일 파일)"
    }
} catch {
    Write-Warning "Setup.exe 빌드 실패: $_"
}

Pop-Location

# ============================================================
# Step 7: LectureSummarizer.exe 생성 (onefile - 원복)
# ============================================================
Write-Step "LectureSummarizer.exe 생성 (PyInstaller - onefile)"

$TrayScript = Join-Path $BuildDir "tray_app\tray_manager.py"
$IconPath = Join-Path $TrayDst "icon_idle.ico"

Push-Location $BuildDir

# 임시 빌드 정리
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $BuildDir "build")
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $BuildDir "dist")

try {
    # UPX 압축 비활성화하여 아카이브 손상 방지
    pyinstaller --onefile --windowed --name "LectureSummarizer" `
        --icon "$IconPath" `
        --noupx `
        --hidden-import=pystray `
        --hidden-import=PIL `
        --hidden-import=PIL.Image `
        --hidden-import=PIL.ImageDraw `
        --hidden-import=requests `
        --hidden-import=urllib3 `
        --hidden-import=certifi `
        --hidden-import=faster_whisper `
        --hidden-import=yt_dlp `
        --hidden-import=ctranslate2 `
        --collect-all=pystray `
        --collect-all=PIL `
        --collect-all=ctranslate2 `
        "$TrayScript" 2>&1 | Out-Null
    
    $BuiltExe = Join-Path $BuildDir "dist\LectureSummarizer.exe"
    if (Test-Path $BuiltExe) {
        # dist/LectureSummarizer.exe를 최상위로 이동
        Move-Item -Force $BuiltExe (Join-Path $BuildDir "LectureSummarizer.exe")
        Write-Success "LectureSummarizer.exe 생성됨 (onefile - 단일 파일, UPX 비활성화)"
    }
} catch {
    Write-Warning "LectureSummarizer.exe 빌드 실패: $_"
}

Pop-Location

# 임시 파일 정리
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $BuildDir "build")
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $BuildDir "dist")
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $BuildDir "*.spec")
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $BuildDir "setup_for_build.py")

# ============================================================
# Step 8: 버전 파일 생성
# ============================================================
Write-Step "버전 정보 파일 생성"

$VersionFile = Join-Path $BuildDir "VERSION.txt"
$VersionContent = @"
Lecture Summarizer v$Version

Build Date: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Build Type: PyInstaller onedir (portable)

Components:
- Chrome Extension (Manifest v3)
- Node.js Server
- Python Whisper Server
- System Tray Manager

GitHub: https://github.com/baobab00/lecture-summarizer
"@

Set-Content -Path $VersionFile -Value $VersionContent -Encoding UTF8
Write-Success "VERSION.txt 생성됨"

# ============================================================
# Step 9: ZIP 패키지 생성
# ============================================================
Write-Step "ZIP 패키지 생성"

$ZipFile = Join-Path $DistDir "LectureSummarizer-Portable-v$Version.zip"

if (Test-Path $ZipFile) {
    Remove-Item -Force $ZipFile
}

Compress-Archive -Path $BuildDir -DestinationPath $ZipFile -Force
Write-Success "ZIP 파일 생성됨"

# ============================================================
# 완료
# ============================================================
Write-Host "`n============================================" -ForegroundColor Green
Write-Host "  Build Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green

Write-Host "`nOutput:" -ForegroundColor White
Write-Host "  Folder: $BuildDir" -ForegroundColor Gray
Write-Host "  ZIP:    $ZipFile" -ForegroundColor Gray

Write-Host "`nContents:" -ForegroundColor White
Get-ChildItem $BuildDir -Depth 0 | ForEach-Object {
    $icon = if ($_.PSIsContainer) { "[DIR]" } else { "[FILE]" }
    Write-Host "  $icon $($_.Name)" -ForegroundColor Gray
}

Write-Host "`nHow to use:" -ForegroundColor Yellow
Write-Host "  1. Run Setup.exe first (install dependencies)" -ForegroundColor Gray
Write-Host "  2. Run LectureSummarizer.exe (start tray app)" -ForegroundColor Gray
Write-Host "  3. Right-click tray icon -> 'Dashboard' or 'Start Server'" -ForegroundColor Gray

Write-Host "`nDone!" -ForegroundColor Green
