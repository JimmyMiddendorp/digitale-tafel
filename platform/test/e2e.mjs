// End-to-end API-test tegen `wrangler dev` (lege lokale database). Gebruik: node test/e2e.mjs
const BASE = process.env.BASE || 'http://localhost:8787';
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '✓ ' : '✗ ') + msg); if (!cond) failures++; };

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, form } = {}) => {
    const headers = cookie ? { cookie } : {};
    let payload;
    if (form) payload = form; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : await r.text() };
  };
}
const tokenOf = (link) => link.split('/wachtwoord/')[1];
const iso = (daysAgo, h = 10) => { const d = new Date(Date.now() - daysAgo * 864e5); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
const date = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

const owner = client();
let r = await owner('/api/setup');
ok(r.data.needed === true, 'setup nodig op lege database');
r = await owner('/api/setup', { method: 'POST', body: { name: 'Eric', email: 'eric@test.nl', password: 'geheim12345' } });
ok(r.status === 200, 'eerste eigenaar aangemaakt');
r = await owner('/api/setup', { method: 'POST', body: { name: 'X', email: 'x@test.nl', password: 'geheim12345' } });
ok(r.status === 403, 'setup daarna dicht');
r = await owner('/api/me');
ok(r.data.user?.role === 'eigenaar', 'ingelogd als eigenaar');

await owner('/api/corporations', { method: 'POST', body: { name: 'Haag Wonen', region_id: 1, contact_email: 'rapporten@haagwonen.test' } });
await owner('/api/corporations', { method: 'POST', body: { name: 'Waterweg Wonen', region_id: 2 } });
await owner('/api/meters', { method: 'POST', body: { from: 1, to: 24 } });
const admin = (await owner('/api/admin')).data;
ok(admin.corporations.length === 2 && admin.meters.length === 24, 'corporaties en 24 meters toegevoegd');
const hw = admin.corporations.find((c) => c.name === 'Haag Wonen').id, ww = admin.corporations.find((c) => c.name === 'Waterweg Wonen').id;

async function invite(name, email, role, extra = {}) {
  const res = await owner('/api/users', { method: 'POST', body: { name, email, role, ...extra } });
  const c = client();
  const t = await c('/api/auth/token/' + tokenOf(res.data.invite_link));
  const acc = await c('/api/auth/token', { method: 'POST', body: { token: tokenOf(res.data.invite_link), password: 'wachtwoord123' } });
  ok(t.data.type === 'invite' && acc.status === 200, `${name} uitgenodigd en wachtwoord gekozen`);
  return [c, res.data.id];
}
const [jimmy, jimmyId] = await invite('Jimmy', 'jimmy@test.nl', 'plaatser', { werkgebied: 'Den Haag', iban: 'NL00TEST0123456789' });
const [sem, semId] = await invite('Sem', 'sem@test.nl', 'plaatser', { werkgebied: 'Amsterdam' });
const [peter] = await invite('Peter', 'peter@test.nl', 'controle');
const [natasja] = await invite('Natasja', 'natasja@test.nl', 'facturatie');
r = await owner('/api/auth/token', { method: 'POST', body: { token: 'x', password: 'wachtwoord123' } });
ok(r.status === 404, 'ongeldige token geweigerd');

// login met wachtwoord
const jimmy2 = client();
r = await jimmy2('/api/auth/login', { method: 'POST', body: { email: 'JIMMY@test.nl', password: 'wachtwoord123' } });
ok(r.status === 200 && r.data.user.role === 'plaatser', 'login met wachtwoord (hoofdletterongevoelig e-mail)');
r = await jimmy2('/api/auth/login', { method: 'POST', body: { email: 'jimmy@test.nl', password: 'fout' } });
ok(r.status === 401, 'fout wachtwoord geweigerd');

// plaatsingen
const mk = (b) => owner('/api/measurements', { method: 'POST', body: { corporation_id: hw, address: 'Weimarstraat 12', city: 'Den Haag', postcode: '2562 GZ', resident_name: 'K. Test', resident_phone: '0600000000', duration_weeks: 1, plaatser_id: jimmyId, planned_place_date: date(0), order_no: 'HW-1', ...b } });
r = await owner('/api/measurements', { method: 'POST', body: { corporation_id: hw, address: '', city: 'Den Haag', duration_weeks: 1, planned_place_date: date(0) } });
ok(r.status === 400, 'validatie: adres verplicht');
const m1 = (await mk({})).data.id;
const m2 = (await mk({ address: 'Insulindesingel 40 B', city: 'Vlaardingen', corporation_id: ww })).data.id;
const m3 = (await mk({ address: 'Javastraat 5', city: 'Amsterdam', plaatser_id: semId })).data.id;
const m4 = (await mk({ address: 'Laan 1', planned_place_date: date(-2) })).data.id; // te laat
ok(m1 && m2 && m3 && m4, 'vier plaatsingen aangemaakt');
const mails = (await owner('/api/admin')).data.emails;
ok(mails.some((e) => e.to_email === 'jimmy@test.nl' && e.subject === 'Nieuwe plaatsing in je omgeving'), 'mail "Nieuwe plaatsing in je omgeving" naar Jimmy gelogd');
r = await jimmy('/api/notifications');
ok(r.data.unread >= 3, 'Jimmy heeft meldingen van nieuwe plaatsingen');
r = await jimmy('/api/my/tasks');
ok(r.data.tasks.filter((t) => !t.done).length === 3 && r.data.tasks.every((t) => t.m.plaatser_id === jimmyId), 'Jimmy ziet alleen zijn eigen 3 opdrachten');
r = await jimmy('/api/measurements/' + m3);
ok(r.status === 404, 'Jimmy kan opdracht van Sem niet openen');
r = await jimmy('/api/overview');
ok(r.status === 403, 'plaatser heeft geen toegang tot overzicht');
r = await natasja('/api/admin');
ok(r.status === 403, 'facturatie heeft geen toegang tot beheer');

// plaatsen
const full5 = [true, true, true, true, true];
r = await jimmy(`/api/measurements/${m1}/place`, { method: 'POST', body: { meter_id: 11, at: iso(8), checklist: [true, true, false, true, true] } });
ok(r.status === 400, 'plaatsen zonder volledige checklist geweigerd');
r = await jimmy(`/api/measurements/${m1}/place`, { method: 'POST', body: { meter_id: 11, at: iso(8), checklist: full5, remark: 'Meter in slaapkamer' } });
ok(r.status === 200 && r.data.planned_pickup_date, 'meter 11 geplaatst, ophaaldatum ' + r.data.planned_pickup_date);
r = await jimmy(`/api/measurements/${m2}/place`, { method: 'POST', body: { meter_id: 11, at: iso(1), checklist: full5 } });
ok(r.status === 400, 'bezette meter 11 kan niet nog eens geplaatst worden');
r = await jimmy(`/api/measurements/${m2}/place`, { method: 'POST', body: { meter_id: 12, at: iso(2), checklist: full5 } });
ok(r.status === 200, 'meter 12 geplaatst in Vlaardingen (2 dagen geleden)');
r = await jimmy('/api/meters/free');
ok(!r.data.meters.includes(11) && !r.data.meters.includes(12) && r.data.meters.length === 22, 'vrije meters bijgewerkt (22)');
r = await peter('/api/notifications');
ok(r.data.items.some((n) => n.title.includes('Meter 11 geplaatst')), 'Peter krijgt melding "Meter 11 geplaatst"');

// controle
r = await peter(`/api/measurements/${m1}/check`, { method: 'POST' });
ok(r.status === 200, 'Peter controleert plaatsing m1');
r = await jimmy(`/api/measurements/${m1}/check`, { method: 'POST' });
ok(r.status === 403, 'plaatser mag niet controleren');

// termijnbewaking
r = await owner('/api/admin/run-alerts', { method: 'POST' });
ok(r.data.created > 0, `cron maakte ${r.data.created} meldingen`);
r = await owner('/api/notifications');
ok(r.data.items.some((n) => n.severity === 'red' && n.title.startsWith('Plaatsing niet afgevinkt')), 'eigenaar: rood "Plaatsing niet afgevinkt" (m4)');
ok(r.data.items.some((n) => n.severity === 'red' && n.title.startsWith('Plaatsing nog niet gecontroleerd')), 'eigenaar: rood "nog niet gecontroleerd" (m2, >24 uur)');
ok(r.data.items.some((n) => n.title.startsWith('Ophalen niet afgevinkt')), 'eigenaar: "Ophalen niet afgevinkt" (m1, 8 dagen bij 1 week)');
const before = r.data.items.length;
await owner('/api/admin/run-alerts', { method: 'POST' });
r = await owner('/api/notifications');
ok(r.data.items.length === before, 'tweede cron-run maakt geen dubbele meldingen');

// ophalen + foto
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'dagboek.png');
r = await jimmy(`/api/measurements/${m1}/photos`, { method: 'POST', form: fd });
ok(r.status === 200 && r.data.count === 1, 'foto van dagboek geüpload');
r = await jimmy(`/api/measurements/${m1}/pickup`, { method: 'POST', body: { at: iso(0, 9), checklist: [true, true, true], diary: 'ja', noise_heard: true, remark: 'Bewoner tevreden' } });
ok(r.status === 200, 'meter 11 opgehaald');
r = await jimmy('/api/meters/free');
ok(r.data.meters.includes(11), 'meter 11 weer vrij');
r = await peter('/api/measurements/' + m1);
ok(r.data.photos.length === 1 && r.data.measurement.stage === 2 && r.data.measurement.report_deadline, 'Peter ziet foto, stap "Opgehaald" en deadline ' + r.data.measurement.report_deadline);
const photoRes = await fetch(BASE + '/api/files/photo/' + r.data.photos[0].id);
ok(photoRes.status === 401, 'foto niet op te halen zonder inloggen');

