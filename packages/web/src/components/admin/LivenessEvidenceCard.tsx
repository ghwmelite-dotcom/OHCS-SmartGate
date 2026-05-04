interface LivenessSignature {
  v: 1;
  challenge_action: 'blink' | 'turn_left' | 'turn_right' | 'smile';
  challenge_completed: boolean;
  motion_delta: number;
  face_score: number;
  sharpness: number;
  decision: 'pass' | 'fail' | 'manual_review' | 'skipped';
  model_version: string;
  screen_artifact_score: number | null;
  ms_total: number;
}

const LABEL: Record<LivenessSignature['challenge_action'], string> = {
  blink: 'Blink',
  turn_left: 'Turn left',
  turn_right: 'Turn right',
  smile: 'Smile',
};

export function LivenessEvidenceCard({ signature }: { signature: LivenessSignature }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm space-y-1">
      <div className="font-medium">Liveness evidence</div>
      <div>Challenge: <span className="font-mono">{LABEL[signature.challenge_action]}</span></div>
      <div>Completed: {signature.challenge_completed ? 'yes' : 'no'}</div>
      <div>Motion delta: <span className="font-mono">{signature.motion_delta.toFixed(3)}</span></div>
      <div>Face confidence: <span className="font-mono">{(signature.face_score * 100).toFixed(1)}%</span></div>
      <div>Decision: <span className={`font-mono ${signature.decision === 'pass' ? 'text-emerald-700' : signature.decision === 'fail' ? 'text-red-700' : 'text-amber-700'}`}>{signature.decision}</span></div>
      <div className="text-zinc-500 text-xs">model: {signature.model_version} · {signature.ms_total}ms</div>
    </div>
  );
}
