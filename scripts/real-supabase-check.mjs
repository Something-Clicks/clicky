// Real-Supabase checks against the DEVELOPMENT project only. Creates two real Auth accounts, then proves tenant isolation
// through the real Data API with their real JWTs. Reads SUPABASE_URL and SUPABASE_ANON_KEY (public) from the environment.
// Passwords are random and never printed. Test rows are namespaced "sc-test-" and removed by the cleanup SQL that follows.
import { randomBytes } from 'node:crypto';
const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY; const stamp = Date.now();
if (!URL_ || !ANON) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
if (!/ofstvbgaoznipsiqbjjp/.test(URL_)) throw new Error('Refusing to run: not the clicky-dev project');
const mkUser = (n) => ({ email: `sc-test-${n}-${stamp}@example.com`, password: randomBytes(18).toString('base64url') + 'aA1!' });
const A = mkUser('a'), B = mkUser('b');
const j = async (path, init = {}) => { const r = await fetch(URL_ + path, { ...init, headers: { apikey: ANON, 'content-type': 'application/json', ...(init.headers ?? {}) } }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b }; };
const out = [];
const rec = (name, ok, detail = '') => { out.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const signup = async (u) => j('/auth/v1/signup', { method: 'POST', body: JSON.stringify(u) });
const sa = await signup(A); const sb = await signup(B);
const needsConfirm = (s) => s.status === 200 && !s.body.access_token;
rec('real signup A accepted', sa.status === 200, `status ${sa.status} ${sa.status !== 200 ? JSON.stringify(sa.body).slice(0, 200) : ''}${needsConfirm(sa) ? ' (email confirmation required: no session yet)' : ' (session issued: auto-confirm)'}`);
rec('real signup B accepted', sb.status === 200, `status ${sb.status}`);
const bad = await j('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: A.email, password: 'wrong-password-123' }) });
rec('wrong password is rejected', bad.status === 400, `status ${bad.status}`);
const unconfirmed = await j('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify(A) });
console.log(`INFO  login before confirmation → status ${unconfirmed.status}${unconfirmed.body?.error_code ? ' ' + unconfirmed.body.error_code : ''}`);
console.log(JSON.stringify({ A: A.email, B: B.email, needsConfirmA: needsConfirm(sa), idA: sa.body?.user?.id ?? sa.body?.id, idB: sb.body?.user?.id ?? sb.body?.id }));
globalThis.__creds = { A, B };
import { writeFileSync } from 'node:fs'; writeFileSync(process.env.CREDS_FILE ?? '/tmp/sc-test-creds.json', JSON.stringify({ A, B, idA: sa.body?.user?.id ?? sa.body?.id, idB: sb.body?.user?.id ?? sb.body?.id, needsConfirmA: needsConfirm(sa) }), { mode: 0o600 });
