import { NextResponse, type NextRequest } from "next/server";

import { draftAsText, draftFields } from "@/components/draft";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Downloads a prepared draft as a text file. RLS limits it to members of the business. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await getUser())) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase
    .from("approvals")
    .select("id, agent_runs ( output, draft_type ), action_cards ( title )")
    .eq("id", id)
    .maybeSingle();
  if (!data?.agent_runs) return new NextResponse("Not found", { status: 404 });
  const text = `${data.action_cards?.title ?? "Draft"}\n\n${draftAsText(draftFields(data.agent_runs.output))}\n`;
  return new NextResponse(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="something-clicks-draft-${id.slice(0, 8)}.txt"`,
      "cache-control": "private, no-store",
    },
  });
}
