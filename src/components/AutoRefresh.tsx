'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
export default function AutoRefresh({ active, ms = 2500 }: { active: boolean; ms?: number }) {
  const r = useRouter();
  useEffect(() => { if (!active) return; const t = setInterval(() => r.refresh(), ms); return () => clearInterval(t); }, [active, ms, r]);
  return active ? <p className="mut small" aria-live="polite">Working… this page updates automatically.</p> : null;
}