// rapportage
r = await peter(`/api/measurements/${m1}/advance`, { method: 'POST', body: { step: 'data' } });
ok(r.status === 400, 'stappen in volgorde afgedwongen');
await peter(`/api/measurements/${m1}/advance`, { method: 'POST', body: { step: 'diary' } });
r = await peter(`/api/measurements/${m1}/advance`, { method: 'POST', body: { step: 'data' } });
ok(r.status === 200, 'dagboek verwerkt en data gecontroleerd');
const pdf = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const fd2 = new FormData(); fd2.append('outcome', 'Overlast aangetoond'); fd2.append('file', new Blob([pdf], { type: 'application/pdf' }), 'rapport.pdf');
r = await peter(`/api/measurements/${m1}/report`, { method: 'POST', form: fd2 });
ok(r.status === 200, 'rapport (PDF) geüpload met uitkomst');
r = await peter(`/api/measurements/${m1}/send`, { method: 'POST' });
ok(r.status === 200, 'rapport verzonden (' + r.data.mail + ')');
const sentMail = (await owner('/api/admin')).data.emails.find((e) => e.to_email === 'rapporten@haagwonen.test');
ok(!!sentMail, 'mail met rapport naar corporatie in logboek');
r = await owner(`/api/measurements/${m1}/close`, { method: 'POST' });
ok(r.status === 200, 'dossier afgerond');
r = await owner(`/api/measurements/${m1}/notes`, { method: 'POST', body: { body: 'Corporatie gebeld' } });
r = await owner('/api/measurements/' + m1);
ok(r.data.measurement.stage === 7 && r.data.events.length >= 8 && r.data.notes.length === 1, `detail: afgerond, ${r.data.events.length} events, 1 notitie`);

