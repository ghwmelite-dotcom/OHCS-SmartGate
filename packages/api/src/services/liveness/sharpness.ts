import type { FrameAnalysis } from './types';

export function selectSharpestFrame(frames: ReadonlyArray<FrameAnalysis>): number {
  if (frames.length === 0) return 0;

  // If no frame has detectable landmarks, return index 0 as a safe default.
  const hasAnyLandmarks = frames.some((f) => f.landmarks !== null);
  if (!hasAnyLandmarks) return 0;

  const midIdx = Math.floor((frames.length - 1) / 2);
  let bestIdx = 0;
  let bestScore = -Infinity;

  frames.forEach((frame, idx) => {
    const conf = frame.landmarks?.faceConfidence ?? 0;
    // Composite score: confidence dominates; mid-burst proximity breaks ties.
    const tieBreak = -Math.abs(idx - midIdx) * 1e-6;
    const score = conf + tieBreak;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  return bestIdx;
}
