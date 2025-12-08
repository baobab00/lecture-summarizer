import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ffmpeg 경로 설정
// 환경 변수 또는 runtime 폴더 또는 시스템 PATH 사용
const runtimeFfmpeg = path.resolve(__dirname, '../../runtime/ffmpeg/ffmpeg.exe');
const runtimeFfprobe = path.resolve(__dirname, '../../runtime/ffmpeg/ffprobe.exe');

const ffmpegPath = process.env.FFMPEG_PATH || runtimeFfmpeg;
const ffprobePath = process.env.FFPROBE_PATH || runtimeFfprobe;

try {
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);
} catch (e) {
  console.log('[Config] FFmpeg paths not set, using system PATH');
}

// Whisper 서버 URL
export const WHISPER_SERVER_URL = process.env.WHISPER_SERVER_URL || "http://127.0.0.1:5001";

// 기본 설정값
export const MAX_CHUNK_SIZE_MB = 20;
export const AUDIO_OPTIONS = {
  videoNone: "-vn",        // 비디오 제거
  channels: "-ac 1",       // 모노
  sampleRate: "-ar 16000", // 16kHz
  bitrate: "-b:a 32k"      // 32kbps
};

export default {
  WHISPER_SERVER_URL,
  MAX_CHUNK_SIZE_MB,
  AUDIO_OPTIONS
};
