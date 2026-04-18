import { useEffect, useState } from 'react';

interface Piece {
  id: number;
  dx: number;
  dy: number;
  r: number;
}

export function ConfettiBurst() {
  const [pieces, setPieces] = useState<Piece[]>([]);

  useEffect(() => {
    const fresh: Piece[] = Array.from({ length: 10 }, (_, id) => {
      const angle = (id / 10) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 40 + Math.random() * 30;
      return {
        id,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        r: Math.round((Math.random() - 0.5) * 360),
      };
    });
    setPieces(fresh);
    const t = setTimeout(() => setPieces([]), 900);
    return () => clearTimeout(t);
  }, []);

  if (pieces.length === 0) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-triangle"
          style={{
            ['--dx' as unknown as string]: `${p.dx}px`,
            ['--dy' as unknown as string]: `${p.dy}px`,
            ['--r' as unknown as string]: `${p.r}deg`,
          }}
        />
      ))}
    </div>
  );
}
