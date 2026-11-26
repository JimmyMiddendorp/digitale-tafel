import { code, todayAms, addDays, amsDate } from './util.js';

export const STAGES = ['Aangemaakt', 'Geplaatst', 'Opgehaald', 'Dagboek verwerkt', 'Data gecontroleerd', 'Rapportage klaar', 'Verzonden', 'Afgerond'];

export const BASE_SELECT = `
SELECT m.*, c.name AS corp_name, c.contact_email AS corp_email,
  COALESCE(pr.name, cr.name) AS region_name, COALESCE(pr.id, cr.id) AS region_id,
  u.name AS plaatser_name, u.email AS plaatser_email,
  (SELECT COUNT(*) FROM photos ph WHERE ph.measurement_id = m.id) AS photo_count
FROM measurements m
JOIN corporations c ON c.id = m.corporation_id
LEFT JOIN regions cr ON cr.id = c.region_id
LEFT JOIN places pl ON pl.name = m.city
LEFT JOIN regions pr ON pr.id = pl.region_id
LEFT JOIN users u ON u.id = m.plaatser_id`;

export function enrich(m, s) {
  const today = todayAms();
  const deadline = m.picked_up_at ? addDays(amsDate(m.picked_up_at), s.report_days) : null;
  const ctrlDue = m.placed_at ? Date.parse(m.placed_at) + s.control_hours * 36e5 : null;
  return {
    ...m,
    code: code(m.id),
    stage_label: STAGES[m.stage],
    place_checklist: m.place_checklist ? JSON.parse(m.place_checklist) : null,
    pickup_checklist: m.pickup_checklist ? JSON.parse(m.pickup_checklist) : null,
    report_deadline: deadline,
    late_report: !!(deadline && m.stage < 6 && today > deadline),
    late_control: !!(m.placed_at && !m.place_checked_at && Date.now() > ctrlDue),
    waiting_control: !!(m.placed_at && !m.place_checked_at),
    late_place: m.stage === 0 && m.planned_place_date < today,
    late_pickup: m.stage === 1 && m.planned_pickup_date && m.planned_pickup_date < today,
  };
}

export async function getMeasurement(env, id, s) {
  const m = await env.DB.prepare(BASE_SELECT + ' WHERE m.id = ?').bind(id).first();
  return m ? enrich(m, s) : null;
}

export async function listMeasurements(env, s, where = '', binds = []) {
  const { results } = await env.DB.prepare(`${BASE_SELECT} ${where} ORDER BY m.id DESC`).bind(...binds).all();
  return results.map((m) => enrich(m, s));
}

export const PLACE_CHECKLIST = ['Meter aan, lampje brandt', 'Meter in de kamer met de meeste overlast', 'Uitleg gegeven aan de bewoner', 'QR-sticker op de meter geplakt', 'Ophaaldatum doorgegeven aan de bewoner'];
export const PICKUP_CHECKLIST = ['Meter uit en meegenomen', 'Dagboek gefotografeerd of gemeld als afwezig', 'Bewoner verteld wat er nu gebeurt'];
export const OUTCOMES = ['Overlast aangetoond', 'Deels aangetoond', 'Geen overschrijding van de norm', 'Meting niet bruikbaar'];
