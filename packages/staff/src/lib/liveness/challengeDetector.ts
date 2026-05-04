import type { LivenessChallenge } from './types';

export interface LandmarkSnapshot {
  leftEyeOpenness: number;
  rightEyeOpenness: number;
  nosePos: [number, number];
  eyeMidpoint: [number, number];
  mouthSpread: number;
}

const T = {
  blink: 0.20,
  turn: 0.06,
  smile: 0.025,
};

export function detectClientChallenge(
  challenge: LivenessChallenge,
  baseline: LandmarkSnapshot,
  current: LandmarkSnapshot,
): boolean {
  switch (challenge) {
    case 'blink': {
      const lDelta = baseline.leftEyeOpenness - current.leftEyeOpenness;
      const rDelta = baseline.rightEyeOpenness - current.rightEyeOpenness;
      return lDelta >= T.blink && rDelta >= T.blink;
    }
    case 'turn_left': {
      const baseOffset = baseline.nosePos[0] - baseline.eyeMidpoint[0];
      const curOffset = current.nosePos[0] - current.eyeMidpoint[0];
      return curOffset - baseOffset >= T.turn;
    }
    case 'turn_right': {
      const baseOffset = baseline.nosePos[0] - baseline.eyeMidpoint[0];
      const curOffset = current.nosePos[0] - current.eyeMidpoint[0];
      return baseOffset - curOffset >= T.turn;
    }
    case 'smile': {
      return current.mouthSpread - baseline.mouthSpread >= T.smile;
    }
  }
}
