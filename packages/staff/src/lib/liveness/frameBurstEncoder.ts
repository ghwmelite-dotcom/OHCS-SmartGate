import type { FrameBurst } from './types';

/**
 * Capture three JPEG frames from a `<video>` element across a ~2s window.
 * Frame 0 captures immediately (baseline), Frame 1 at ~1s (mid-challenge),
 * Frame 2 at ~2s (post-challenge). Frames are cropped to a centered 480x480
 * square at 0.85 quality.
 */
export async function captureFrameBurst(video: HTMLVideoElement): Promise<FrameBurst> {
  const f0 = await captureSquare(video);
  await wait(1000);
  const f1 = await captureSquare(video);
  await wait(1000);
  const f2 = await captureSquare(video);
  return { frame0: f0, frame1: f1, frame2: f2 };
}

const SIZE = 480;

async function captureSquare(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const vw = video.videoWidth || SIZE;
  const vh = video.videoHeight || SIZE;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  ctx.drawImage(video, sx, sy, side, side, 0, 0, SIZE, SIZE);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      0.85,
    );
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
