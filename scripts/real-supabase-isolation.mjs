// Tenant isolation through the REAL Supabase Auth + Data API (development project only) with two real accounts.
const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY;
if (!/ofstvbgaoznipsiqbjjp/.test(URL_ ?? '')) throw new Error('Refusing to run: not the clicky-dev project');
const creds = JSON.parse(process.env.TEST_CREDS);
const call = async (path, { token, method = 'GET', body } = {}) => { const r = await fetch(URL_ + path, { method, headers: { apikey: ANON, authorization: `Bearer ${token ?? ANON}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { status: r.status, body: b }; };
const login = async (c) => { const r = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify(c) }); const b = await r.json(); return { status: r.status, token: b.access_token, uid: b.user?.id }; };
let fail = 0; const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const ids = (r) => (Array.isArray(r.body) ? r.body.map((x) => x.id).sort() : []);

const settings = await fetch(URL_ + '/auth/v1/settings', { headers: { apikey: ANON } });
if (settings.status !== 200) throw new Error(`API key rejected by the project (status ${settings.status}); fix the key before trusting any result below`);
const a = await login(creds.A), b = await login(creds.B);
rec('real login A returns a session', a.status === 200 && !!a.token, `status ${a.status}`); rec('real login B returns a session', b.status === 200 && !!b.token);
const badLogin = await login({ ...creds.A, password: 'definitely-wrong-1' }); rec('wrong password is rejected', badLogin.status === 400 && !badLogin.token);

const cardsA = await call('/rest/v1/sc_cards?select=id&id=like.sc-test-*', { token: a.token }); rec('A sees only A\'s cards', JSON.stringify(ids(cardsA)) === '["sc-test-card-a"]', JSON.stringify(ids(cardsA)));
const cardsB = await call('/rest/v1/sc_cards?select=id&id=like.sc-test-*', { token: b.token }); rec('B (a viewer in A, owner of B) reads exactly A\'s and B\'s cards, as membership dictates', JSON.stringify(ids(cardsB)) === '["sc-test-card-a","sc-test-card-b"]', JSON.stringify(ids(cardsB)));
const aGetB = await call('/rest/v1/sc_cards?select=id&id=eq.sc-test-card-b', { token: a.token }); rec('A cannot fetch B\'s card by exact id', Array.isArray(aGetB.body) && aGetB.body.length === 0);
const aBiz = await call('/rest/v1/sc_businesses?select=id&id=like.sc-test-*', { token: a.token }); rec('A sees only business A', JSON.stringify(ids(aBiz)) === '["sc-test-biz-a"]', JSON.stringify(ids(aBiz)));
const auditA = await call('/rest/v1/sc_audit?select=id&id=like.sc-test-*', { token: a.token }); rec('owner A can read the audit log', ids(auditA).length === 1);
const auditB = await call('/rest/v1/sc_audit?select=id&id=like.sc-test-*', { token: b.token }); rec('viewer B cannot read A\'s audit log', ids(auditB).length === 0);
const billA = await call('/rest/v1/sc_billing?select=id&id=like.sc-test-*', { token: a.token }); rec('A can read own billing row', ids(billA).length === 1);
const mem = await call('/rest/v1/sc_members?select=id&id=like.sc-test-*', { token: b.token }); rec('B sees own memberships only (not A\'s owner row)', JSON.stringify(ids(mem)) === '["sc-test-m-b","sc-test-m-b-viewer-in-a"]', JSON.stringify(ids(mem)));

for (const [name, r] of [['A insert into own tenant', await call('/rest/v1/sc_cards', { token: a.token, method: 'POST', body: { id: 'sc-test-evil1', business_id: 'sc-test-biz-a', data: {} } })], ['A insert into B tenant', await call('/rest/v1/sc_cards', { token: a.token, method: 'POST', body: { id: 'sc-test-evil2', business_id: 'sc-test-biz-b', data: {} } })], ['A update own card', await call('/rest/v1/sc_cards?id=eq.sc-test-card-a', { token: a.token, method: 'PATCH', body: { data: { hacked: true } } })], ['A update B\'s card', await call('/rest/v1/sc_cards?id=eq.sc-test-card-b', { token: a.token, method: 'PATCH', body: { data: { hacked: true } } })], ['A delete own card', await call('/rest/v1/sc_cards?id=eq.sc-test-card-a', { token: a.token, method: 'DELETE' })], ['A grant itself membership in B', await call('/rest/v1/sc_members', { token: a.token, method: 'POST', body: { id: 'sc-test-evil3', business_id: 'sc-test-biz-b', data: { userId: a.uid, role: 'owner' } } })]])
  rec(`client write refused by the database: ${name}`, (r.status === 401 || r.status === 403) && r.body?.code === '42501', `status ${r.status} ${r.body?.code ?? ''}`);
for (const t of ['sc_previews', 'sc_stripe_events']) { const r = await call(`/rest/v1/${t}?select=id`, { token: a.token }); rec(`authenticated cannot read ${t}`, r.body?.code === '42501', `status ${r.status} ${r.body?.code ?? ''}`); const an = await call(`/rest/v1/${t}?select=id`); rec(`anonymous cannot read ${t}`, an.body?.code === '42501', `status ${an.status} ${an.body?.code ?? ''}`); }
const anonCards = await call('/rest/v1/sc_cards?select=id'); rec('anonymous cannot read cards', anonCards.body?.code === '42501', `status ${anonCards.status} ${anonCards.body?.code ?? ''}`);
const rpc = await call('/rest/v1/rpc/is_member', { token: a.token, method: 'POST', body: { bid: 'sc-test-biz-b' } }); rec('private helper functions are not exposed over the API', rpc.status === 404 || rpc.status === 401 || rpc.status === 403, `status ${rpc.status}`);
console.log(fail ? `\n${fail} FAILED` : '\nall passed'); process.exit(fail ? 1 : 0);
