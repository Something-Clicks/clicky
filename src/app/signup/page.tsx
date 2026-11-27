import Link from 'next/link';
import { signUp } from '../actions';
import { Notice, one, type SP } from '@/components/ui';
export default async function Signup({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const preview = one(sp.preview) ?? '';
  return (<main className="wrap" style={{ maxWidth: 440 }}><h1>Create your account</h1>
    {preview && <div className="banner">Your website analysis will be saved to your new workspace.</div>}<Notice e={one(sp.e)} />
    <form action={signUp} className="card"><input type="hidden" name="preview" value={preview} />
      <label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" />
      <label htmlFor="password">Password (10+ characters)</label><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
      <p><button>Create account</button></p></form>
    <p className="mut">Already have an account? <Link href={`/login${preview ? `?preview=${preview}` : ''}`}>Sign in</Link></p></main>);
}
