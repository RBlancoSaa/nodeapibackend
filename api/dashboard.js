// api/dashboard.js  –  Romy HQ frontend
import { supabase } from '../services/supabaseClient.js';

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('nl-NL', {
    timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('nl-NL', {
    timeZone: 'Europe/Amsterdam', day: '2-digit', month: 'short', year: 'numeric'
  });
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function ago(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'zojuist';
  if (m < 60) return `${m}m geleden`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}u geleden`;
  return `${Math.floor(h / 24)}d geleden`;
}

const BRON_COLORS = {
  jordex:    '#10b981', dfds:      '#3b82f6', steinweg:  '#f59e0b',
  neelevat:  '#8b5cf6', ritra:     '#ef4444', b2l:       '#f97316',
  steder:    '#06b6d4', eimskip:   '#14b8a6', easyfresh: '#84cc16',
  kwe:       '#ec4899',
};
function bronDot(bron) {
  const c = BRON_COLORS[(bron||'').toLowerCase()] || '#94a3b8';
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:6px;flex-shrink:0"></span>`;
}
function bronBadge(bron) {
  const c = BRON_COLORS[(bron||'').toLowerCase()] || '#94a3b8';
  const bg = c + '22';
  return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:${bg};color:${c}">${bronDot(bron)}${esc(bron||'?')}</span>`;
}
function statusChip(s) {
  const map = {
    OK:          ['#dcfce7','#16a34a','✓'],
    FOUT:        ['#fee2e2','#dc2626','✕'],
    verwerkt:    ['#dcfce7','#16a34a','✓'],
    fout:        ['#fee2e2','#dc2626','✕'],
    overgeslagen:['#fef9c3','#92400e','—'],
    update:      ['#e0e7ff','#4338ca','↑'],
    onbekend:    ['#f1f5f9','#64748b','?'],
  };
  const [bg, color, icon] = map[s] || ['#f1f5f9','#64748b','?'];
  return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:${bg};color:${color}">${icon} ${esc(s)}</span>`;
}

export default async function handler(req, res) {
  try {
    const token = req.query?.token || '';
    if (token !== (process.env.CRON_SECRET || '')) {
      res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Romy HQ</title>
      <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;color:white}
      .box{text-align:center}.logo{font-size:32px;font-weight:800;margin-bottom:8px}.logo span{color:#6366f1}
      p{color:#94a3b8;margin-bottom:24px}input{padding:10px 16px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:white;font-size:14px;width:280px}
      button{margin-left:8px;padding:10px 20px;background:#6366f1;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600}
      </style></head><body><div class="box"><div class="logo">Romy <span>HQ</span></div>
      <p>Voer je toegangstoken in</p>
      <form method="GET"><input type="password" name="token" placeholder="Token..." autofocus>
      <button type="submit">Inloggen</button></form></div></body></html>`);
      return;
    }

    const periode = req.query?.periode || 'deze-maand';
    const tab     = req.query?.tab    || 'runs';
    const zoek    = (req.query?.zoek  || '').toLowerCase().trim();
    const base    = `?token=${encodeURIComponent(token)}`;

    // ── Periode → cutoff berekenen ───────────────────────────────────────────
    function periodeLabel(p) {
      return { vandaag:'Vandaag', gisteren:'Gisteren', 'deze-week':'Deze week',
               'vorige-week':'Vorige week', 'deze-maand':'Deze maand',
               'vorige-maand':'Vorige maand', alles:'Alles' }[p] || 'Deze maand';
    }
    function periodeCutoffs(p) {
      const now = new Date();
      const ams = d => new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
      const today = ams(now);
      today.setHours(0, 0, 0, 0);
      if (p === 'vandaag') {
        return { from: today.toISOString(), to: null };
      }
      if (p === 'gisteren') {
        const van = new Date(today); van.setDate(van.getDate() - 1);
        return { from: van.toISOString(), to: today.toISOString() };
      }
      if (p === 'deze-week') {
        const van = new Date(today);
        van.setDate(van.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
        return { from: van.toISOString(), to: null };
      }
      if (p === 'vorige-week') {
        const eind = new Date(today);
        eind.setDate(eind.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
        const van  = new Date(eind); van.setDate(van.getDate() - 7);
        return { from: van.toISOString(), to: eind.toISOString() };
      }
      if (p === 'deze-maand') {
        const van = new Date(today); van.setDate(1);
        return { from: van.toISOString(), to: null };
      }
      if (p === 'vorige-maand') {
        const eind = new Date(today); eind.setDate(1);
        const van  = new Date(eind); van.setMonth(van.getMonth() - 1);
        return { from: van.toISOString(), to: eind.toISOString() };
      }
      return { from: null, to: null }; // alles
    }
    const { from: cutoff, to: cutoffTo } = periodeCutoffs(periode);

    // ── Prijsafspraken ophalen (altijd, ongeacht periode) ────────────────────
    const { data: paRaw } = await supabase
      .from('prijsafspraken').select('*').order('klant');
    const prijsafspraken = paRaw || [];

    // ── Data ophalen ─────────────────────────────────────────────────────────
    let qOp = supabase.from('opdrachten_log').select('*')
      .order('verwerkt_op', { ascending: false }).limit(1000);
    if (cutoff)   qOp = qOp.gte('verwerkt_op', cutoff);
    if (cutoffTo) qOp = qOp.lt('verwerkt_op', cutoffTo);
    const { data: opRaw } = await qOp;

    let qVl = supabase.from('verwerkingslog').select('*')
      .order('created_at', { ascending: false }).limit(1000);
    if (cutoff)   qVl = qVl.gte('created_at', cutoff);
    if (cutoffTo) qVl = qVl.lt('created_at', cutoffTo);
    const { data: vlRaw } = await qVl;

    const opdrachten = opRaw || [];
    const emails     = vlRaw || [];

    // ── Filter ───────────────────────────────────────────────────────────────
    const opFiltered = zoek ? opdrachten.filter(r =>
      [r.ritnummer, r.containernummer, r.klant_naam, r.klant_plaats, r.bron, r.easy_bestand, r.laadreferentie]
        .some(v => (v||'').toLowerCase().includes(zoek))
    ) : opdrachten;

    const vlFiltered = zoek ? emails.filter(r =>
      [r.email_subject, r.email_van, r.klant, r.fout_melding]
        .some(v => (v||'').toLowerCase().includes(zoek))
    ) : emails;

    // ── Stats ────────────────────────────────────────────────────────────────
    const totOp      = opFiltered.length;
    const okOp       = opFiltered.filter(r => r.status === 'OK').length;
    const foutOp     = opFiltered.filter(r => r.status === 'FOUT').length;
    const totVl      = vlFiltered.length;
    const verwerktVl = vlFiltered.filter(r => r.status === 'verwerkt').length;
    const skipVl     = vlFiltered.filter(r => r.status === 'overgeslagen').length;
    const foutVl     = vlFiltered.filter(r => r.status === 'fout').length;

    // TO's (easy bestanden)
    const allTOs = opFiltered.filter(r => r.easy_bestand && r.status === 'OK').map(r => r.easy_bestand);
    const totTO  = allTOs.length;

    // ── Runs (gegroepeerd op run_id) ─────────────────────────────────────────
    const runMap = new Map();
    for (const e of vlFiltered) {
      const rid = e.run_id || 'onbekend';
      if (!runMap.has(rid)) runMap.set(rid, { id: rid, ts: e.created_at, emails: [] });
      runMap.get(rid).emails.push(e);
    }
    const runs = [...runMap.values()].slice(0, 20);

    // ── Bronnen voor filter ──────────────────────────────────────────────────
    const bronnen = [...new Set(opdrachten.map(r => r.bron).filter(Boolean))].sort();

    // ── Per-bron stats ───────────────────────────────────────────────────────
    const bronStats = {};
    for (const r of opFiltered) {
      const b = (r.bron || 'onbekend').toLowerCase();
      if (!bronStats[b]) bronStats[b] = { ok: 0, fout: 0, naam: r.bron || 'onbekend' };
      r.status === 'OK' ? bronStats[b].ok++ : bronStats[b].fout++;
    }

    // ── HTML bouwers ─────────────────────────────────────────────────────────

    function statsBar() {
      const cards = [
        { n: totTO,      l: 'TO\'s aangemaakt', icon: '📄', accent: '#6366f1' },
        { n: okOp,       l: 'Verwerkt',         icon: '✅', accent: '#10b981' },
        { n: foutOp + foutVl, l: 'Fouten',      icon: '⚠️', accent: '#ef4444' },
        { n: skipVl,     l: 'Overgeslagen',      icon: '⏭',  accent: '#f59e0b' },
        { n: totVl,      l: 'Emails gelezen',    icon: '📧', accent: '#3b82f6' },
        { n: totOp,      l: 'Opdrachten',        icon: '📦', accent: '#8b5cf6' },
      ];
      return cards.map(c => `
        <div class="stat-card">
          <div class="stat-icon">${c.icon}</div>
          <div class="stat-num" style="color:${c.accent}">${c.n}</div>
          <div class="stat-lbl">${c.l}</div>
        </div>`).join('');
    }

    function runsList() {
      if (!runs.length) return `<div class="empty">Geen runs gevonden voor periode: ${periodeLabel(periode)}</div>`;
      return runs.map(run => {
        const verwerkt   = run.emails.filter(e => e.status === 'verwerkt');
        const overgeslagen = run.emails.filter(e => e.status === 'overgeslagen');
        const fouten     = run.emails.filter(e => e.status === 'fout');
        const tos        = verwerkt.flatMap(e => Array.isArray(e.easy_bestanden) ? e.easy_bestanden : (e.easy_bestanden ? [e.easy_bestanden] : []));

        return `<div class="run-card">
          <div class="run-header">
            <div class="run-meta">
              <span class="run-time">${fmt(run.ts)}</span>
              <span class="run-ago">${ago(run.ts)}</span>
            </div>
            <div class="run-chips">
              ${verwerkt.length ? `<span class="chip chip-ok">✓ ${verwerkt.length} verwerkt</span>` : ''}
              ${fouten.length ? `<span class="chip chip-err">✕ ${fouten.length} fout</span>` : ''}
              ${overgeslagen.length ? `<span class="chip chip-skip">— ${overgeslagen.length} overgeslagen</span>` : ''}
            </div>
          </div>
          ${tos.length ? `<div class="run-tos">${tos.map(t => `<span class="to-tag">📄 ${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="run-emails">
            ${run.emails.map(e => {
              const isOk   = e.status === 'verwerkt';
              const isErr  = e.status === 'fout';
              const isSkip = e.status === 'overgeslagen';
              const dot    = isOk ? '🟢' : isErr ? '🔴' : '⚪';
              return `<div class="run-email ${isErr ? 'email-err' : isSkip ? 'email-skip' : ''}">
                <span class="run-email-dot">${dot}</span>
                <span class="run-email-van">${esc((e.email_van||'').replace(/^"([^"]+)".*/, '$1').trim())}</span>
                <span class="run-email-sub">${esc((e.email_subject||'').slice(0,70))}</span>
                ${e.klant ? bronBadge(e.klant) : ''}
                ${isErr ? `<span class="run-email-err" title="${esc(e.fout_melding||'')}">⚠ ${esc((e.fout_melding||'').slice(0,50))}</span>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('');
    }

    function opdrachtenTable() {
      if (!opFiltered.length) return `<div class="empty">Geen opdrachten gevonden</div>`;
      return `<div class="table-wrap"><table>
        <thead><tr>
          <th>Datum</th><th>Bron</th><th>Container</th><th>Type</th>
          <th>Klant</th><th>Plaats</th><th>Laad datum</th>
          <th>TO bestand</th><th>Status</th><th>Fout</th>
        </tr></thead>
        <tbody>
        ${opFiltered.map(r => `<tr class="${r.status !== 'OK' ? 'row-err' : ''}">
          <td class="td-time">${fmt(r.verwerkt_op)}</td>
          <td>${bronBadge(r.bron)}</td>
          <td class="td-mono">${esc(r.containernummer||r.ritnummer||'—')}</td>
          <td class="td-type">${esc(r.containertype||'')}</td>
          <td class="td-klant">${esc(r.klant_naam||'—')}</td>
          <td class="td-plaats">${esc(r.klant_plaats||'—')}</td>
          <td class="td-datum">${esc(r.datum||'—')}</td>
          <td class="td-to">${r.easy_bestand ? `<span class="to-inline">📄 ${esc(r.easy_bestand)}</span>` : '<span class="td-empty">—</span>'}</td>
          <td>${statusChip(r.status)}</td>
          <td class="td-fout">${esc((r.foutmelding||'').slice(0,60))}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>`;
    }

    function overgeslagenTable() {
      const rows = vlFiltered.filter(r => r.status === 'overgeslagen');
      if (!rows.length) return `<div class="empty">Geen overgeslagen emails in deze periode ✅</div>`;
      return `<div class="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Afzender</th><th>Onderwerp</th><th>Type</th></tr></thead>
        <tbody>
        ${rows.map(r => `<tr class="row-skip">
          <td class="td-time">${fmt(r.created_at)}</td>
          <td class="td-van">${esc((r.email_van||'').replace(/^"([^"]+)".*/, '$1').trim())}</td>
          <td class="td-sub">${esc((r.email_subject||'').slice(0,80))}</td>
          <td><span class="type-badge">${esc(r.type||'onbekend')}</span></td>
        </tr>`).join('')}
        </tbody>
      </table></div>`;
    }

    function foutenTable() {
      const opFouten = opFiltered.filter(r => r.status === 'FOUT');
      const vlFouten = vlFiltered.filter(r => r.status === 'fout');
      if (!opFouten.length && !vlFouten.length) return `<div class="empty">Geen fouten gevonden ✅</div>`;
      return `<div class="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Bron</th><th>Onderwerp / Bestand</th><th>Foutmelding</th></tr></thead>
        <tbody>
        ${opFouten.map(r => `<tr class="row-err">
          <td class="td-time">${fmt(r.verwerkt_op)}</td>
          <td>${bronBadge(r.bron)}</td>
          <td class="td-sub">${esc(r.bestandsnaam||r.containernummer||'—')}</td>
          <td class="td-fout-big">${esc(r.foutmelding||'')}</td>
        </tr>`).join('')}
        ${vlFouten.map(r => `<tr class="row-err">
          <td class="td-time">${fmt(r.created_at)}</td>
          <td>${bronBadge(r.klant||'?')}</td>
          <td class="td-sub">${esc((r.email_subject||'').slice(0,70))}</td>
          <td class="td-fout-big">${esc(r.fout_melding||'')}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>`;
    }

    function bronOverzicht() {
      const entries = Object.entries(bronStats).sort((a,b) => (b[1].ok+b[1].fout)-(a[1].ok+a[1].fout));
      if (!entries.length) return `<div class="empty">Geen data</div>`;
      return entries.map(([key, s]) => {
        const tot  = s.ok + s.fout;
        const pct  = tot ? Math.round(s.ok / tot * 100) : 0;
        const c    = BRON_COLORS[key] || '#94a3b8';
        return `<div class="bron-row">
          <div class="bron-label">${bronBadge(s.naam)}</div>
          <div class="bron-bar-wrap">
            <div class="bron-bar-bg">
              <div class="bron-bar-fill" style="width:${pct}%;background:${c}"></div>
            </div>
          </div>
          <div class="bron-nums">
            <span style="color:#10b981;font-weight:600">${s.ok}</span>
            ${s.fout ? `<span style="color:#ef4444"> / ${s.fout} fout</span>` : ''}
            <span style="color:#94a3b8;font-size:10px"> (${pct}%)</span>
          </div>
        </div>`;
      }).join('');
    }

    const TABS = [
      { id: 'runs',            label: 'Runs',          icon: '⚡' },
      { id: 'opdrachten',      label: 'Opdrachten',    icon: '📦', count: totOp },
      { id: 'overgeslagen',    label: 'Overgeslagen',  icon: '⏭',  count: skipVl },
      { id: 'fouten',          label: 'Fouten',        icon: '⚠️', count: foutOp + foutVl, alert: true },
      { id: 'prijsafspraken',  label: 'Tarieven',      icon: '💶' },
    ];

    function tabNav() {
      return TABS.map(t => {
        const active = tab === t.id;
        const badge  = t.count !== undefined
          ? `<span class="tab-cnt ${t.alert && t.count > 0 ? 'tab-cnt-err' : ''}">${t.count}</span>`
          : '';
        return `<a href="${base}&periode=${periode}&tab=${t.id}${zoek ? '&zoek='+encodeURIComponent(zoek) : ''}"
          class="tab-btn ${active ? 'tab-active' : ''}">${t.icon} ${t.label}${badge}</a>`;
      }).join('');
    }

    // ── Tarieven / Prijsafspraken tab ────────────────────────────────────────
    const DEFAULTS_PA = {
      diesel:     { chart: 9,    label: 'Diesel',        actief: true  },
      delta:      { chart: 28.5, label: 'ECT Delta',     actief: true  },
      euromax:    { chart: 28.5, label: 'Euromax',       actief: true  },
      rwg:        { chart: 31,   label: 'RWG',           actief: true  },
      adr:        { chart: 0,    label: 'ADR',           actief: false },
      genset:     { chart: 0,    label: 'Genset',        actief: false },
      gasmeten:   { chart: 0,    label: 'Gasmeten',      actief: false },
      extra_stop: { chart: 0,    label: 'Extra stop',    actief: false },
      botlek:     { chart: 0,    label: 'Botlek',        actief: false },
      wacht_uur:  { chart: 0,    label: 'Wachtuur',      actief: false },
      blanco1:    { chart: 0,    label: 'Blanco 1',      actief: false, hasText: true },
      blanco2:    { chart: 0,    label: 'Blanco 2',      actief: false, hasText: true },
    };
    const PA_KEYS = Object.keys(DEFAULTS_PA);

    // Historische medianen uit oudedata (all-in referentiewaarden)
    const PA_HINTS = {
      steinweg: '📊 Historisch (all-in): ECT Delta 20ft €189 · Botlek 20ft €80-94 · RWG €183',
      jordex:   '📊 Historisch (all-in): ECT Delta 45ft €425 · RWG 45ft €454 · ECT Delta 20ft €308',
      dfds:     '📊 Historisch (all-in): ECT Delta 45ft €250 · ECT Delta 20ft €268 · RWG €282',
      neelevat: '📊 Historisch (all-in): ECT Delta 20ft €231 · RWG €230',
      b2l:      '📊 Historisch (all-in): ECT Delta 45ft €406 · Matrans 45ft €455',
      ritra:    '📊 Historisch (all-in): ECT Delta 45ft €460 · Matrans 45ft €290',
    };

    function prijsafsprakenTab() {
      const rows = prijsafspraken.length
        ? prijsafspraken
        : [{ klant: '(geen data)', velden: {}, all_in: false }];

      const cards = rows.map(pa => {
        const klant  = pa.klant || '?';
        const allIn  = !!pa.all_in;
        const velden = { ...DEFAULTS_PA, ...(pa.velden || {}) };
        const hint   = PA_HINTS[klant.toLowerCase()] || '';
        const c      = BRON_COLORS[klant.toLowerCase()] || '#94a3b8';
        const bg     = c + '18';

        const veldenJson = esc(JSON.stringify(velden));
        const fieldRows  = PA_KEYS.map(key => {
          const v     = velden[key] || DEFAULTS_PA[key];
          const def   = DEFAULTS_PA[key];
          const label = def?.label || key;
          const actief = !!v.actief;
          const chart  = v.chart ?? def?.chart ?? 0;
          const text   = v.text ?? '';
          const hasText = !!def?.hasText;

          return `<tr class="pa-field-row ${actief ? '' : 'pa-inactive'}">
            <td class="pa-label">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" class="pa-actief" data-key="${key}" ${actief ? 'checked' : ''}
                  onchange="paToggle('${klant}','${key}',this.checked)">
                ${label}
              </label>
            </td>
            <td class="pa-amount">
              <input type="number" step="0.01" min="0" class="pa-chart" data-key="${key}"
                value="${chart}" ${actief ? '' : 'disabled'}
                onchange="paChange('${klant}','${key}',this.value)"
                style="width:80px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;text-align:right">
            </td>
            ${hasText ? `<td class="pa-text-cell">
              <input type="text" class="pa-text" data-key="${key}" value="${esc(text)}" placeholder="omschrijving"
                ${actief ? '' : 'disabled'}
                onchange="paTextChange('${klant}','${key}',this.value)"
                style="width:120px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">
            </td>` : '<td></td>'}
          </tr>`;
        }).join('');

        return `<div class="pa-card" id="pa-card-${esc(klant)}" data-klant="${esc(klant)}"
          data-velden="${veldenJson}" data-allin="${allIn ? '1' : '0'}">
          <div class="pa-card-header" style="background:${bg};border-left:4px solid ${c}">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              ${bronBadge(klant)}
              <label class="pa-allin-toggle" title="All-in = geen terminal toeslag apart berekend">
                <input type="checkbox" class="pa-allin-cb" ${allIn ? 'checked' : ''}
                  onchange="paAllIn('${klant}',this.checked)">
                <span class="pa-allin-label">All-in</span>
                <span class="pa-allin-hint">(terminal toeslagen = €0)</span>
              </label>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="pa-save-msg" id="pa-msg-${esc(klant)}" style="display:none;font-size:11px;color:#10b981;font-weight:600">✓ Opgeslagen</span>
              <button class="pa-save-btn" onclick="paSave('${esc(klant)}','${esc(token)}')">💾 Opslaan</button>
            </div>
          </div>
          ${hint ? `<div class="pa-hint">${esc(hint)}</div>` : ''}
          <div class="pa-table-wrap">
            <table class="pa-table">
              <thead><tr>
                <th>Toeslag</th><th style="text-align:right">Bedrag (€)</th><th>Omschrijving</th>
              </tr></thead>
              <tbody>${fieldRows}</tbody>
            </table>
          </div>
        </div>`;
      }).join('');

      return `<div class="pa-intro">
        <p>Pas hier per klant de toeslagen aan. Klik op <strong>Opslaan</strong> om op te slaan in Supabase. Wijzigingen worden direct gebruikt bij de volgende verwerking.</p>
      </div>
      <div class="pa-grid">${cards}</div>`;
    }

    function tabContent() {
      switch (tab) {
        case 'runs':           return `<div class="runs-list">${runsList()}</div>`;
        case 'opdrachten':     return opdrachtenTable();
        case 'overgeslagen':   return overgeslagenTable();
        case 'fouten':         return foutenTable();
        case 'prijsafspraken': return prijsafsprakenTab();
        default:               return opdrachtenTable();
      }
    }

    const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Romy HQ</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; font-size: 13px; min-height: 100vh; }

/* ── Sidebar ── */
.layout    { display: flex; min-height: 100vh; }
.sidebar   { width: 220px; background: #0f172a; display: flex; flex-direction: column; flex-shrink: 0; position: sticky; top: 0; height: 100vh; }
.sb-logo   { padding: 24px 20px 20px; border-bottom: 1px solid #1e293b; }
.sb-logo-text { font-size: 22px; font-weight: 800; color: white; letter-spacing: -.5px; }
.sb-logo-text span { color: #6366f1; }
.sb-logo-sub { font-size: 10px; color: #475569; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
.sb-nav    { padding: 16px 12px; flex: 1; }
.sb-section { font-size: 10px; color: #475569; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; padding: 8px 8px 4px; }
.sb-link   { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; color: #94a3b8; text-decoration: none; font-size: 13px; font-weight: 500; transition: all .15s; margin-bottom: 2px; }
.sb-link:hover { background: #1e293b; color: white; }
.sb-link.active { background: #6366f1; color: white; }
.sb-link .sb-cnt { margin-left: auto; background: rgba(255,255,255,.15); padding: 1px 6px; border-radius: 10px; font-size: 10px; }
.sb-link .sb-cnt.err { background: #ef4444; color: white; }
.sb-bottom { padding: 16px 12px; border-top: 1px solid #1e293b; }
.sb-status { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #64748b; padding: 6px 10px; }
.sb-status .dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

/* ── Main ── */
.main      { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar    { background: white; border-bottom: 1px solid #e2e8f0; padding: 0 28px; height: 56px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 10; }
.topbar-left { display: flex; align-items: center; gap: 16px; }
.page-title  { font-size: 16px; font-weight: 700; color: #0f172a; }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.refresh-btn  { display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; }
.refresh-btn:hover { background: #4f46e5; }

/* ── Stats ── */
.stats-grid  { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; padding: 20px 28px 0; }
@media(max-width:1200px) { .stats-grid { grid-template-columns: repeat(3,1fr); } }
.stat-card   { background: white; border-radius: 12px; padding: 16px; border: 1px solid #e2e8f0; }
.stat-icon   { font-size: 20px; margin-bottom: 8px; }
.stat-num    { font-size: 28px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
.stat-lbl    { font-size: 11px; color: #64748b; font-weight: 500; }

/* ── Filter bar ── */
.filter-bar  { padding: 16px 28px 0; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.filter-bar select, .filter-bar input { padding: 7px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; background: white; color: #0f172a; outline: none; }
.filter-bar select:focus, .filter-bar input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px #6366f133; }
.btn-filter  { padding: 7px 16px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-reset   { padding: 7px 12px; background: white; color: #64748b; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; cursor: pointer; text-decoration: none; }
.search-wrap { position: relative; }
.search-wrap input { padding-left: 32px; width: 220px; }
.search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 13px; pointer-events: none; }

/* ── Tabs ── */
.tabs-row    { padding: 16px 28px 0; display: flex; gap: 4px; border-bottom: 1px solid #e2e8f0; margin: 0 28px; margin-top: 16px; }
.tab-btn     { padding: 10px 16px; font-size: 13px; font-weight: 500; color: #64748b; text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; display: flex; align-items: center; gap: 6px; transition: all .15s; border-radius: 6px 6px 0 0; }
.tab-btn:hover { color: #0f172a; background: #f8fafc; }
.tab-active  { color: #6366f1; border-bottom-color: #6366f1; font-weight: 600; }
.tab-cnt     { background: #f1f5f9; color: #475569; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 700; }
.tab-cnt-err { background: #ef4444; color: white; }

/* ── Content ── */
.content     { padding: 20px 28px 40px; flex: 1; }
.empty       { text-align: center; padding: 60px 20px; color: #94a3b8; font-size: 14px; }

/* ── Runs ── */
.runs-list   { display: flex; flex-direction: column; gap: 12px; }
.run-card    { background: white; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
.run-header  { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; gap: 8px; }
.run-meta    { display: flex; align-items: center; gap: 10px; }
.run-time    { font-size: 12px; font-weight: 600; color: #0f172a; }
.run-ago     { font-size: 11px; color: #94a3b8; }
.run-chips   { display: flex; gap: 6px; flex-wrap: wrap; }
.chip        { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.chip-ok     { background: #dcfce7; color: #16a34a; }
.chip-err    { background: #fee2e2; color: #dc2626; }
.chip-skip   { background: #fef9c3; color: #92400e; }
.run-tos     { padding: 8px 16px; background: #f0f9ff; border-bottom: 1px solid #bae6fd; display: flex; flex-wrap: wrap; gap: 6px; }
.to-tag      { background: white; border: 1px solid #bae6fd; color: #0369a1; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 500; }
.run-emails  { padding: 8px 0; }
.run-email   { display: flex; align-items: center; gap: 8px; padding: 6px 16px; font-size: 12px; flex-wrap: wrap; }
.run-email:hover { background: #f8fafc; }
.email-err   { background: #fff5f5; }
.email-skip  { opacity: .65; }
.run-email-dot { font-size: 9px; flex-shrink: 0; }
.run-email-van  { color: #475569; min-width: 120px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; flex-shrink: 0; }
.run-email-sub  { color: #0f172a; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.run-email-err  { color: #dc2626; font-size: 11px; flex-shrink: 0; }

/* ── Tables ── */
.table-wrap  { overflow-x: auto; border-radius: 12px; border: 1px solid #e2e8f0; }
table        { width: 100%; border-collapse: collapse; background: white; }
thead tr     { background: #0f172a; }
thead th     { padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .8px; white-space: nowrap; }
tbody tr     { border-bottom: 1px solid #f1f5f9; }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: #f8fafc; }
tbody tr.row-err  { background: #fff5f5; }
tbody tr.row-err:hover { background: #ffe4e4; }
tbody tr.row-skip { background: #fffbeb; }
td           { padding: 8px 14px; vertical-align: middle; }
.td-time     { font-size: 11px; color: #64748b; white-space: nowrap; }
.td-mono     { font-family: 'Consolas', monospace; font-size: 12px; font-weight: 600; color: #0f172a; }
.td-type     { font-size: 11px; color: #64748b; }
.td-klant    { font-weight: 500; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-plaats   { color: #475569; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-datum    { font-size: 12px; color: #475569; white-space: nowrap; }
.td-to       { max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.to-inline   { font-size: 11px; color: #0369a1; background: #e0f2fe; padding: 2px 7px; border-radius: 5px; }
.td-fout     { font-size: 11px; color: #dc2626; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-fout-big { font-size: 12px; color: #dc2626; max-width: 300px; }
.td-van      { color: #475569; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-sub      { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-empty    { color: #cbd5e1; }
.type-badge  { background: #f1f5f9; color: #475569; padding: 2px 8px; border-radius: 6px; font-size: 11px; }

/* ── Bron overzicht ── */
.bron-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.bron-card   { background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 20px; }
.bron-card h3 { font-size: 13px; font-weight: 700; margin-bottom: 14px; color: #0f172a; }
.bron-row    { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.bron-label  { min-width: 100px; }
.bron-bar-wrap { flex: 1; }
.bron-bar-bg { background: #f1f5f9; border-radius: 4px; height: 8px; overflow: hidden; }
.bron-bar-fill { height: 100%; border-radius: 4px; transition: width .3s; }
.bron-nums   { min-width: 120px; font-size: 11px; text-align: right; }

/* ── Prijsafspraken tab ── */
.pa-intro    { background:#e0e7ff;border:1px solid #c7d2fe;border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:12px;color:#3730a3; }
.pa-grid     { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 20px; }
.pa-card     { background: white; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; }
.pa-card-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; gap: 12px; flex-wrap: wrap; }
.pa-hint     { background: #f0fdf4; border-top: 1px solid #bbf7d0; padding: 7px 16px; font-size: 11px; color: #166534; }
.pa-table-wrap { overflow-x: auto; }
.pa-table    { width: 100%; border-collapse: collapse; }
.pa-table thead tr { background: #f8fafc; }
.pa-table thead th { padding: 7px 12px; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .6px; border-bottom: 1px solid #e2e8f0; }
.pa-field-row { border-bottom: 1px solid #f1f5f9; transition: background .1s; }
.pa-field-row:hover { background: #f8fafc; }
.pa-field-row:last-child { border-bottom: none; }
.pa-inactive { opacity: .55; }
.pa-label    { padding: 7px 12px; font-size: 12px; color: #374151; }
.pa-amount   { padding: 7px 12px; }
.pa-text-cell { padding: 7px 12px; }
.pa-allin-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.pa-allin-cb { width: 15px; height: 15px; cursor: pointer; accent-color: #6366f1; }
.pa-allin-label { font-size: 12px; font-weight: 700; color: #374151; }
.pa-allin-hint  { font-size: 11px; color: #94a3b8; }
.pa-save-btn    { padding: 6px 14px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .15s; }
.pa-save-btn:hover { background: #4f46e5; }
.pa-save-btn:disabled { background: #94a3b8; cursor: default; }
</style>
</head>
<body>
<div class="layout">

<!-- ── Sidebar ── -->
<aside class="sidebar">
  <div class="sb-logo">
    <div class="sb-logo-text">Romy <span>HQ</span></div>
    <div class="sb-logo-sub">Tiaro Transport</div>
  </div>
  <nav class="sb-nav">
    <div class="sb-section">Overzicht</div>
    <a href="${base}&periode=${periode}&tab=runs"         class="sb-link ${tab==='runs'?'active':''}">⚡ Runs</a>
    <a href="${base}&periode=${periode}&tab=opdrachten"   class="sb-link ${tab==='opdrachten'?'active':''}">📦 Opdrachten <span class="sb-cnt">${totOp}</span></a>
    <a href="${base}&periode=${periode}&tab=overgeslagen" class="sb-link ${tab==='overgeslagen'?'active':''}">⏭ Overgeslagen <span class="sb-cnt">${skipVl}</span></a>
    <a href="${base}&periode=${periode}&tab=fouten"       class="sb-link ${tab==='fouten'?'active':''}">⚠️ Fouten ${(foutOp+foutVl)>0 ? `<span class="sb-cnt err">${foutOp+foutVl}</span>` : `<span class="sb-cnt">0</span>`}</a>
    <div class="sb-section" style="margin-top:12px">Beheer</div>
    <a href="${base}&tab=prijsafspraken" class="sb-link ${tab==='prijsafspraken'?'active':''}">💶 Tarieven</a>
    <div class="sb-section" style="margin-top:12px">Periode</div>
    ${[
      ['vandaag',      '☀️ Vandaag'],
      ['gisteren',     '🌙 Gisteren'],
      ['deze-week',    '📅 Deze week'],
      ['vorige-week',  '📅 Vorige week'],
      ['deze-maand',   '🗓 Deze maand'],
      ['vorige-maand', '🗓 Vorige maand'],
      ['alles',        '∞ Alles'],
    ].map(([p, l]) => `<a href="${base}&periode=${p}&tab=${tab}" class="sb-link ${periode===p?'active':''}">${l}</a>`).join('')}
  </nav>
  <div class="sb-bottom">
    <div class="sb-status"><span class="dot"></span> Systeem actief</div>
  </div>
</aside>

<!-- ── Main ── -->
<div class="main">
  <header class="topbar">
    <div class="topbar-left">
      <span class="page-title">${
        tab === 'runs'           ? '⚡ Runs' :
        tab === 'opdrachten'     ? '📦 Opdrachten' :
        tab === 'overgeslagen'   ? '⏭ Overgeslagen emails' :
        tab === 'fouten'         ? '⚠️ Fouten' :
        tab === 'prijsafspraken' ? '💶 Tarieven per klant' : '📦 Opdrachten'
      }</span>
      <span style="font-size:11px;color:#94a3b8">${periodeLabel(periode)}</span>
    </div>
    <div class="topbar-right">
      <form method="GET" style="display:flex;gap:8px;align-items:center">
        <input type="hidden" name="token" value="${esc(token)}">
        <input type="hidden" name="tab" value="${esc(tab)}">
        <input type="hidden" name="periode" value="${esc(periode)}">
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input type="text" name="zoek" placeholder="Zoek container, klant..." value="${esc(zoek)}" autocomplete="off">
        </div>
        <button type="submit" class="btn-filter">Zoeken</button>
        ${zoek ? `<a href="${base}&periode=${esc(periode)}&tab=${tab}" class="btn-reset">✕ Reset</a>` : ''}
      </form>
      <a href="?token=${esc(token)}&periode=${esc(periode)}&tab=${tab}" class="refresh-btn">↻ Verversen</a>
    </div>
  </header>

  <!-- Stats -->
  <div class="stats-grid">${statsBar()}</div>

  <!-- Tab content -->
  <div class="content" style="padding-top:24px">
    ${tabContent()}
  </div>
</div><!-- /main -->

</div><!-- /layout -->
<script>
// Auto-refresh elke 90 seconden (niet op prijsafspraken tab — voorkomt verlies van aanpassingen)
if (!location.search.includes('tab=prijsafspraken')) {
  setTimeout(() => location.reload(), 90000);
}

// ── Prijsafspraken helpers ───────────────────────────────────────────────────

function _paCard(klant) {
  return document.getElementById('pa-card-' + klant);
}
function _paVelden(klant) {
  const card = _paCard(klant);
  if (!card) return {};
  try { return JSON.parse(card.dataset.velden || '{}'); } catch { return {}; }
}
function _paSetVelden(klant, v) {
  const card = _paCard(klant);
  if (card) card.dataset.velden = JSON.stringify(v);
}

function paToggle(klant, key, checked) {
  const v = _paVelden(klant);
  if (!v[key]) v[key] = {};
  v[key].actief = checked;
  _paSetVelden(klant, v);
  // enable/disable related inputs
  const card = _paCard(klant);
  if (!card) return;
  card.querySelectorAll('[data-key="' + key + '"]').forEach(el => {
    if (el.type !== 'checkbox') el.disabled = !checked;
  });
  const row = card.querySelector('.pa-field-row input[data-key="' + key + '"][type="checkbox"]')?.closest('tr');
  if (row) row.classList.toggle('pa-inactive', !checked);
}

function paChange(klant, key, val) {
  const v = _paVelden(klant);
  if (!v[key]) v[key] = {};
  v[key].chart = parseFloat(val) || 0;
  _paSetVelden(klant, v);
}

function paTextChange(klant, key, val) {
  const v = _paVelden(klant);
  if (!v[key]) v[key] = {};
  v[key].text = val;
  _paSetVelden(klant, v);
}

function paAllIn(klant, checked) {
  const card = _paCard(klant);
  if (card) card.dataset.allin = checked ? '1' : '0';
}

async function paSave(klant, token) {
  const card = _paCard(klant);
  if (!card) return;
  const velden = _paVelden(klant);
  const all_in = card.dataset.allin === '1';
  const btn    = card.querySelector('.pa-save-btn');
  const msg    = document.getElementById('pa-msg-' + klant);

  btn.disabled = true;
  btn.textContent = '⏳ Opslaan...';

  try {
    const res = await fetch('/api/prijsafspraken?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ klant, velden, all_in })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    btn.textContent = '💾 Opslaan';
    btn.disabled = false;
    if (msg) { msg.style.display = 'inline'; setTimeout(() => { msg.style.display = 'none'; }, 3000); }
  } catch (e) {
    btn.textContent = '❌ Fout';
    btn.disabled = false;
    alert('Opslaan mislukt: ' + e.message);
  }
}
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).send(html);

  } catch (err) {
    console.error('❌ Dashboard crash:', err);
    res.status(500).send(`<pre style="padding:20px;font-family:monospace">Dashboard fout:\n${err?.stack || err?.message || String(err)}</pre>`);
  }
}
