const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

function runFfmpeg(args) {
  if (!ffmpegPath) {
    return Promise.reject(new Error('The ffmpeg executable is unavailable'));
  }

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Video rendering failed: ${String(stderr || error.message).trim()}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function validateRender({ duration, outPath, overlayPath }) {
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 90) {
    throw new Error('Video duration must be between 1 and 90 seconds');
  }
  if (!outPath || (overlayPath && !fs.existsSync(overlayPath))) {
    throw new Error('A valid output path and optional rendered overlay are required');
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  return seconds;
}

function getVideoDimensions(videoPath) {
  if (!ffmpegPath) {
    return Promise.reject(new Error('The ffmpeg executable is unavailable'));
  }

  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, ['-hide_banner', '-i', videoPath], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      const match = String(stderr).match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})(?=[,\s])/s);
      if (!match) {
        reject(new Error(`Could not read uploaded video dimensions${error ? `: ${error.message}` : ''}`));
        return;
      }
      resolve({ width: Number(match[1]), height: Number(match[2]) });
    });
  });
}

async function composeFromVideo({ videoPath, overlayPath, duration, outPath }) {
  const seconds = validateRender({ duration, outPath, overlayPath });
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error('The source stock video is unavailable');
  }

  const filters = [
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,` +
    `crop=${WIDTH}:${HEIGHT},fps=${FPS},trim=duration=${seconds},setpts=PTS-STARTPTS[base]`
  ];
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '-1', '-i', videoPath];
  if (overlayPath) {
    args.push('-loop', '1', '-framerate', String(FPS), '-i', overlayPath);
    filters.push('[base][1:v]overlay=0:0:shortest=1[out]');
  } else {
    filters[0] = filters[0].replace('[base]', '[out]');
  }
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[out]', '-an', '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    outPath
  );

  await runFfmpeg(args);
}

async function overlayLogoOnVideo({ videoPath, overlayPath, outPath }) {
  if (!videoPath || !fs.existsSync(videoPath) || !overlayPath || !fs.existsSync(overlayPath) || !outPath) {
    throw new Error('A source video, logo overlay, and output path are required');
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const filter = '[0:v][1:v]overlay=0:0:shortest=1[out]';
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', videoPath,
    '-loop', '1', '-framerate', String(FPS), '-i', overlayPath,
    '-filter_complex', filter,
    '-map', '[out]', '-map', '0:a:0?',
    '-map_metadata', '0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    outPath
  ]);
}

function imageExtension(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return '.png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return '.jpg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP') {
    return '.webp';
  }
  return '.jpg';
}

async function composeFromPhotos({ photos, overlayPath, duration, outPath }) {
  const seconds = validateRender({ duration, outPath, overlayPath });
  if (!Array.isArray(photos) || photos.length === 0 ||
      photos.some((photo) => !Buffer.isBuffer(photo) || photo.length === 0)) {
    throw new Error('At least one valid photo is required to create a slideshow');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwikreel-photos-'));
  try {
    const photoPaths = photos.map((photo, index) => {
      const photoPath = path.join(tmpDir, `photo-${index}${imageExtension(photo)}`);
      fs.writeFileSync(photoPath, photo);
      return photoPath;
    });
    const segmentDuration = seconds / photoPaths.length;
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];

    photoPaths.forEach((photoPath) => {
      args.push(
        '-loop', '1', '-framerate', String(FPS),
        '-t', String(segmentDuration), '-i', photoPath
      );
    });
    if (overlayPath) {
      args.push('-loop', '1', '-framerate', String(FPS), '-i', overlayPath);
    }

    const filters = photoPaths.map((_, index) =>
      `[${index}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${WIDTH}:${HEIGHT},zoompan=z='zoom+0.00008':d=1:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
      `trim=duration=${segmentDuration},setpts=PTS-STARTPTS,setsar=1[photo${index}]`
    );
    const concatInputs = photoPaths.map((_, index) => `[photo${index}]`).join('');
    filters.push(`${concatInputs}concat=n=${photoPaths.length}:v=1:a=0[base]`);
    if (overlayPath) {
      filters.push(`[base][${photoPaths.length}:v]overlay=0:0:shortest=1[out]`);
    }
    args.push(
      '-filter_complex', filters.join(';'),
      '-map', overlayPath ? '[out]' : '[base]', '-an', '-t', String(seconds),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outPath
    );
    await runFfmpeg(args);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { composeFromVideo, composeFromPhotos, getVideoDimensions, overlayLogoOnVideo };
