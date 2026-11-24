import { SiteChrome } from "@/components/site-chrome";
import { getUser } from "@/lib/auth";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  let signedIn = false;
  try {
    signedIn = Boolean(await getUser());
  } catch {
    // Supabase not configured (e.g. a static preview): show the signed-out state.
  }
  return <SiteChrome signedIn={signedIn}>{children}</SiteChrome>;
}
