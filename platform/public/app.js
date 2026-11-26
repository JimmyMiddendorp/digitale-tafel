// NeighborNoise platform – frontend (geen buildstap nodig)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'Europe/Amsterdam';
const fD = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const fDT = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fT = new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const toDate = (s) => new Date(s.length === 10 ? s + 'T12:00:00Z' : s);
const fmtD = (s) => (s ? fD.format(toDate(s)) : '—');
const fmtDT = (s) => (s ? fDT.format(toDate(s)) : '—');
const euro = (n) => '€ ' + Number(n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const weken = (n) => `${n} ${n > 1 ? 'weken' : 'week'}`;
const dayDiff = (a, b) => Math.round((toDate(a) - toDate(b)) / 864e5);
const localInput = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const LOGO = `<svg width="28" height="25" viewBox="14 12 76 68" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><g stroke-width="5.5"><line x1="20" y1="45" x2="20" y2="49"/><line x1="30" y1="38" x2="30" y2="56"/><line x1="40" y1="31" x2="40" y2="63"/><line x1="50" y1="24" x2="50" y2="70"/></g><path d="M59 18 L83 28 Q85 29 85 31 L85 63 Q85 65 83 65.5 Q70 68 59 75 Z" stroke-width="5.5"/></svg>`;
const BELL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;

const state = { me: null, ov: null, filters: { regio: null, corp: '', q: '', late: false, ctrl: false, stage: '' }, lastNotif: 0, month: null };

// ---------- api ----------
async function api(path, { method = 'GET', body, form } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (form) opt.body = form;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const isJson = (r.headers.get('content-type') || '').includes('json');
  const data = isJson ? await r.json() : await r.text();
  if (r.status === 401 && !path.startsWith('/api/auth')) { state.me = null; location.hash = '#/login'; throw new Error('Log opnieuw in'); }
  if (!r.ok) throw new Error((data && data.error) || 'Er ging iets mis');
  return data;
}
function toast(msg, err) {
  const el = $('#toast'); el.textContent = msg; el.className = 'toast' + (err ? ' err' : ''); el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), err ? 5000 : 2800);
}
async function act(fn, ok) { try { const r = await fn(); if (ok) toast(ok); return r ?? true; } catch (e) { toast(e.message, true); return false; } }

// ---------- router ----------
window.addEventListener('hashchange', route);
async function route() {
  closeDrawer();
  $('#popups').innerHTML = '';
  const h = location.hash.replace(/^#\/?/, '');
  const [p0, p1, p2] = h.split('/');
  if (p0 === 'wachtwoord' && p1) return renderPassword(p1);
  if (p0 === 'vergeten') return renderForgot();
  if (!state.me) {
    try { state.me = (await api('/api/me')).user; } catch { state.me = null; }
  }
  if (!state.me) {
    const setup = await api('/api/setup').catch(() => ({ needed: false }));
    return setup.needed ? renderSetup() : renderLogin();
  }
  const role = state.me.role;
  startPolling();
  if (role === 'plaatser') {
    if (p0 === 'plaatser' && p1) return renderTask(Number(p1));
    return renderRonde();
  }
  const home = { eigenaar: 'overzicht', controle: 'controle', facturatie: 'uitbetaling' }[role];
  const page = ['overzicht', 'controle', 'uitbetaling', 'beheer', 'meting'].includes(p0) ? p0 : home;
  if (page === 'meting' && p1) { await renderDesk(home); return openMeasurement(Number(p1)); }
  if (page === 'beheer' && role !== 'eigenaar') return (location.hash = '#/' + home);
  if (page === 'uitbetaling' && !['eigenaar', 'facturatie'].includes(role)) return (location.hash = '#/' + home);
  if (page === 'controle' && !['eigenaar', 'controle'].includes(role)) return (location.hash = '#/' + home);
  return renderDesk(page, p1);
}

// ---------- inloggen ----------
function authCard(inner) {
  $('#app').innerHTML = `<div class="auth"><div class="card"><div class="logo">${LOGO} NeighborNoise</div>${inner}</div></div>`;
}
function renderLogin() {
  authCard(`<div><h1>Inloggen</h1><p class="sub">Log in met je e-mailadres en wachtwoord.</p></div>
  <form class="form" id="lf"><div class="field"><label for="le">E-mailadres</label><input id="le" type="email" autocomplete="username" required></div>
  <div class="field"><label for="lp">Wachtwoord</label><input id="lp" type="password" autocomplete="current-password" required></div>
  <p class="err" id="lerr" hidden></p><button class="btn" type="submit">Inloggen</button></form>
  <a class="small muted" href="#/vergeten">Wachtwoord vergeten?</a>`);
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { email: $('#le').value, password: $('#lp').value } });
      state.me = r.user; location.hash = '#/'; route();
    } catch (err) { $('#lerr').textContent = err.message; $('#lerr').hidden = false; }
  };
}
function renderSetup() {
  authCard(`<div><h1>Eerste account</h1><p class="sub">Maak het eigenaarsaccount aan. Daarna nodig je de rest van het team uit.</p></div>
  <form class="form" id="sf"><div class="field"><label for="sn">Naam</label><input id="sn" required></div>
  <div class="field"><label for="se">E-mailadres</label><input id="se" type="email" required></div>
  <div class="field"><label for="sp">Wachtwoord (minimaal 10 tekens)</label><input id="sp" type="password" minlength="10" autocomplete="new-password" required></div>
  <p class="err" id="serr" hidden></p><button class="btn" type="submit">Account aanmaken</button></form>`);
  $('#sf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/setup', { method: 'POST', body: { name: $('#sn').value, email: $('#se').value, password: $('#sp').value } }); state.me = null; location.hash = '#/'; route(); }
    catch (err) { $('#serr').textContent = err.message; $('#serr').hidden = false; }
  };
}
function renderForgot() {
  authCard(`<div><h1>Wachtwoord vergeten</h1><p class="sub">We sturen je een link om een nieuw wachtwoord te kiezen.</p></div>
  <form class="form" id="ff"><div class="field"><label for="fe">E-mailadres</label><input id="fe" type="email" required></div><button class="btn" type="submit">Stuur link</button></form>
  <a class="small muted" href="#/login">Terug naar inloggen</a>`);
  $('#ff').onsubmit = async (e) => {
    e.preventDefault();
    await act(() => api('/api/auth/forgot', { method: 'POST', body: { email: $('#fe').value } }));
    authCard('<h1>Kijk in je mailbox</h1><p class="sub">Als dit e-mailadres bij ons bekend is, staat er nu een link klaar. Die is 24 uur geldig.</p><a class="btn ghost" href="#/login">Terug naar inloggen</a>');
  };
}
async function renderPassword(token) {
  let t;
  try { t = await api('/api/auth/token/' + encodeURIComponent(token)); }
  catch (e) { return authCard(`<h1>Link verlopen</h1><p class="sub">${esc(e.message)}</p><a class="btn ghost" href="#/vergeten">Nieuwe link aanvragen</a>`); }
  authCard(`<div><h1>${t.type === 'invite' ? 'Welkom, ' + esc(t.name) : 'Nieuw wachtwoord'}</h1><p class="sub">Kies een wachtwoord voor ${esc(t.email)}.</p></div>
  <form class="form" id="pf"><div class="field"><label for="p1">Wachtwoord (minimaal 10 tekens)</label><input id="p1" type="password" minlength="10" autocomplete="new-password" required></div>
  <div class="field"><label for="p2">Herhaal wachtwoord</label><input id="p2" type="password" autocomplete="new-password" required></div>
  <p class="err" id="perr" hidden></p><button class="btn" type="submit">Opslaan en inloggen</button></form>`);
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#perr');
    if ($('#p1').value !== $('#p2').value) { err.textContent = 'De wachtwoorden zijn niet gelijk'; err.hidden = false; return; }
    try { await api('/api/auth/token', { method: 'POST', body: { token, password: $('#p1').value } }); state.me = null; location.hash = '#/'; route(); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
  };
}
async function logout() { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); state.me = null; stopPolling(); location.hash = '#/login'; route(); }

