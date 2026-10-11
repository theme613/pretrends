import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const execute = promisify(execFile);
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const mediaHosts = [
  "tiktok.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokv.com",
  "tiktokv.us",
  "byteoversea.com",
  "ibytedtos.com",
  "ibyteimg.com",
  "cdninstagram.com",
  "fbcdn.net",
];
export function allowedMediaUrl(url: string) {
  try {
    const value = new URL(url);
    return (
      value.protocol === "https:" &&
      !value.username &&
      !value.password &&
      !value.port &&
      mediaHosts.some(
        (host) =>
          value.hostname === host || value.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}

async function downloadVideo(url: string, parentSignal: AbortSignal) {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(12000)]);
  for (let redirect = 0; redirect < 4; redirect++) {
    if (!allowedMediaUrl(url)) throw new Error("Unsupported video media host.");
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url, {
          redirect: "manual",
          signal,
          headers: {
            "User-Agent": "Mozilla/5.0",
            Referer: "https://www.tiktok.com/",
          },
        });
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt === 0
        ) {
          await response.body?.cancel();
          continue;
        }
        break;
      } catch {
        if (attempt || signal.aborted)
          throw new Error("Video download timed out or failed.");
      }
    }
    if (!response) throw new Error("Video download failed.");
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Video redirect had no destination.");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error("Video could not be downloaded.");
    if (Number(response.headers.get("content-length")) > MAX_VIDEO_BYTES) {
      await response.body.cancel();
      throw new Error("Video exceeds the 25 MB check limit.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_VIDEO_BYTES)
          throw new Error("Video exceeds the 25 MB check limit.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Too many video redirects.");
}

async function getFfmpeg(): Promise<string> {
  if (!ffmpegPath) throw new Error("FFmpeg is unavailable on this server.");
  if (process.platform === "win32") return ffmpegPath;
  try {
    await fs.access(ffmpegPath, fs.constants.X_OK);
    return ffmpegPath;
  } catch {
    const tmpFfmpeg = path.join(os.tmpdir(), "ffmpeg");
    try {
      await fs.access(tmpFfmpeg, fs.constants.X_OK);
      return tmpFfmpeg;
    } catch {
      await fs.copyFile(ffmpegPath, tmpFfmpeg);
      await fs.chmod(tmpFfmpeg, 0o755);
      return tmpFfmpeg;
    }
  }
}

// Only three small frames are sent to AI; full videos never enter the prompt.
export async function extractFrames(
  videoUrl: string,
  signal = AbortSignal.timeout(75000),
  timings?: { download_ms: number; frame_ms: number },
): Promise<string[]> {
  const bin = await getFfmpeg();
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "pretrends-frames-"),
  );
  try {
    const video = path.join(directory, "video.mp4");
    const started = Date.now();
    await fs.writeFile(video, await downloadVideo(videoUrl, signal));
    if (timings) timings.download_ms = Date.now() - started;
    const frameStarted = Date.now();
    let metadata = "";
    try {
      await execute(bin, ["-hide_banner", "-i", video], {
        signal,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      metadata = String((error as { stderr?: string }).stderr || "");
    }
    const match = metadata.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) throw new Error("Video duration could not be read.");
    const duration =
      Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    if (duration < 1 || duration > 600)
      throw new Error(
        "Video must be between 1 second and 10 minutes for visual checks.",
      );
    const frames: string[] = [];
    for (const fraction of [0.1, 0.5, 0.9]) {
      const { stdout } = await execute(
        bin,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-ss",
          String(duration * fraction),
          "-i",
          video,
          "-frames:v",
          "1",
          "-vf",
          "scale=512:512:force_original_aspect_ratio=decrease",
          "-q:v",
          "5",
          "-f",
          "image2pipe",
          "-vcodec",
          "mjpeg",
          "pipe:1",
        ],
        {
          signal,
          timeout: 15000,
          maxBuffer: 2 * 1024 * 1024,
          encoding: "buffer",
        },
      );
      if (!stdout.length)
        throw new Error("A video frame could not be extracted.");
      frames.push(`data:image/jpeg;base64,${stdout.toString("base64")}`);
    }
    if (timings) timings.frame_ms = Date.now() - frameStarted;
    return frames;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
