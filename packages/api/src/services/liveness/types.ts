export type LivenessChallenge = 'blink' | 'turn_left' | 'turn_right' | 'smile';

export type LivenessDecision = 'pass' | 'fail' | 'manual_review' | 'skipped';

export interface FaceLandmarks {
  // 5-keypoint output from insightface buffalo_s, normalised to [0,1] image coordinates.
  leftEye: [number, number];
  rightEye: [number, number];
  nose: [number, number];
  mouthLeft: [number, number];
  mouthRight: [number, number];
  faceConfidence: number;
}

export interface FrameAnalysis {
  landmarks: FaceLandmarks | null;   // null if no face was detected in the frame
  sharpness: number;                 // Laplacian variance proxy (higher = sharper)
}

export interface LivenessSignature {
  v: 1;
  challenge_action: LivenessChallenge;
  challenge_completed: boolean;
  motion_delta: number;              // [0,1] — magnitude of detected motion in expected direction
  face_score: number;                // mean faceConfidence across frames
  sharpness: number;                 // sharpness of the canonical (sharpest) frame
  decision: LivenessDecision;
  model_version: string;
  screen_artifact_score: number | null;
  ms_total: number;
}

export interface LivenessVerification {
  pass: boolean;
  decision: LivenessDecision;
  signature: LivenessSignature;
  canonicalFrame: ArrayBuffer;       // the sharpest frame, ready to write to R2
}

export const ALL_CHALLENGES: readonly LivenessChallenge[] = [
  'blink', 'turn_left', 'turn_right', 'smile',
] as const;
