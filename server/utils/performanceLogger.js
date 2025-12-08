/**
 * performanceLogger.js
 * 성능 데이터를 logs/performance.json에 저장 및 통계 계산
 */

import fs from 'fs';
import path from 'path';

const MAX_SESSIONS = 200; // 최대 200개 세션만 유지

/**
 * 성능 데이터 저장
 * @param {Object} perfData - PerformanceTracker.toJSON() 결과
 * @param {Object} videoInfo - 비디오 정보 (duration, format, sizeBytes)
 */
export async function savePerformanceData(perfData, videoInfo = {}) {
  const perfFile = path.join(process.cwd(), 'logs', 'performance.json');
  
  // logs 디렉토리 생성
  const logsDir = path.dirname(perfFile);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  // 기존 데이터 로드
  let data = { sessions: [], statistics: {} };
  if (fs.existsSync(perfFile)) {
    try {
      const content = fs.readFileSync(perfFile, 'utf-8');
      data = JSON.parse(content);
    } catch (err) {
      console.error('[PerformanceLogger] Failed to parse existing data:', err);
      data = { sessions: [], statistics: {} };
    }
  }
  
  // 새 세션 추가
  const newSession = {
    sessionId: perfData.sessionId,
    timestamp: perfData.timestamp,
    videoInfo,
    stages: perfData.stages,
    totalTime: perfData.totalTime,
    status: 'completed'
  };
  
  data.sessions.push(newSession);
  
  // 최대 개수 초과 시 오래된 것 삭제
  if (data.sessions.length > MAX_SESSIONS) {
    const removeCount = data.sessions.length - MAX_SESSIONS;
    console.log(`[PerformanceLogger] Removing ${removeCount} old sessions (max: ${MAX_SESSIONS})`);
    data.sessions.splice(0, removeCount);
  }
  
  // 통계 재계산
  data.statistics = calculateStatistics(data.sessions);
  
  // 저장
  try {
    fs.writeFileSync(perfFile, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[PerformanceLogger] Saved performance data (total sessions: ${data.sessions.length})`);
  } catch (err) {
    console.error('[PerformanceLogger] Failed to save performance data:', err);
  }
}

/**
 * 통계 계산 (원본 데이터 기반, 정규화 없음)
 * @param {Array} sessions - 세션 배열
 * @returns {Object} 통계 정보
 */
function calculateStatistics(sessions) {
  if (!sessions || sessions.length === 0) {
    return {
      totalProcessed: 0,
      averageTime: 0,
      minTime: 0,
      maxTime: 0,
      stageAverages: {}
    };
  }
  
  const stats = {
    totalProcessed: sessions.length,
    averageTime: 0,
    minTime: Infinity,
    maxTime: 0,
    stageAverages: {}
  };
  
  // 전체 시간 통계 (원본 데이터)
  const totalTimes = [];
  sessions.forEach(session => {
    const totalTime = session.totalTime || 0;
    if (totalTime > 0) {
      totalTimes.push(totalTime);
    }
  });
  
  if (totalTimes.length > 0) {
    stats.averageTime = Math.round(totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length);
    stats.minTime = Math.min(...totalTimes);
    stats.maxTime = Math.max(...totalTimes);
  } else {
    stats.minTime = 0;
  }
  
  // 각 단계별 평균 시간 계산 (원본 데이터)
  const stageData = {};
  
  sessions.forEach(session => {
    if (!session.stages) return;
    
    Object.keys(session.stages).forEach(stageName => {
      if (!stageData[stageName]) {
        stageData[stageName] = {
          label: session.stages[stageName].label,
          durations: []
        };
      }
      
      const duration = session.stages[stageName].duration;
      if (duration && duration > 0) {
        stageData[stageName].durations.push(duration);
      }
    });
  });
  
  // 평균 계산
  Object.keys(stageData).forEach(stageName => {
    const durations = stageData[stageName].durations;
    if (durations.length > 0) {
      const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      stats.stageAverages[stageName] = {
        label: stageData[stageName].label,
        average: avg,
        min: Math.min(...durations),
        max: Math.max(...durations),
        count: durations.length
      };
    }
  });
  
  return stats;
}

/**
 * 성능 데이터 조회
 * @returns {Object|null} 성능 데이터
 */
export function loadPerformanceData() {
  const perfFile = path.join(process.cwd(), 'logs', 'performance.json');
  
  if (!fs.existsSync(perfFile)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(perfFile, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('[PerformanceLogger] Failed to load performance data:', err);
    return null;
  }
}
