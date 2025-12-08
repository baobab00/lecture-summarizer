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
 * 통계 계산
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
      stageAverages: {},
      normalized30min: {}
    };
  }
  
  const STANDARD_DURATION = 30 * 60; // 30분 = 1800초
  
  const stats = {
    totalProcessed: sessions.length,
    averageTime: 0,        // 30분 기준 정규화된 평균
    minTime: Infinity,     // 30분 기준 정규화된 최소
    maxTime: 0,            // 30분 기준 정규화된 최대
    stageAverages: {},
    normalized30min: {}    // 30분 기준 정규화 통계
  };
  
  // 전체 시간 통계 (30분 기준 정규화)
  const normalizedTimes = [];
  sessions.forEach(session => {
    const totalTime = session.totalTime || 0;
    if (totalTime > 0) {
      const videoDuration = session.videoInfo?.durationSeconds || STANDARD_DURATION;
      const normalizeFactor = STANDARD_DURATION / videoDuration;
      const normalizedTotal = Math.round(totalTime * normalizeFactor);
      normalizedTimes.push(normalizedTotal);
    }
  });
  
  if (normalizedTimes.length > 0) {
    stats.averageTime = Math.round(normalizedTimes.reduce((a, b) => a + b, 0) / normalizedTimes.length);
    stats.minTime = Math.min(...normalizedTimes);
    stats.maxTime = Math.max(...normalizedTimes);
  } else {
    stats.minTime = 0;
  }
  
  // 각 단계별 평균 시간 계산 (원본 + 정규화)
  const stageData = {};
  const normalizedStageData = {};
  
  sessions.forEach(session => {
    if (!session.stages) return;
    
    // 영상 길이 (초)
    const videoDuration = session.videoInfo?.durationSeconds || STANDARD_DURATION;
    const normalizeFactor = STANDARD_DURATION / videoDuration; // 30분 기준 환산 배율
    
    Object.keys(session.stages).forEach(stageName => {
      // 원본 데이터
      if (!stageData[stageName]) {
        stageData[stageName] = {
          label: session.stages[stageName].label,
          durations: []
        };
      }
      
      // 정규화 데이터
      if (!normalizedStageData[stageName]) {
        normalizedStageData[stageName] = {
          label: session.stages[stageName].label,
          durations: []
        };
      }
      
      const duration = session.stages[stageName].duration;
      if (duration && duration > 0) {
        stageData[stageName].durations.push(duration);
        
        // 30분 기준으로 정규화
        const normalized = Math.round(duration * normalizeFactor);
        normalizedStageData[stageName].durations.push(normalized);
      }
    });
  });
  
  // 원본 평균 계산
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
  
  // 30분 기준 정규화 평균 계산
  Object.keys(normalizedStageData).forEach(stageName => {
    const durations = normalizedStageData[stageName].durations;
    if (durations.length > 0) {
      const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      stats.normalized30min[stageName] = {
        label: normalizedStageData[stageName].label,
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
