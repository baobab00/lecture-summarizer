#!/usr/bin/env python3
"""
Lecture Summarizer - System Tray Manager
사용자가 서버를 시작/중지할 수 있는 시스템 트레이 애플리케이션
"""

import sys
import os
import subprocess
import requests
import time
import webbrowser
from pathlib import Path
from threading import Thread
import shutil
import pystray
from PIL import Image, ImageDraw


class LectureSummarizerTray:
    def __init__(self):
        self.server_processes = {
            'whisper': None,
            'nodejs': None
        }

        # 경로 설정: PyInstaller(onefile)에서는 sys.executable 기준으로 잡아야 외부 리소스 접근 가능
        self.base_path = self._get_base_path()
        self.server_path = self.base_path / 'server'
        self.logs_path = self.base_path / 'logs'
        self.icons_path = self.base_path / 'tray_app'

        self.logs_path.mkdir(exist_ok=True)
        self.server_running = False
        self.app_running = True  # 앱 종료 플래그 추가

    def _get_base_path(self) -> Path:
        """실행 기준 경로 반환 (포터블/개발 환경 모두 대응)"""
        if getattr(sys, 'frozen', False):
            return Path(sys.executable).parent
        return Path(__file__).resolve().parent.parent
    
    def _find_python(self):
        """시스템에서 Python 찾기"""
        # 1. runtime/python 확인
        runtime_python = self.base_path / 'runtime' / 'python' / 'python.exe'
        if runtime_python.exists():
            return runtime_python
        
        # 2. PATH에서 python 찾기
        python_path = shutil.which('python')
        if python_path:
            return Path(python_path)
        
        # 3. py launcher 시도
        py_path = shutil.which('py')
        if py_path:
            return Path(py_path)
        
        return None
    
    def _find_node(self):
        """시스템에서 Node.js 찾기"""
        # 1. runtime/node 확인
        runtime_node = self.base_path / 'runtime' / 'node' / 'node.exe'
        if runtime_node.exists():
            return runtime_node
        
        # 2. PATH에서 node 찾기
        node_path = shutil.which('node')
        if node_path:
            return Path(node_path)
        
        return None
        
    def create_icon_image(self, color):
        """간단한 아이콘 생성 (fallback)"""
        image = Image.new('RGB', (64, 64), color)
        draw = ImageDraw.Draw(image)
        draw.ellipse([16, 16, 48, 48], fill='white')
        return image
    
    def get_icon(self, state='idle'):
        """상태에 따른 아이콘 로드"""
        icon_files = {
            'idle': 'icon_idle.ico',
            'running': 'icon_running.ico',
            'error': 'icon_error.ico'
        }
        
        icon_path = self.icons_path / icon_files.get(state, 'icon_idle.ico')
        
        if icon_path.exists():
            return Image.open(icon_path)
        
        # Fallback: 색상으로 간단하게 생성
        colors = {'idle': '#4A90E2', 'running': '#4CAF50', 'error': '#F44336'}
        return self.create_icon_image(colors.get(state, '#4A90E2'))
    
    def check_server_status(self):
        """서버 실행 상태 확인"""
        try:
            whisper = requests.get('http://localhost:5001/', timeout=2)
            nodejs = requests.get('http://localhost:3000/health', timeout=2)
            return whisper.ok and nodejs.ok
        except:
            return False
    
    def _kill_process_on_port(self, port):
        """지정된 포트에서 실행 중인 프로세스 종료"""
        try:
            if sys.platform == 'win32':
                # netstat으로 포트에 바인딩된 PID 찾기 (LISTENING 및 TIME_WAIT 모두 처리)
                netstat_cmd = f'netstat -ano | findstr :{port}'
                result = subprocess.run(netstat_cmd, shell=True, capture_output=True, text=True, timeout=10)
                
                if result.stdout:
                    killed_pids = set()
                    lines = result.stdout.strip().split('\n')
                    for line in lines:
                        # LISTENING, ESTABLISHED, TIME_WAIT 등 모든 상태에서 PID 추출
                        parts = line.split()
                        if len(parts) >= 5:
                            pid = parts[-1]
                            # 숫자인지 확인하고 이미 종료하지 않은 PID만 처리
                            if pid.isdigit() and pid not in killed_pids and pid != '0':
                                killed_pids.add(pid)
                                try:
                                    subprocess.run(f'taskkill /PID {pid} /F', shell=True, 
                                                 capture_output=True, timeout=5)
                                    print(f"Killed process {pid} on port {port}")
                                except Exception as e:
                                    print(f"Failed to kill PID {pid}: {e}")
                    
                    # 포트 정리 후 대기
                    if killed_pids:
                        time.sleep(1)
        except Exception as e:
            print(f"Error killing process on port {port}: {e}")
    
    def _start_servers_internal(self, icon):
        """서버 시작 (내부용 - 알림 없이, 재시도 로직 포함)"""
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                # 기존 포트 정리
                print(f"[Attempt {retry_count + 1}/{max_retries}] Cleaning up ports...")
                self._kill_process_on_port(5001)
                self._kill_process_on_port(3000)
                time.sleep(2)  # 포트 정리 후 충분히 대기
                
                # Python 및 Node.js 경로 찾기
                python_exe = self._find_python()
                node_exe = self._find_node()
                
                if not python_exe:
                    raise RuntimeError("Python not found")
                if not node_exe:
                    raise RuntimeError("Node.js not found")
                
                # 환경 변수 설정 (포터블 모드)
                env = os.environ.copy()
                
                # Whisper 모델 캐시 경로 설정 (포터블 환경)
                cache_dir = self.base_path / '.cache' / 'huggingface' / 'hub'
                cache_dir.mkdir(parents=True, exist_ok=True)
                env['WHISPER_CACHE'] = str(cache_dir)
                env['TRANSFORMERS_CACHE'] = str(cache_dir)
                env['HF_HOME'] = str(self.base_path / '.cache')
                
                # FFmpeg 경로 설정 (runtime에서 찾기)
                ffmpeg_exe = self.base_path / 'runtime' / 'ffmpeg' / 'ffmpeg.exe'
                if ffmpeg_exe.exists():
                    env['FFMPEG_PATH'] = str(ffmpeg_exe)
                
                # yt-dlp PATH에 추가 (우선순위: runtime/yt-dlp → Python Scripts)
                yt_dlp_runtime = self.base_path / 'runtime' / 'yt-dlp' / 'yt-dlp.exe'
                yt_dlp_scripts = self.base_path / 'runtime' / 'python' / 'Scripts' / 'yt-dlp.exe'
                
                if yt_dlp_runtime.exists():
                    env['PATH'] = str(yt_dlp_runtime.parent) + ';' + env.get('PATH', '')
                elif yt_dlp_scripts.exists():
                    env['PATH'] = str(yt_dlp_scripts.parent) + ';' + env.get('PATH', '')
                
                # Whisper 서버 시작
                icon.notify("모델 로딩 중... (최초 실행 시 시간이 소요될 수 있습니다)", "Lecture Summarizer")
                whisper_cmd = [str(python_exe), str(self.server_path / 'whisper_server.py')]
                self.server_processes['whisper'] = subprocess.Popen(
                    whisper_cmd,
                    stdout=open(self.logs_path / 'whisper.log', 'w', encoding='utf-8'),
                    stderr=open(self.logs_path / 'whisper_error.log', 'w', encoding='utf-8'),
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
                    env=env
                )
                
                # Whisper 모델 로딩 대기 (최초 실행 시 모델 다운로드 포함 최대 60초)
                whisper_ready = False
                for i in range(60):  # 최대 60초 대기
                    try:
                        resp = requests.get('http://localhost:5001/', timeout=2)
                        if resp.ok:
                            whisper_ready = True
                            print(f"Whisper server ready after {i+1} seconds")
                            break
                    except:
                        pass
                    time.sleep(1)
                
                if not whisper_ready:
                    raise RuntimeError("Whisper server failed to start within 60 seconds")
                
                # Node.js 서버 시작
                icon.notify("서버 시작 중...", "Lecture Summarizer")
                nodejs_cmd = [str(node_exe), str(self.server_path / 'server.js')]
                self.server_processes['nodejs'] = subprocess.Popen(
                    nodejs_cmd,
                    stdout=open(self.logs_path / 'nodejs.log', 'w', encoding='utf-8'),
                    stderr=open(self.logs_path / 'nodejs_error.log', 'w', encoding='utf-8'),
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0,
                    cwd=str(self.server_path),
                    env=env
                )
                time.sleep(2)
                
                # 서버 상태 업데이트
                if self.check_server_status():
                    self.server_running = True
                    icon.icon = self.get_icon('running')
                    # 메뉴 즉시 갱신 (enabled 상태 동기화)
                    icon.update_menu()
                    return True
                
                # 상태 확인 실패 시 재시도
                retry_count += 1
                if retry_count < max_retries:
                    print(f"Server status check failed, retrying ({retry_count}/{max_retries})...")
                    self.stop_servers(icon, None)
                    time.sleep(2)
                
            except Exception as e:
                print(f"Server startup error (attempt {retry_count + 1}/{max_retries}): {e}")
                icon.icon = self.get_icon('error')
                retry_count += 1
                if retry_count < max_retries:
                    time.sleep(2)
        
        return False
    
    def start_servers(self, icon, item):
        """서버 시작 (메뉴에서 호출 - 스레드에서 실행하여 UI 블로킹 방지)"""
        if self.check_server_status():
            icon.notify("서버가 이미 실행 중입니다", "Lecture Summarizer")
            return
        
        # 별도 스레드에서 서버 시작 (트레이 메인 루프 블로킹 방지)
        def start_in_thread():
            try:
                if self._start_servers_internal(icon):
                    # 서버가 완전히 시작될 때까지 대기
                    time.sleep(3)
                    if self.check_server_status():
                        icon.notify("서버가 시작되었습니다", "Lecture Summarizer")
                        self.server_running = True
                        icon.update_menu()  # 메뉴 상태 즉시 갱신
                    else:
                        icon.notify("서버 시작 실패 - 로그를 확인하세요", "Lecture Summarizer")
                        self.server_running = False
                        icon.update_menu()
                        self.stop_servers(icon, item)
                else:
                    icon.notify("서버 시작 실패 - 로그를 확인하세요", "Lecture Summarizer")
                    self.server_running = False
                    icon.update_menu()
            except Exception as e:
                icon.notify(f"서버 시작 중 오류: {str(e)}", "Lecture Summarizer")
                self.server_running = False
                icon.update_menu()
                self.stop_servers(icon, item)
        
        thread = Thread(target=start_in_thread, daemon=True)
        thread.start()
    
    def stop_servers(self, icon, item):
        """서버 중지 - 안전한 정리"""
        if not self.check_server_status() and not any(self.server_processes.values()):
            icon.notify("서버가 실행되지 않았습니다", "Lecture Summarizer")
            return
        
        try:
            # 프로세스 종료 (안전한 순서: Node → Whisper)
            for name in ['nodejs', 'whisper']:
                process = self.server_processes.get(name)
                if process and process.poll() is None:
                    try:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=2)
                    except Exception as e:
                        print(f"Error terminating {name}: {e}")
            
            # 포트 강제 정리 (좀비 프로세스)
            self._kill_process_on_port(3000)
            self._kill_process_on_port(5001)
            
            self.server_processes = {'whisper': None, 'nodejs': None}
            self.server_running = False
            
            icon.icon = self.get_icon('idle')
            icon.update_menu()  # 메뉴 상태 즉시 갱신
            icon.notify("서버가 중지되었습니다", "Lecture Summarizer")
            
        except Exception as e:
            icon.notify(f"서버 중지 실패: {str(e)}", "Lecture Summarizer")
    
    def show_status(self, icon, item):
        """서버 상태 확인"""
        if self.check_server_status():
            message = "서버 실행 중\n\nWhisper: http://localhost:5001\nNode.js: http://localhost:3000"
        else:
            message = "서버 중지됨\n\n우클릭 → '서버 시작'을 클릭하세요"
        
        icon.notify(message, "Lecture Summarizer")
    
    def show_dashboard(self, icon, item):
        """웹 대시보드 열기 (브라우저) - 서버가 꺼져있으면 먼저 시작 (스레드)"""
        # 별도 스레드에서 대시보드 열기 (트레이 메인 루프 블로킹 방지)
        def open_dashboard_in_thread():
            try:
                # 서버가 실행 중이 아니면 먼저 시작
                if not self.check_server_status():
                    icon.notify("서버를 시작하는 중...", "Lecture Summarizer")
                    self._start_servers_internal(icon)
                    
                    # 서버가 완전히 시작될 때까지 대기 (최대 15초)
                    for _ in range(15):
                        time.sleep(1)
                        if self.check_server_status():
                            self.server_running = True
                            icon.update_menu()
                            break
                    
                    if not self.check_server_status():
                        icon.notify("서버 시작 실패 - 로그를 확인하세요", "Lecture Summarizer")
                        self.server_running = False
                        icon.update_menu()
                        return
                
                dashboard_url = 'http://127.0.0.1:3000/dashboard'
                webbrowser.open(dashboard_url)
            except Exception as e:
                icon.notify(f"대시보드 열기 실패: {str(e)}", "Lecture Summarizer")
        
        thread = Thread(target=open_dashboard_in_thread, daemon=True)
        thread.start()
    
    def open_logs_folder(self, icon, item):
        """로그 폴더 열기"""
        try:
            if sys.platform == 'win32':
                os.startfile(self.logs_path)
            else:
                subprocess.Popen(['xdg-open', str(self.logs_path)])
        except Exception as e:
            icon.notify(f"폴더 열기 실패: {str(e)}", "Lecture Summarizer")
    
    def quit_app(self, icon, item):
        """트레이 앱 종료 (서버도 함께 종료)"""
        # 종료 플래그 설정
        self.app_running = False
        
        try:
            # 서버 프로세스 종료
            for name, process in self.server_processes.items():
                if process and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
        except Exception as e:
            pass  # 종료 중 오류 무시
        
        # 트레이 아이콘 중지
        icon.stop()
        
        # 프로그램 강제 종료
        os._exit(0)
    
    def create_menu(self):
        """우클릭 메뉴 생성"""
        return pystray.Menu(
            pystray.MenuItem(
                "서버 시작",
                self.start_servers,
                enabled=lambda item: not self.server_running
            ),
            pystray.MenuItem(
                "서버 중지",
                self.stop_servers,
                enabled=lambda item: self.server_running
            ),
            pystray.MenuItem(
                "서버 상태",
                self.show_status
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "대시보드 열기",
                self.show_dashboard
            ),
            pystray.MenuItem(
                "로그 폴더 열기",
                self.open_logs_folder
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "종료",
                self.quit_app
            )
        )
    
    def update_icon_status(self, icon):
        """주기적으로 서버 상태 확인 및 아이콘 업데이트"""
        while self.app_running and icon.visible:
            try:
                current_status = self.check_server_status()
                if current_status != self.server_running:
                    self.server_running = current_status
                    icon.icon = self.get_icon('running' if current_status else 'idle')
                    icon.update_menu()  # 메뉴 상태 동기화
            except:
                pass  # 아이콘 업데이트 중 오류 무시
            time.sleep(5)
    
    def run(self):
        """트레이 앱 실행"""
        icon = pystray.Icon(
            "LectureSummarizer",
            self.get_icon('idle'),
            "Lecture Summarizer",
            menu=self.create_menu()
        )
        
        # 상태 모니터링 스레드 시작
        monitor_thread = Thread(target=self.update_icon_status, args=(icon,), daemon=True)
        monitor_thread.start()
        
        icon.run()


if __name__ == '__main__':
    app = LectureSummarizerTray()
    app.run()
