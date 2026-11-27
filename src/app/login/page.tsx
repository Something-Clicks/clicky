import Link from 'next/link';
import { logIn } from '../actions';
import { Notice, one, type SP } from '@/components/ui';
export default async function Login({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const preview = one(sp.preview) ?? '';
  return (<main className="wrap" style={{ maxWidth: 440 }}><h1>Sign in</h1><Notice e={one(sp.e)} m={one(sp.m)} />
    <form action={logIn} className="card"><input type="hidden" name="preview" value={preview} />
      <label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" />
      <label htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" />
      <p><button>Sign in</button></p></form>
    <p className="mut">New here? <Link href={`/signup${preview ? `?preview=${preview}` : ''}`}>Create an account</Link></p></main>);
}
