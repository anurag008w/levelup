import { useEffect, useState } from 'react';

/** Completion stamp. Fires once per `trigger` change and replaces screen-wide confetti. */
export default function Confetti({ trigger, tone = 'green' }: { trigger: number; tone?: 'green' | 'gold' }) {
  const [stamp, setStamp] = useState(0);

  useEffect(() => {
    if (trigger === 0) return;
    setStamp(trigger);
    const timer = window.setTimeout(() => setStamp(0), 1400);
    return () => window.clearTimeout(timer);
  }, [trigger]);

  if (stamp === 0) return null;

  return (
    <span
      key={stamp}
      aria-hidden="true"
      className="confetti-piece"
      style={{
        ['--stamp-color' as string]: tone === 'gold' ? 'var(--color-light)' : 'var(--color-l)',
      }}
    >
      Completed
    </span>
  );
}
