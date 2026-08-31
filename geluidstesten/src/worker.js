import appHtml from "./app.html";
import adminHtml from "./admin.html";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const page = (html) =>
  new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
  });

const str = (v, max = 400) => (typeof v === "string" ? v : "").trim().slice(0, max);
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/* Adresherkenning ------------------------------------------------------------
   Alles wat geen letter of cijfer is gaat eruit en het geheel wordt hoofdletters.
   "1234 ab" en "1234AB" leveren dus dezelfde sleutel op, zodat een bewoner die
   het de tweede keer nét anders typt tóch in zijn eigen dossier komt.          */
const normPostcode = (v) => str(v, 20).toUpperCase().replace(/[^0-9A-Z]/g, "");
const normHuisnummer = (v) => str(v, 20).toUpperCase().replace(/[^0-9A-Z]/g, "");

const validPostcode = (p) => /^[1-9][0-9]{3}[A-Z]{2}$/.test(p);
const validHuisnummer = (h) => /^[0-9]{1,5}[A-Z0-9]{0,6}$/.test(h);

async function loadEntries(env, reportId) {
  const { results } = await env.DB.prepare(
    "SELECT id, datum, start, stop, omschrijving, afwezig FROM log_entries WHERE report_id = ?1 ORDER BY pos ASC"
  )
    .bind(reportId)
    .all();
  return results ?? [];
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/* Een regel telt alleen als er iets in staat. Zo levert een half ingevulde
   lege regel onderaan het formulier geen spookrecord op.                       */
function cleanEntries(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 500)
    .map((e) => ({
      datum: str(e && e.datum, 20),
      start: str(e && e.start, 10),
      stop: str(e && e.stop, 10),
      omschrijving: str(e && e.omschrijving, 1000),
      afwezig: e && e.afwezig ? 1 : 0,
    }))
    .filter((e) => e.datum || e.start || e.stop || e.omschrijving || e.afwezig);
}

async function findOrCreate(env, postcode, huisnummer) {
  const key = postcode + "-" + huisnummer;
  const found = await env.DB.prepare("SELECT * FROM address_reports WHERE adres_key = ?1").bind(key).first();
  if (found) return found;

  const t = now();
  try {
    await env.DB.prepare(
      `INSERT INTO address_reports (id, adres_key, postcode, huisnummer, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)`
    )
      .bind(uid(), key, postcode, huisnummer, t)
      .run();
  } catch (err) {
    // Twee tabbladen tegelijk op hetzelfde adres: UNIQUE weigert de tweede
    // insert en we lezen gewoon het dossier dat de eerste aanmaakte.
    if (!String(err && err.message).includes("UNIQUE")) throw err;
  }
  return await env.DB.prepare("SELECT * FROM address_reports WHERE adres_key = ?1").bind(key).first();
}

async function handleApi(request, env, url) {
  const path = url.pathname;

  // --- dossier openen op adres (maakt het aan als het nog niet bestaat) ---
  if (path === "/api/open" && request.method === "POST") {
    const b = await readBody(request);
    const postcode = normPostcode(b.postcode);
    const huisnummer = normHuisnummer(b.huisnummer);
    if (!validPostcode(postcode)) return json({ error: "bad_postcode" }, 400);
    if (!validHuisnummer(huisnummer)) return json({ error: "bad_huisnummer" }, 400);

    const report = await findOrCreate(env, postcode, huisnummer);
    return json({ report, entries: await loadEntries(env, report.id) });
  }

  // --- alles in één keer opslaan: profiel + volledige regellijst ---
  if (path === "/api/save" && request.method === "POST") {
    const b = await readBody(request);
    const postcode = normPostcode(b.postcode);
    const huisnummer = normHuisnummer(b.huisnummer);
    if (!validPostcode(postcode) || !validHuisnummer(huisnummer)) {
      return json({ error: "bad_address" }, 400);
    }

    const report = await findOrCreate(env, postcode, huisnummer);
    const p = b.profile || {};
    const rows = cleanEntries(b.entries);
    const t = now();

    // Alles in één D1-batch: die draait als één transactie, dus de oude regels
    // verdwijnen nooit zonder dat de nieuwe er staan.
    const stmts = [
      env.DB.prepare(
        `UPDATE address_reports SET m_naam=?2, m_straat=?3, m_plaats=?4, v_naam=?5, v_adres=?6,
         v_plaats=?7, richting=?8, updated_at=?9 WHERE id=?1`
      ).bind(
        report.id, str(p.m_naam, 120), str(p.m_straat, 200), str(p.m_plaats, 120),
        str(p.v_naam, 120), str(p.v_adres, 200), str(p.v_plaats, 120), str(p.richting, 120), t
      ),
      env.DB.prepare("DELETE FROM log_entries WHERE report_id = ?1").bind(report.id),
    ];
    rows.forEach((e, i) => {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO log_entries (id, report_id, datum, start, stop, omschrijving, afwezig, pos, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
        ).bind(uid(), report.id, e.datum, e.start, e.stop, e.omschrijving, e.afwezig, i, t)
      );
    });
    await env.DB.batch(stmts);

    return json({ ok: true, saved_at: t, count: rows.length });
  }

  // --- beheerdersoverzicht achter wachtwoord ---
  if (path === "/api/admin" && request.method === "POST") {
    const b = await readBody(request);
    if (str(b.password, 100) !== String(env.ADMIN_PASSWORD ?? "333")) {
      return json({ error: "unauthorized" }, 401);
    }
    const [reports, entries] = await Promise.all([
      env.DB.prepare("SELECT * FROM address_reports ORDER BY updated_at DESC").all(),
      env.DB.prepare(
        "SELECT id, report_id, datum, start, stop, omschrijving, afwezig FROM log_entries ORDER BY datum DESC, start DESC"
      ).all(),
    ]);
    return json({ reports: reports.results ?? [], entries: entries.results ?? [] });
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: "server_error", detail: String(err && err.message) }, 500);
      }
    }

    if (url.pathname === "/dashboard" || url.pathname === "/dashboard/") return page(adminHtml);
    if (url.pathname === "/" || url.pathname === "/index.html") return page(appHtml);

    return new Response("Niet gevonden", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
