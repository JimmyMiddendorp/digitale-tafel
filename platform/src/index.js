import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  nowIso, todayAms, addDays, amsDate, code, esc, fmtDate, fmtDateTime, randomHex, sha256, hashPassword, safeEqual,
  getSettings, logEvent, notify, sendMail, mailLayout, placeRegions, zoneOf,
} from './util.js';
import { getMeasurement, listMeasurements, PLACE_CHECKLIST, PICKUP_CHECKLIST, OUTCOMES, STAGES } from './measurements.js';
import { runAlerts } from './alerts.js';

const app = new Hono();
const COOKIE = 'nn_session';
const SESSION_DAYS = 30;
const ROLES = ['eigenaar', 'controle', 'plaatser', 'facturatie'];
const ROLE_LABEL = { eigenaar: 'Eigenaar', controle: 'Controle', plaatser: 'Plaatser', facturatie: 'Facturatie' };
const appUrl = (env) => (env.APP_URL || '').replace(/\/$/, '');
const bad = (c, msg, status = 400) => c.json({ error: msg }, status);
const isEmail = (s) => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const str = (v, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Er ging iets mis op de server. Probeer het opnieuw.' }, 500);
});

// ---------- sessies ----------
async function createSession(c, userId) {
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)').bind(await sha256(token), userId, expires).run();
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 });
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, role_label: ROLE_LABEL[u.role], phone: u.phone, werkgebied: u.werkgebied });

app.use('/api/*', async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (token) {
    const row = await c.env.DB.prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.active = 1'
    ).bind(await sha256(token), nowIso()).first();
    if (row) c.set('user', row);
  }
  await next();
});
const auth = async (c, next) => (c.get('user') ? next() : bad(c, 'Niet ingelogd', 401));
const need = (...roles) => async (c, next) => (roles.includes(c.get('user')?.role) ? next() : bad(c, 'Geen toegang voor deze rol', 403));

// ---------- setup & inloggen ----------
app.get('/api/setup', async (c) => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n');
  return c.json({ needed: n === 0 });
});
app.post('/api/setup', async (c) => {
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n');
  if (n > 0) return bad(c, 'Setup is al gedaan', 403);
  const b = await c.req.json();
  if (!str(b.name) || !isEmail(b.email) || !b.password || b.password.length < 10) return bad(c, 'Vul naam, geldig e-mailadres en een wachtwoord van minimaal 10 tekens in');
  const id = crypto.randomUUID(), salt = randomHex(16);
  await c.env.DB.prepare('INSERT INTO users (id,email,name,role,password_hash,password_salt) VALUES (?,?,?,?,?,?)')
    .bind(id, b.email.trim(), str(b.name), 'eigenaar', await hashPassword(b.password, salt), salt).run();
  await createSession(c, id);
  return c.json({ ok: true });
});

app.post('/api/auth/login', async (c) => {
  const b = await c.req.json();
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? AND active = 1').bind(String(b.email || '').trim()).first();
  const ok = u?.password_hash && safeEqual(await hashPassword(String(b.password || ''), u.password_salt), u.password_hash);
  if (!ok) return bad(c, 'E-mailadres of wachtwoord klopt niet', 401);
  await createSession(c, u.id);
  return c.json({ user: publicUser(u) });
});
app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});
app.get('/api/me', auth, (c) => c.json({ user: publicUser(c.get('user')) }));

async function issueToken(env, user, type) {
  const token = randomHex(24);
  const expires = new Date(Date.now() + (type === 'invite' ? 7 : 1) * 864e5).toISOString();
  await env.DB.prepare('INSERT INTO tokens (id,user_id,type,expires_at) VALUES (?,?,?,?)').bind(await sha256(token), user.id, type, expires).run();
  const link = `${appUrl(env)}/#/wachtwoord/${token}`;
  if (type === 'invite') {
    await sendMail(env, user.email, 'Je account voor NeighborNoise',
      mailLayout(`Welkom, ${user.name}`, `<p>Je bent toegevoegd aan het NeighborNoise-platform als <b>${esc(ROLE_LABEL[user.role])}</b>.</p><p>Kies via de knop een wachtwoord. De link is 7 dagen geldig.</p>`, { url: link, label: 'Wachtwoord instellen' }));
  } else {
    await sendMail(env, user.email, 'Nieuw wachtwoord instellen',
      mailLayout('Nieuw wachtwoord', '<p>Via de knop kies je een nieuw wachtwoord. De link is 24 uur geldig. Heb je dit niet aangevraagd? Dan kun je deze mail negeren.</p>', { url: link, label: 'Nieuw wachtwoord kiezen' }));
  }
  return link;
}
app.post('/api/auth/forgot', async (c) => {
  const b = await c.req.json();
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? AND active = 1').bind(String(b.email || '').trim()).first();
  if (u) await issueToken(c.env, u, 'reset');
  return c.json({ ok: true });
});
app.get('/api/auth/token/:token', async (c) => {
  const t = await c.env.DB.prepare('SELECT t.type, u.name, u.email FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ? AND t.used_at IS NULL AND t.expires_at > ?')
    .bind(await sha256(c.req.param('token')), nowIso()).first();
  return t ? c.json(t) : bad(c, 'Deze link is verlopen of al gebruikt. Vraag een nieuwe aan.', 404);
});
app.post('/api/auth/token', async (c) => {
  const b = await c.req.json();
  if (!b.password || b.password.length < 10) return bad(c, 'Kies een wachtwoord van minimaal 10 tekens');
  const id = await sha256(String(b.token || ''));
  const t = await c.env.DB.prepare('SELECT * FROM tokens WHERE id = ? AND used_at IS NULL AND expires_at > ?').bind(id, nowIso()).first();
  if (!t) return bad(c, 'Deze link is verlopen of al gebruikt. Vraag een nieuwe aan.', 404);
  const salt = randomHex(16);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').bind(await hashPassword(b.password, salt), salt, t.user_id),
    c.env.DB.prepare('UPDATE tokens SET used_at = ? WHERE id = ?').bind(nowIso(), id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(t.user_id),
  ]);
  await createSession(c, t.user_id);
  return c.json({ ok: true });
});

