// Tijdgestuurde bewaking: draait elk kwartier via de Cron Trigger
import { getSettings, notify, sendMail, mailLayout, todayAms, addDays, fmtDate, esc, code } from './util.js';
import { listMeasurements } from './measurements.js';

export async function runAlerts(env) {
  const s = await getSettings(env);
  const today = todayAms();
  const tomorrow = addDays(today, 1);
  const in2 = addDays(today, 2);
  const list = await listMeasurements(env, s, 'WHERE m.stage < 7');
  let created = 0;
  const url = (env.APP_URL || '').replace(/\/$/, '');

  for (const m of list) {
    const where = `${m.address}, ${m.city}`;
    // plaatser: dag vóór plaatsen
    if (m.stage === 0 && m.planned_place_date === tomorrow && m.plaatser_id) {
      const n = await notify(env, { userIds: [m.plaatser_id] }, { title: `Morgen plaatsen: ${m.address}`, body: `${m.city} · ${m.corp_name}`, measurementId: m.id, key: `place-reminder-${m.id}-${tomorrow}` });
      if (n && m.plaatser_email) {
        await sendMail(env, m.plaatser_email, `Morgen plaatsen: ${m.address}`,
          mailLayout('Morgen plaatsen', `<p>Hoi ${esc(m.plaatser_name)},</p><p>Morgen plaats je een meter bij <b>${esc(where)}</b> (${esc(m.corp_name)}). Bewoner: ${esc(m.resident_name || '—')}, ${esc(m.resident_phone || '')}.</p>`, { url: `${url}/#/plaatser/${m.id}`, label: 'Open in de app' }));
      }
      created += n;
    }
    // eigenaar: plaatsdatum voorbij
    if (m.late_place) created += await notify(env, { roles: ['eigenaar'] }, { severity: 'red', title: `Plaatsing niet afgevinkt: ${m.address}`, body: `${m.plaatser_name || 'Geen plaatser'} · gepland ${fmtDate(m.planned_place_date)}`, measurementId: m.id, key: `late-place-${m.id}-${m.planned_place_date}` });
    // controle te laat
    if (m.late_control) created += await notify(env, { roles: ['eigenaar', 'controle'] }, { severity: 'red', title: `Plaatsing nog niet gecontroleerd: Meter ${m.meter_id}`, body: `${where} · geplaatst ${fmtDate(m.placed_at)}`, measurementId: m.id, key: `late-control-${m.id}` });
    // plaatser: ophalen over 2 dagen
    if (m.stage === 1 && m.planned_pickup_date === in2 && m.plaatser_id) {
      const n = await notify(env, { userIds: [m.plaatser_id] }, { title: `Over 2 dagen ophalen: Meter ${m.meter_id}`, body: where, measurementId: m.id, key: `pickup-reminder-${m.id}` });
      if (n && m.plaatser_email) {
        await sendMail(env, m.plaatser_email, `Over 2 dagen ophalen: Meter ${m.meter_id}`,
          mailLayout('Ophalen over 2 dagen', `<p>Hoi ${esc(m.plaatser_name)},</p><p>Op ${esc(fmtDate(m.planned_pickup_date))} haal je Meter ${m.meter_id} op bij <b>${esc(where)}</b>.</p>`, { url: `${url}/#/plaatser/${m.id}`, label: 'Open in de app' }));
      }
      created += n;
    }
    if (m.late_pickup) created += await notify(env, { roles: ['eigenaar'] }, { severity: 'red', title: `Ophalen niet afgevinkt: Meter ${m.meter_id}`, body: `${where} · ${m.plaatser_name || ''} · gepland ${fmtDate(m.planned_pickup_date)}`, measurementId: m.id, key: `late-pickup-${m.id}-${m.planned_pickup_date}` });
    if (m.stage >= 2 && m.stage < 4 && m.diary === 'nee') created += await notify(env, { roles: ['eigenaar'] }, { severity: 'warn', title: `Geen dagboek aangeleverd: ${code(m.id)}`, body: where, measurementId: m.id, key: `no-diary-${m.id}` });
    if (m.late_report) created += await notify(env, { roles: ['eigenaar', 'controle'] }, { severity: 'red', title: `Rapportage over de deadline: ${code(m.id)}`, body: `${where} · deadline ${fmtDate(m.report_deadline)}`, measurementId: m.id, key: `late-report-${m.id}` });
  }
  // oude sessies en tokens opruimen
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(new Date().toISOString()),
    env.DB.prepare('DELETE FROM tokens WHERE expires_at < ?').bind(new Date().toISOString()),
  ]);
  return created;
}
