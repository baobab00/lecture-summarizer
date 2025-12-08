import FormData from "form-data";
import axios from "axios";
import fs from "fs";
import path from "path";
import { WHISPER_SERVER_URL } from "../config/config.js";

/**
 * 여러 chunk mp3를 Whisper로 전사해서 하나의 텍스트로 합치기
 * @param {string[]} chunkPaths - 분할된 오디오 파일 경로 배열
 * @returns {Promise<{text: string, segments: Array}>} 전체 텍스트 + 타임스탬프 세그먼트
 */
export async function transcribeChunks(chunkPaths) {
  let fullText = "";
  let allSegments = [];
  let index = 0;
  let cumulativeTime = 0; // 누적 시간 오프셋

  for (const chunk of chunkPaths) {
    index += 1;

    try {
      // FormData로 파일 전송
      const form = new FormData();
      const fileName = path.basename(chunk);
      form.append('file', fs.createReadStream(chunk), {
        filename: fileName,
        contentType: 'audio/mpeg'
      });

      // 로컬 Whisper 서버 호출
      const response = await axios.post(`${WHISPER_SERVER_URL}/transcribe`, form, {
        headers: {
          ...form.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        responseType: "json",
        validateStatus: () => true,
      });

      if (response.status < 200 || response.status >= 300) {
        const errorText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        throw new Error(`Whisper 서버 응답 에러 (${response.status}): ${errorText}`);
      }

      const result = response.data;
      const text = result.text;
      const segments = result.segments || [];
      
      fullText += text + "\n";
      
      // 세그먼트에 누적 시간 추가
      segments.forEach(seg => {
        allSegments.push({
          start: seg.start + cumulativeTime,
          end: seg.end + cumulativeTime,
          text: seg.text
        });
      });
      
      // 다음 chunk를 위한 누적 시간 업데이트
      if (result.duration) {
        cumulativeTime += result.duration;
      }
      
    } catch (err) {
      console.error(`Chunk ${index} transcription error:`, err.message);
      throw err;
    }
  }

  return {
    text: fullText.trim(),
    segments: allSegments,
    duration: cumulativeTime // 전체 영상 길이 (초)
  };
}
