/**
 * performanceTracker.js
 * 강의 처리 단계별 시간 측정 및 추적
 */

export class PerformanceTracker {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.stages = {};
    this.startTime = Date.now();
    this.currentStage = null;
  }
  
  /**
   * 새로운 단계 시작
   * @param {string} stageName - 단계 식별자 (예: 'audioConversion')
   * @param {string} label - 사용자에게 보여질 레이블 (예: '음성 추출')
   */
  markStage(stageName, label) {
    // 이전 단계가 있고 종료되지 않았으면 자동 종료
    if (this.currentStage && !this.stages[this.currentStage].duration) {
      this.endStage(this.currentStage);
    }
    
    this.currentStage = stageName;
    this.stages[stageName] = {
      label,
      startTime: Date.now(),
      duration: null
    };
    
    console.log(`[PerformanceTracker] Stage started: ${stageName} (${label})`);
  }
  
  /**
   * 현재 단계 종료
   * @param {string} stageName - 종료할 단계 식별자
   */
  endStage(stageName) {
    if (!this.stages[stageName]) {
      console.warn(`[PerformanceTracker] Stage not found: ${stageName}`);
      return;
    }
    
    if (this.stages[stageName].duration !== null) {
      console.warn(`[PerformanceTracker] Stage already ended: ${stageName}`);
      return;
    }
    
    const duration = Date.now() - this.stages[stageName].startTime;
    this.stages[stageName].duration = duration;
    
    console.log(`[PerformanceTracker] Stage ended: ${stageName} (${duration}ms)`);
    
    if (this.currentStage === stageName) {
      this.currentStage = null;
    }
  }
  
  /**
   * 모든 미완료 단계 종료
   */
  endAllStages() {
    for (const stageName in this.stages) {
      if (this.stages[stageName].duration === null) {
        this.endStage(stageName);
      }
    }
  }
  
  /**
   * JSON 형태로 변환 (저장용)
   */
  toJSON() {
    // 미완료 단계 자동 종료
    this.endAllStages();
    
    const totalTime = Date.now() - this.startTime;
    
    // 각 단계의 비율 계산
    const stagesWithPercentage = {};
    for (const stageName in this.stages) {
      const stage = this.stages[stageName];
      stagesWithPercentage[stageName] = {
        label: stage.label,
        duration: stage.duration,
        percentage: totalTime > 0 ? ((stage.duration / totalTime) * 100).toFixed(1) : 0
      };
    }
    
    return {
      sessionId: this.sessionId,
      stages: stagesWithPercentage,
      totalTime,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * 현재 상태 출력 (디버깅용)
   */
  printStatus() {
    console.log(`\n[PerformanceTracker] Session: ${this.sessionId}`);
    console.log(`Total elapsed: ${Date.now() - this.startTime}ms`);
    console.log('Stages:');
    for (const stageName in this.stages) {
      const stage = this.stages[stageName];
      const status = stage.duration !== null ? `${stage.duration}ms` : 'in progress';
      console.log(`  - ${stageName} (${stage.label}): ${status}`);
    }
    console.log('');
  }
}
