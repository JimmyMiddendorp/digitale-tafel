// Gedeelde helpers: tijd, beveiliging, database, meldingen en e-mail
export const TZ = 'Europe/Amsterdam';
export const nowIso = () => new Date().toISOString();
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const amsDate = (d = new Date()) => dateFmt.format(typeof d === 'string' ? new Date(d) : d);
export const todayAms = () => amsDate(new Date());
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const diffDays = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5);
export const code = (id) => 'NN-' + String(id).padStart(4, '0');
const nlDate = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const nlDateTime = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (s) => (s ? nlDate.format(new Date(s.length === 10 ? s + 'T12:00:00Z' : s)) : '—');
export const fmtDateTime = (s) => (s ? nlDateTime.format(new Date(s)) : '—');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- crypto ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomHex = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(s) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
export async function hashPassword(pw, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return hex(bits);
}
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- settings ----------
export async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    control_hours: Number(s.control_hours ?? 24),
    report_days: Number(s.report_days ?? 14),
    tariff_z1: Number(s.tariff_z1 ?? 42.5),
    tariff_z2: Number(s.tariff_z2 ?? 55),
    tariff_z3: Number(s.tariff_z3 ?? 65),
  };
}

// ---------- events, meldingen ----------
export async function logEvent(env, measurementId, type, message, actorId) {
  await env.DB.prepare('INSERT INTO events (measurement_id, type, message, actor_id) VALUES (?,?,?,?)')
    .bind(measurementId ?? null, type, message, actorId ?? null).run();
}

// target: { roles: [...]} en/of { userIds: [...] }
export async function notify(env, target, { severity = 'info', title, body = '', measurementId = null, key = null }) {
  const ids = new Set(target.userIds || []);
  if (target.roles?.length) {
    const q = `SELECT id FROM users WHERE active = 1 AND role IN (${target.roles.map(() => '?').join(',')})`;
    const { results } = await env.DB.prepare(q).bind(...target.roles).all();
    results.forEach((r) => ids.add(r.id));
  }
  if (!ids.size) return 0;
  const stmt = env.DB.prepare(
    'INSERT OR IGNORE INTO notifications (user_id, dedupe_key, severity, title, body, measurement_id) VALUES (?,?,?,?,?,?)'
  );
  const res = await env.DB.batch([...ids].map((id) => stmt.bind(id, key, severity, title, body, measurementId)));
  return res.reduce((n, r) => n + (r.meta?.changes || 0), 0);
}

// ---------- e-mail via Resend (of alleen logboek zonder sleutel) ----------
export function mailLayout(title, inner, cta) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#0a0a0a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e7e7e7;border-radius:10px">
  <tr><td style="padding:20px 24px;border-bottom:1px solid #e7e7e7;font-weight:700;font-size:17px">NeighborNoise</td></tr>
  <tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>${inner}
  ${cta ? `<p style="margin:24px 0 0"><a href="${esc(cta.url)}" style="background:#0a0a0a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block">${esc(cta.label)}</a></p>` : ''}
  </td></tr></table>
  <p style="font-size:12px;color:#6e6e6e">Automatisch bericht van het NeighborNoise-platform.</p>
  </td></tr></table></body></html>`;
}

export async function sendMail(env, to, subject, html, attachments) {
  let status = 'logged', error = null;
  if (env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, attachments }),
      });
      if (r.ok) status = 'sent';
      else { status = 'failed'; error = (await r.text()).slice(0, 500); }
    } catch (e) { status = 'failed'; error = String(e).slice(0, 500); }
  }
  await env.DB.prepare('INSERT INTO emails (to_email, subject, html, status, error) VALUES (?,?,?,?,?)')
    .bind(to, subject, html, status, error).run();
  return status;
}

// ---------- zones voor uitbetaling ----------
export async function placeRegions(env) {
  const { results } = await env.DB.prepare('SELECT p.name, p.region_id FROM places p').all();
  return Object.fromEntries(results.map((r) => [r.name.toLowerCase(), r.region_id]));
}
export function zoneOf(werkgebied, city, regionsByPlace) {
  if (!werkgebied || !city) return 3;
  if (werkgebied.toLowerCase() === city.toLowerCase()) return 1;
  const a = regionsByPlace[werkgebied.toLowerCase()], b = regionsByPlace[city.toLowerCase()];
  return a && a === b ? 2 : 3;
}
