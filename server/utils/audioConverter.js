import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { AUDIO_OPTIONS } from "../config/config.js";

/**
 * MP4 -> 저용량 MP3 변환
 */
export async function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        AUDIO_OPTIONS.videoNone,    // 비디오 제거
        AUDIO_OPTIONS.channels,     // 모노
        AUDIO_OPTIONS.sampleRate,   // 16kHz
        AUDIO_OPTIONS.bitrate       // 32kbps
      ])
      .save(outputPath)
      .on("end", () => {
        resolve(outputPath);
      })
      .on("error", (err) => {
        reject(err);
      });
  });
}

/**
 * ffprobe로 오디오 길이(초) 구하기
 */
export function getDuration(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration);
    });
  });
}

/**
 * mp3를 일정 크기(예: 20MB) 기준으로 분할
 */
export async function splitAudio(inputPath, chunkDir, maxSizeMB = 20) {
  const stat = fs.statSync(inputPath);
  const sizeMB = stat.size / (1024 * 1024);
  if (sizeMB <= maxSizeMB) {
    return [inputPath];
  }

  const duration = await getDuration(inputPath);
  const n = Math.ceil(sizeMB / maxSizeMB);
  const segment = duration / n;

  const chunks = [];

  // 실제 분할이 필요한 경우에만 디렉터리 생성
  if (!fs.existsSync(chunkDir)) {
    fs.mkdirSync(chunkDir, { recursive: true });
  }

  for (let i = 0; i < n; i++) {
    const start = i * segment;
    const output = path.join(chunkDir, `chunk-${i}.mp3`);

    // 조각 하나씩 생성
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(start)
        .setDuration(segment)
        .save(output)
        .on("end", resolve)
        .on("error", reject);
    });

    chunks.push(output);
  }

  return chunks;
}