app.use('/api/*', async (c, next) => {
  const p = new URL(c.req.url).pathname;
  if (p === '/api/setup' || p.startsWith('/api/auth/')) return next();
  return auth(c, next);
});

// ---------- overzicht (eigenaar, controle, facturatie) ----------
app.get('/api/overview', need('eigenaar', 'controle', 'facturatie'), async (c) => {
  const env = c.env, s = await getSettings(env);
  const [measurements, meters, regions, corps, plaatsers] = await Promise.all([
    listMeasurements(env, s),
    env.DB.prepare('SELECT * FROM meters ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM regions ORDER BY sort, name').all(),
    env.DB.prepare('SELECT * FROM corporations WHERE active = 1 ORDER BY name').all(),
    env.DB.prepare("SELECT id, name, werkgebied FROM users WHERE role = 'plaatser' AND active = 1 ORDER BY name").all(),
  ]);
  return c.json({ settings: s, today: todayAms(), stages: STAGES, measurements, meters: meters.results, regions: regions.results, corporations: corps.results, plaatsers: plaatsers.results, outcomes: OUTCOMES });
});

async function loadForUser(c, id) {
  const s = await getSettings(c.env);
  const m = await getMeasurement(c.env, Number(id), s);
  if (!m) return [null, bad(c, 'Meting niet gevonden', 404)];
  const u = c.get('user');
  if (u.role === 'plaatser' && m.plaatser_id !== u.id) return [null, bad(c, 'Meting niet gevonden', 404)];
  return [m, null, s];
}

app.get('/api/measurements/:id', async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  const env = c.env, isPl = c.get('user').role === 'plaatser';
  const [events, notes, photos] = await Promise.all([
    env.DB.prepare('SELECT e.*, u.name AS actor FROM events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.measurement_id = ? ORDER BY e.at').bind(m.id).all(),
    isPl ? { results: [] } : env.DB.prepare('SELECT n.*, u.name AS author FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.measurement_id = ? ORDER BY n.created_at DESC').bind(m.id).all(),
    env.DB.prepare('SELECT id, content_type, created_at FROM photos WHERE measurement_id = ? ORDER BY id').bind(m.id).all(),
  ]);
  return c.json({ measurement: m, events: events.results, notes: notes.results, photos: photos.results, place_checklist: PLACE_CHECKLIST, pickup_checklist: PICKUP_CHECKLIST, outcomes: OUTCOMES });
});

