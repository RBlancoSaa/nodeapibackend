// api/dashboard.js
// Volledig dashboard: opdrachten, email log, fouten en statistieken
// Beveiligd met ?token=<CRON_SECRET>
import { supabase } from '../services/supabaseClient.js';

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'short', timeStyle: 'short' });
}
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function badge(bron) {
  const cls = (bron || '').toLowerCase().replace(/\s+/g, '-');
  return `<span class="badge badge-${cls}">${esc(bron)}</span>`;
}
function statusPill(s) {
  const map = { OK:'ok', FOUT:'fout', verwerkt:'ok', fout:'fout', overgeslagen:'skip', update:'update', onbekend:'skip' };
  const cls = map[s] || 'skip';
  return `<span class="pill pill-${cls}">${esc(s)}</span>`;
}
function typePill(t) {
  const map = { transport:'tr', reservering:'res', update:'upd', onbekend:'unk' };
  const cls = map[t] || 'unk';
  return `<span class="pill pill-type-${cls}">${esc(t)}</span>`;
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  try {
  const token = req.query?.token || '';
  if (token !== (process.env.CRON_SECRET || '')) {
    res.status(401).send('Niet geautoriseerd');
    return;
  }

  // Filters
  const bronFilter    = req.query?.bron    || '';
  const statusFilter  = req.query?.status  || '';
  const typeFilter    = req.query?.type    || '';
  const zoekFilter    = (req.query?.zoek   || '').toLowerCase().trim();
  const dagenFilter   = parseInt(req.query?.dagen  || '30', 10);
  const activeTab     = req.query?.tab     || 'opdrachten';

  const cutoff = dagenFilter > 0
    ? new Date(Date.now() - dagenFilter * 86_400_000).toISOString()
    : null;

  // ── Ophalen opdrachten_log ────────────────────────────────────────────────
  let qOp = supabase
    .from('opdrachten_log')
    .select('*')
    .order('verwerkt_op', { ascending: false })
    .limit(1000);
  if (bronFilter)   qOp = qOp.eq('bron', bronFilter);
  if (statusFilter && (statusFilter === 'OK' || statusFilter === 'FOUT')) qOp = qOp.eq('status', statusFilter);
  if (cutoff)       qOp = qOp.gte('verwerkt_op', cutoff);
  const { data: opdrachten, error: opErr } = await qOp;
  if (opErr) { res.status(500).send(`Supabase fout (opdrachten): ${opErr.message}`); return; }

  // ── Ophalen verwerkingslog ────────────────────────────────────────────────
  let qVl = supabase
    .from('verwerkingslog')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (typeFilter)   qVl = qVl.eq('type', typeFilter);
  if (statusFilter === 'verwerkt' || statusFilter === 'fout' || statusFilter === 'overgeslagen') qVl = qVl.eq('status', statusFilter);
  if (cutoff)       qVl = qVl.gte('created_at', cutoff);
  const { data: verwLog } = await qVl;
  const emailLog = verwLog || [];

  // ── Unieke bronnen voor filter ────────────────────────────────────────────
  const { data: bronnenRij } = await supabase.from('opdrachten_log').select('bron').order('bron');
  const uniekeBronnen = [...new Set((bronnenRij || []).map(r => r.bron).filter(Boolean))];

  // ── Filter op zoekterm (client-side-achtig: server filtert) ──────────────
  const opRows = (opdrachten || []).filter(r => {
    if (!zoekFilter) return true;
    return [r.ritnummer, r.containernummer, r.klant_naam, r.klant_plaats, r.bron, r.laadreferentie]
      .some(v => (v || '').toLowerCase().includes(zoekFilter));
  });

  const vlRows = emailLog.filter(r => {
    if (!zoekFilter) return true;
    return [r.email_subject, r.email_van, r.klant, r.fout_melding]
      .some(v => (v || '').toLowerCase().includes(zoekFilter));
  });

  const foutRows = [
    ...opRows.filter(r => r.status === 'FOUT').map(r => ({
      _src: 'opdracht',
      ts:   r.verwerkt_op,
      bron: r.bron,
      subject: r.bestandsnaam || '',
      van:  r.afzender_email || '',
      detail: `${r.containernummer || r.ritnummer || ''} — ${r.klant_naam || ''}`,
      fout: r.foutmelding || '',
      raw:  r
    })),
    ...vlRows.filter(r => r.status === 'fout').map(r => ({
      _src: 'email',
      ts:   r.created_at,
      bron: r.klant || '?',
      subject: r.email_subject || '',
      van:  r.email_van || '',
      detail: r.type || '',
      fout: r.fout_melding || '',
      raw:  r
    }))
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totOp   = opRows.length;
  const okOp    = opRows.filter(r => r.status === 'OK').length;
  const foutOp  = opRows.filter(r => r.status === 'FOUT').length;
  const totVl   = vlRows.length;
  const verwerkt= vlRows.filter(r => r.status === 'verwerkt').length;
  const skip    = vlRows.filter(r => r.status === 'overgeslagen').length;
  const foutVl  = vlRows.filter(r => r.status === 'fout').length;

  // ── Bouw HTML ────────────────────────────────────────────────────────────
  const baseUrl = `?token=${encodeURIComponent(token)}&dagen=${dagenFilter}${bronFilter ? `&bron=${encodeURIComponent(bronFilter)}` : ''}${zoekFilter ? `&zoek=${encodeURIComponent(zoekFilter)}` : ''}`;

  function tabLink(tabId, label, count, hasAlert = false) {
    const active = activeTab === tabId;
    const url = `${baseUrl}&tab=${tabId}`;
    const alert = hasAlert && count > 0 ? ` <span class="tab-badge">${count}</span>` : '';
    return `<a href="${url}" class="tab${active ? ' tab-active' : ''}">${label}${alert}</a>`;
  }

  // ─ Tabel opdrachten ───────────────────────────────────────────────────────
  function opdrachtRows() {
    if (!opRows.length) return `<tr><td colspan="13" class="empty">Geen opdrachten gevonden</td></tr>`;
    return opRows.map(r => {
      const isOK = r.status === 'OK';
      const dataJson = esc(JSON.stringify({
        Datum:        fmt(r.verwerkt_op),
        Bron:         r.bron || '',
        Ritnummer:    r.ritnummer || '',
        Container:    r.containernummer || '',
        Type:         r.containertype || '',
        'L/L Datum':  r.datum || '',
        Klant:        r.klant_naam || '',
        Plaats:       r.klant_plaats || '',
        'Laad ref':   r.laadreferentie || '',
        'Inlever ref':r.inleverreferentie || '',
        Status:       r.status || '',
        'Easy bestand': r.easy_bestand || '',
        Afzender:     r.afzender_email || '',
        Bestandsnaam: r.bestandsnaam || '',
        Foutmelding:  r.foutmelding || ''
      }));
      return `<tr class="${isOK ? '' : 'row-fout'}" onclick="showDetail(this)" data-detail="${dataJson}" style="cursor:pointer">
        <td>${fmt(r.verwerkt_op)}</td>
        <td>${badge(r.bron)}</td>
        <td class="mono">${esc(r.ritnummer)}</td>
        <td class="mono">${esc(r.containernummer)}</td>
        <td>${esc(r.containertype)}</td>
        <td>${esc(r.datum)}</td>
        <td>${esc(r.klant_naam)}</td>
        <td>${esc(r.klant_plaats)}</td>
        <td class="ref">${esc(r.laadreferentie)}</td>
        <td class="ref">${esc(r.inleverreferentie)}</td>
        <td>${statusPill(r.status)}</td>
        <td class="easy">${esc(r.easy_bestand)}</td>
        <td class="fout-col">${esc((r.foutmelding || '').slice(0, 80))}</td>
      </tr>`;
    }).join('\n');
  }

  // ─ Tabel email log ────────────────────────────────────────────────────────
  function emailRows() {
    if (!vlRows.length) return `<tr><td colspan="7" class="empty">Geen log-entries gevonden</td></tr>`;
    return vlRows.map(r => {
      const dataJson = esc(JSON.stringify({
        Datum:       fmt(r.created_at),
        'Run ID':    r.run_id || '',
        Afzender:    r.email_van || '',
        Onderwerp:   r.email_subject || '',
        Type:        r.type || '',
        Klant:       r.klant || '',
        Status:      r.status || '',
        'Easy bestanden': Array.isArray(r.easy_bestanden) ? r.easy_bestanden.join(', ') : (r.easy_bestanden || ''),
        Foutmelding: r.fout_melding || ''
      }));
      return `<tr onclick="showDetail(this)" data-detail="${dataJson}" style="cursor:pointer" class="${r.status === 'fout' ? 'row-fout' : r.status === 'overgeslagen' ? 'row-skip' : ''}">
        <td>${fmt(r.created_at)}</td>
        <td class="vantd" title="${esc(r.email_van)}">${esc((r.email_van||'').split('@')[1] ? '@'+(r.email_van||'').split('@')[1] : r.email_van||'')}</td>
        <td class="subject">${esc((r.email_subject||'').slice(0,80))}</td>
        <td>${typePill(r.type)}</td>
        <td>${badge(r.klant || '?')}</td>
        <td>${statusPill(r.status)}</td>
        <td class="fout-col">${esc((r.fout_melding||'').slice(0,80))}</td>
      </tr>`;
    }).join('\n');
  }

  // ─ Tabel fouten ──────────────────────────────────────────────────────────
  function foutRowsHtml() {
    if (!foutRows.length) return `<tr><td colspan="6" class="empty">✅ Geen fouten gevonden in deze periode</td></tr>`;
    return foutRows.map(r => {
      const dataJson = esc(JSON.stringify(r.raw));
      return `<tr class="row-fout" onclick="showDetail(this)" data-detail="${dataJson}" style="cursor:pointer">
        <td>${fmt(r.ts)}</td>
        <td>${badge(r.bron)}</td>
        <td class="subject">${esc((r.subject||'').slice(0,60))}</td>
        <td class="van-td">${esc((r.van||'').slice(0,40))}</td>
        <td class="mono">${esc((r.detail||'').slice(0,60))}</td>
        <td class="fout-col red">${esc((r.fout||'').slice(0,120))}</td>
      </tr>`;
    }).join('\n');
  }

  // ─ Overzicht stats / recent ───────────────────────────────────────────────
  function overzichtContent() {
    const recentOp = opRows.slice(0, 5);
    const recentRecentHtml = recentOp.length
      ? recentOp.map(r => `<div class="recent-item">
          <div class="ri-left">${badge(r.bron)} <span class="ri-cntr mono">${esc(r.containernummer||r.ritnummer||'—')}</span></div>
          <div class="ri-mid">${esc(r.klant_naam||'—')} · ${esc(r.klant_plaats||'—')}</div>
          <div class="ri-right">${statusPill(r.status)} <span class="ri-time">${fmt(r.verwerkt_op)}</span></div>
        </div>`).join('')
      : '<div class="empty" style="padding:20px">Geen recente opdrachten</div>';

    // Per-bron statistieken
    const bronStats = {};
    for (const r of opRows) {
      const b = r.bron || 'Onbekend';
      if (!bronStats[b]) bronStats[b] = { ok: 0, fout: 0 };
      if (r.status === 'OK') bronStats[b].ok++;
      else bronStats[b].fout++;
    }
    const bronHtml = Object.entries(bronStats)
      .sort((a, b) => (b[1].ok + b[1].fout) - (a[1].ok + a[1].fout))
      .map(([b, s]) => `<div class="bron-stat">
        <div class="bs-left">${badge(b)}</div>
        <div class="bs-bar">
          <div class="bar-ok" style="width:${totOp ? Math.round(s.ok / (s.ok + s.fout) * 100) : 0}%"></div>
        </div>
        <div class="bs-nums"><span class="green">${s.ok} ok</span>${s.fout ? ` <span class="red">${s.fout} fout</span>` : ''}</div>
      </div>`).join('') || '<div class="empty" style="padding:10px">Geen data</div>';

    return `<div class="overzicht-grid">
      <div class="ov-section">
        <h3>Recente opdrachten</h3>
        <div class="recent-list">${recentRecentHtml}</div>
        <a href="${baseUrl}&tab=opdrachten" class="meer-link">Alle opdrachten →</a>
      </div>
      <div class="ov-section">
        <h3>Per opdrachtgever (${dagenFilter} dagen)</h3>
        <div class="bron-stats">${bronHtml}</div>
      </div>
    </div>`;
  }

  const bronOpties = uniekeBronnen.map(b =>
    `<option value="${b}" ${b === bronFilter ? 'selected' : ''}>${b}</option>`
  ).join('');
  const dagenOpties = [7, 14, 30, 90, 365].map(d =>
    `<option value="${d}" ${d === dagenFilter ? 'selected' : ''}>${d} d</option>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tiaro Transport — Dashboard</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f2f5; color: #1a1a2e; font-size: 13px; }

/* ── Header ── */
header { background: #0f172a; color: white; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; height: 52px; }
header .logo { font-size: 16px; font-weight: 700; letter-spacing: .3px; }
header .logo span { color: #38bdf8; }
.header-right { font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 14px; }
.auto-refresh-btn { background: none; border: 1px solid #334155; color: #94a3b8; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
.auto-refresh-btn.active { border-color: #38bdf8; color: #38bdf8; }

/* ── Tabs ── */
.tabs { background: #1e293b; display: flex; gap: 2px; padding: 0 24px; }
.tab { padding: 12px 18px; font-size: 12px; font-weight: 500; color: #94a3b8; text-decoration: none; border-bottom: 3px solid transparent; transition: all .15s; display: flex; align-items: center; gap: 6px; }
.tab:hover { color: white; }
.tab-active { color: white; border-bottom-color: #38bdf8; }
.tab-badge { background: #ef4444; color: white; font-size: 10px; padding: 1px 5px; border-radius: 10px; font-weight: 700; }

/* ── Stats bar ── */
.stats-bar { padding: 12px 24px; display: flex; gap: 10px; flex-wrap: wrap; border-bottom: 1px solid #e2e5ea; background: white; }
.stat { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
.stat .num { font-size: 20px; font-weight: 700; }
.stat .lbl { font-size: 11px; color: #64748b; }
.stat.ok  .num { color: #16a34a; }
.stat.err .num { color: #dc2626; }
.stat.skip .num { color: #d97706; }
.stat.tot  .num { color: #0f172a; }

/* ── Toolbar ── */
.toolbar { background: white; border-bottom: 1px solid #e2e5ea; padding: 8px 24px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.toolbar label { font-size: 12px; color: #64748b; }
.toolbar select, .toolbar input[type=text] { padding: 5px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; background: white; }
.toolbar select:focus, .toolbar input:focus { outline: 2px solid #38bdf8; border-color: transparent; }
.toolbar .search-wrap { display: flex; align-items: center; gap: 4px; flex: 1; max-width: 280px; }
.toolbar .search-wrap input { width: 100%; }
.btn { padding: 5px 14px; background: #0f172a; color: white; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; font-weight: 500; text-decoration: none; }
.btn:hover { background: #1e293b; }
.btn-ghost { background: none; border: 1px solid #cbd5e1; color: #64748b; }
.btn-ghost:hover { background: #f1f5f9; }

/* ── Tabel ── */
.table-wrap { padding: 16px 24px 24px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
thead tr { background: #0f172a; color: white; }
thead th { padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 600; letter-spacing: .6px; text-transform: uppercase; white-space: nowrap; }
tbody tr { border-bottom: 1px solid #f1f5f9; transition: background .1s; }
tbody tr:hover { background: #f8fafc; }
tbody tr:last-child { border-bottom: none; }
tbody tr.row-fout { background: #fff5f5; }
tbody tr.row-fout:hover { background: #ffe4e4; }
tbody tr.row-skip { background: #fffbeb; }
tbody tr.row-skip:hover { background: #fef3c7; }
td { padding: 7px 12px; vertical-align: middle; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.empty { text-align: center; padding: 40px; color: #94a3b8; }

/* ── Badges & Pills ── */
.badge { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 10px; font-weight: 700; }
.badge-dfds       { background: #dbeafe; color: #1d4ed8; }
.badge-jordex     { background: #d1fae5; color: #065f46; }
.badge-steinweg   { background: #fef3c7; color: #92400e; }
.badge-neelevat   { background: #f3e8ff; color: #6b21a8; }
.badge-ritra      { background: #ffe4e6; color: #9f1239; }
.badge-b2l        { background: #ffedd5; color: #9a3412; }
.badge-b2l-cargocare { background: #ffedd5; color: #9a3412; }
.badge-steder     { background: #e0f2fe; color: #0369a1; }
.badge-eimskip    { background: #ecfdf5; color: #065f46; }
.badge-reservering { background: #f0fdf4; color: #166534; }
.badge-steinweg-route1,.badge-steinweg-route2 { background: #fef3c7; color: #92400e; }
.badge- { background: #f1f5f9; color: #475569; }

.pill { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; }
.pill-ok      { background: #dcfce7; color: #15803d; }
.pill-fout    { background: #fee2e2; color: #b91c1c; }
.pill-skip    { background: #fef9c3; color: #854d0e; }
.pill-update  { background: #e0e7ff; color: #4338ca; }
.pill-type-tr  { background: #dbeafe; color: #1e40af; }
.pill-type-res { background: #d1fae5; color: #065f46; }
.pill-type-upd { background: #e0e7ff; color: #4338ca; }
.pill-type-unk { background: #f1f5f9; color: #64748b; }

.mono   { font-family: 'Consolas', monospace; font-size: 12px; }
.ref    { font-size: 12px; color: #475569; }
.easy   { font-size: 11px; color: #94a3b8; }
.fout-col { font-size: 11px; color: #b91c1c; max-width: 160px; }
.subject { max-width: 260px; color: #334155; }
.vantd  { color: #64748b; font-size: 12px; }
.red    { color: #b91c1c !important; }
.green  { color: #16a34a; }

/* ── Overzicht ── */
.overzicht-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 24px 24px; }
@media(max-width: 900px) { .overzicht-grid { grid-template-columns: 1fr; } }
.ov-section { background: white; border-radius: 10px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.ov-section h3 { font-size: 13px; font-weight: 600; margin-bottom: 14px; color: #0f172a; }
.recent-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9; gap: 8px; flex-wrap: wrap; }
.recent-item:last-child { border-bottom: none; }
.ri-left { display: flex; align-items: center; gap: 6px; }
.ri-cntr { color: #475569; font-size: 12px; }
.ri-mid  { flex: 1; color: #64748b; font-size: 12px; }
.ri-right { display: flex; align-items: center; gap: 6px; }
.ri-time { font-size: 11px; color: #94a3b8; }
.meer-link { display: inline-block; margin-top: 10px; font-size: 12px; color: #0ea5e9; text-decoration: none; }
.meer-link:hover { text-decoration: underline; }
.bron-stats { display: flex; flex-direction: column; gap: 8px; }
.bron-stat { display: flex; align-items: center; gap: 8px; }
.bs-left { min-width: 80px; }
.bs-bar { flex: 1; height: 8px; background: #fee2e2; border-radius: 4px; overflow: hidden; }
.bar-ok { height: 100%; background: #16a34a; border-radius: 4px; }
.bs-nums { font-size: 11px; min-width: 80px; text-align: right; }

/* ── Modal ── */
#modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 1000; justify-content: center; align-items: flex-start; padding: 40px 20px; overflow-y: auto; }
#modal-overlay.open { display: flex; }
#modal { background: white; border-radius: 12px; width: 100%; max-width: 680px; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
.modal-header { padding: 18px 22px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
.modal-header h2 { font-size: 15px; font-weight: 600; }
.modal-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #64748b; line-height: 1; }
.modal-close:hover { color: #0f172a; }
.modal-body { padding: 20px 22px; }
.detail-grid { display: grid; grid-template-columns: 160px 1fr; gap: 6px 12px; }
.detail-grid .lbl { font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; padding-top: 2px; }
.detail-grid .val { font-size: 13px; color: #1e293b; word-break: break-all; }
.detail-grid .val.fout-val { color: #b91c1c; font-weight: 500; }
.detail-sep { grid-column: 1/-1; border-top: 1px solid #f1f5f9; margin: 6px 0; }
</style>
</head>
<body>

<header>
  <div class="logo">🚛 Tiaro <span>Transport</span></div>
  <div class="header-right">
    <span>Dashboard</span>
    <button class="auto-refresh-btn" id="refreshBtn" onclick="toggleAutoRefresh()">⟳ Auto-refresh</button>
  </div>
</header>

<nav class="tabs">
  ${tabLink('overzicht',   '📊 Overzicht',  0)}
  ${tabLink('opdrachten',  '📦 Opdrachten', totOp)}
  ${tabLink('emaillog',    '📧 Email log',  totVl)}
  ${tabLink('fouten',      '❌ Fouten',     foutOp + foutVl, true)}
</nav>

<div class="stats-bar">
  <div class="stat tot"><div class="num">${totOp}</div><div class="lbl">Opdrachten</div></div>
  <div class="stat ok"> <div class="num">${okOp}</div>   <div class="lbl">Succesvol</div></div>
  <div class="stat err"><div class="num">${foutOp + foutVl}</div><div class="lbl">Fouten</div></div>
  <div class="stat tot"><div class="num">${totVl}</div><div class="lbl">Emails log</div></div>
  <div class="stat ok"> <div class="num">${verwerkt}</div><div class="lbl">Verwerkt</div></div>
  <div class="stat skip"><div class="num">${skip}</div>  <div class="lbl">Overgeslagen</div></div>
</div>

<div class="toolbar">
  <form method="GET" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%">
    <input type="hidden" name="token" value="${token}">
    <input type="hidden" name="tab" value="${activeTab}">
    <div class="search-wrap">
      <input type="text" name="zoek" placeholder="🔍 Zoeken..." value="${esc(zoekFilter)}" autocomplete="off">
    </div>
    <label>Bron:
      <select name="bron" onchange="this.form.submit()">
        <option value="">Alle</option>
        ${bronOpties}
      </select>
    </label>
    <label>Periode:
      <select name="dagen" onchange="this.form.submit()">
        ${dagenOpties}
      </select>
    </label>
    <button type="submit" class="btn">Filteren</button>
    <a class="btn btn-ghost" href="?token=${encodeURIComponent(token)}&tab=${activeTab}">Reset</a>
    <button type="button" class="btn btn-ghost" onclick="exportCsv()">⬇ CSV</button>
  </form>
</div>

<!-- ─── Tab: Overzicht ─── -->
<div id="tab-overzicht" class="tab-panel" style="display:${activeTab === 'overzicht' ? 'block' : 'none'}">
  ${overzichtContent()}
</div>

<!-- ─── Tab: Opdrachten ─── -->
<div id="tab-opdrachten" class="tab-panel" style="display:${activeTab === 'opdrachten' ? 'block' : 'none'}">
  <div class="table-wrap">
    <table id="tbl-opdrachten">
      <thead><tr>
        <th>Verwerkt op</th>
        <th>Bron</th>
        <th>Ritnummer</th>
        <th>Container</th>
        <th>Type</th>
        <th>L/L datum</th>
        <th>Klant</th>
        <th>Plaats</th>
        <th>Laad ref</th>
        <th>Inlever ref</th>
        <th>Status</th>
        <th>Easy bestand</th>
        <th>Foutmelding</th>
      </tr></thead>
      <tbody>${opdrachtRows()}</tbody>
    </table>
  </div>
</div>

<!-- ─── Tab: Email log ─── -->
<div id="tab-emaillog" class="tab-panel" style="display:${activeTab === 'emaillog' ? 'block' : 'none'}">
  <div class="table-wrap">
    <table id="tbl-emaillog">
      <thead><tr>
        <th>Datum</th>
        <th>Afzender</th>
        <th>Onderwerp</th>
        <th>Type</th>
        <th>Klant</th>
        <th>Status</th>
        <th>Foutmelding</th>
      </tr></thead>
      <tbody>${emailRows()}</tbody>
    </table>
  </div>
</div>

<!-- ─── Tab: Fouten ─── -->
<div id="tab-fouten" class="tab-panel" style="display:${activeTab === 'fouten' ? 'block' : 'none'}">
  <div class="table-wrap">
    <table id="tbl-fouten">
      <thead><tr>
        <th>Datum</th>
        <th>Bron</th>
        <th>Bestand / Onderwerp</th>
        <th>Afzender</th>
        <th>Detail</th>
        <th>Foutmelding</th>
      </tr></thead>
      <tbody>${foutRowsHtml()}</tbody>
    </table>
  </div>
</div>

<!-- ─── Detail Modal ─── -->
<div id="modal-overlay" onclick="closeModal(event)">
  <div id="modal">
    <div class="modal-header">
      <h2 id="modal-title">Detail</h2>
      <button class="modal-close" onclick="document.getElementById('modal-overlay').classList.remove('open')">✕</button>
    </div>
    <div class="modal-body" id="modal-body"></div>
  </div>
</div>

<script>
// ── Auto-refresh ────────────────────────────────────────────────────────────
let refreshTimer = null;
function toggleAutoRefresh() {
  const btn = document.getElementById('refreshBtn');
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
    btn.classList.remove('active');
    btn.textContent = '⟳ Auto-refresh';
  } else {
    refreshTimer = setInterval(() => location.reload(), 60000);
    btn.classList.add('active');
    btn.textContent = '⟳ Auto (60s)';
  }
}

// ── Detail Modal ─────────────────────────────────────────────────────────────
function showDetail(row) {
  try {
    const data = JSON.parse(row.getAttribute('data-detail'));
    const body = document.getElementById('modal-body');
    let html = '<div class="detail-grid">';
    for (const [k, v] of Object.entries(data)) {
      if (!v && v !== 0) continue;
      const isFout = k.toLowerCase().includes('fout') || k.toLowerCase().includes('fout');
      html += \`<div class="lbl">\${k}</div><div class="val\${isFout && v ? ' fout-val' : ''}"><span>\${String(v).replace(/</g,'&lt;')}</span></div>\`;
    }
    html += '</div>';
    body.innerHTML = html;
    document.getElementById('modal-title').textContent = data['Container'] || data['Onderwerp'] || 'Detail';
    document.getElementById('modal-overlay').classList.add('open');
  } catch(e) { console.error(e); }
}
function closeModal(e) {
  if (e.target.id === 'modal-overlay') document.getElementById('modal-overlay').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('modal-overlay').classList.remove('open'); });

// ── CSV export ───────────────────────────────────────────────────────────────
function exportCsv() {
  const activePanel = document.querySelector('.tab-panel[style*="block"]');
  const table = activePanel?.querySelector('table');
  if (!table) return;
  const rows = [...table.querySelectorAll('tr')];
  const csv = rows.map(r => [...r.querySelectorAll('th,td')].map(c => '"' + c.textContent.trim().replace(/"/g,'""') + '"').join(',')).join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\\uFEFF' + csv);
  a.download = 'tiaro-export-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).send(html);

  } catch (err) {
    console.error('❌ Dashboard crash:', err);
    res.status(500).send(`<pre>Dashboard fout:\n${err?.stack || err?.message || String(err)}</pre>`);
  }
}
