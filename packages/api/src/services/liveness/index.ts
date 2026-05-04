import { analyzeFrame } from './ai';
import { detectMotion } from './motion';
import { selectSharpestFrame } from './sharpness';
import type {
  LivenessChallenge, LivenessVerification, LivenessSignature, FrameAnalysis,
} from './types';

export * from './types';
export { isoWeekKey, getReviewCount, incrementReviewCount } from './review-counter';

interface VerifyArgs {
  ai: Ai;
  frames: ArrayBuffer[];
  challenge: LivenessChallenge;
  modelVersion: string;
}

export async function verifyLivenessBurst(args: VerifyArgs): Promise<LivenessVerification> {
  const { ai, frames, challenge, modelVersion } = args;
  if (frames.length !== 3) throw new Error('verifyLivenessBurst expects exactly 3 frames');

  const start = Date.now();

  const analyses: FrameAnalysis[] = await Promise.all(frames.map((f) => analyzeFrame(ai, f)));

  // If every frame errored at the AI call level (not just no-face), report skipped.
  // analyzeFrame sets error: 'ai_failure' only when ai.run throws — distinguishing
  // it from a legitimate "no face detected in frame" result.
  const allAiFailed = analyses.every((a) => a.error === 'ai_failure');
  if (allAiFailed) {
    const signature: LivenessSignature = {
      v: 1,
      challenge_action: challenge,
      challenge_completed: false,
      motion_delta: 0,
      face_score: 0,
      sharpness: 0,
      decision: 'skipped',
      model_version: modelVersion,
      screen_artifact_score: null,
      ms_total: Date.now() - start,
    };
    return {
      pass: false,
      decision: 'skipped',
      signature,
      canonicalFrame: frames[0]!,
    };
  }

  const motion = detectMotion(analyses.map((a) => a.landmarks), challenge);
  const sharpestIdx = selectSharpestFrame(analyses);
  const decision: LivenessSignature['decision'] = motion.completed ? 'pass' : 'fail';

  const signature: LivenessSignature = {
    v: 1,
    challenge_action: challenge,
    challenge_completed: motion.completed,
    motion_delta: motion.delta,
    face_score: meanFaceScore(analyses),
    sharpness: analyses[sharpestIdx]?.sharpness ?? 0,
    decision,
    model_version: modelVersion,
    screen_artifact_score: null,
    ms_total: Date.now() - start,
  };

  return {
    pass: motion.completed,
    decision,
    signature,
    canonicalFrame: frames[sharpestIdx]!,
  };
}

function meanFaceScore(analyses: ReadonlyArray<FrameAnalysis>): number {
  const scores = analyses.map((a) => a.landmarks?.faceConfidence ?? 0);
  if (scores.length === 0) return 0;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}