// ---------- aanmaken en wijzigen (eigenaar) ----------
async function validateMeasurement(env, b) {
  if (!str(b.address)) return 'Vul het adres in';
  if (!str(b.city)) return 'Vul de plaats in';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.planned_place_date || '')) return 'Kies een plaatsdatum';
  if (![1, 2].includes(Number(b.duration_weeks))) return 'Meetduur is 1 of 2 weken';
  const corp = await env.DB.prepare('SELECT id FROM corporations WHERE id = ?').bind(Number(b.corporation_id)).first();
  if (!corp) return 'Kies een corporatie';
  if (b.plaatser_id) {
    const p = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'plaatser' AND active = 1").bind(b.plaatser_id).first();
    if (!p) return 'Kies een geldige plaatser';
  }
  return null;
}
async function mailNewAssignment(env, mid) {
  const s = await getSettings(env);
  const m = await getMeasurement(env, mid, s);
  if (!m?.plaatser_id) return;
  await notify(env, { userIds: [m.plaatser_id] }, { title: `Nieuwe plaatsing: ${m.address}`, body: `${m.city} · gepland ${fmtDate(m.planned_place_date)}`, measurementId: m.id, key: `assign-${m.id}-${m.plaatser_id}` });
  if (m.plaatser_email) {
    await sendMail(env, m.plaatser_email, 'Nieuwe plaatsing in je omgeving',
      mailLayout(`Hey ${m.plaatser_name}! Nieuwe plaatsing in je omgeving`,
        `<table style="font-size:14px;line-height:1.6"><tr><td style="color:#6e6e6e;padding-right:12px">Adres</td><td><b>${esc(m.address)}</b>, ${esc(m.postcode || '')} ${esc(m.city)}</td></tr>
        <tr><td style="color:#6e6e6e;padding-right:12px">Datum</td><td>${esc(fmtDate(m.planned_place_date))}</td></tr>
        <tr><td style="color:#6e6e6e;padding-right:12px">Meetduur</td><td>${m.duration_weeks} ${m.duration_weeks > 1 ? 'weken' : 'week'}</td></tr>
        <tr><td style="color:#6e6e6e;padding-right:12px">Corporatie</td><td>${esc(m.corp_name)}</td></tr>
        <tr><td style="color:#6e6e6e;padding-right:12px">Bewoner</td><td>${esc(m.resident_name || '—')} ${esc(m.resident_phone || '')}</td></tr></table>`,
        { url: `${appUrl(env)}/#/plaatser/${m.id}`, label: 'Bekijk in de app' }));
  }
}
app.post('/api/measurements', need('eigenaar'), async (c) => {
  const b = await c.req.json(), env = c.env, u = c.get('user');
  const err = await validateMeasurement(env, b);
  if (err) return bad(c, err);
  const r = await env.DB.prepare(`INSERT INTO measurements (corporation_id, order_no, address, postcode, city, resident_name, resident_phone, duration_weeks, plaatser_id, planned_place_date, remark, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(Number(b.corporation_id), str(b.order_no, 80), str(b.address), str(b.postcode, 12), str(b.city, 80), str(b.resident_name, 120), str(b.resident_phone, 40),
    Number(b.duration_weeks), b.plaatser_id || null, b.planned_place_date, str(b.remark, 1000), u.id).run();
  const id = r.meta.last_row_id;
  await logEvent(env, id, 'created', 'Nieuwe plaatsing aangemaakt', u.id);
  await mailNewAssignment(env, id);
  return c.json({ id });
});
app.patch('/api/measurements/:id', need('eigenaar'), async (c) => {
  const env = c.env, id = Number(c.req.param('id'));
  const cur = await env.DB.prepare('SELECT * FROM measurements WHERE id = ?').bind(id).first();
  if (!cur) return bad(c, 'Meting niet gevonden', 404);
  const b = { ...cur, ...(await c.req.json()) };
  const err = await validateMeasurement(env, b);
  if (err) return bad(c, err);
  await env.DB.prepare(`UPDATE measurements SET corporation_id=?, order_no=?, address=?, postcode=?, city=?, resident_name=?, resident_phone=?, duration_weeks=?, plaatser_id=?, planned_place_date=?, remark=?,
    planned_pickup_date = CASE WHEN placed_at IS NOT NULL THEN ? ELSE planned_pickup_date END, is_new = CASE WHEN plaatser_id IS NOT ? THEN 1 ELSE is_new END WHERE id=?`)
    .bind(Number(b.corporation_id), str(b.order_no, 80), str(b.address), str(b.postcode, 12), str(b.city, 80), str(b.resident_name, 120), str(b.resident_phone, 40), Number(b.duration_weeks),
      b.plaatser_id || null, b.planned_place_date, str(b.remark, 1000), cur.placed_at ? addDays(amsDate(cur.placed_at), 7 * Number(b.duration_weeks)) : null, b.plaatser_id || null, id).run();
  await logEvent(env, id, 'edited', 'Gegevens aangepast', c.get('user').id);
  if ((b.plaatser_id || null) !== cur.plaatser_id && b.plaatser_id && cur.stage < 2) await mailNewAssignment(env, id);
  return c.json({ ok: true });
});
app.delete('/api/measurements/:id', need('eigenaar'), async (c) => {
  const env = c.env, id = Number(c.req.param('id'));
  const { results } = await env.DB.prepare('SELECT r2_key FROM photos WHERE measurement_id = ?').bind(id).all();
  const m = await env.DB.prepare('SELECT report_key FROM measurements WHERE id = ?').bind(id).first();
  const keys = results.map((r) => r.r2_key).concat(m?.report_key ? [m.report_key] : []);
  if (keys.length) await env.FILES.delete(keys);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM photos WHERE measurement_id = ?').bind(id),
    env.DB.prepare('DELETE FROM events WHERE measurement_id = ?').bind(id),
    env.DB.prepare('DELETE FROM notes WHERE measurement_id = ?').bind(id),
    env.DB.prepare('DELETE FROM notifications WHERE measurement_id = ?').bind(id),
    env.DB.prepare('DELETE FROM measurements WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});
app.post('/api/measurements/:id/remind', need('eigenaar'), async (c) => {
  const [m, err, s] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  const env = c.env, { to } = await c.req.json();
  const what = m.stage === 0 ? 'plaatsen' : m.stage === 1 ? 'ophalen' : 'verwerken';
  if (to === 'controle') {
    await notify(env, { roles: ['controle'] }, { severity: 'warn', title: `Herinnering: ${code(m.id)}`, body: `${m.address} · ${m.stage_label}`, measurementId: m.id, key: `remind-${m.id}-${Date.now()}` });
    const { results } = await env.DB.prepare("SELECT email, name FROM users WHERE role='controle' AND active=1").all();
    for (const r of results) await sendMail(env, r.email, `Herinnering: ${code(m.id)} ${m.address}`, mailLayout('Herinnering', `<p>Hoi ${esc(r.name)}, wil je ${esc(m.address)}, ${esc(m.city)} oppakken? Huidige stap: <b>${esc(m.stage_label)}</b>.</p>`, { url: `${appUrl(env)}/#/meting/${m.id}`, label: 'Open meting' }));
  } else {
    if (!m.plaatser_id) return bad(c, 'Er is nog geen plaatser gekoppeld');
    await notify(env, { userIds: [m.plaatser_id] }, { severity: 'warn', title: `Herinnering: ${what} ${m.address}`, body: m.city, measurementId: m.id, key: `remind-${m.id}-${Date.now()}` });
    if (m.plaatser_email) await sendMail(env, m.plaatser_email, `Herinnering: ${what} ${m.address}`, mailLayout('Herinnering', `<p>Hoi ${esc(m.plaatser_name)}, vergeet niet te ${what} bij <b>${esc(m.address)}, ${esc(m.city)}</b> en het af te vinken in de app.</p>`, { url: `${appUrl(env)}/#/plaatser/${m.id}`, label: 'Open in de app' }));
  }
  await logEvent(env, m.id, 'reminder', `Herinnering gestuurd aan ${to === 'controle' ? 'controle' : m.plaatser_name}`, c.get('user').id);
  return c.json({ ok: true });
});
app.post('/api/measurements/:id/close', need('eigenaar'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  if (m.stage !== 6) return bad(c, 'Afronden kan zodra de rapportage is verzonden');
  await c.env.DB.prepare('UPDATE measurements SET stage = 7, closed_at = ? WHERE id = ?').bind(nowIso(), m.id).run();
  await logEvent(c.env, m.id, 'closed', 'Dossier afgerond', c.get('user').id);
  return c.json({ ok: true });
});
app.post('/api/measurements/:id/notes', need('eigenaar', 'controle'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  const body = str((await c.req.json()).body, 4000);
  if (!body) return bad(c, 'Notitie is leeg');
  await c.env.DB.prepare('INSERT INTO notes (measurement_id, user_id, body) VALUES (?,?,?)').bind(m.id, c.get('user').id, body).run();
  return c.json({ ok: true });
});

