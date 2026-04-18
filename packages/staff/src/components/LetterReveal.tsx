import { useMemo } from 'react';

interface Props {
  text: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'span' | 'p';
  delayOffsetMs?: number;
}

export function LetterReveal({ text, className, as: Tag = 'span', delayOffsetMs = 0 }: Props) {
  const parts = useMemo(() => {
    return Array.from(text).map((ch, i) => ({ ch, i }));
  }, [text]);
  const baseOffset = Math.max(0, Math.round(delayOffsetMs / 30));
  return (
    <Tag className={className}>
      {parts.map(({ ch, i }) =>
        ch === ' ' ? (
          <span key={i}>&nbsp;</span>
        ) : (
          <span key={i} className="letter-reveal" style={{ ['--i' as unknown as string]: i + baseOffset }}>
            {ch}
          </span>
        ),
      )}
    </Tag>
  );
}
