// api/dashboard.js
// Eenvoudig dashboard: lijst van alle verwerkte opdrachten.
// Beveiligd met ?token=<CRON_SECRET>
import '../utils/fsPatch.js';
import { supabase } from '../services/supabaseClient.js';

function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam', dateStyle: 'short', timeStyle: 'short' });
}

export default async function handler(req, res) {
  // Simpele tokencheck
  const token = req.query?.token || '';
  if (token !== (process.env.CRON_SECRET || '')) {
    res.status(401).send('Niet geautoriseerd');
    return;
  }

  // Filters uit querystring
  const bronFilter  = req.query?.bron  || '';
  const dagenFilter = parseInt(req.query?.dagen || '30', 10);

  // Data ophalen
  let query = supabase
    .from('opdrachten_log')
    .select('*')
    .order('verwerkt_op', { ascending: false })
    .limit(500);

  if (bronFilter)    query = query.eq('bron', bronFilter);
  if (dagenFilter > 0) {
    const cutoff = new Date(Date.now() - dagenFilter * 86_400_000).toISOString();
    query = query.gte('verwerkt_op', cutoff);
  }

  const { data: rijen, error } = await query;
  if (error) {
    res.status(500).send(`Supabase fout: ${error.message}`);
    return;
  }

  // Unieke bronnen voor filter-dropdown
  const { data: bronnen } = await supabase
    .from('opdrachten_log')
    .select('bron')
    .order('bron');
  const uniekeBronnen = [...new Set((bronnen || []).map(r => r.bron).filter(Boolean))];

  const rijen_ok   = (rijen || []).filter(r => r.status === 'OK').length;
  const rijen_fout = (rijen || []).filter(r => r.status === 'FOUT').length;

  const rows = (rijen || []).map(r => {
    const isOK   = r.status === 'OK';
    const rowCls = isOK ? '' : 'row-fout';
    return `<tr class="${rowCls}">
      <td>${fmt(r.verwerkt_op)}</td>
      <td><span class="badge badge-${(r.bron || '').toLowerCase()}">${r.bron || ''}</span></td>
      <td>${r.ritnummer || ''}</td>
      <td class="mono">${r.containernummer || ''}</td>
      <td>${r.containertype || ''}</td>
      <td>${r.datum || ''}</td>
      <td>${r.klant_naam || ''}</td>
      <td>${r.klant_plaats || ''}</td>
      <td class="ref">${r.laadreferentie || ''}</td>
      <td class="ref">${r.inleverreferentie || ''}</td>
      <td><span class="status ${isOK ? 'ok' : 'fout'}">${r.status}</span></td>
      <td class="easy">${r.easy_bestand || ''}</td>
    </tr>`;
  }).join('\n');

  const bronOpties = uniekeBronnen.map(b =>
    `<option value="${b}" ${b === bronFilter ? 'selected' : ''}>${b}</option>`
  ).join('');

  const dagenOpties = [7, 14, 30, 90, 365].map(d =>
    `<option value="${d}" ${d === dagenFilter ? 'selected' : ''}>${d} dagen</option>`
  ).join('');

  const baseUrl = `?token=${encodeURIComponent(token)}`;

  const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tiaro Transport — Opdrachten dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f2f5; color: #1a1a2e; font-size: 13px; }

  header { background: #1a1a2e; color: white; padding: 14px 24px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 18px; font-weight: 600; letter-spacing: .3px; }
  header .sub { font-size: 12px; opacity: .6; margin-top: 2px; }

  .toolbar { background: white; border-bottom: 1px solid #e2e5ea; padding: 10px 24px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .toolbar label { font-size: 12px; color: #666; }
  .toolbar select { padding: 5px 10px; border: 1px solid #cdd1d9; border-radius: 5px; font-size: 12px; background: white; cursor: pointer; }
  .toolbar select:focus { outline: 2px solid #3b82f6; border-color: transparent; }
  .toolbar .btn-refresh { padding: 5px 14px; background: #3b82f6; color: white; border: none; border-radius: 5px; font-size: 12px; cursor: pointer; font-weight: 500; text-decoration: none; }
  .toolbar .btn-refresh:hover { background: #2563eb; }

  .stats { padding: 12px 24px; display: flex; gap: 12px; flex-wrap: wrap; }
  .stat { background: white; border-radius: 8px; padding: 10px 18px; box-shadow: 0 1px 3px rgba(0,0,0,.07); }
  .stat .num { font-size: 22px; font-weight: 700; color: #1a1a2e; }
  .stat .lbl { font-size: 11px; color: #888; margin-top: 2px; }
  .stat.ok  .num { color: #16a34a; }
  .stat.fout .num { color: #dc2626; }

  .table-wrap { padding: 0 24px 24px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.07); }
  thead tr { background: #1a1a2e; color: white; }
  thead th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .4px; text-transform: uppercase; white-space: nowrap; }
  tbody tr { border-bottom: 1px solid #f0f2f5; transition: background .1s; }
  tbody tr:hover { background: #f7f9fc; }
  tbody tr:last-child { border-bottom: none; }
  tbody tr.row-fout { background: #fff5f5; }
  tbody tr.row-fout:hover { background: #ffe4e4; }
  td { padding: 8px 12px; vertical-align: middle; white-space: nowrap; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-dfds      { background: #dbeafe; color: #1d4ed8; }
  .badge-jordex    { background: #d1fae5; color: #065f46; }
  .badge-steinweg  { background: #fef3c7; color: #92400e; }
  .badge-neelevat  { background: #f3e8ff; color: #6b21a8; }
  .badge-ritra     { background: #ffe4e6; color: #9f1239; }
  .badge-b2l       { background: #ffedd5; color: #9a3412; }
  .badge-steder    { background: #e0f2fe; color: #0369a1; }

  .status { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .status.ok   { background: #dcfce7; color: #15803d; }
  .status.fout { background: #fee2e2; color: #b91c1c; }

  .mono { font-family: 'Consolas', monospace; font-size: 12px; }
  .ref  { font-size: 12px; color: #555; }
  .easy { font-size: 11px; color: #888; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }

  .empty { text-align: center; padding: 48px; color: #999; }
</style>
</head>
<body>

<header>
  <div>
    <h1>🚛 Tiaro Transport — Opdrachten</h1>
    <div class="sub">Automatisch verwerkte transportopdrachten</div>
  </div>
</header>

<div class="toolbar">
  <form method="GET" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
    <input type="hidden" name="token" value="${token}">
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
    <a class="btn-refresh" href="${baseUrl}${bronFilter ? `&bron=${bronFilter}` : ''}&dagen=${dagenFilter}">↻ Vernieuwen</a>
  </form>
</div>

<div class="stats">
  <div class="stat">
    <div class="num">${(rijen || []).length}</div>
    <div class="lbl">Totaal opdrachten</div>
  </div>
  <div class="stat ok">
    <div class="num">${rijen_ok}</div>
    <div class="lbl">Succesvol</div>
  </div>
  <div class="stat fout">
    <div class="num">${rijen_fout}</div>
    <div class="lbl">Met fouten</div>
  </div>
  <div class="stat">
    <div class="num">${[...new Set((rijen || []).map(r => r.bron).filter(Boolean))].length}</div>
    <div class="lbl">Bronnen</div>
  </div>
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Verwerkt op</th>
        <th>Bron</th>
        <th>Ritnummer</th>
        <th>Container nr</th>
        <th>Type</th>
        <th>L/L datum</th>
        <th>Klant</th>
        <th>Plaats</th>
        <th>Laad ref</th>
        <th>Inlever ref</th>
        <th>Status</th>
        <th>Easy bestand</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="12" class="empty">Geen opdrachten gevonden</td></tr>`}
    </tbody>
  </table>
</div>

</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