// uitbetaling
const month = new Date().toISOString().slice(0, 7);
r = await natasja('/api/payouts?month=' + month);
const pj = r.data.plaatsers.find((p) => p.user.name === 'Jimmy');
const zones = pj.lines.map((l) => `${l.type}:${l.city}:z${l.zone}:${l.amount}`);
console.log('   Jimmy deze maand:', zones.join(' | '), '→ totaal', pj.total);
ok(pj.lines.some((l) => l.city === 'Vlaardingen' && l.zone === 3 && l.amount === 65), 'Vlaardingen voor Jimmy (Den Haag) = zone 3, €65');
ok(pj.lines.filter((l) => l.city === 'Den Haag').every((l) => l.zone === 1 && l.amount === 42.5), 'Den Haag = zone 1, €42,50');
r = await natasja(`/api/payouts/${jimmyId}/${month}`, { method: 'POST', body: { status: 'goedgekeurd' } });
r = await natasja('/api/payouts?month=' + month);
ok(r.data.plaatsers.find((p) => p.user.name === 'Jimmy').status === 'goedgekeurd', 'uitbetaling goedgekeurd');
r = await natasja(`/api/payouts.csv?month=${month}`);
ok(typeof r.data === 'string' && r.data.includes('Vlaardingen'), 'CSV-export bevat regels');
r = await jimmy('/api/my/tasks');
ok(r.data.month.total === pj.total, 'Jimmy ziet zijn maandtotaal in de app');

// gebruiker deactiveren logt uit
const sem2 = sem;
await owner(`/api/users/${semId}`, { method: 'PATCH', body: { active: false } });
r = await sem2('/api/me');
ok(r.status === 401, 'gedeactiveerde gebruiker is uitgelogd');

// wachtwoord vergeten
r = await owner('/api/auth/forgot', { method: 'POST', body: { email: 'peter@test.nl' } });
ok((await owner('/api/admin')).data.emails.some((e) => e.to_email === 'peter@test.nl' && e.subject === 'Nieuw wachtwoord instellen'), 'reset-mail naar Peter');

console.log(failures ? `\n${failures} test(s) mislukt` : '\nAlle tests geslaagd');
process.exit(failures ? 1 : 0);