// ---------- controle ----------
app.post('/api/measurements/:id/check', need('controle', 'eigenaar'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  if (!m.placed_at) return bad(c, 'Deze meter is nog niet geplaatst');
  if (m.place_checked_at) return bad(c, 'Al gecontroleerd');
  const u = c.get('user');
  await c.env.DB.prepare('UPDATE measurements SET place_checked_at = ?, place_checked_by = ? WHERE id = ?').bind(nowIso(), u.id, m.id).run();
  await logEvent(c.env, m.id, 'place_checked', 'Plaatsing gecontroleerd', u.id);
  return c.json({ ok: true });
});
app.post('/api/measurements/:id/advance', need('controle', 'eigenaar'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  const { step } = await c.req.json(), u = c.get('user');
  const map = { diary: [2, 3, 'diary_processed_at', 'Dagboek verwerkt'], data: [3, 4, 'data_checked_at', 'Data gecontroleerd'] };
  const st = map[step];
  if (!st) return bad(c, 'Onbekende stap');
  if (m.stage !== st[0]) return bad(c, `Deze stap kan pas na "${STAGES[st[0]]}"`);
  await c.env.DB.prepare(`UPDATE measurements SET stage = ?, ${st[2]} = ? WHERE id = ?`).bind(st[1], nowIso(), m.id).run();
  await logEvent(c.env, m.id, step, st[3], u.id);
  return c.json({ ok: true });
});
app.post('/api/measurements/:id/report', need('controle', 'eigenaar'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  if (m.stage !== 4 && m.stage !== 5) return bad(c, 'Upload het rapport nadat de data is gecontroleerd');
  const body = await c.req.parseBody();
  const file = body.file, outcome = String(body.outcome || '');
  if (!OUTCOMES.includes(outcome)) return bad(c, 'Kies de uitkomst van het rapport');
  if (!(file instanceof File) || file.type !== 'application/pdf') return bad(c, 'Upload het rapport als PDF');
  if (file.size > 20 * 1024 * 1024) return bad(c, 'Het rapport is groter dan 20 MB');
  const key = `reports/${m.id}/${crypto.randomUUID()}.pdf`;
  await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'application/pdf' } });
  if (m.report_key) await c.env.FILES.delete(m.report_key);
  await c.env.DB.prepare('UPDATE measurements SET stage = 5, report_key = ?, report_name = ?, report_ready_at = ?, outcome = ? WHERE id = ?')
    .bind(key, str(file.name, 200) || 'rapport.pdf', nowIso(), outcome, m.id).run();
  await logEvent(c.env, m.id, 'report', `Rapportage geüpload (${outcome})`, c.get('user').id);
  return c.json({ ok: true });
});
app.post('/api/measurements/:id/send', need('controle', 'eigenaar'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  if (m.stage !== 5) return bad(c, 'Upload eerst het rapport');
  if (!m.corp_email) return bad(c, `Er staat geen e-mailadres voor rapporten bij ${m.corp_name}. Vul dit in bij Beheer › Corporaties.`);
  const obj = await c.env.FILES.get(m.report_key);
  if (!obj) return bad(c, 'Rapportbestand niet gevonden, upload het opnieuw');
  const buf = new Uint8Array(await obj.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const status = await sendMail(c.env, m.corp_email, `Rapport geluidsmeting ${m.address}${m.order_no ? ' · opdracht ' + m.order_no : ''}`,
    mailLayout('Rapport geluidsmeting', `<p>Beste ${esc(m.corp_name)},</p><p>In de bijlage vindt u het rapport van de geluidsmeting bij <b>${esc(m.address)}, ${esc(m.city)}</b>${m.order_no ? ` (opdrachtnummer ${esc(m.order_no)})` : ''}.</p><p>Uitkomst: <b>${esc(m.outcome)}</b>.<br>Meetperiode: ${esc(fmtDate(m.placed_at))} t/m ${esc(fmtDate(m.picked_up_at))}.</p><p>Met vriendelijke groet,<br>NeighborNoise</p>`),
    [{ filename: m.report_name || `rapport-${code(m.id)}.pdf`, content: btoa(bin) }]);
  if (status === 'failed') return bad(c, 'Versturen mislukt. Controleer de e-mailinstellingen en probeer opnieuw.', 502);
  await c.env.DB.prepare('UPDATE measurements SET stage = 6, report_sent_at = ? WHERE id = ?').bind(nowIso(), m.id).run();
  await logEvent(c.env, m.id, 'sent', `Rapportage verzonden naar ${m.corp_email}`, c.get('user').id);
  await notify(c.env, { roles: ['eigenaar'] }, { title: `Rapport verzonden: ${m.address}`, body: `${m.corp_name} · ${m.outcome}`, measurementId: m.id, key: `sent-${m.id}` });
  return c.json({ ok: true, mail: status });
});

// ---------- plaatser ----------
async function freeMeters(env) {
  const { results } = await env.DB.prepare('SELECT id FROM meters WHERE active = 1 AND id NOT IN (SELECT meter_id FROM measurements WHERE stage = 1 AND meter_id IS NOT NULL) ORDER BY id').all();
  return results.map((r) => r.id);
}
async function payoutLines(env, userId, month, s, regionsByPlace) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  const { results } = await env.DB.prepare(`SELECT m.id, m.address, m.city, m.order_no, m.meter_id, m.placed_at, m.placed_by, m.picked_up_at, m.picked_up_by, c.name AS corp_name
    FROM measurements m JOIN corporations c ON c.id = m.corporation_id WHERE m.placed_by = ? OR m.picked_up_by = ?`).bind(userId, userId).all();
  const lines = [];
  for (const m of results) {
    for (const [type, at, by] of [['Plaatsen', m.placed_at, m.placed_by], ['Ophalen', m.picked_up_at, m.picked_up_by]]) {
      if (at && by === userId && amsDate(at).slice(0, 7) === month) {
        const zone = zoneOf(u.werkgebied, m.city, regionsByPlace);
        lines.push({ measurement_id: m.id, code: code(m.id), type, at, meter_id: m.meter_id, address: m.address, city: m.city, order_no: m.order_no, corp_name: m.corp_name, zone, amount: s['tariff_z' + zone] });
      }
    }
  }
  lines.sort((a, b) => a.at.localeCompare(b.at));
  return { user: { id: u.id, name: u.name, werkgebied: u.werkgebied, iban: u.iban, email: u.email }, lines, total: lines.reduce((t, l) => t + l.amount, 0) };
}

