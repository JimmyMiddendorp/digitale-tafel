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

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function loadEntries(env, reportId) {
  const { results } = await env.DB.prepare(
    "SELECT id, datum, start, stop, omschrijving, afwezig FROM entries WHERE report_id = ?1 ORDER BY datum DESC, start DESC"
  )
    .bind(reportId)
    .all();
  return results ?? [];
}

async function handleApi(request, env, url) {
  const path = url.pathname;

  // --- melder: profiel opslaan (nieuw of bestaand) ---
  if (path === "/api/report" && request.method === "POST") {
    const b = await readBody(request);
    const fields = {
      m_naam: str(b.m_naam, 120),
      m_adres: str(b.m_adres, 200),
      m_plaats: str(b.m_plaats, 120),
      v_naam: str(b.v_naam, 120),
      v_adres: str(b.v_adres, 200),
      v_plaats: str(b.v_plaats, 120),
      richting: str(b.richting, 120),
    };
    const id = str(b.id, 64);
    const t = now();

    if (id) {
      const { meta } = await env.DB.prepare(
        `UPDATE reports SET m_naam=?2, m_adres=?3, m_plaats=?4, v_naam=?5, v_adres=?6, v_plaats=?7,
         richting=?8, updated_at=?9 WHERE id=?1`
      )
        .bind(id, fields.m_naam, fields.m_adres, fields.m_plaats, fields.v_naam, fields.v_adres,
              fields.v_plaats, fields.richting, t)
        .run();
      if (meta.changes > 0) return json({ id });
    }

    const newId = uid();
    await env.DB.prepare(
      `INSERT INTO reports (id, created_at, updated_at, m_naam, m_adres, m_plaats, v_naam, v_adres, v_plaats, richting)
       VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    )
      .bind(newId, t, fields.m_naam, fields.m_adres, fields.m_plaats, fields.v_naam, fields.v_adres,
            fields.v_plaats, fields.richting)
      .run();
    return json({ id: newId });
  }

  // --- melder: eigen dossier ophalen ---
  if (path.startsWith("/api/report/") && request.method === "GET") {
    const id = decodeURIComponent(path.slice("/api/report/".length));
    const report = await env.DB.prepare("SELECT * FROM reports WHERE id = ?1").bind(id).first();
    if (!report) return json({ error: "not_found" }, 404);
    return json({ report, entries: await loadEntries(env, id) });
  }

  // --- melder: registratie toevoegen ---
  if (path === "/api/entry" && request.method === "POST") {
    const b = await readBody(request);
    const reportId = str(b.report_id, 64);
    if (!reportId) return json({ error: "no_report" }, 400);
    const exists = await env.DB.prepare("SELECT id FROM reports WHERE id = ?1").bind(reportId).first();
    if (!exists) return json({ error: "not_found" }, 404);

    const id = uid();
    await env.DB.prepare(
      `INSERT INTO entries (id, report_id, datum, start, stop, omschrijving, afwezig, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
      .bind(id, reportId, str(b.datum, 20), str(b.start, 10), str(b.stop, 10),
            str(b.omschrijving, 1000), b.afwezig ? 1 : 0, now())
      .run();
    await env.DB.prepare("UPDATE reports SET updated_at = ?2 WHERE id = ?1").bind(reportId, now()).run();
    return json({ entries: await loadEntries(env, reportId) });
  }

  // --- melder: registratie verwijderen (alleen binnen eigen dossier) ---
  if (path === "/api/entry/delete" && request.method === "POST") {
    const b = await readBody(request);
    const reportId = str(b.report_id, 64);
    const id = str(b.id, 64);
    if (!reportId || !id) return json({ error: "bad_request" }, 400);
    await env.DB.prepare("DELETE FROM entries WHERE id = ?1 AND report_id = ?2").bind(id, reportId).run();
    return json({ entries: await loadEntries(env, reportId) });
  }

  // --- admin: alles ophalen achter wachtwoord ---
  if (path === "/api/admin" && request.method === "POST") {
    const b = await readBody(request);
    if (str(b.password, 100) !== String(env.ADMIN_PASSWORD ?? "333")) {
      return json({ error: "unauthorized" }, 401);
    }
    const [reports, entries] = await Promise.all([
      env.DB.prepare("SELECT * FROM reports ORDER BY updated_at DESC").all(),
      env.DB.prepare(
        "SELECT id, report_id, datum, start, stop, omschrijving, afwezig FROM entries ORDER BY datum DESC, start DESC"
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
