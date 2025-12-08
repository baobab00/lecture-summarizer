/**
 * dashboardService.js
 * 웹 대시보드용 데이터 서비스
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * 로그 파일 읽기
 * @param {string} logType - 로그 타입 (whisper, whisper_error, nodejs, nodejs_error)
 * @param {number} maxLines - 최대 라인 수
 * @returns {Object} 로그 데이터
 */
export function readLogFile(logType, maxLines = 500) {
  const logsDir = path.join(process.cwd(), '..', 'logs');
  
  const logFiles = {
    'whisper': 'whisper.log',
    'whisper_error': 'whisper_error.log',
    'nodejs': 'nodejs.log',
    'nodejs_error': 'nodejs_error.log'
  };

  const filename = logFiles[logType];
  if (!filename) {
    return { error: 'Invalid log type', lines: [] };
  }

  const filePath = path.join(logsDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return { 
      filename,
      exists: false,
      lines: [],
      message: `로그 파일이 없습니다: ${filename}`
    };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // 최근 N개 라인만 반환
    const recentLines = lines.slice(-maxLines);
    
    return {
      filename,
      exists: true,
      totalLines: lines.length,
      lines: recentLines,
      lastModified: fs.statSync(filePath).mtime
    };
  } catch (err) {
    return {
      filename,
      exists: true,
      error: err.message,
      lines: []
    };
  }
}

/**
 * 성능 데이터 조회
 * @returns {Object} 성능 데이터
 */
export function getPerformanceData() {
  const perfFile = path.join(process.cwd(), 'logs', 'performance.json');
  
  if (!fs.existsSync(perfFile)) {
    return {
      sessions: [],
      statistics: {
        totalProcessed: 0,
        averageTime: 0,
        minTime: 0,
        maxTime: 0,
        stageAverages: {},
        normalized30min: {}
      }
    };
  }

  try {
    const content = fs.readFileSync(perfFile, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('[DashboardService] Failed to load performance data:', err);
    return {
      error: err.message,
      sessions: [],
      statistics: {}
    };
  }
}

/**
 * 시스템 메트릭 조회
 * @returns {Object} 시스템 메트릭
 */
export function getSystemMetrics() {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;

  // CPU 사용량 계산 (평균)
  let totalIdle = 0;
  let totalTick = 0;
  cpus.forEach(cpu => {
    for (let type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });
  const cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);

  return {
    timestamp: new Date().toISOString(),
    cpu: {
      usage: cpuUsage,
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown'
    },
    memory: {
      total: totalMemory,
      used: usedMemory,
      free: freeMemory,
      usagePercent: Math.round((usedMemory / totalMemory) * 100)
    },
    platform: {
      os: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      uptime: os.uptime()
    },
    process: {
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    }
  };
}

/**
 * 서버 상태 조회
 * @returns {Object} 서버 상태
 */
export async function getServerStatus() {
  const status = {
    nodejs: { running: true, port: 3000 },
    whisper: { running: false, port: 5001, busy: false }
  };

  // Whisper 서버 확인 - 처리 중일 때는 응답이 늦을 수 있으므로 타임아웃 증가
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5초로 증가
    
    const response = await fetch('http://127.0.0.1:5001/', {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    status.whisper.running = response.ok;
  } catch (err) {
    // 타임아웃 에러인 경우 - 서버가 바쁜 것으로 간주 (처리 중)
    if (err.name === 'AbortError') {
      status.whisper.running = true;  // 서버는 실행 중이지만
      status.whisper.busy = true;     // 바쁜 상태
      status.whisper.error = '처리 중 (응답 지연)';
    } else {
      status.whisper.running = false;
      status.whisper.error = err.message;
    }
  }

  return status;
}