app.get('/api/my/tasks', need('plaatser'), async (c) => {
  const env = c.env, u = c.get('user'), s = await getSettings(env), today = todayAms();
  const mine = await listMeasurements(env, s, 'WHERE m.plaatser_id = ? AND (m.stage < 2 OR date(m.picked_up_at) >= date(?))', [u.id, addDays(today, -1)]);
  const tasks = [];
  for (const m of mine) {
    if (m.stage === 0 && m.planned_place_date <= addDays(today, 14)) tasks.push({ type: 'Plaatsen', date: m.planned_place_date, done: false, m });
    else if (m.stage === 1 && m.planned_pickup_date <= addDays(today, 7)) tasks.push({ type: 'Ophalen', date: m.planned_pickup_date, done: false, m });
    if (m.placed_at && amsDate(m.placed_at) === today && m.placed_by === u.id) tasks.push({ type: 'Plaatsen', date: today, done: true, m });
    if (m.picked_up_at && amsDate(m.picked_up_at) === today && m.picked_up_by === u.id) tasks.push({ type: 'Ophalen', date: today, done: true, m });
  }
  tasks.sort((a, b) => a.done - b.done || a.date.localeCompare(b.date));
  const active = mine.filter((m) => m.stage === 1);
  const month = today.slice(0, 7);
  const pay = await payoutLines(env, u.id, month, s, await placeRegions(env));
  return c.json({ today, tasks, active_count: active.length, month: { month, placed: pay.lines.filter((l) => l.type === 'Plaatsen').length, picked: pay.lines.filter((l) => l.type === 'Ophalen').length, total: pay.total } });
});
app.get('/api/meters/free', need('plaatser', 'eigenaar'), async (c) => c.json({ meters: await freeMeters(c.env) }));
app.post('/api/measurements/:id/seen', need('plaatser'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  await c.env.DB.prepare('UPDATE measurements SET is_new = 0 WHERE id = ?').bind(m.id).run();
  return c.json({ ok: true });
});
function parseAt(v) {
  const t = Date.parse(v);
  if (!v || Number.isNaN(t)) return [null, 'Kies datum en tijd'];
  if (t > Date.now() + 3600e3) return [null, 'Datum en tijd liggen in de toekomst'];
  if (t < Date.now() - 30 * 864e5) return [null, 'Datum en tijd liggen meer dan 30 dagen terug'];
  return [new Date(t).toISOString(), null];
}
const fullChecklist = (arr, len) => Array.isArray(arr) && arr.length === len && arr.every((x) => x === true);

