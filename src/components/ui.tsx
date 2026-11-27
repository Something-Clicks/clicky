import type { ReactNode } from 'react';
import type { EvidenceClass } from '@/agent/domain/enums';

const EV_HELP: Record<string, string> = { verified: 'Directly supported by retrieved or supplied information', inferred: 'A reasonable interpretation of available evidence', estimated: 'An estimate with stated assumptions', unknown: 'Not enough information to say' };
export const EvidencePill = ({ v }: { v: EvidenceClass | string }) => <span className={`pill e-${v}`} title={EV_HELP[v]}>{v}</span>;
export const PriorityPill = ({ label }: { label: string }) => <span className={`pill p-${label}`}>{label} priority</span>;
export const Pill = ({ children, cls = '' }: { children: ReactNode; cls?: string }) => <span className={`pill ${cls}`}>{children}</span>;
export const Notice = ({ e, m }: { e?: string; m?: string }) => (<>{e && <div className="banner err" role="alert">{e}</div>}{m && <div className="banner ok">{m}</div>}</>);
export const MockBanner = ({ show }: { show?: boolean }) => show ? <div className="banner warn">Demo mode: this result was produced by the development stand-in, not a real AI model. Do not use it as real advice.</div> : null;
export const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '');
export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
