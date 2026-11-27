import { submitRequest } from '../../actions';
import { Notice, one, type SP } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { DELIVERABLE_SPECS } from '@/agent/capabilities/deliverable-specs';

export default async function Ask({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; await requireWorkspace();
  return (<><h1>Ask the Marketing Agent</h1><p className="mut">Describe what you need. The agent chooses which capabilities to use, shows its work, and prepares drafts for your approval. It never publishes or sends anything by itself.</p><Notice e={one(sp.e)} />
    <form action={submitRequest} className="card"><input type="hidden" name="back" value="/ask" />
      <label htmlFor="request">Your request</label><textarea id="request" name="request" required placeholder="Examples: Improve my homepage headline · Research my competitors · Develop a marketing plan · Prepare a promotional campaign for drain cleaning · Write a blog article about water heater maintenance" />
      <details><summary>Optional details</summary>
        <label htmlFor="competitorUrls">Competitor websites (up to 5, space or comma separated)</label><input id="competitorUrls" name="competitorUrls" placeholder="rival.com other.com" />
        <label htmlFor="deliverableType">Type of content (if you know)</label><select id="deliverableType" name="deliverableType"><option value="">Let the agent decide</option>{Object.entries(DELIVERABLE_SPECS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <label htmlFor="goal">Campaign goal</label><input id="goal" name="goal" /><label htmlFor="offer">Offer (only if you really have one)</label><input id="offer" name="offer" />
        <label htmlFor="notes">Anything the agent should know</label><textarea id="notes" name="notes" />
        <label htmlFor="keywordFile">Keyword export (CSV, e.g. from Semrush)</label><input id="keywordFile" name="keywordFile" type="file" accept=".csv,text/csv" />
        <label><input type="checkbox" name="rescan" style={{ width: 'auto' }} /> Re-read my website even if scanned recently</label></details>
      <p><button>Send</button></p></form></>);
}