// ---------- schil voor laptoprollen ----------
function shell(page, content) {
  const r = state.me.role;
  const items = [['overzicht', 'Overzicht', true], ['controle', 'Controle', ['eigenaar', 'controle'].includes(r)], ['uitbetaling', 'Uitbetaling', ['eigenaar', 'facturatie'].includes(r)], ['beheer', 'Beheer', r === 'eigenaar']].filter((x) => x[2]);
  $('#app').innerHTML = `<header class="top"><div class="wrap">
    <a class="logo" href="#/">${LOGO} NeighborNoise</a>
    <nav class="nav" aria-label="Hoofdmenu">${items.map(([k, l]) => `<a href="#/${k}" ${k === page ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <button class="bell" id="bell" aria-label="Meldingen">${BELL}<span id="bellN" hidden></span></button>
    <div class="who"><span>${esc(state.me.name)} <span class="muted">· ${esc(state.me.role_label)}</span></span><button class="linkbtn" id="logout">Uitloggen</button></div>
  </div></header><main class="wrap" id="main">${content}</main>`;
  $('#logout').onclick = logout;
  $('#bell').onclick = openNotifications;
  updateBell();
}
async function renderDesk(page, sub) {
  if (page === 'overzicht') return renderOverview();
  if (page === 'controle') return renderControle();
  if (page === 'uitbetaling') return renderPayouts();
  if (page === 'beheer') return renderBeheer(sub || 'gebruikers');
}
async function loadOverview() { state.ov = await api('/api/overview'); return state.ov; }

// ---------- status helpers ----------
function statusPill(m) {
  if (m.late_report) return `<span class="pill alert"><span class="dot"></span>Rapport te laat</span>`;
  if (m.late_control) return `<span class="pill alert"><span class="dot"></span>Wacht op controle</span>`;
  if (m.late_place) return `<span class="pill alert"><span class="dot"></span>Plaatsing niet afgevinkt</span>`;
  if (m.late_pickup) return `<span class="pill alert"><span class="dot"></span>Ophalen niet afgevinkt</span>`;
  if (m.stage === 0) return `<span class="pill">Gepland ${fmtD(m.planned_place_date)}</span>`;
  if (m.stage === 7) return `<span class="pill solid">Afgerond</span>`;
  if (m.stage === 1 && m.waiting_control) return `<span class="pill">Geplaatst · controle open</span>`;
  return `<span class="pill">${esc(m.stage_label)}</span>`;
}
function checks(m) {
  let h = '';
  for (let i = 0; i < 8; i++) h += `<i class="${i <= m.stage ? 'on' : ''}${(m.late_report && i === m.stage + 1) ? ' late' : ''}" title="${esc(state.ov?.stages?.[i] || '')}"></i>`;
  return `<span class="checks" aria-label="Stap ${m.stage + 1} van 8">${h}</span>`;
}

// ---------- overzicht ----------
async function renderOverview() {
  shell('overzicht', '<p class="muted">Laden…</p>');
  let ov;
  try { ov = await loadOverview(); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const isOwner = state.me.role === 'eigenaar';
  const M = ov.measurements, month = ov.today.slice(0, 7);
  const field = M.filter((m) => m.stage === 1).length;
  const lateR = M.filter((m) => m.late_report).length;
  const wait = M.filter((m) => m.waiting_control), waitLate = wait.filter((m) => m.late_control).length;
  const sent = M.filter((m) => m.report_sent_at && m.report_sent_at.slice(0, 7) === month).length;
  $('#main').innerHTML = `
  <div class="head"><div><div class="eyebrow">Totaaloverzicht</div><h1>Alle metingen</h1><p class="sub">Waar elke meting staat en wat blijft hangen.</p></div>
    ${isOwner ? '<button class="btn" id="newBtn">+ Nieuwe plaatsing</button>' : ''}</div>
  <div class="kpis">
    <div class="kpi"><span class="eyebrow">Meters in het veld</span><b>${field}<span class="muted" style="font-size:16px"> / ${ov.meters.filter((x) => x.active).length}</span></b><span class="d">${M.filter((m) => m.stage === 0).length} plaatsingen gepland</span></div>
    <div class="kpi ${lateR ? 'alert' : ''}"><span class="eyebrow">Rapportage te laat</span><b>${lateR}</b><span class="d">deadline ${ov.settings.report_days} dagen na ophalen</span></div>
    <div class="kpi ${waitLate ? 'alert' : ''}"><span class="eyebrow">Wacht op controle</span><b>${wait.length}</b><span class="d">${waitLate} langer dan ${ov.settings.control_hours} uur</span></div>
    <div class="kpi"><span class="eyebrow">Verzonden deze maand</span><b>${sent}</b><span class="d">rapportages naar corporaties</span></div>
  </div>
  <div class="regions" id="regions"></div>
  <div class="section-title"><h2>Waar staat welke meter</h2><span class="muted small">${field} in het veld · ${ov.meters.filter((x) => x.active).length - field} beschikbaar</span></div>
  <div class="meters" id="meters"></div>
  <div class="section-title"><h2>Metingen</h2></div>
  <div class="filters">
    <input id="q" type="search" placeholder="Zoek adres, code, meter, bewoner of opdrachtnummer" value="${esc(state.filters.q)}" aria-label="Zoeken">
    <select id="fCorp" aria-label="Corporatie"><option value="">Alle corporaties</option>${ov.corporations.map((c) => `<option value="${c.id}" ${String(c.id) === state.filters.corp ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <select id="fStage" aria-label="Status"><option value="">Alle statussen</option>${ov.stages.map((s, i) => `<option value="${i}" ${String(i) === state.filters.stage ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <button class="chip" id="fLate" aria-pressed="${state.filters.late}">Te laat</button>
    <button class="chip" id="fCtrl" aria-pressed="${state.filters.ctrl}">Wacht op controle</button>
  </div>
  <div class="tbl"><table><thead><tr><th>Code</th><th>Meter</th><th>Adres</th><th>Bewoner</th><th>Corporatie</th><th>Plaatser</th><th>Geplaatst</th><th>Ophalen</th><th>Duur</th><th>Dagboek</th><th>Checklist</th><th>Status</th><th>Rapport vóór</th></tr></thead><tbody id="rows"></tbody></table></div>`;
  // regio's
  const C = ['var(--fg)', 'color-mix(in srgb,var(--fg) 50%,var(--bg))', 'color-mix(in srgb,var(--fg) 20%,var(--bg))', 'var(--alert)'];
  $('#regions').innerHTML = ov.regions.map((r) => {
    const rs = M.filter((m) => m.region_id === r.id), n = rs.length || 1;
    const late = rs.filter((m) => m.late_report || m.late_control || m.late_place || m.late_pickup).length;
    const done = rs.filter((m) => m.stage >= 6).length, fieldN = rs.filter((m) => m.stage <= 1).length - rs.filter((m) => m.stage <= 1 && (m.late_place || m.late_pickup || m.late_control)).length;
    const proc = Math.max(0, rs.length - done - fieldN - late), w = (x) => (x / n * 100).toFixed(1) + '%';
    return `<button class="region" data-r="${r.id}" aria-pressed="${state.filters.regio === r.id}"><div class="row"><h2>${esc(r.name)}</h2><span class="n">${rs.length}</span></div>
      <div class="stack"><i style="width:${w(done)};background:${C[0]}"></i><i style="width:${w(proc)};background:${C[1]}"></i><i style="width:${w(fieldN)};background:${C[2]}"></i><i style="width:${w(late)};background:${C[3]}"></i></div>
      <div class="legend"><span><i style="background:${C[0]}"></i>${done} opgeleverd</span><span><i style="background:${C[1]}"></i>${proc} in verwerking</span><span><i style="background:${C[2]}"></i>${fieldN} gepland/veld</span>${late ? `<span style="color:var(--alert)"><i style="background:${C[3]}"></i>${late} te laat</span>` : ''}</div></button>`;
  }).join('');
  $$('.region').forEach((b) => (b.onclick = () => { const id = Number(b.dataset.r); state.filters.regio = state.filters.regio === id ? null : id; renderOverview(); }));
  // meters
  $('#meters').innerHTML = ov.meters.filter((x) => x.active).map((mt) => {
    const m = M.find((x) => x.stage === 1 && x.meter_id === mt.id);
    if (!m) { const last = M.filter((x) => x.meter_id === mt.id && x.picked_up_at).sort((a, b) => b.picked_up_at.localeCompare(a.picked_up_at))[0];
      return `<div class="meter"><b>Meter ${mt.id}</b><span>Beschikbaar</span><span class="a">${last ? 'Laatst: ' + esc(last.address) : 'Op voorraad'}</span></div>`; }
    const due = m.planned_pickup_date <= ov.today;
    return `<button class="meter busy ${m.late_pickup ? 'due' : ''}" data-id="${m.id}"><b>Meter ${mt.id}</b><span class="a">${esc(m.address)}</span><span>${esc(m.city)} · ${esc(m.corp_name)}</span><span style="${m.late_pickup ? 'color:var(--alert);font-weight:600' : ''}">Ophalen ${due && !m.late_pickup ? 'vandaag' : fmtD(m.planned_pickup_date)} · ${esc(m.plaatser_name || '')}</span></button>`;
  }).join('') || '<p class="muted">Nog geen meters. Voeg ze toe bij Beheer › Meters.</p>';
  $$('.meter[data-id]').forEach((b) => (b.onclick = () => openMeasurement(Number(b.dataset.id))));
  // filters
  const rerenderRows = () => drawRows(ov);
  $('#q').oninput = (e) => { state.filters.q = e.target.value; rerenderRows(); };
  $('#fCorp').onchange = (e) => { state.filters.corp = e.target.value; rerenderRows(); };
  $('#fStage').onchange = (e) => { state.filters.stage = e.target.value; rerenderRows(); };
  $('#fLate').onclick = (e) => { state.filters.late = !state.filters.late; e.target.setAttribute('aria-pressed', state.filters.late); rerenderRows(); };
  $('#fCtrl').onclick = (e) => { state.filters.ctrl = !state.filters.ctrl; e.target.setAttribute('aria-pressed', state.filters.ctrl); rerenderRows(); };
  if (isOwner) $('#newBtn').onclick = () => openForm();
  drawRows(ov);
}
function drawRows(ov) {
  const f = state.filters, q = f.q.toLowerCase();
  let rows = ov.measurements.filter((m) => (!f.regio || m.region_id === f.regio) && (!f.corp || String(m.corporation_id) === f.corp) && (f.stage === '' || String(m.stage) === f.stage)
    && (!f.late || m.late_report || m.late_control || m.late_place || m.late_pickup) && (!f.ctrl || m.waiting_control)
    && (!q || [m.code, 'meter ' + m.meter_id, m.address, m.city, m.postcode, m.resident_name, m.order_no, m.corp_name, m.plaatser_name].join(' ').toLowerCase().includes(q)));
  const urgency = (m) => (m.late_report || m.late_control || m.late_place || m.late_pickup ? 0 : m.stage === 7 ? 2 : 1);
  rows.sort((a, b) => urgency(a) - urgency(b) || (a.report_deadline || a.planned_pickup_date || a.planned_place_date || '').localeCompare(b.report_deadline || b.planned_pickup_date || b.planned_place_date || ''));
  $('#rows').innerHTML = rows.map((m) => {
    const dl = m.report_deadline ? (m.stage >= 6 ? `<span class="muted">${fmtD(m.report_deadline)}</span>` : `<span class="${m.late_report ? 'late-t' : ''}">${fmtD(m.report_deadline)}</span>`) : '<span class="muted">—</span>';
    return `<tr class="click" data-id="${m.id}" tabindex="0"><td class="mono">${m.code}</td><td>${m.meter_id ? 'Meter ' + m.meter_id : '<span class="muted">—</span>'}</td>
      <td class="wrapcell">${esc(m.address)}<small>${esc(m.postcode || '')} ${esc(m.city)}</small></td><td class="wrapcell">${esc(m.resident_name || '—')}<small class="mono">${esc(m.resident_phone || '')}</small></td>
      <td>${esc(m.corp_name)}${m.order_no ? `<small class="mono">${esc(m.order_no)}</small>` : ''}</td><td>${esc(m.plaatser_name || '—')}</td>
      <td>${m.placed_at ? fmtDT(m.placed_at) : `<span class="muted">gepl. ${fmtD(m.planned_place_date)}</span>`}</td>
      <td>${m.picked_up_at ? fmtDT(m.picked_up_at) : m.planned_pickup_date ? `<span class="${m.late_pickup ? 'late-t' : 'muted'}">gepl. ${fmtD(m.planned_pickup_date)}</span>` : '—'}</td>
      <td>${weken(m.duration_weeks)}</td><td>${m.diary ? (m.diary === 'ja' ? 'Ja' + (m.photo_count ? ` <span class="muted">(${m.photo_count} foto)</span>` : '') : '<span class="muted">Nee</span>') : '<span class="muted">—</span>'}</td>
      <td>${checks(m)}</td><td>${statusPill(m)}</td><td>${dl}</td></tr>`;
  }).join('') || '<tr><td colspan="13" class="empty">Geen metingen voor dit filter.</td></tr>';
  $$('#rows tr[data-id]').forEach((tr) => { tr.onclick = () => openMeasurement(Number(tr.dataset.id)); tr.onkeydown = (e) => { if (e.key === 'Enter') openMeasurement(Number(tr.dataset.id)); }; });
}

// ---------- drawer ----------
function drawer(html, label) {
  $('#drawerRoot').innerHTML = `<div class="scrim" id="scrim"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(label)}"><button class="x" id="dx" aria-label="Sluiten">✕</button>${html}</aside>`;
  $('#scrim').onclick = closeDrawer; $('#dx').onclick = closeDrawer;
  $('.drawer').focus?.();
}
function closeDrawer() { $('#drawerRoot').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
async function refreshCurrent() {
  const h = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (state.me?.role === 'plaatser') return route();
  if (h === 'controle') return renderControle();
  if (h === 'uitbetaling') return renderPayouts();
  if (h === 'beheer') return renderBeheer(location.hash.split('/')[2] || 'gebruikers');
  return renderOverview();
}

async function openMeasurement(id) {
  let d;
  try { d = await api('/api/measurements/' + id); } catch (e) { return toast(e.message, true); }
  const m = d.measurement, role = state.me.role, isOwner = role === 'eigenaar', canCtrl = ['eigenaar', 'controle'].includes(role);
  const ev = (type) => d.events.filter((e) => e.type === type).slice(-1)[0];
  const step = (label, done, when, who, late) => `<li><span class="box ${done ? 'on' : ''} ${late ? 'late' : ''}"></span><div><b style="font-weight:${done ? 600 : 500}">${label}</b>${who ? `<div class="muted small">${esc(who)}</div>` : ''}</div><span class="when">${when || ''}</span></li>`;
  const E = (t) => { const e = ev(t); return e ? [fmtDT(e.at), e.actor] : [null, null]; };
  const steps = [
    step('Aangemaakt', true, ...E('created')),
    step('Geplaatst', !!m.placed_at, m.placed_at ? fmtDT(m.placed_at) : `gepland ${fmtD(m.planned_place_date)}`, E('placed')[1] || m.plaatser_name, m.late_place),
    step('Plaatsing gecontroleerd', !!m.place_checked_at, m.place_checked_at ? fmtDT(m.place_checked_at) : m.late_control ? '<span class="late-t">te laat</span>' : '', E('place_checked')[1], m.late_control),
    step('Opgehaald', !!m.picked_up_at, m.picked_up_at ? fmtDT(m.picked_up_at) : m.planned_pickup_date ? `gepland ${fmtD(m.planned_pickup_date)}` : '', E('picked_up')[1], m.late_pickup),
    step('Dagboek verwerkt', m.stage >= 3, ...E('diary')),
    step('Data gecontroleerd', m.stage >= 4, ...E('data')),
    step('Rapportage klaar', m.stage >= 5, ...E('report')),
    step('Verzonden', m.stage >= 6, m.report_sent_at ? fmtDT(m.report_sent_at) : m.report_deadline ? `<span class="${m.late_report ? 'late-t' : ''}">vóór ${fmtD(m.report_deadline)}</span>` : '', E('sent')[1], m.late_report),
    step('Afgerond', m.stage >= 7, ...E('closed')),
  ].join('');
  // acties
  const acts = [];
  if (canCtrl && m.placed_at && !m.place_checked_at) acts.push('<button class="btn" data-a="check">✓ Plaatsing gecontroleerd</button>');
  if (canCtrl && m.stage === 2) acts.push('<button class="btn" data-a="diary">Dagboek verwerkt</button>');
  if (canCtrl && m.stage === 3) acts.push('<button class="btn" data-a="data">Data gecontroleerd</button>');
  if (canCtrl && m.stage === 5) acts.push(`<button class="btn" data-a="send">Verzend rapport naar ${esc(m.corp_name)}</button>`);
  if (isOwner && m.stage === 6) acts.push('<button class="btn" data-a="close">Dossier afronden</button>');
  if (isOwner && m.stage < 7) acts.push(`<button class="btn ghost" data-a="remind-pl">Herinnering plaatser</button><button class="btn ghost" data-a="remind-ctrl">Herinnering controle</button>`);
  if (isOwner) acts.push('<button class="btn ghost" data-a="edit">Bewerken</button>');
  const reportBlock = canCtrl && (m.stage === 4 || m.stage === 5) ? `<form class="card form" id="repForm"><h2>${m.stage === 5 ? 'Rapport vervangen' : 'Rapport uploaden'}</h2>
     <div class="field"><label for="repOut">Uitkomst</label><select id="repOut" required><option value="">Kies…</option>${d.outcomes.map((o) => `<option ${o === m.outcome ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
     <div class="field"><label for="repFile">Rapport (PDF)</label><input id="repFile" type="file" accept="application/pdf" required></div>
     <button class="btn" type="submit">Uploaden</button></form>` : '';
  drawer(`
    <div><div class="eyebrow">${m.meter_id ? 'Meter ' + m.meter_id + ' · ' : ''}<span class="mono">${m.code}</span></div><h1 style="font-size:22px">${esc(m.address)}</h1><div class="muted">${esc(m.postcode || '')} ${esc(m.city)} · ${esc(m.corp_name)}${m.region_name ? ' · ' + esc(m.region_name) : ''}</div></div>
    <div class="btnrow">${statusPill(m)}${m.outcome ? `<span class="pill solid">${esc(m.outcome)}</span>` : ''}</div>
    <div class="btnrow">${acts.join('')}</div>
    ${reportBlock}
    <dl class="kv"><dt>Bewoner</dt><dd>${esc(m.resident_name || '—')}</dd><dt>Telefoon</dt><dd class="mono">${m.resident_phone ? `<a href="tel:${esc(m.resident_phone)}">${esc(m.resident_phone)}</a>` : '—'}</dd>
      <dt>Opdrachtnummer</dt><dd class="mono">${esc(m.order_no || '—')}</dd><dt>Plaatser</dt><dd>${esc(m.plaatser_name || '—')}</dd><dt>Meetduur</dt><dd>${weken(m.duration_weeks)}</dd>
      <dt>Dagboek</dt><dd>${m.diary ? (m.diary === 'ja' ? 'Ja' : 'Nee') : '—'}</dd><dt>Geluid gehoord bij ophalen</dt><dd>${m.noise_heard == null ? '—' : m.noise_heard ? 'Ja' : 'Nee'}</dd>
      ${m.report_key && canCtrl ? `<dt>Rapport</dt><dd><a href="/api/files/report/${m.id}" target="_blank" rel="noopener">${esc(m.report_name || 'rapport.pdf')}</a></dd>` : ''}</dl>
    ${m.remark ? `<div class="card" style="padding:12px;white-space:pre-line"><span class="eyebrow">Opmerkingen</span>${esc(m.remark)}</div>` : ''}
    <div><h2 style="margin-bottom:6px">Checklist</h2><ul class="steps">${steps}</ul></div>
    <div><div class="section-title" style="margin:0 0 8px"><h2>Foto's dagboek (${d.photos.length})</h2>${canCtrl ? '<label class="btn ghost sm" style="cursor:pointer">+ Foto<input type="file" accept="image/*" multiple hidden id="addPhoto"></label>' : ''}</div>
      ${d.photos.length ? `<div class="photos">${d.photos.map((p) => `<a href="/api/files/photo/${p.id}" target="_blank" rel="noopener"><img src="/api/files/photo/${p.id}" alt="Foto dagboek" loading="lazy"></a>`).join('')}</div>` : '<p class="muted small">Nog geen foto\'s.</p>'}</div>
    ${canCtrl ? `<div><h2 style="margin-bottom:8px">Interne notities</h2><form class="form" id="noteForm"><div class="field"><label for="noteBody" class="muted">Nieuwe notitie</label><textarea id="noteBody" rows="2"></textarea></div><button class="btn ghost sm" type="submit">Notitie toevoegen</button></form>
      <ul class="feed" style="margin-top:8px">${d.notes.map((n) => `<li><time>${fmtDT(n.created_at)}</time><div><b style="font-weight:600">${esc(n.author || '')}</b><div style="white-space:pre-line">${esc(n.body)}</div></div></li>`).join('')}</ul></div>` : ''}
    <div><h2 style="margin-bottom:8px">Activiteit</h2><ul class="feed">${d.events.slice().reverse().map((e) => `<li><time>${fmtDT(e.at)}</time><div>${esc(e.message)}<div class="muted small">${esc(e.actor || 'Systeem')}</div></div></li>`).join('')}</ul></div>
    ${isOwner ? '<div class="btnrow" style="margin-top:8px"><button class="btn danger sm" id="delBtn">Meting verwijderen</button><span id="delConfirm" hidden><span class="small">Zeker weten? Foto\'s en rapport gaan ook weg.</span> <button class="btn danger sm" id="delYes">Ja, verwijderen</button></span></div>' : ''}
  `, 'Meting ' + m.code);
  const after = () => { openMeasurement(id); refreshCurrent(); };
  $$('[data-a]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a;
    b.disabled = true;
    let ok = false;
    if (a === 'check') ok = await act(() => api(`/api/measurements/${id}/check`, { method: 'POST' }), 'Plaatsing gecontroleerd');
    if (a === 'diary' || a === 'data') ok = await act(() => api(`/api/measurements/${id}/advance`, { method: 'POST', body: { step: a } }), 'Stap afgevinkt');
    if (a === 'send') ok = await act(() => api(`/api/measurements/${id}/send`, { method: 'POST' }), 'Rapport verzonden');
    if (a === 'close') ok = await act(() => api(`/api/measurements/${id}/close`, { method: 'POST' }), 'Dossier afgerond');
    if (a === 'remind-pl') ok = await act(() => api(`/api/measurements/${id}/remind`, { method: 'POST', body: { to: 'plaatser' } }), 'Herinnering gestuurd');
    if (a === 'remind-ctrl') ok = await act(() => api(`/api/measurements/${id}/remind`, { method: 'POST', body: { to: 'controle' } }), 'Herinnering gestuurd');
    if (a === 'edit') return openForm(m);
    b.disabled = false;
    if (ok) after();
  }));
  const rf = $('#repForm');
  if (rf) rf.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(); fd.append('outcome', $('#repOut').value); fd.append('file', $('#repFile').files[0]);
    if (await act(() => api(`/api/measurements/${id}/report`, { method: 'POST', form: fd }), 'Rapport geüpload')) after();
  };
  const ap = $('#addPhoto');
  if (ap) ap.onchange = async () => { const fd = new FormData(); [...ap.files].forEach((f) => fd.append('file', f)); if (await act(() => api(`/api/measurements/${id}/photos`, { method: 'POST', form: fd }), 'Foto toegevoegd')) openMeasurement(id); };
  const nf = $('#noteForm');
  if (nf) nf.onsubmit = async (e) => { e.preventDefault(); if (await act(() => api(`/api/measurements/${id}/notes`, { method: 'POST', body: { body: $('#noteBody').value } }), 'Notitie opgeslagen')) openMeasurement(id); };
  const del = $('#delBtn');
  if (del) { del.onclick = () => ($('#delConfirm').hidden = false); $('#delYes').onclick = async () => { if (await act(() => api('/api/measurements/' + id, { method: 'DELETE' }), 'Meting verwijderd')) { closeDrawer(); refreshCurrent(); } }; }
}

// ---------- nieuwe plaatsing / bewerken ----------
async function openForm(m) {
  const ov = state.ov || (await loadOverview());
  const v = m || { duration_weeks: 1, planned_place_date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) };
  drawer(`<div><div class="eyebrow">${m ? m.code : 'Eigenaar'}</div><h1 style="font-size:22px">${m ? 'Meting bewerken' : 'Nieuwe plaatsing'}</h1><div class="muted">${m ? 'Wijzig je de plaatser, dan krijgt de nieuwe plaatser een mail.' : 'De plaatser krijgt direct een mail en ziet de opdracht in zijn app.'}</div></div>
   <form class="form" id="mf">
    <div class="two"><div class="field"><label for="fCorpSel">Corporatie</label><select id="fCorpSel" required><option value="">Kies…</option>${ov.corporations.map((c) => `<option value="${c.id}" ${c.id === v.corporation_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="fOrder">Opdrachtnummer corporatie</label><input id="fOrder" value="${esc(v.order_no || '')}"></div></div>
    <div class="field"><label for="fAddr">Adres (straat en huisnummer)</label><input id="fAddr" required value="${esc(v.address || '')}"></div>
    <div class="two"><div class="field"><label for="fPc">Postcode</label><input id="fPc" value="${esc(v.postcode || '')}"></div>
      <div class="field"><label for="fCity">Plaats</label><input id="fCity" required list="placeList" value="${esc(v.city || '')}"><datalist id="placeList"></datalist></div></div>
    <div class="two"><div class="field"><label for="fRes">Naam bewoner</label><input id="fRes" value="${esc(v.resident_name || '')}"></div>
      <div class="field"><label for="fTel">Telefoon bewoner</label><input id="fTel" inputmode="tel" value="${esc(v.resident_phone || '')}"></div></div>
    <div class="three"><div class="field"><label for="fDur">Meetduur</label><select id="fDur"><option value="1" ${v.duration_weeks === 1 ? 'selected' : ''}>1 week</option><option value="2" ${v.duration_weeks === 2 ? 'selected' : ''}>2 weken</option></select></div>
      <div class="field"><label for="fPl">Plaatser</label><select id="fPl"><option value="">Nog niet toegewezen</option>${ov.plaatsers.map((p) => `<option value="${p.id}" ${p.id === v.plaatser_id ? 'selected' : ''}>${esc(p.name)}${p.werkgebied ? ' · ' + esc(p.werkgebied) : ''}</option>`).join('')}</select></div>
      <div class="field"><label for="fDate">Plaatsen op</label><input id="fDate" type="date" required value="${esc(v.planned_place_date)}"></div></div>
    <div class="field"><label for="fRem">Opmerking voor de plaatser</label><textarea id="fRem" rows="2">${esc(m ? '' : v.remark || '')}</textarea></div>
    <p class="err" id="mfErr" hidden></p>
    <button class="btn" type="submit">${m ? 'Opslaan' : 'Plaatsing aanmaken'}</button>
   </form>`, m ? 'Meting bewerken' : 'Nieuwe plaatsing');
  api('/api/admin').then((a) => { $('#placeList').innerHTML = a.places.map((p) => `<option value="${esc(p.name)}">`).join(''); }).catch(() => {});
  $('#mf').onsubmit = async (e) => {
    e.preventDefault();
    const body = { corporation_id: Number($('#fCorpSel').value), order_no: $('#fOrder').value, address: $('#fAddr').value, postcode: $('#fPc').value, city: $('#fCity').value,
      resident_name: $('#fRes').value, resident_phone: $('#fTel').value, duration_weeks: Number($('#fDur').value), plaatser_id: $('#fPl').value || null, planned_place_date: $('#fDate').value };
    if (!m || $('#fRem').value.trim()) body.remark = m ? [m.remark, $('#fRem').value.trim()].filter(Boolean).join('\n') : $('#fRem').value;
    try {
      if (m) await api('/api/measurements/' + m.id, { method: 'PATCH', body });
      else await api('/api/measurements', { method: 'POST', body });
      toast(m ? 'Opgeslagen' : 'Plaatsing aangemaakt · plaatser is gemaild');
      closeDrawer(); refreshCurrent(); if (m) openMeasurement(m.id);
    } catch (x) { $('#mfErr').textContent = x.message; $('#mfErr').hidden = false; }
  };
}

// ---------- controle ----------
async function renderControle() {
  shell('controle', '<p class="muted">Laden…</p>');
  let ov, evs;
  try { [ov, evs] = await Promise.all([loadOverview(), api('/api/events')]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const toCheck = ov.measurements.filter((m) => m.waiting_control).sort((a, b) => a.placed_at.localeCompare(b.placed_at));
  const queue = ov.measurements.filter((m) => m.stage >= 2 && m.stage <= 5).sort((a, b) => (b.late_report - a.late_report) || (a.report_deadline || '').localeCompare(b.report_deadline || ''));
  const next = { 2: 'Dagboek verwerken', 3: 'Data controleren', 4: 'Rapport uploaden', 5: 'Rapport verzenden' };
  $('#main').innerHTML = `<div class="head"><div><div class="eyebrow">Controle &amp; rapportage</div><h1>Te controleren</h1><p class="sub">Elke geplaatste en opgehaalde meter komt hier binnen. Plaatsingen binnen ${ov.settings.control_hours} uur afvinken.</p></div></div>
  <div class="grid2"><div style="display:flex;flex-direction:column;gap:20px;min-width:0">
    <div class="card"><div class="section-title" style="margin:0"><h2>Net geplaatst · controleren (${toCheck.length})</h2><span class="muted small">Na ${ov.settings.control_hours} uur rood bij de eigenaar</span></div>
      ${toCheck.map((m) => `<div class="crow ${m.late_control ? 'late' : ''}"><div style="min-width:0"><b>Meter ${m.meter_id} · ${esc(m.address)}</b><div class="muted small">${esc(m.city)} · ${esc(m.corp_name)} · door ${esc(m.plaatser_name || '')} op ${fmtDT(m.placed_at)}${m.late_control ? ' · <span class="late-t">te laat</span>' : ''}</div></div>
        <div class="btnrow"><button class="btn ghost sm" data-open="${m.id}">Details</button><button class="btn sm" data-check="${m.id}">✓ Gecontroleerd</button></div></div>`).join('') || '<p class="muted">Alle plaatsingen zijn gecontroleerd.</p>'}</div>
    <div><h2 style="margin-bottom:10px">Rapportage-wachtrij (${queue.length})</h2><div style="display:flex;flex-direction:column;gap:10px">
      ${queue.map((m) => `<div class="qitem"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div style="min-width:0"><span class="muted small"><b style="color:var(--fg)">Meter ${m.meter_id}</b> · <span class="mono">${m.code}</span></span><h2>${esc(m.address)}</h2><div class="muted small">${esc(m.city)} · ${esc(m.corp_name)} · ${esc(m.plaatser_name || '')}</div></div>${statusPill(m)}</div>
        <div class="muted small">${fmtDT(m.placed_at)} → ${fmtDT(m.picked_up_at)} (${weken(m.duration_weeks)}) · dagboek ${m.diary === 'ja' ? 'ja' + (m.photo_count ? ` (${m.photo_count} foto)` : '') : 'nee'} · geluid gehoord ${m.noise_heard ? 'ja' : 'nee'} · deadline <span class="${m.late_report ? 'late-t' : ''}">${fmtD(m.report_deadline)}</span></div>
        ${checks(m)}<div class="btnrow"><button class="btn sm" data-open="${m.id}">${next[m.stage]}</button></div></div>`).join('') || '<p class="muted">De wachtrij is leeg.</p>'}</div></div>
  </div>
  <div class="card"><h2>Activiteit</h2><ul class="feed">${evs.items.map((e) => `<li><time>${fmtDT(e.at)}</time><div><b style="font-weight:600">${esc(e.message)}</b><div class="muted small">${esc(e.address || '')} · ${esc(e.actor || 'Systeem')}</div></div></li>`).join('') || '<li class="muted" style="display:block">Nog geen activiteit.</li>'}</ul></div></div>`;
  $$('[data-open]').forEach((b) => (b.onclick = () => openMeasurement(Number(b.dataset.open))));
  $$('[data-check]').forEach((b) => (b.onclick = async () => { b.disabled = true; if (await act(() => api(`/api/measurements/${b.dataset.check}/check`, { method: 'POST' }), 'Plaatsing gecontroleerd')) renderControle(); else b.disabled = false; }));
}

// ---------- uitbetaling ----------
function monthsBack(n) { const out = []; const d = new Date(); d.setDate(1); for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() - 1); } return out; }
const monthName = (m) => new Date(m + '-15T12:00:00Z').toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
async function renderPayouts() {
  shell('uitbetaling', '<p class="muted">Laden…</p>');
  const month = state.month || monthsBack(1)[0];
  let d;
  try { d = await api('/api/payouts?month=' + month); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const total = d.plaatsers.reduce((s, p) => s + p.total, 0);
  const zoneLbl = { 1: 'Binnen eigen stad', 2: 'Net buiten de stad, eigen regio', 3: 'Verder weg' };
  $('#main').innerHTML = `<div class="head"><div><div class="eyebrow">Facturatie</div><h1>Uitbetaling plaatsers</h1><p class="sub">Elke plaatsing en ophaling die een plaatser afvinkt telt automatisch mee, met de prijs die bij de afstand hoort.</p></div>
    <div class="btnrow"><select id="mSel" aria-label="Maand" style="border:1px solid var(--line);border-radius:8px;padding:9px 10px;background:var(--bg)">${monthsBack(12).map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select>
    <a class="btn ghost" href="/api/payouts.csv?month=${month}">CSV exporteren</a></div></div>
  <div class="kpis"><div class="kpi"><span class="eyebrow">Totaal ${monthName(month)}</span><b class="mono">${euro(total)}</b><span class="d">${d.plaatsers.length} plaatsers</span></div>
    ${d.plaatsers.map((p) => `<div class="kpi"><span class="eyebrow">${esc(p.user.name)}</span><b class="mono">${euro(p.total)}</b><span class="d">${p.lines.filter((l) => l.type === 'Plaatsen').length} geplaatst · ${p.lines.filter((l) => l.type === 'Ophalen').length} opgehaald</span></div>`).join('')}</div>
  <div class="grid2"><div style="display:flex;flex-direction:column;gap:16px;min-width:0">
    ${d.plaatsers.map((p) => `<div class="card"><div class="section-title" style="margin:0"><div><h2>${esc(p.user.name)}</h2><span class="muted small">Werkgebied ${esc(p.user.werkgebied || 'niet ingesteld')} · <span class="mono">${esc(p.user.iban || 'geen IBAN')}</span></span></div><span class="pill ${p.status === 'betaald' ? 'solid' : ''}">${p.status}</span></div>
      <div class="tbl" style="max-height:300px;overflow:auto"><table style="min-width:640px"><thead><tr><th>Datum</th><th>Actie</th><th>Meter</th><th>Adres</th><th>Opdracht</th><th>Zone</th><th>Bedrag</th></tr></thead><tbody>
      ${p.lines.map((l) => `<tr><td>${fmtDT(l.at)}</td><td>${l.type}</td><td>${l.meter_id || '—'}</td><td>${esc(l.address)}<small>${esc(l.city)}</small></td><td class="mono">${esc(l.order_no || '')}</td><td>${l.zone}</td><td class="mono">${euro(l.amount)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Niets in deze maand.</td></tr>'}
      </tbody></table></div>
      <div class="il tot"><span>Totaal (${p.lines.length} bezoeken)</span><span class="mono">${euro(p.total)}</span></div>
      <div class="btnrow">${p.status === 'concept' ? `<button class="btn sm" data-st="goedgekeurd" data-u="${p.user.id}">Goedkeuren</button>` : ''}${p.status === 'goedgekeurd' ? `<button class="btn sm" data-st="betaald" data-u="${p.user.id}">Markeer betaald</button>` : ''}${p.status !== 'concept' ? `<button class="btn ghost sm" data-st="concept" data-u="${p.user.id}">Terug naar concept</button>` : ''}
        <button class="btn ghost sm" data-mail="${p.user.id}">Specificatie mailen naar ${esc(p.user.name)}</button></div></div>`).join('') || '<p class="muted">Nog geen plaatsers.</p>'}
  </div>
  <form class="card form" id="tf"><h2>Tarieven per bezoek</h2><p class="muted small" style="margin:0">Per plaatsing of ophaling. De zone volgt uit het werkgebied van de plaatser en de plaats van het adres (zie Beheer › Regio's en plaatsen).</p>
    ${[1, 2, 3].map((z) => `<div class="two" style="align-items:center"><label for="t${z}">${z}. ${zoneLbl[z]}</label><input id="t${z}" type="number" step="0.01" min="0" value="${d.settings['tariff_z' + z]}" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg)"></div>`).join('')}
    <button class="btn" type="submit">Tarieven opslaan</button></form></div>`;
  $('#mSel').onchange = (e) => { state.month = e.target.value; renderPayouts(); };
  $$('[data-st]').forEach((b) => (b.onclick = async () => { if (await act(() => api(`/api/payouts/${b.dataset.u}/${month}`, { method: 'POST', body: { status: b.dataset.st } }), 'Status bijgewerkt')) renderPayouts(); }));
  $$('[data-mail]').forEach((b) => (b.onclick = () => act(() => api(`/api/payouts/${b.dataset.mail}/${month}/mail`, { method: 'POST' }), 'Specificatie gemaild')));
  $('#tf').onsubmit = async (e) => { e.preventDefault(); if (await act(() => api('/api/settings', { method: 'PUT', body: { tariff_z1: $('#t1').value, tariff_z2: $('#t2').value, tariff_z3: $('#t3').value } }), 'Tarieven opgeslagen')) renderPayouts(); };
}

// ---------- beheer ----------
const ROLE_OPTS = [['eigenaar', 'Eigenaar'], ['controle', 'Controle'], ['plaatser', 'Plaatser'], ['facturatie', 'Facturatie']];
async function renderBeheer(sub) {
  shell('beheer', '<p class="muted">Laden…</p>');
  let a;
  try { a = await api('/api/admin'); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const tabs = [['gebruikers', 'Gebruikers'], ['corporaties', 'Corporaties'], ['meters', 'Meters'], ['regios', "Regio's en plaatsen"], ['instellingen', 'Instellingen'], ['emails', 'E-mails']];
  const placeOpts = (sel) => `<option value="">—</option>` + a.places.map((p) => `<option ${p.name === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  let body = '';
  if (sub === 'gebruikers') body = `<div class="grid2"><div class="tbl"><table style="min-width:760px"><thead><tr><th>Naam</th><th>Rol</th><th>Werkgebied</th><th>IBAN</th><th>Status</th><th></th></tr></thead><tbody>
    ${a.users.map((u) => `<tr><td>${esc(u.name)}<small>${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</small></td>
      <td><select data-urole="${u.id}" aria-label="Rol van ${esc(u.name)}">${ROLE_OPTS.map(([k, l]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td>${u.role === 'plaatser' ? `<select data-uwg="${u.id}" aria-label="Werkgebied">${placeOpts(u.werkgebied)}</select>` : '<span class="muted">—</span>'}</td>
      <td>${u.role === 'plaatser' ? `<input data-uiban="${u.id}" value="${esc(u.iban || '')}" placeholder="NL.." style="width:190px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;background:var(--bg)" aria-label="IBAN">` : '<span class="muted">—</span>'}</td>
      <td>${!u.active ? '<span class="pill">Gedeactiveerd</span>' : u.has_password ? '<span class="pill solid">Actief</span>' : '<span class="pill">Uitgenodigd</span>'}</td>
      <td><div class="btnrow">${!u.has_password && u.active ? `<button class="btn ghost sm" data-reinv="${u.id}">Opnieuw uitnodigen</button>` : ''}<button class="btn ghost sm" data-uact="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'Deactiveren' : 'Activeren'}</button></div></td></tr>`).join('')}
    </tbody></table></div>
    <form class="card form" id="uf"><h2>Gebruiker uitnodigen</h2><div class="field"><label for="uN">Naam</label><input id="uN" required></div><div class="field"><label for="uE">E-mailadres</label><input id="uE" type="email" required></div>
      <div class="two"><div class="field"><label for="uR">Rol</label><select id="uR">${ROLE_OPTS.map(([k, l]) => `<option value="${k}" ${k === 'plaatser' ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div class="field"><label for="uT">Telefoon</label><input id="uT" inputmode="tel"></div></div>
      <div class="two"><div class="field"><label for="uW">Werkgebied (plaatser)</label><select id="uW">${placeOpts('')}</select></div><div class="field"><label for="uI">IBAN (plaatser)</label><input id="uI"></div></div>
      <button class="btn" type="submit">Uitnodiging versturen</button><p class="small muted" id="invLink" style="word-break:break-all"></p></form></div>`;
  if (sub === 'corporaties') body = `<div class="grid2"><div class="tbl"><table style="min-width:620px"><thead><tr><th>Naam</th><th>Regio</th><th>E-mail voor rapporten</th><th></th></tr></thead><tbody>
    ${a.corporations.map((c) => `<tr><td>${esc(c.name)}${c.active ? '' : ' <span class="pill">inactief</span>'}</td><td><select data-creg="${c.id}" aria-label="Regio">${a.regions.map((r) => `<option value="${r.id}" ${r.id === c.region_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></td>
      <td><input data-cmail="${c.id}" type="email" value="${esc(c.contact_email || '')}" placeholder="rapporten@corporatie.nl" style="width:240px;border:1px solid var(--line);border-radius:6px;padding:5px 8px;background:var(--bg)" aria-label="E-mail voor rapporten"></td>
      <td><button class="btn ghost sm" data-csave="${c.id}" data-active="${c.active}">Opslaan</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nog geen corporaties.</td></tr>'}</tbody></table></div>
    <form class="card form" id="cf"><h2>Corporatie toevoegen</h2><div class="field"><label for="cN">Naam</label><input id="cN" required></div><div class="field"><label for="cR">Regio</label><select id="cR">${a.regions.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="cM">E-mail voor rapporten</label><input id="cM" type="email"></div><button class="btn" type="submit">Toevoegen</button></form></div>`;
  if (sub === 'meters') body = `<div class="grid2"><div class="meters">${a.meters.map((m) => `<button class="meter ${m.active ? 'busy' : ''}" data-mtog="${m.id}" data-v="${m.active ? 0 : 1}"><b>Meter ${m.id}</b><span>${m.active ? 'Actief · klik om uit te zetten' : 'Uit gebruik · klik om te activeren'}</span></button>`).join('') || '<p class="muted">Nog geen meters.</p>'}</div>
    <form class="card form" id="mtf"><h2>Meters toevoegen</h2><div class="two"><div class="field"><label for="mFrom">Van nummer</label><input id="mFrom" type="number" min="1" required></div><div class="field"><label for="mTo">Tot en met (optioneel)</label><input id="mTo" type="number" min="1"></div></div><button class="btn" type="submit">Toevoegen</button></form></div>`;
  if (sub === 'regios') body = `<div class="grid2"><div class="regions">${a.regions.map((r) => `<div class="card"><h2>${esc(r.name)}</h2><div class="chips">${a.places.filter((p) => p.region_id === r.id).map((p) => `<span class="pill">${esc(p.name)} <button class="linkbtn" data-pdel="${esc(p.name)}" aria-label="Verwijder ${esc(p.name)}">×</button></span>`).join('')}</div></div>`).join('')}</div>
    <div style="display:flex;flex-direction:column;gap:16px"><form class="card form" id="pf2"><h2>Plaats toevoegen</h2><p class="muted small" style="margin:0">Bepaalt de zone voor de uitbetaling en de regio in het overzicht.</p><div class="field"><label for="pN">Plaats</label><input id="pN" required></div><div class="field"><label for="pR">Regio</label><select id="pR">${a.regions.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div><button class="btn" type="submit">Toevoegen</button></form>
    <form class="card form" id="rf2"><h2>Regio toevoegen</h2><div class="field"><label for="rN">Naam</label><input id="rN" required></div><button class="btn" type="submit">Toevoegen</button></form></div></div>`;
  if (sub === 'instellingen') body = `<div class="grid2"><form class="card form" id="sf2"><h2>Termijnen</h2>
    <div class="field"><label for="sC">Plaatsing controleren binnen (uren)</label><input id="sC" type="number" min="1" value="${a.settings.control_hours}"></div>
    <div class="field"><label for="sR">Rapport verzenden binnen (dagen na ophalen)</label><input id="sR" type="number" min="1" value="${a.settings.report_days}"></div>
    <button class="btn" type="submit">Opslaan</button></form>
    <div class="card"><h2>E-mail en meldingen</h2><p class="small">${a.mail_live ? 'E-mails worden echt verstuurd via Resend.' : '<b>Testmodus:</b> er is nog geen Resend-sleutel ingesteld. Mails komen alleen in het logboek (tab E-mails).'}</p>
    <p class="small muted">De automatische controle op termijnen draait elk kwartier. Je kunt hem ook nu laten draaien.</p><button class="btn ghost" id="runAlerts">Termijnen nu controleren</button></div></div>`;
  if (sub === 'emails') body = `<div class="tbl"><table style="min-width:700px"><thead><tr><th>Tijd</th><th>Aan</th><th>Onderwerp</th><th>Status</th></tr></thead><tbody>
    ${a.emails.map((e) => `<tr class="click" data-mail="${e.id}"><td>${fmtDT(e.created_at)}</td><td>${esc(e.to_email)}</td><td>${esc(e.subject)}</td><td>${e.status === 'sent' ? '<span class="pill solid">Verstuurd</span>' : e.status === 'failed' ? `<span class="pill alert" title="${esc(e.error || '')}">Mislukt</span>` : '<span class="pill">Alleen logboek</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nog geen e-mails.</td></tr>'}</tbody></table></div>`;
  $('#main').innerHTML = `<div class="head"><div><div class="eyebrow">Eigenaar</div><h1>Beheer</h1></div></div>
    <nav class="subtabs">${tabs.map(([k, l]) => `<a href="#/beheer/${k}" ${k === sub ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>${body}`;
  const reload = () => renderBeheer(sub);
  // gebruikers
  const uf = $('#uf');
  if (uf) uf.onsubmit = async (e) => {
    e.preventDefault();
    const r = await act(() => api('/api/users', { method: 'POST', body: { name: $('#uN').value, email: $('#uE').value, role: $('#uR').value, phone: $('#uT').value, werkgebied: $('#uW').value, iban: $('#uI').value } }), 'Uitnodiging verstuurd');
    if (r) { await reload(); if (r.invite_link) $('#invLink').innerHTML = `Testmodus, de mail is niet echt verstuurd. Uitnodigingslink: <a href="${esc(r.invite_link)}">${esc(r.invite_link)}</a>`; }
  };
  const patchUser = (id, body) => act(() => api('/api/users/' + id, { method: 'PATCH', body }), 'Opgeslagen');
  $$('[data-urole]').forEach((s) => (s.onchange = async () => { if (await patchUser(s.dataset.urole, { role: s.value })) reload(); }));
  $$('[data-uwg]').forEach((s) => (s.onchange = () => patchUser(s.dataset.uwg, { werkgebied: s.value })));
  $$('[data-uiban]').forEach((s) => (s.onchange = () => patchUser(s.dataset.uiban, { iban: s.value })));
  $$('[data-uact]').forEach((b) => (b.onclick = async () => { if (await patchUser(b.dataset.uact, { active: b.dataset.v === '1' })) reload(); }));
  $$('[data-reinv]').forEach((b) => (b.onclick = async () => { const r = await act(() => api(`/api/users/${b.dataset.reinv}/invite`, { method: 'POST' }), 'Uitnodiging opnieuw verstuurd'); if (r?.invite_link) toast('Testmodus: link staat in Beheer › E-mails'); }));
  // corporaties
  const cf = $('#cf');
  if (cf) cf.onsubmit = async (e) => { e.preventDefault(); if (await act(() => api('/api/corporations', { method: 'POST', body: { name: $('#cN').value, region_id: $('#cR').value, contact_email: $('#cM').value } }), 'Corporatie toegevoegd')) reload(); };
  $$('[data-csave]').forEach((b) => (b.onclick = () => { const id = b.dataset.csave; act(() => api('/api/corporations/' + id, { method: 'PATCH', body: { region_id: $(`[data-creg="${id}"]`).value, contact_email: $(`[data-cmail="${id}"]`).value, active: b.dataset.active === '1' } }), 'Opgeslagen'); }));
  // meters
  const mtf = $('#mtf');
  if (mtf) mtf.onsubmit = async (e) => { e.preventDefault(); if (await act(() => api('/api/meters', { method: 'POST', body: { from: $('#mFrom').value, to: $('#mTo').value } }), 'Meters toegevoegd')) reload(); };
  $$('[data-mtog]').forEach((b) => (b.onclick = async () => { if (await act(() => api('/api/meters/' + b.dataset.mtog, { method: 'PATCH', body: { active: b.dataset.v === '1' } }), 'Opgeslagen')) reload(); }));
  // regio's
  const pf2 = $('#pf2');
  if (pf2) pf2.onsubmit = async (e) => { e.preventDefault(); if (await act(() => api('/api/places', { method: 'POST', body: { name: $('#pN').value, region_id: $('#pR').value } }), 'Plaats opgeslagen')) reload(); };
  const rf2 = $('#rf2');
  if (rf2) rf2.onsubmit = async (e) => { e.preventDefault(); if (await act(() => api('/api/regions', { method: 'POST', body: { name: $('#rN').value } }), 'Regio toegevoegd')) reload(); };
  $$('[data-pdel]').forEach((b) => (b.onclick = async () => { if (await act(() => api('/api/places/' + encodeURIComponent(b.dataset.pdel), { method: 'DELETE' }), 'Plaats verwijderd')) reload(); }));
  // instellingen
  const sf2 = $('#sf2');
  if (sf2) sf2.onsubmit = async (e) => { e.preventDefault(); await act(() => api('/api/settings', { method: 'PUT', body: { control_hours: $('#sC').value, report_days: $('#sR').value } }), 'Opgeslagen'); };
  const ra = $('#runAlerts');
  if (ra) ra.onclick = async () => { const r = await act(() => api('/api/admin/run-alerts', { method: 'POST' })); if (r) { toast(`${r.created} nieuwe melding(en)`); updateBell(true); } };
  // e-mails
  $$('[data-mail]').forEach((tr) => (tr.onclick = async () => {
    const e = await act(() => api('/api/admin/emails/' + tr.dataset.mail));
    if (!e) return;
    drawer(`<div><div class="eyebrow">Aan ${esc(e.to_email)} · ${fmtDT(e.created_at)}</div><h1 style="font-size:20px">${esc(e.subject)}</h1>${e.error ? `<p class="err">${esc(e.error)}</p>` : ''}</div><iframe title="Voorbeeld e-mail" sandbox="allow-popups" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:8px;background:#fff" srcdoc="${esc(e.html)}"></iframe>`, 'E-mail');
  }));
}

// ---------- plaatser ----------
async function plaatserShell(inner) {
  $('#app').innerHTML = `<header class="top"><div class="wrap"><a class="logo" href="#/">${LOGO} NeighborNoise</a><button class="bell" id="bell" aria-label="Meldingen">${BELL}<span id="bellN" hidden></span></button><button class="linkbtn" id="logout">Uitloggen</button></div></header><div class="mobile" id="main">${inner}</div>`;
  $('#logout').onclick = logout; $('#bell').onclick = openNotifications; updateBell();
}
async function renderRonde() {
  await plaatserShell('<p class="muted">Laden…</p>');
  let d, n;
  try { [d, n] = await Promise.all([api('/api/my/tasks'), api('/api/notifications')]); } catch (e) { $('#main').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const todayT = d.tasks.filter((t) => t.done || t.date <= d.today);
  const done = todayT.filter((t) => t.done).length;
  const unread = n.items.filter((x) => !x.read_at).slice(0, 3);
  $('#main').innerHTML = `<div><div class="eyebrow">Hoi ${esc(state.me.name.split(' ')[0])}</div><h1>Jouw ronde</h1><p class="muted small">${fmtD(d.today)} · ${d.active_count} meter${d.active_count === 1 ? '' : 's'} in het veld</p></div>
   ${unread.map((x) => `<div class="nb ${x.severity === 'red' ? 'red' : ''}"><b>${esc(x.title)}</b><span class="muted">${esc(x.body || '')}</span></div>`).join('')}
   <div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px"><b>Vandaag: ${done} van ${todayT.length} gedaan</b><span class="muted">${todayT.length ? Math.round(done / todayT.length * 100) : 0}%</span></div><div class="prog"><i style="width:${todayT.length ? done / todayT.length * 100 : 0}%"></i></div></div>
   ${d.tasks.map((t) => { const dd = dayDiff(t.date, d.today), late = !t.done && dd < 0;
      return `<a class="task ${t.done ? 'done' : ''} ${late ? 'late' : ''}" href="#/plaatser/${t.m.id}"><span class="tag ${t.m.is_new && !t.done ? 'new' : ''}">${t.m.is_new && !t.done ? 'Nieuw' : t.type}</span><span class="t"><b>${esc(t.m.address)}</b><span>${esc(t.m.city)} · ${t.type === 'Ophalen' ? 'Meter ' + t.m.meter_id + ' · ' : ''}${t.done ? 'afgevinkt' : late ? `<span class="late-t">${-dd} dag${dd === -1 ? '' : 'en'} te laat</span>` : dd === 0 ? 'vandaag' : dd === 1 ? 'morgen' : fmtD(t.date)}</span></span><span aria-hidden="true">${t.done ? '✓' : '›'}</span></a>`; }).join('') || '<div class="card empty">Geen opdrachten in de komende dagen.</div>'}
   <div class="card" style="gap:4px"><span class="eyebrow">Mijn ${new Date(d.month.month + '-15').toLocaleDateString('nl-NL', { month: 'long' })}</span><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${d.month.placed} geplaatst · ${d.month.picked} opgehaald</b><b class="mono">${euro(d.month.total)}</b></div><span class="muted small">Telt automatisch mee. Je krijgt aan het eind van de maand een specificatie.</span></div>`;
}
async function renderTask(id) {
  await plaatserShell('<p class="muted">Laden…</p>');
  let d, free = [];
  try { d = await api('/api/measurements/' + id); } catch (e) { $('#main').innerHTML = `<a class="linkbtn" href="#/">‹ Terug</a><p class="err">${esc(e.message)}</p>`; return; }
  const m = d.measurement;
  if (m.is_new) api(`/api/measurements/${id}/seen`, { method: 'POST' }).catch(() => {});
  const type = m.stage === 0 ? 'Plaatsen' : m.stage === 1 ? 'Ophalen' : null;
  if (type === 'Plaatsen') free = (await api('/api/meters/free').catch(() => ({ meters: [] }))).meters;
  const list = type === 'Plaatsen' ? d.place_checklist : d.pickup_checklist;
  const f = { meter: null, chk: list ? list.map(() => false) : [], diary: null, noise: null, photos: 0 };
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${m.address}, ${m.postcode || ''} ${m.city}`)}`;
  const header = `<a class="linkbtn" href="#/" style="text-decoration:none;font-weight:600;color:var(--fg)">‹ Terug</a>
    <div><span class="muted small">${esc(m.corp_name)} · ${weken(m.duration_weeks)}${m.order_no ? ' · ' + esc(m.order_no) : ''}</span><h1 style="font-size:22px;margin-top:2px">${esc(m.address)}</h1><a class="muted small" href="${maps}" target="_blank" rel="noopener">${esc(m.postcode || '')} ${esc(m.city)} · open in kaart</a></div>
    <div class="contact"><div><b>${esc(m.resident_name || 'Bewoner')}</b><div class="mono muted">${esc(m.resident_phone || 'geen telefoonnummer')}</div></div>${m.resident_phone ? `<a class="btn ghost sm" href="tel:${esc(m.resident_phone)}">Bellen</a>` : ''}</div>
    ${m.remark ? `<div class="card" style="padding:12px;white-space:pre-line"><span class="eyebrow">Opmerking</span>${esc(m.remark)}</div>` : ''}`;
  if (!type) {
    $('#main').innerHTML = header + `<div class="card"><h2>Afgevinkt</h2><p class="muted small" style="margin:0">Geplaatst ${fmtDT(m.placed_at)}${m.picked_up_at ? ' · opgehaald ' + fmtDT(m.picked_up_at) : ''}. Peter neemt het vanaf hier over.</p></div>`;
    return;
  }
  const draw = () => {
    $('#main').innerHTML = header + `
    <div class="card" style="gap:4px"><span class="eyebrow">${type === 'Plaatsen' ? 'Plaatsen' : 'Ophalen'}</span><b>${type === 'Plaatsen' ? `Gepland ${fmtD(m.planned_place_date)}` : `Meter ${m.meter_id} · gepland ${fmtD(m.planned_pickup_date)}`}</b></div>
    <form class="form" id="tf">
      ${type === 'Plaatsen' ? `<div class="field"><span class="lbl">Welke meter plaats je?</span><div class="meterchips">${free.map((x) => `<button type="button" class="chip" data-meter="${x}" aria-pressed="${f.meter === x}">${x}</button>`).join('') || '<span class="err">Er zijn geen vrije meters. Neem contact op met Eric of Jacco.</span>'}</div></div>` : ''}
      <div class="field"><label for="tAt">Datum en tijd</label><input id="tAt" type="datetime-local" value="${localInput()}" max="${localInput(new Date(Date.now() + 3600e3))}"></div>
      <div class="field"><span class="lbl">Checklist ${type === 'Plaatsen' ? 'bij plaatsen' : 'bij ophalen'}</span><div class="chk">${list.map((c, i) => `<button type="button" data-ck="${i}" aria-pressed="${f.chk[i]}"><span class="box"></span><span>${esc(c)}${type === 'Plaatsen' && i === 4 ? ` <span class="muted">(${fmtD(new Date(Date.now() + 7 * m.duration_weeks * 864e5).toISOString())})</span>` : ''}</span></button>`).join('')}</div></div>
      ${type === 'Ophalen' ? `<div class="field"><span class="lbl">Dagboek aanwezig?</span><div class="seg"><button type="button" data-diary="ja" aria-pressed="${f.diary === 'ja'}">Ja</button><button type="button" data-diary="nee" aria-pressed="${f.diary === 'nee'}">Nee</button></div></div>
        <div class="field"><label class="btn ghost" style="cursor:pointer">📷 Foto van het dagboek${f.photos ? ` (${f.photos} geüpload)` : ''}<input id="tPhoto" type="file" accept="image/*" capture="environment" multiple hidden></label></div>
        <div class="field"><span class="lbl">Geluid gehoord tijdens je bezoek?</span><div class="seg"><button type="button" data-noise="1" aria-pressed="${f.noise === true}">Ja</button><button type="button" data-noise="0" aria-pressed="${f.noise === false}">Nee</button></div></div>` : ''}
      <div class="field"><label for="tRem">Bijzondere opmerkingen</label><textarea id="tRem" rows="3" placeholder="Bijv. meter in slaapkamer, bewoner alleen na 17:00 thuis"></textarea></div>
      <p class="err" id="tErr" hidden></p>
      <button class="big" type="submit">${type === 'Plaatsen' ? 'Geplaatst · insturen' : 'Opgehaald · insturen'}</button>
    </form>`;
    const keep = () => ({ at: $('#tAt').value, rem: $('#tRem').value });
    const restore = (k) => { $('#tAt').value = k.at; $('#tRem').value = k.rem; };
    const redraw = () => { const k = keep(); draw(); restore(k); };
    $$('[data-meter]').forEach((b) => (b.onclick = () => { f.meter = Number(b.dataset.meter); redraw(); }));
    $$('[data-ck]').forEach((b) => (b.onclick = () => { f.chk[b.dataset.ck] = !f.chk[b.dataset.ck]; redraw(); }));
    $$('[data-diary]').forEach((b) => (b.onclick = () => { f.diary = b.dataset.diary; redraw(); }));
    $$('[data-noise]').forEach((b) => (b.onclick = () => { f.noise = b.dataset.noise === '1'; redraw(); }));
    const ph = $('#tPhoto');
    if (ph) ph.onchange = async () => {
      const k = keep(); const fd = new FormData(); [...ph.files].forEach((x) => fd.append('file', x));
      toast('Foto uploaden…');
      const r = await act(() => api(`/api/measurements/${id}/photos`, { method: 'POST', form: fd }), 'Foto opgeslagen');
      if (r) { f.photos += r.count; if (!f.diary) f.diary = 'ja'; }
      draw(); restore(k);
    };
    $('#tf').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#tErr'), k = keep();
      const fail = (msg) => { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: 'center' }); };
      if (type === 'Plaatsen' && !f.meter) return fail('Kies welke meter je plaatst');
      if (f.chk.some((x) => !x)) return fail('Vink eerst de hele checklist af');
      if (type === 'Ophalen' && !f.diary) return fail('Geef aan of er een dagboek is');
      if (type === 'Ophalen' && f.noise === null) return fail('Geef aan of je geluid hebt gehoord');
      const at = k.at ? new Date(k.at).toISOString() : new Date().toISOString();
      const btn = $('#tf .big'); btn.disabled = true;
      try {
        if (type === 'Plaatsen') { const r = await api(`/api/measurements/${id}/place`, { method: 'POST', body: { meter_id: f.meter, at, checklist: f.chk, remark: k.rem } }); toast(`Geplaatst · ophalen ${fmtD(r.planned_pickup_date)}`); }
        else { await api(`/api/measurements/${id}/pickup`, { method: 'POST', body: { at, checklist: f.chk, diary: f.diary, noise_heard: f.noise, remark: k.rem } }); toast('Opgehaald · staat nu bij Peter'); }
        location.hash = '#/';
      } catch (x) { btn.disabled = false; fail(x.message); }
    };
  };
  draw();
}

// ---------- meldingen ----------
let pollT = null;
function startPolling() { if (!pollT) { updateBell(true); pollT = setInterval(() => updateBell(true), 60000); } }
function stopPolling() { clearInterval(pollT); pollT = null; state.lastNotif = 0; }
async function updateBell(fetchNew) {
  if (!state.me) return;
  if (fetchNew || !state.notifs) { try { state.notifs = await api('/api/notifications'); } catch { return; } }
  const el = $('#bellN');
  if (el) { el.textContent = state.notifs.unread || ''; el.hidden = !state.notifs.unread; }
  const newest = state.notifs.items[0]?.id || 0;
  const seenKey = 'nn_seen_' + state.me.id;
  let seen = 0; try { seen = Number(localStorage.getItem(seenKey) || 0); } catch {}
  const fresh = state.notifs.items.filter((x) => !x.read_at && x.id > seen).slice(0, 3);
  if (fresh.length && state.me.role !== 'plaatser') {
    $('#popups').innerHTML = fresh.map((x) => `<div class="pop ${x.severity === 'red' ? 'red' : ''}"><b>${esc(x.title)}</b><span class="muted">${esc(x.body || '')}</span></div>`).join('');
    clearTimeout(updateBell.t); updateBell.t = setTimeout(() => ($('#popups').innerHTML = ''), 7000);
  }
  try { localStorage.setItem(seenKey, String(Math.max(seen, newest))); } catch {}
}
async function openNotifications() {
  await updateBell(true);
  const n = state.notifs;
  drawer(`<div><div class="eyebrow">${esc(state.me.name)}</div><h1 style="font-size:22px">Meldingen</h1></div>
    <div class="btnrow"><button class="btn ghost sm" id="readAll" ${n.unread ? '' : 'disabled'}>Alles gelezen</button></div>
    <div class="nlist">${n.items.map((x) => `<button class="nitem ${x.read_at ? '' : 'unread'} ${x.severity === 'red' ? 'red' : ''}" data-n="${x.id}" data-m="${x.measurement_id || ''}"><span class="sev"></span><span><b>${esc(x.title)}</b><span class="muted">${esc(x.body || '')}</span><span class="muted small">${fmtDT(x.created_at)}</span></span></button>`).join('') || '<p class="muted">Nog geen meldingen.</p>'}</div>`, 'Meldingen');
  $('#readAll').onclick = async () => { await api('/api/notifications/read', { method: 'POST', body: {} }); await updateBell(true); openNotifications(); };
  $$('[data-n]').forEach((b) => (b.onclick = async () => {
    await api('/api/notifications/read', { method: 'POST', body: { ids: [Number(b.dataset.n)] } }).catch(() => {});
    updateBell(true);
    const mid = b.dataset.m;
    if (!mid) return;
    if (state.me.role === 'plaatser') location.hash = '#/plaatser/' + mid; else openMeasurement(Number(mid));
  }));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();