app.post('/api/measurements/:id/place', need('plaatser', 'eigenaar'), async (c) => {
  const [m, err, s] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  if (m.stage !== 0) return bad(c, 'Deze meter is al geplaatst');
  const b = await c.req.json(), u = c.get('user'), env = c.env;
  const [at, atErr] = parseAt(b.at);
  if (atErr) return bad(c, atErr);
  if (!fullChecklist(b.checklist, PLACE_CHECKLIST.length)) return bad(c, 'Vink eerst de hele checklist af');
  const meter = Number(b.meter_id);
  if (!(await freeMeters(env)).includes(meter)) return bad(c, `Meter ${meter} is niet beschikbaar. Kies een vrije meter.`);
  const pickup = addDays(amsDate(at), 7 * m.duration_weeks);
  await env.DB.prepare(`UPDATE measurements SET stage = 1, meter_id = ?, placed_at = ?, placed_by = ?, place_checklist = ?, planned_pickup_date = ?, is_new = 0,
    remark = CASE WHEN ? IS NULL THEN remark ELSE trim(COALESCE(remark || char(10), '') || ?) END WHERE id = ?`)
    .bind(meter, at, u.id, JSON.stringify(PLACE_CHECKLIST), pickup, str(b.remark, 1000), 'Plaatsen: ' + (str(b.remark, 1000) || ''), m.id).run();
  await logEvent(env, m.id, 'placed', `Meter ${meter} geplaatst${str(b.remark) ? ': ' + str(b.remark, 300) : ''}`, u.id);
  await notify(env, { roles: ['controle'] }, { title: `Meter ${meter} geplaatst, graag controleren`, body: `${m.address}, ${m.city} · door ${u.name} om ${fmtDateTime(at)}`, measurementId: m.id, key: `placed-${m.id}` });
  await notify(env, { roles: ['eigenaar'] }, { title: `Meter ${meter} geplaatst`, body: `${m.address} · door ${u.name}`, measurementId: m.id, key: `placed-${m.id}` });
  return c.json({ ok: true, planned_pickup_date: pickup });
});
app.post('/api/measurements/:id/pickup', need('plaatser', 'eigenaar'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  if (m.stage !== 1) return bad(c, 'Deze meter staat niet in het veld');
  const b = await c.req.json(), u = c.get('user'), env = c.env;
  const [at, atErr] = parseAt(b.at);
  if (atErr) return bad(c, atErr);
  if (Date.parse(at) < Date.parse(m.placed_at)) return bad(c, 'Ophalen kan niet vóór het plaatsen liggen');
  if (!fullChecklist(b.checklist, PICKUP_CHECKLIST.length)) return bad(c, 'Vink eerst de hele checklist af');
  if (!['ja', 'nee'].includes(b.diary)) return bad(c, 'Geef aan of er een dagboek is');
  if (typeof b.noise_heard !== 'boolean') return bad(c, 'Geef aan of je geluid hebt gehoord');
  await env.DB.prepare(`UPDATE measurements SET stage = 2, picked_up_at = ?, picked_up_by = ?, pickup_checklist = ?, diary = ?, noise_heard = ?,
    remark = CASE WHEN ? IS NULL THEN remark ELSE trim(COALESCE(remark || char(10), '') || ?) END WHERE id = ?`)
    .bind(at, u.id, JSON.stringify(PICKUP_CHECKLIST), b.diary, b.noise_heard ? 1 : 0, str(b.remark, 1000), 'Ophalen: ' + (str(b.remark, 1000) || ''), m.id).run();
  await logEvent(env, m.id, 'picked_up', `Meter ${m.meter_id} opgehaald · dagboek ${b.diary} · geluid gehoord ${b.noise_heard ? 'ja' : 'nee'}`, u.id);
  await notify(env, { roles: ['controle'] }, { title: `Meter ${m.meter_id} opgehaald: data verwerken`, body: `${m.address}, ${m.city} · dagboek ${b.diary}`, measurementId: m.id, key: `picked-${m.id}` });
  return c.json({ ok: true });
});
app.post('/api/measurements/:id/photos', need('plaatser', 'eigenaar', 'controle'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  const body = await c.req.parseBody({ all: true });
  const files = [].concat(body.file || []).filter((f) => f instanceof File);
  if (!files.length) return bad(c, 'Geen foto ontvangen');
  for (const f of files) {
    if (!/^image\//.test(f.type)) return bad(c, 'Alleen foto\'s zijn toegestaan');
    if (f.size > 12 * 1024 * 1024) return bad(c, 'Een foto is groter dan 12 MB');
  }
  for (const f of files) {
    const key = `photos/${m.id}/${crypto.randomUUID()}`;
    await c.env.FILES.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type } });
    await c.env.DB.prepare('INSERT INTO photos (measurement_id, r2_key, content_type, uploaded_by) VALUES (?,?,?,?)').bind(m.id, key, f.type, c.get('user').id).run();
  }
  await logEvent(c.env, m.id, 'photo', `${files.length} foto${files.length > 1 ? "'s" : ''} van het dagboek toegevoegd`, c.get('user').id);
  return c.json({ ok: true, count: files.length });
});

