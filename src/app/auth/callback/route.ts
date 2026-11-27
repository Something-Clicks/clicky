import { NextResponse, type NextRequest } from 'next/server';
import { getContainer } from '@/server/container';
import { env } from '@/server/env';
import { userClient } from '@/server/supabase/clients';

/** Supabase Auth email-confirmation landing: exchange the code for a session, then claim any pending preview. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code'); const preview = req.nextUrl.searchParams.get('preview');
  if (code) {
    const sb = await userClient(); const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await sb.auth.getUser();
      if (data.user && preview) await getContainer().previews.claim(preview, { id: data.user.id }).catch(() => undefined);
      return NextResponse.redirect(`${env.appUrl}/dashboard`);
    }
  }
  return NextResponse.redirect(`${env.appUrl}/login?e=${encodeURIComponent('That confirmation link is invalid or has expired.')}`);
}
