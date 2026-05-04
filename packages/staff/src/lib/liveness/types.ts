export type LivenessChallenge = 'blink' | 'turn_left' | 'turn_right' | 'smile';

export type LivenessUiState =
  | 'idle'
  | 'looking-for-face'
  | 'face-off-center'
  | 'low-light'
  | 'ready'
  | 'challenge-active'
  | 'challenge-detected'
  | 'capturing'
  | 'failed';

export interface FrameBurst {
  frame0: Blob;
  frame1: Blob;
  frame2: Blob;
}
