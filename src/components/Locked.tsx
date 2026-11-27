import Link from 'next/link';
import { FEATURE_LABEL, type Feature } from '@/agent/plans';
import { minPlanFor } from '@/server/billing/plans';

export default function Locked({ feature, title }: { feature: Feature; title: string }) {
  return (<><h1>{title}</h1><div className="card"><h2 style={{ marginTop: 0 }}>Included in {minPlanFor(feature)}</h2><p className="mut">{FEATURE_LABEL[feature][0]!.toUpperCase() + FEATURE_LABEL[feature].slice(1)} is part of {minPlanFor(feature)} and the plans above it. Your saved work stays available whatever plan you are on.</p><Link className="btn" href="/billing">See plans</Link></div></>);
}
