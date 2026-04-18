import { useRef } from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

interface Props extends ButtonProps {
  children: React.ReactNode;
}

export function MagneticButton({ children, onPointerDown, onMouseMove, onMouseLeave, className, ...rest }: Props) {
  const ref = useRef<HTMLButtonElement>(null);

  function handleMove(e: React.MouseEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (!el) {
      onMouseMove?.(e);
      return;
    }
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;
    const clampX = Math.max(-6, Math.min(6, mx * 0.08));
    const clampY = Math.max(-6, Math.min(6, my * 0.08));
    el.style.transform = `translate3d(${clampX}px, ${clampY}px, 0)`;
    onMouseMove?.(e);
  }

  function handleLeave(e: React.MouseEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (el) el.style.transform = 'translate3d(0,0,0)';
    onMouseLeave?.(e);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const dot = document.createElement('span');
      dot.className = 'ripple-dot';
      dot.style.left = `${e.clientX - rect.left}px`;
      dot.style.top = `${e.clientY - rect.top}px`;
      el.appendChild(dot);
      setTimeout(() => dot.remove(), 650);
    }
    onPointerDown?.(e);
  }

  return (
    <button
      ref={ref}
      className={`magnetic relative overflow-hidden ${className ?? ''}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onPointerDown={handlePointerDown}
      {...rest}
    >
      {children}
    </button>
  );
}
