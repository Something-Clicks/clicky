import "server-only";

import type { StoredFact } from "@/lib/business-profile";

import type { Db } from "../analysis";
import { understand, type BusinessUnderstanding, type OwnerProfile } from "./modules/business-intelligence";

/**
 * Customer context for the Marketing Agent (§14): the business understanding a capability needs,
 * read as the signed-in user (RLS limits it to their own business).
 */
export async function loadUnderstanding(db: Pick<Db, "from">, orgId: string, profile: OwnerProfile): Promise<{ facts: StoredFact[]; understanding: BusinessUnderstanding }> {
  const { data } = await db
    .from("business_facts")
    .select("id, category, field, value, source, evidence_class, basis, evidence, status, observed_at, confirmed_at")
    .eq("organization_id", orgId)
    .in("status", ["proposed", "confirmed"])
    .order("created_at", { ascending: true });
  const facts = (data ?? []) as unknown as StoredFact[];
  return { facts, understanding: understand(profile, facts) };
}