// ---------- bestanden ----------
app.get('/api/files/photo/:id', async (c) => {
  const p = await c.env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(Number(c.req.param('id'))).first();
  if (!p) return bad(c, 'Niet gevonden', 404);
  const [, err] = await loadForUser(c, p.measurement_id);
  if (err) return err;
  const obj = await c.env.FILES.get(p.r2_key);
  if (!obj) return bad(c, 'Niet gevonden', 404);
  return new Response(obj.body, { headers: { 'Content-Type': p.content_type || 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
});
app.get('/api/files/report/:id', need('eigenaar', 'controle'), async (c) => {
  const [m, err] = await loadForUser(c, c.req.param('id'));
  if (err) return err;
  const obj = m.report_key && (await c.env.FILES.get(m.report_key));
  if (!obj) return bad(c, 'Geen rapport', 404);
  return new Response(obj.body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${(m.report_name || 'rapport.pdf').replace(/"/g, '')}"` } });
});

// ---------- meldingen ----------
app.get('/api/notifications', async (c) => {
  const u = c.get('user');
  const [{ results }, unread] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60').bind(u.id).all(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').bind(u.id).first('n'),
  ]);
  return c.json({ items: results, unread });
});
app.post('/api/notifications/read', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const u = c.get('user');
  if (Array.isArray(b.ids) && b.ids.length) {
    await c.env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${b.ids.map(() => '?').join(',')})`).bind(nowIso(), u.id, ...b.ids.map(Number)).run();
  } else {
    await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(nowIso(), u.id).run();
  }
  return c.json({ ok: true });
});

// ---------- beheer (eigenaar) ----------
app.get('/api/admin', need('eigenaar'), async (c) => {
  const env = c.env;
  const [users, corps, meters, regions, places, emails] = await Promise.all([
    env.DB.prepare('SELECT id, email, name, role, phone, werkgebied, iban, active, (password_hash IS NOT NULL) AS has_password, created_at FROM users ORDER BY role, name').all(),
    env.DB.prepare('SELECT c.*, r.name AS region_name FROM corporations c LEFT JOIN regions r ON r.id = c.region_id ORDER BY c.name').all(),
    env.DB.prepare('SELECT * FROM meters ORDER BY id').all(),
    env.DB.prepare('SELECT * FROM regions ORDER BY sort, name').all(),
    env.DB.prepare('SELECT p.*, r.name AS region_name FROM places p JOIN regions r ON r.id = p.region_id ORDER BY r.sort, p.name').all(),
    env.DB.prepare('SELECT id, to_email, subject, status, error, created_at FROM emails ORDER BY id DESC LIMIT 40').all(),
  ]);
  return c.json({ users: users.results, corporations: corps.results, meters: meters.results, regions: regions.results, places: places.results, emails: emails.results, settings: await getSettings(env), mail_live: !!env.RESEND_API_KEY });
});
app.get('/api/admin/emails/:id', need('eigenaar'), async (c) => {
  const e = await c.env.DB.prepare('SELECT * FROM emails WHERE id = ?').bind(Number(c.req.param('id'))).first();
  return e ? c.json(e) : bad(c, 'Niet gevonden', 404);
});
app.post('/api/users', need('eigenaar'), async (c) => {
  const b = await c.req.json(), env = c.env;
  if (!str(b.name) || !isEmail(b.email)) return bad(c, 'Vul naam en een geldig e-mailadres in');
  if (!ROLES.includes(b.role)) return bad(c, 'Kies een rol');
  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(b.email.trim()).first();
  if (exists) return bad(c, 'Er bestaat al een gebruiker met dit e-mailadres');
  const user = { id: crypto.randomUUID(), email: b.email.trim(), name: str(b.name, 120), role: b.role };
  await env.DB.prepare('INSERT INTO users (id,email,name,role,phone,werkgebied,iban) VALUES (?,?,?,?,?,?,?)')
    .bind(user.id, user.email, user.name, user.role, str(b.phone, 40), str(b.werkgebied, 80), str(b.iban, 40)).run();
  const link = await issueToken(env, user, 'invite');
  return c.json({ id: user.id, invite_link: env.RESEND_API_KEY ? null : link });
});
app.patch('/api/users/:id', need('eigenaar'), async (c) => {
  const env = c.env, id = c.req.param('id'), b = await c.req.json();
  const cur = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!cur) return bad(c, 'Gebruiker niet gevonden', 404);
  const n = { ...cur, ...b };
  if (!ROLES.includes(n.role)) return bad(c, 'Kies een rol');
  if (id === c.get('user').id && (n.role !== 'eigenaar' || !n.active)) return bad(c, 'Je kunt je eigen eigenaarsrol niet uitzetten');
  await env.DB.prepare('UPDATE users SET name=?, role=?, phone=?, werkgebied=?, iban=?, active=? WHERE id=?')
    .bind(str(n.name, 120), n.role, str(n.phone, 40), str(n.werkgebied, 80), str(n.iban, 40), n.active ? 1 : 0, id).run();
  if (!n.active) await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  return c.json({ ok: true });
});
app.post('/api/users/:id/invite', need('eigenaar'), async (c) => {
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first();
  if (!u) return bad(c, 'Gebruiker niet gevonden', 404);
  const link = await issueToken(c.env, u, 'invite');
  return c.json({ ok: true, invite_link: c.env.RESEND_API_KEY ? null : link });
});
app.post('/api/corporations', need('eigenaar'), async (c) => {
  const b = await c.req.json();
  if (!str(b.name)) return bad(c, 'Vul de naam in');
  if (b.contact_email && !isEmail(b.contact_email)) return bad(c, 'Het e-mailadres klopt niet');
  try {
    await c.env.DB.prepare('INSERT INTO corporations (name, region_id, contact_email) VALUES (?,?,?)').bind(str(b.name, 120), b.region_id ? Number(b.region_id) : null, str(b.contact_email, 120)).run();
  } catch { return bad(c, 'Deze corporatie bestaat al'); }
  return c.json({ ok: true });
});
app.patch('/api/corporations/:id', need('eigenaar'), async (c) => {
  const b = await c.req.json();
  if (b.contact_email && !isEmail(b.contact_email)) return bad(c, 'Het e-mailadres klopt niet');
  await c.env.DB.prepare('UPDATE corporations SET name = COALESCE(?, name), region_id = ?, contact_email = ?, active = ? WHERE id = ?')
    .bind(str(b.name, 120), b.region_id ? Number(b.region_id) : null, str(b.contact_email, 120), b.active === false ? 0 : 1, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});
app.post('/api/meters', need('eigenaar'), async (c) => {
  const b = await c.req.json();
  const from = Number(b.from), to = Number(b.to || b.from);
  if (!Number.isInteger(from) || from < 1 || to < from || to - from > 200) return bad(c, 'Geef een geldig meternummer of bereik');
  const stmt = c.env.DB.prepare('INSERT OR IGNORE INTO meters (id) VALUES (?)');
  await c.env.DB.batch(Array.from({ length: to - from + 1 }, (_, i) => stmt.bind(from + i)));
  return c.json({ ok: true });
});
app.patch('/api/meters/:id', need('eigenaar'), async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare('UPDATE meters SET active = ?, note = ? WHERE id = ?').bind(b.active ? 1 : 0, str(b.note, 200), Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});
app.post('/api/regions', need('eigenaar'), async (c) => {
  const b = await c.req.json();
  if (!str(b.name)) return bad(c, 'Vul de naam in');
  try { await c.env.DB.prepare('INSERT INTO regions (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort),0)+1 FROM regions))').bind(str(b.name, 80)).run(); }
  catch { return bad(c, 'Deze regio bestaat al'); }
  return c.json({ ok: true });
});
app.post('/api/places', need('eigenaar'), async (c) => {
  const b = await c.req.json();
  if (!str(b.name) || !b.region_id) return bad(c, 'Vul plaats en regio in');
  await c.env.DB.prepare('INSERT INTO places (name, region_id) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET region_id = excluded.region_id').bind(str(b.name, 80), Number(b.region_id)).run();
  return c.json({ ok: true });
});
app.delete('/api/places/:name', need('eigenaar'), async (c) => {
  await c.env.DB.prepare('DELETE FROM places WHERE name = ?').bind(c.req.param('name')).run();
  return c.json({ ok: true });
});
app.put('/api/settings', need('eigenaar', 'facturatie'), async (c) => {
  const b = await c.req.json(), role = c.get('user').role;
  const allowed = role === 'eigenaar' ? ['control_hours', 'report_days', 'tariff_z1', 'tariff_z2', 'tariff_z3'] : ['tariff_z1', 'tariff_z2', 'tariff_z3'];
  const stmts = [];
  for (const k of allowed) if (b[k] != null) {
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < 0 || v > 100000) return bad(c, 'Ongeldige waarde voor ' + k);
    stmts.push(c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(v)));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true, settings: await getSettings(c.env) });
});
app.post('/api/admin/run-alerts', need('eigenaar'), async (c) => c.json({ created: await runAlerts(c.env) }));

// ---------- facturatie: uitbetaling plaatsers ----------
const validMonth = (m) => /^\d{4}-\d{2}$/.test(m || '');
app.get('/api/payouts', need('facturatie', 'eigenaar'), async (c) => {
  const env = c.env, month = c.req.query('month') || todayAms().slice(0, 7);
  if (!validMonth(month)) return bad(c, 'Ongeldige maand');
  const s = await getSettings(env), rp = await placeRegions(env);
  const { results: pl } = await env.DB.prepare("SELECT id FROM users WHERE role = 'plaatser' ORDER BY name").all();
  const { results: st } = await env.DB.prepare('SELECT * FROM payouts WHERE month = ?').bind(month).all();
  const status = Object.fromEntries(st.map((r) => [r.plaatser_id, r.status]));
  const out = [];
  for (const p of pl) {
    const r = await payoutLines(env, p.id, month, s, rp);
    if (r.lines.length || r.user) out.push({ ...r, status: status[p.id] || 'concept' });
  }
  return c.json({ month, settings: s, plaatsers: out });
});
app.post('/api/payouts/:uid/:month', need('facturatie', 'eigenaar'), async (c) => {
  const { status } = await c.req.json(), month = c.req.param('month');
  if (!validMonth(month) || !['concept', 'goedgekeurd', 'betaald'].includes(status)) return bad(c, 'Ongeldige status');
  await c.env.DB.prepare('INSERT INTO payouts (plaatser_id, month, status, updated_at) VALUES (?,?,?,?) ON CONFLICT(plaatser_id, month) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at')
    .bind(c.req.param('uid'), month, status, nowIso()).run();
  return c.json({ ok: true });
});
const eur = (n) => '€ ' + n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
app.post('/api/payouts/:uid/:month/mail', need('facturatie', 'eigenaar'), async (c) => {
  const env = c.env, month = c.req.param('month');
  if (!validMonth(month)) return bad(c, 'Ongeldige maand');
  const r = await payoutLines(env, c.req.param('uid'), month, await getSettings(env), await placeRegions(env));
  const rows = r.lines.map((l) => `<tr><td style="padding:4px 8px 4px 0">${esc(fmtDateTime(l.at))}</td><td style="padding:4px 8px">${l.type}</td><td style="padding:4px 8px">${esc(l.address)}, ${esc(l.city)}</td><td style="padding:4px 8px">zone ${l.zone}</td><td style="padding:4px 0;text-align:right">${eur(l.amount)}</td></tr>`).join('');
  await sendMail(env, r.user.email, `Je specificatie ${month}`, mailLayout(`Specificatie ${month}`,
    `<p>Hoi ${esc(r.user.name)}, dit is je overzicht van ${month}: ${r.lines.filter((l) => l.type === 'Plaatsen').length} keer geplaatst en ${r.lines.filter((l) => l.type === 'Ophalen').length} keer opgehaald.</p>
    <table style="font-size:13px;border-collapse:collapse;width:100%">${rows}<tr><td colspan="4" style="padding-top:8px;font-weight:700">Totaal</td><td style="padding-top:8px;text-align:right;font-weight:700">${eur(r.total)}</td></tr></table>
    <p>Uitbetaling op ${esc(r.user.iban || 'je bekende rekeningnummer')}.</p>`));
  return c.json({ ok: true });
});
app.get('/api/payouts.csv', need('facturatie', 'eigenaar'), async (c) => {
  const env = c.env, month = c.req.query('month');
  if (!validMonth(month)) return bad(c, 'Ongeldige maand');
  const s = await getSettings(env), rp = await placeRegions(env);
  const { results: pl } = await env.DB.prepare("SELECT id FROM users WHERE role = 'plaatser' ORDER BY name").all();
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  let csv = 'plaatser;iban;datum;actie;meting;meter;adres;plaats;opdracht;zone;bedrag\n';
  for (const p of pl) {
    const r = await payoutLines(env, p.id, month, s, rp);
    for (const l of r.lines) csv += [r.user.name, r.user.iban, fmtDateTime(l.at), l.type, l.code, l.meter_id, l.address, l.city, l.order_no, l.zone, String(l.amount).replace('.', ',')].map(q).join(';') + '\n';
  }
  return new Response('﻿' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="uitbetaling-${month}.csv"` } });
});

app.get('/api/events', need('eigenaar', 'controle'), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT e.*, u.name AS actor, m.address, m.city FROM events e LEFT JOIN users u ON u.id = e.actor_id
    LEFT JOIN measurements m ON m.id = e.measurement_id ORDER BY e.id DESC LIMIT 40`).all();
  return c.json({ items: results });
});

app.all('/api/*', (c) => bad(c, 'Onbekende route', 404));

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runAlerts(env));
  },
};
