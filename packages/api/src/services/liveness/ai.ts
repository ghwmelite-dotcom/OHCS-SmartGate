import type { FrameAnalysis, FaceLandmarks } from './types';

interface InsightfaceResponse {
  faces?: Array<{
    bbox: [number, number, number, number];
    score: number;
    kps: Array<[number, number]>;
  }>;
}

export async function analyzeFrame(ai: Ai, frame: ArrayBuffer): Promise<FrameAnalysis> {
  let raw: InsightfaceResponse;
  try {
    raw = await ai.run('@cf/insightface/buffalo_s' as never, {
      image: Array.from(new Uint8Array(frame)),
    } as never) as InsightfaceResponse;
  } catch {
    return { landmarks: null, sharpness: 0 };
  }

  const faces = raw.faces ?? [];
  if (faces.length === 0) return { landmarks: null, sharpness: 0 };

  const best = faces.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.kps.length < 5) return { landmarks: null, sharpness: 0 };

  const landmarks: FaceLandmarks = {
    leftEye:    best.kps[0]!,
    rightEye:   best.kps[1]!,
    nose:       best.kps[2]!,
    mouthLeft:  best.kps[3]!,
    mouthRight: best.kps[4]!,
    faceConfidence: best.score,
  };

  return { landmarks, sharpness: 0 };
}
