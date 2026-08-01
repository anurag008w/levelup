import { useEffect, useMemo, useState } from 'react';

const COLORS = ['#4fd1c5', '#60a5fa', '#6b8afd', '#34d399', '#f5c35c', '#f25d68'];

interface Piece {
  id: number;
  left: number;
  size: number;
  color: string;
  duration: number;
  delay: number;
  drift: number;
}

/** Fixed overlay confetti burst. Fires once per `key` change (no deps). */
export default function Confetti({ trigger }: { trigger: number }) {
  const [bursts, setBursts] = useState<number[]>([]);

  useEffect(() => {
    if (trigger === 0) return;
    setBursts((prev) => [...prev, trigger]);
  }, [trigger]);

  useEffect(() => {
    if (bursts.length === 0) return;
    const t = window.setTimeout(() => {
      setBursts((prev) => prev.slice(1));
    }, 3400);
    return () => window.clearTimeout(t);
  }, [bursts]);

  const pieces = useMemo<Piece[]>(() => {
    if (bursts.length === 0) return [];
    return Array.from({ length: 36 }, (_, i) => ({
      id: i,
      left: 8 + Math.random() * 84,
      size: 5 + Math.random() * 6,
      color: COLORS[i % COLORS.length],
      duration: 1.8 + Math.random() * 1.6,
      delay: Math.random() * 0.25,
      drift: (Math.random() - 0.5) * 160,
    }));
  }, [bursts]);

  if (bursts.length === 0) return null;

  return (
    <div aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={`${bursts[bursts.length - 1]}-${p.id}`}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 1.4,
            backgroundColor: p.color,
            ['--duration' as string]: `${p.duration}s`,
            ['--drift' as string]: `${p.drift}px`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
