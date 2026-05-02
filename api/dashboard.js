// api/dashboard.js  –  Automating Logistics tenant-dashboard
import { supabase } from '../services/supabaseClient.js';
import { requireTenantAccess } from '../utils/auth.js';
import { effectivePermissions, PERMISSIONS } from '../utils/permissions.js';
import { listUsersForTenant, listMembershipsForUser } from '../services/userService.js';

// Welke tenant heeft op dit moment échte data? (Phase 2 maakt alle tenants live.)
const LIVE_DATA_TENANT = 'tiarotransport';

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
    OK:          ['#D1F0E0','#1A6640','✓'],
    FOUT:        ['#FAD7D7','#8B1A1A','✕'],
    verwerkt:    ['#D1F0E0','#1A6640','✓'],
    fout:        ['#FAD7D7','#8B1A1A','✕'],
    overgeslagen:['#F5E8C8','#7A5210','—'],
    update:      ['#D6E1F0','#1B2A4A','↑'],
    onbekend:    ['#EDE7DC','#7D6A53','?'],
  };
  const [bg, color, icon] = map[s] || ['#f1f5f9','#64748b','?'];
  return `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;background:${bg};color:${color}">${icon} ${esc(s)}</span>`;
}

export default async function handler(req, res) {
  try {
    const slug = req.params?.slug || 'tiarotransport';
    const ctx  = await requireTenantAccess(req, res, slug);
    if (!ctx) return;
    const { user, tenant, membership } = ctx;
    const perms     = effectivePermissions(user, membership);
    const isLive    = tenant.slug === LIVE_DATA_TENANT;
    const canManage = user.is_superuser || membership?.is_owner || perms.manage_users;

    // 'token' wordt nog gebruikt door inline AJAX-templates verderop. Bij cookie-auth
    // blijft hij leeg; de sessiecookie wordt automatisch meegestuurd.
    const token = '';

    const periode = req.query?.periode || 'deze-maand';
    let   tab     = req.query?.tab    || 'opdrachten';
    const zoek    = (req.query?.zoek  || '').toLowerCase().trim();
    // base = relative query-prefix; URLs blijven relatief t.o.v. /<tenant-slug>.
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

    // ── Unieke bronnen ophalen (opdrachtgevers — lookup-sleutel in enrichOrder) ──
    const { data: allBronnenRaw } = await supabase
      .from('opdrachten_log').select('bron').not('bron', 'is', null).neq('bron', '');
    const bronSet = new Set();
    const allBronnen = [];
    for (const r of (allBronnenRaw || [])) {
      const b = (r.bron || '').trim();
      if (b && !bronSet.has(b.toLowerCase())) { bronSet.add(b.toLowerCase()); allBronnen.push({ naam: b, plaats: '', bron: b, isBron: true }); }
    }
    allBronnen.sort((a, b) => a.naam.localeCompare(b.naam));

    // ── Alle unieke klant_naam waarden ophalen (over alle tijden) ────────────
    const { data: allKlantenRaw } = await supabase
      .from('opdrachten_log')
      .select('klant_naam, klant_plaats, bron')
      .not('klant_naam', 'is', null)
      .neq('klant_naam', '')
      .neq('klant_naam', 'OMRIJDER')
      .order('klant_naam');
    // Deduplicate op klant_naam
    const klantNaamMap = new Map();
    for (const r of (allKlantenRaw || [])) {
      const naam = (r.klant_naam || '').trim();
      if (!naam || naam.toUpperCase() === 'OMRIJDER') continue;
      if (!klantNaamMap.has(naam)) klantNaamMap.set(naam, { naam, plaats: r.klant_plaats || '', bron: r.bron || '' });
    }
    const allKlanten = [...allBronnen, ...klantNaamMap.values()];

    // ── Per-bron bestemmingen (klant_naam + klant_plaats per opdrachtgever) ───
    const bronDestsMap = {};
    for (const r of (allKlantenRaw || [])) {
      const bron  = (r.bron      || '').trim();
      const naam  = (r.klant_naam  || '').trim();
      const plaats = (r.klant_plaats || '').trim();
      if (!bron || !naam) continue;
      if (!bronDestsMap[bron]) bronDestsMap[bron] = new Map();
      const key = `${naam.toLowerCase()}|${plaats.toLowerCase()}`;
      if (!bronDestsMap[bron].has(key)) bronDestsMap[bron].set(key, { naam, plaats });
    }
    // Convert Maps → sorted arrays
    for (const bron of Object.keys(bronDestsMap)) {
      bronDestsMap[bron] = [...bronDestsMap[bron].values()]
        .sort((a, b) => a.naam.localeCompare(b.naam));
    }

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
        { n: totTO,      l: 'TO\'s aangemaakt', icon: '📄', accent: '#8B1A2E' },
        { n: okOp,       l: 'Verwerkt',         icon: '✅', accent: '#2D7A4F' },
        { n: foutOp + foutVl, l: 'Fouten',      icon: '⚠️', accent: '#C0392B' },
        { n: skipVl,     l: 'Overgeslagen',      icon: '⏭',  accent: '#B5870F' },
        { n: totVl,      l: 'Emails gelezen',    icon: '📧', accent: '#1B2A4A' },
        { n: totOp,      l: 'Opdrachten',        icon: '📦', accent: '#6B4E8A' },
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
            <span style="color:#2D7A4F;font-weight:600">${s.ok}</span>
            ${s.fout ? `<span style="color:#C0392B"> / ${s.fout} fout</span>` : ''}
            <span style="color:#9E8A75;font-size:10px"> (${pct}%)</span>
          </div>
        </div>`;
      }).join('');
    }

    const ALL_TABS = [
      { id: 'opdrachten',      label: 'Opdrachten',    icon: '📦', count: totOp,            perm: 'view_opdrachten' },
      { id: 'runs',            label: 'Runs',          icon: '⚡',                            perm: 'view_runs' },
      { id: 'overgeslagen',    label: 'Overgeslagen',  icon: '⏭',  count: skipVl,           perm: 'view_overgeslagen' },
      { id: 'fouten',          label: 'Fouten',        icon: '⚠️', count: foutOp + foutVl, alert: true, perm: 'view_fouten' },
      { id: 'prijsafspraken',  label: 'Tarieven',      icon: '💶',                            perm: 'view_tarieven' },
      { id: 'gebruikers',      label: 'Gebruikers',    icon: '👥',                            perm: 'manage_users' },
    ];
    const TABS = ALL_TABS.filter(t => perms[t.perm]);
    if (!TABS.find(t => t.id === tab)) tab = TABS[0]?.id || 'opdrachten';

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

    // ── Tarieven grid (spreadsheet-view) ─────────────────────────────────────
    // Kolom-definitie: key, label, terminal (= valt weg bij all-in)
    const T_COLS = [
      { key: 'tarief',     label: 'Tarief',       terminal: false },
      { key: 'diesel',     label: 'Diesel',      terminal: false },
      { key: 'delta',      label: 'ECT Delta',   terminal: true  },
      { key: 'euromax',    label: 'Euromax',      terminal: true  },
      { key: 'rwg',        label: 'RWG',          terminal: true  },
      { key: 'botlek',     label: 'Botlek',       terminal: true  },
      { key: 'adr',        label: 'ADR',          terminal: false },
      { key: 'genset',     label: 'Genset',       terminal: false },
      { key: 'gasmeten',   label: 'Gasmeten',     terminal: false },
      { key: 'extra_stop', label: 'Extra stop',   terminal: false },
      { key: 'wacht_uur',  label: 'Wachtuur',     terminal: false },
      { key: 'blanco1',    label: 'Blanco 1',     terminal: false },
      { key: 'blanco2',    label: 'Blanco 2',     terminal: false },
    ];
    const T_DEFAULTS = {
      tarief: 0,
      diesel: 9, delta: 28.5, euromax: 28.5, rwg: 31,
      botlek: 0, adr: 10, genset: 100, gasmeten: 55,
      extra_stop: 55, wacht_uur: 0, blanco1: 0, blanco2: 0,
    };
    // ADR is een percentage — toon als "%" in de kolom
    const T_PERCENT_KEYS = new Set(['adr']);

    // prijsafspraken geïndexeerd op klant (lowercase)
    const paByKlant = {};
    for (const pa of prijsafspraken) paByKlant[(pa.klant || '').toLowerCase()] = pa;

    // Per-bestemming tarieven data voor JS (embed als BT_DATA in script-tag)
    // Alleen bronnen (opdrachtgevers) — bestemmingen auto-gevuld vanuit opdrachten_log
    const btDataForJs = {};
    for (const bron of allBronnen) {
      const pa = paByKlant[bron.naam.toLowerCase()] || {};
      const savedTarieven = pa.velden?._tarieven || [];
      // Lookup: "naam|plaats" → tarief (support ook oud formaat zonder naam)
      const tariefMap = {};
      for (const t of savedTarieven) {
        const nk = `${(t.naam||'').toLowerCase()}|${(t.plaats||'').toLowerCase()}`;
        const pk = `|${(t.plaats||'').toLowerCase()}`;
        tariefMap[nk] = t.tarief ?? '';
        if (tariefMap[pk] === undefined) tariefMap[pk] = t.tarief ?? '';
      }
      const knownDests = bronDestsMap[bron.naam] || [];
      btDataForJs[bron.naam] = knownDests.map(d => {
        const nk = `${d.naam.toLowerCase()}|${d.plaats.toLowerCase()}`;
        const pk = `|${d.plaats.toLowerCase()}`;
        const tarief = tariefMap[nk] !== undefined ? tariefMap[nk]
                     : tariefMap[pk] !== undefined ? tariefMap[pk] : '';
        return { naam: d.naam, plaats: d.plaats, tarief };
      });
    }

    function prijsafsprakenTab() {
      if (!allKlanten.length) {
        return `<div class="empty">Nog geen verwerkte orders — laad/los-klanten verschijnen hier automatisch.</div>`;
      }

      const headerCols = T_COLS.map(c => {
        const hint = c.terminal ? 'Terminal toeslag (vervalt bij all-in)'
                   : c.key === 'adr' ? 'Percentage van basistarief (bijv. 10 = 10%)'
                   : '';
        const suffix = T_PERCENT_KEYS.has(c.key) ? ' <span style="font-size:9px;opacity:.7">%</span>' : '';
        return `<th class="tg-th ${c.terminal ? 'tg-th-term' : ''}" title="${hint}">${c.label}${suffix}</th>`;
      }).join('');

      // Splits in actief en verborgen
      const actiefKlanten  = allKlanten.filter(k => !(paByKlant[k.naam.toLowerCase()]?.velden?._negeer));
      const verborgenKlanten = allKlanten.filter(k =>  (paByKlant[k.naam.toLowerCase()]?.velden?._negeer));

      function buildRow(k, hidden) {
        const paKey  = k.naam.toLowerCase();
        const pa     = paByKlant[paKey] || {};
        const velden = { ...pa.velden };
        delete velden._negeer; // strip intern veld uit weergave
        const allIn  = !!pa.all_in;
        const c      = BRON_COLORS[(k.bron || '').toLowerCase()] || '#94a3b8';

        const cells = T_COLS.map(col => {
          const v       = velden[col.key] || {};
          const chart   = v.chart ?? T_DEFAULTS[col.key] ?? 0;
          const dimmed  = allIn && col.terminal;
          const isPct   = T_PERCENT_KEYS.has(col.key);
          return `<td class="tg-cell ${dimmed ? 'tg-dimmed' : ''}">
            <div style="display:flex;align-items:center;gap:2px">
              <input type="number" step="${isPct ? '1' : '0.01'}" min="0" class="tg-inp" data-key="${col.key}"
                value="${dimmed ? '' : chart}"
                placeholder="${dimmed ? '—' : '0'}"
                style="width:${isPct ? '52px' : '68px'}"
                ${dimmed || hidden ? 'disabled' : ''}
                oninput="tgChange(this)">
              ${isPct ? '<span style="font-size:11px;color:#9E8A75">%</span>' : ''}
            </div>
          </td>`;
        }).join('');

        const bronLabel = k.bron && !k.isBron ? `<span class="tg-bron" style="background:${c}22;color:${c}">${esc(k.bron)}</span>` : '';
        const bronTag   = k.isBron ? `<span style="font-size:10px;color:#9E8A75;font-style:italic">opdrachtgever</span>` : '';

        if (hidden) {
          return `<tr class="tg-row tg-row-hidden" data-klant="${esc(k.naam)}" data-velden="${esc(JSON.stringify(pa.velden||{}))}" data-allin="${allIn?'1':'0'}">
            <td class="tg-cb-cell"><input type="checkbox" class="tg-cb" onchange="tgSelChange()"></td>
            <td class="tg-naam" colspan="2">
              <span class="tg-dot" style="background:${c}"></span>
              <div>
                <div class="tg-naam-text" style="text-decoration:line-through;color:#9E8A75">${esc(k.naam)}</div>
                <div class="tg-naam-sub">${esc(k.plaats||'')} ${bronLabel}</div>
              </div>
            </td>
            <td colspan="${T_COLS.length}" style="color:#9E8A75;font-size:11px;font-style:italic;padding:0 12px">verborgen</td>
            <td class="tg-save-cell">
              <button class="tg-herstel-btn" onclick="tgHerstel(this,'${esc(token)}')" title="Herstel — zet weer zichtbaar">↩ Herstel</button>
            </td>
          </tr>`;
        }

        return `<tr class="tg-row" data-klant="${esc(k.naam)}" data-velden="${esc(JSON.stringify(pa.velden||{}))}" data-allin="${allIn?'1':'0'}">
          <td class="tg-cb-cell"><input type="checkbox" class="tg-cb" onchange="tgSelChange()"></td>
          <td class="tg-naam">
            <span class="tg-dot" style="background:${c}"></span>
            <div>
              <div class="tg-naam-text">${esc(k.naam)}</div>
              <div class="tg-naam-sub">${esc(k.plaats||'')} ${bronLabel}${bronTag}</div>
            </div>
          </td>
          <td class="tg-allin-cell">
            <button class="tg-allin-btn ${allIn ? 'tg-allin-on' : ''}"
              onclick="tgToggleAllIn(this)"
              title="All-in: terminal toeslagen (Delta/Euromax/RWG/Botlek) = 0">
              ${allIn ? '✓ All-in' : 'All-in'}
            </button>
          </td>
          ${cells}
          <td class="tg-save-cell">
            <button class="tg-save-btn" onclick="tgSave(this,'${esc(token)}')">💾</button>
            <span class="tg-ok" style="display:none">✓</span>
            ${k.isBron ? `<button class="tg-dest-btn" onclick="tgOpenBestemmingen('${esc(k.naam)}','${esc(token)}')" title="Tarieven per bestemming">📍</button>` : `<button class="tg-hide-btn" onclick="tgVerberg(this,'${esc(token)}')" title="Verberg — geen klant / depot / fout">🚫</button>`}
          </td>
        </tr>`;
      }

      const actiefRows   = actiefKlanten.map(k => buildRow(k, false)).join('');
      const verborgenRows = verborgenKlanten.map(k => buildRow(k, true)).join('');
      const hiddenBlock  = verborgenKlanten.length
        ? `<tr class="tg-hidden-sep" id="tg-hidden-sep">
             <td colspan="${T_COLS.length + 4}" class="tg-hidden-sep-cell">
               <button class="tg-show-hidden-btn" onclick="tgToggleHidden(this)">
                 👁 Toon ${verborgenKlanten.length} verborgen (depot / fout / geen klant)
               </button>
             </td>
           </tr>
           <tbody id="tg-hidden-rows" style="display:none">${verborgenRows}</tbody>`
        : '';

      return `
      <div class="tg-toolbar">
        <div class="tg-filter-wrap">
          <span class="tg-filter-icon">🔍</span>
          <input type="text" id="tg-filter-inp" class="tg-filter-inp"
            placeholder="Filter op klant of bron..."
            oninput="tgFilter(this.value)">
        </div>
        <div class="tg-bulk-bar" id="tg-bulk-bar" style="display:none">
          <span id="tg-sel-count" style="font-size:12px;color:#5C4A34;font-weight:600"></span>
          <button class="tg-bulk-btn tg-bulk-hide" onclick="tgBulkVerberg('${esc(token)}')">🚫 Verberg geselecteerde</button>
          <button class="tg-bulk-btn tg-bulk-cancel" onclick="tgDeselectAll()">✕ Deselecteer</button>
        </div>
        <div style="font-size:11px;color:#9E8A75;margin-left:auto">
          <strong>All-in</strong> = terminal toeslagen grijs &nbsp;|&nbsp;
          <strong>🚫</strong> = verbergen (depot, fout, geen klant)
        </div>
      </div>
      <div class="tg-wrap">
        <table class="tg-table">
          <thead>
            <tr>
              <th class="tg-th-cb"><input type="checkbox" id="tg-sel-all" onchange="tgSelAll(this)" title="Alles selecteren"></th>
              <th class="tg-th-naam">Klant / Adres</th>
              <th class="tg-th-allin">All-in</th>
              ${headerCols}
              <th class="tg-th-save"></th>
            </tr>
          </thead>
          <tbody id="tg-body">${actiefRows}</tbody>
          ${hiddenBlock}
        </table>
      </div>`;
    }

    function bestemmingentab() {
      const bronOptions = allBronnen.map(b =>
        `<option value="${esc(b.naam)}">${esc(b.naam)}</option>`
      ).join('');

      return `
      <div class="bt-page">
        <div class="bt-header-bar">
          <div>
            <div class="bt-title">Tarieven per bestemming</div>
            <div class="bt-desc">Stel per opdrachtgever een tarief in per laad-/losplaats. Bestemmingen worden automatisch gevuld vanuit verwerkte opdrachten.</div>
          </div>
          <div class="bt-sel-wrap">
            <label class="bt-sel-label">Opdrachtgever</label>
            <select id="bt-klant-sel" class="bt-klant-sel" onchange="btSelectKlant(this.value, '${esc(token)}')">
              <option value="">— Kies een opdrachtgever —</option>
              ${bronOptions}
            </select>
          </div>
        </div>

        <div id="bt-container" style="display:none">
          <div class="bt-card">
            <div class="bt-table-wrap">
              <table class="bt-table">
                <thead>
                  <tr>
                    <th class="bt-th">Naam (klant)</th>
                    <th class="bt-th">Plaats</th>
                    <th class="bt-th bt-th-tarief">Tarief (€)</th>
                    <th class="bt-th bt-th-del"></th>
                  </tr>
                </thead>
                <tbody id="bt-body"></tbody>
              </table>
            </div>
            <div class="bt-footer">
              <button class="bt-add-btn" onclick="btAddRow()">＋ Bestemming toevoegen</button>
              <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
                <span class="bt-ok" id="bt-ok" style="display:none">✓ Opgeslagen</span>
                <button class="bt-save-btn" id="bt-save-btn" onclick="btSave('${esc(token)}')">💾 Opslaan</button>
              </div>
            </div>
          </div>
        </div>

        <div id="bt-placeholder" class="bt-placeholder">
          Selecteer een opdrachtgever om bestemmingstarieven te beheren.
        </div>
      </div>`;
    }

    function emptyTenantNote() {
      return `<div style="background:#FDFAF5;border:1px dashed #DDD3C4;border-radius:12px;padding:32px;text-align:center;color:#5C4A34">
        <div style="font-size:32px;margin-bottom:8px">📭</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:4px">Nog geen data voor ${esc(tenant.name)}</div>
        <div style="font-size:13px;color:#7A6A53">Inbox/Supabase-koppeling voor deze tenant wordt in een vervolgupdate toegevoegd.</div>
      </div>`;
    }

    function tabContent() {
      if (tab === 'gebruikers') return gebruikersTab();
      if (!isLive) return emptyTenantNote();
      switch (tab) {
        case 'runs':           return `<div class="runs-list">${runsList()}</div>`;
        case 'opdrachten':     return opdrachtenTable();
        case 'overgeslagen':   return overgeslagenTable();
        case 'fouten':         return foutenTable();
        case 'prijsafspraken': return perms.view_tarieven ? prijsafsprakenTab() : geenToegangBlok();
        default:               return opdrachtenTable();
      }
    }

    function geenToegangBlok() {
      return `<div style="background:#FDFAF5;border:1px solid #DDD3C4;border-radius:12px;padding:32px;text-align:center">
        <div style="font-size:24px;margin-bottom:8px">🔒</div>
        <div style="font-weight:600;color:#8B1A2E">Geen toestemming voor dit onderdeel</div>
      </div>`;
    }

    // ── Gebruikers-tab ──────────────────────────────────────────────────────
    let gebruikersData = null;
    if (canManage) {
      try { gebruikersData = await listUsersForTenant(tenant.id); }
      catch (e) { console.error('[dashboard] gebruikers load:', e); gebruikersData = []; }
    }

    // Toon "Wissel tenant"-knop als de user op meer dan één tenant zit (of superuser is).
    let showTenantSwitch = user.is_superuser;
    if (!showTenantSwitch) {
      try {
        const ms = await listMembershipsForUser(user.id);
        showTenantSwitch = ms.filter(m => m.tenant.is_active).length > 1;
      } catch { showTenantSwitch = false; }
    }
    function gebruikersTab() {
      if (!canManage) return geenToegangBlok();
      const rows = (gebruikersData || []).map(u => {
        const permTags = u.is_owner
          ? `<span class="u-tag u-tag-owner">OWNER — alle vinkjes</span>`
          : Object.keys(u.permissions || {}).filter(k => u.permissions[k]).map(k => `<span class="u-tag">${esc(k)}</span>`).join(' ') || '<span class="u-tag-none">geen</span>';
        return `
        <tr data-uid="${u.id}">
          <td><b>${esc(u.username)}</b>${u.is_superuser ? ' <span class="u-tag u-tag-su">superuser</span>' : ''}</td>
          <td>${u.is_active ? '✅ actief' : '⏸ inactief'}</td>
          <td class="u-perms">${permTags}</td>
          <td>${u.last_login ? fmt(u.last_login) : '—'}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="u-btn" onclick="userEdit(${u.id})">✏️ Wijzig</button>
            ${u.id !== user.id ? `<button class="u-btn u-btn-danger" onclick="userRemove(${u.id},'${esc(u.username)}')">🗑</button>` : ''}
          </td>
        </tr>`;
      }).join('');

      const permCheckboxes = PERMISSIONS
        .map(p => `<label class="u-pcb"><input type="checkbox" name="perm" value="${p.key}"> ${esc(p.label)}</label>`).join('');

      return `
      <div class="u-wrap">
        <div class="u-head">
          <h2>Gebruikers van ${esc(tenant.name)}</h2>
          <button class="u-add" onclick="userOpenNew()">＋ Nieuwe gebruiker</button>
        </div>
        <table class="u-tbl">
          <thead><tr><th>Gebruiker</th><th>Status</th><th>Permissies</th><th>Laatste login</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:#7A6A53">Nog geen gebruikers gekoppeld aan deze tenant.</td></tr>'}</tbody>
        </table>

        <div id="u-modal" class="u-modal-overlay" onclick="if(event.target===this)userClose()">
          <div class="u-modal">
            <div class="u-modal-head">
              <h3 id="u-modal-title">Nieuwe gebruiker</h3>
              <button class="u-x" onclick="userClose()">✕</button>
            </div>
            <div class="u-modal-body">
              <input type="hidden" id="u-id" value="">
              <label>Gebruikersnaam <span class="u-hint">(letters/cijfers/_-., 3-40)</span></label>
              <input type="text" id="u-username" autocomplete="off">
              <label>Wachtwoord <span class="u-hint" id="u-pw-hint">(verplicht voor nieuwe gebruiker)</span></label>
              <input type="password" id="u-password" autocomplete="new-password" placeholder="Leeg laten = niet wijzigen">
              <label class="u-pcb u-owner-row"><input type="checkbox" id="u-is-owner"> <b>Owner</b> — krijgt alle vinkjes voor deze tenant + gebruikersbeheer</label>
              <div class="u-perms-grid">${permCheckboxes}</div>
            </div>
            <div class="u-modal-foot">
              <button class="u-btn" onclick="userClose()">Annuleren</button>
              <button class="u-btn u-btn-primary" onclick="userSave()">Opslaan</button>
            </div>
          </div>
        </div>
      </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(tenant.name)} — Automating Logistics</title>
<style>
/* ── CSS variabelen (kleurenpalet) ── */
:root {
  --bg:           #F5F0E8;
  --sidebar:      #1E1209;
  --sidebar-hov:  #2E1A0B;
  --sidebar-bdr:  #3D2A1A;
  --accent:       #8B1A2E;
  --accent-hov:   #6B1220;
  --accent-light: #F0DDE1;
  --card:         #FDFAF5;
  --topbar:       #FDFAF5;
  --border:       #DDD3C4;
  --border-light: #EDE7DC;
  --text:         #2C1A0F;
  --text-med:     #5C4A34;
  --text-muted:   #9E8A75;
  --navy:         #1B2A4A;
  --navy-light:   #D6E1F0;
  --light-bg:     #EDE7DC;
  --term-color:   #B87A1A;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); font-size: 13px; min-height: 100vh; }

/* ── Sidebar ── */
.layout    { display: flex; min-height: 100vh; }
.sidebar   { width: 220px; background: var(--sidebar); display: flex; flex-direction: column; flex-shrink: 0; position: sticky; top: 0; height: 100vh; }
.sb-logo   { padding: 24px 20px 20px; border-bottom: 1px solid var(--sidebar-bdr); }
.sb-logo-text { font-size: 22px; font-weight: 800; color: #F5F0E8; letter-spacing: -.5px; }
.sb-logo-text span { color: #C0485A; }
.sb-logo-sub { font-size: 10px; color: #7D6A53; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
.sb-nav    { padding: 16px 12px; flex: 1; overflow-y: auto; }
.sb-section { font-size: 10px; color: #7D6A53; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; padding: 8px 8px 4px; }
.sb-link   { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; color: #B8A090; text-decoration: none; font-size: 13px; font-weight: 500; transition: all .15s; margin-bottom: 2px; }
.sb-link:hover { background: var(--sidebar-hov); color: #F5F0E8; }
.sb-link.active { background: var(--accent); color: white; }
.sb-link .sb-cnt { margin-left: auto; background: rgba(255,255,255,.12); padding: 1px 6px; border-radius: 10px; font-size: 10px; }
.sb-link .sb-cnt.err { background: #C0392B; color: white; }
.sb-bottom { padding: 16px 12px; border-top: 1px solid var(--sidebar-bdr); }
.sb-status { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #7D6A53; padding: 6px 10px; }
.sb-status .dot { width: 7px; height: 7px; border-radius: 50%; background: #2D7A4F; animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

/* ── Main ── */
.main      { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar    { background: var(--topbar); border-bottom: 1px solid var(--border); padding: 0 28px; height: 56px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 3px rgba(44,26,15,.06); }
.topbar-left { display: flex; align-items: center; gap: 16px; }
.page-title  { font-size: 16px; font-weight: 700; color: var(--text); }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.refresh-btn  { display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: var(--accent); color: white; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; }
.refresh-btn:hover { background: var(--accent-hov); }
.logout-btn   { display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: transparent; color: #9E8A75; border: 1px solid #3D2A1A; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: none; }
.logout-btn:hover { background: #2E1A0B; color: #F5F0E8; border-color: #5A4234; }

/* ── Stats ── */
.stats-grid  { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; padding: 20px 28px 0; }
@media(max-width:1200px) { .stats-grid { grid-template-columns: repeat(3,1fr); } }
.stat-card   { background: var(--card); border-radius: 12px; padding: 16px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(44,26,15,.04); }
.stat-icon   { font-size: 20px; margin-bottom: 8px; }
.stat-num    { font-size: 28px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
.stat-lbl    { font-size: 11px; color: var(--text-med); font-weight: 500; }

/* ── Filter bar ── */
.filter-bar  { padding: 16px 28px 0; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.filter-bar select, .filter-bar input { padding: 7px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; background: var(--card); color: var(--text); outline: none; }
.filter-bar select:focus, .filter-bar input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(139,26,46,.12); }
.btn-filter  { padding: 7px 16px; background: var(--accent); color: white; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
.btn-filter:hover { background: var(--accent-hov); }
.btn-reset   { padding: 7px 12px; background: var(--card); color: var(--text-med); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; cursor: pointer; text-decoration: none; }
.search-wrap { position: relative; }
.search-wrap input { padding-left: 32px; width: 220px; }
.search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 13px; pointer-events: none; }

/* ── Tabs ── */
.tabs-row    { padding: 16px 28px 0; display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin: 0 28px; margin-top: 16px; }
.tab-btn     { padding: 10px 16px; font-size: 13px; font-weight: 500; color: var(--text-med); text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; display: flex; align-items: center; gap: 6px; transition: all .15s; border-radius: 6px 6px 0 0; }
.tab-btn:hover { color: var(--text); background: var(--light-bg); }
.tab-active  { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
.tab-cnt     { background: var(--light-bg); color: var(--text-med); padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 700; }
.tab-cnt-err { background: #C0392B; color: white; }

/* ── Content ── */
.content     { padding: 20px 28px 40px; flex: 1; }
.empty       { text-align: center; padding: 60px 20px; color: var(--text-muted); font-size: 14px; }

/* ── Runs ── */
.runs-list   { display: flex; flex-direction: column; gap: 12px; }
.run-card    { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(44,26,15,.04); }
.run-header  { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--light-bg); border-bottom: 1px solid var(--border-light); flex-wrap: wrap; gap: 8px; }
.run-meta    { display: flex; align-items: center; gap: 10px; }
.run-time    { font-size: 12px; font-weight: 600; color: var(--text); }
.run-ago     { font-size: 11px; color: var(--text-muted); }
.run-chips   { display: flex; gap: 6px; flex-wrap: wrap; }
.chip        { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.chip-ok     { background: #D1F0E0; color: #1A6640; }
.chip-err    { background: #FAD7D7; color: #8B1A1A; }
.chip-skip   { background: #F5E8C8; color: #7A5210; }
.run-tos     { padding: 8px 16px; background: var(--navy-light); border-bottom: 1px solid #C3D1E8; display: flex; flex-wrap: wrap; gap: 6px; }
.to-tag      { background: var(--card); border: 1px solid #C3D1E8; color: var(--navy); padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 500; }
.run-emails  { padding: 8px 0; }
.run-email   { display: flex; align-items: center; gap: 8px; padding: 6px 16px; font-size: 12px; flex-wrap: wrap; }
.run-email:hover { background: var(--light-bg); }
.email-err   { background: #FAF0F0; }
.email-skip  { opacity: .65; }
.run-email-dot { font-size: 9px; flex-shrink: 0; }
.run-email-van  { color: var(--text-med); min-width: 120px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; flex-shrink: 0; }
.run-email-sub  { color: var(--text); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.run-email-err  { color: #C0392B; font-size: 11px; flex-shrink: 0; }

/* ── Tables ── */
.table-wrap  { overflow-x: auto; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(44,26,15,.04); }
table        { width: 100%; border-collapse: collapse; background: var(--card); }
thead tr     { background: var(--sidebar); }
thead th     { padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; color: #B8A090; text-transform: uppercase; letter-spacing: .8px; white-space: nowrap; }
tbody tr     { border-bottom: 1px solid var(--border-light); }
tbody tr:last-child { border-bottom: none; }
tbody tr:hover { background: var(--light-bg); }
tbody tr.row-err  { background: #FAF0F0; }
tbody tr.row-err:hover { background: #F5E0E0; }
tbody tr.row-skip { background: #FAF5E8; }
td           { padding: 8px 14px; vertical-align: middle; }
.td-time     { font-size: 11px; color: var(--text-med); white-space: nowrap; }
.td-mono     { font-family: 'Consolas', monospace; font-size: 12px; font-weight: 600; color: var(--text); }
.td-type     { font-size: 11px; color: var(--text-med); }
.td-klant    { font-weight: 500; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-plaats   { color: var(--text-med); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-datum    { font-size: 12px; color: var(--text-med); white-space: nowrap; }
.td-to       { max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.to-inline   { font-size: 11px; color: var(--navy); background: var(--navy-light); padding: 2px 7px; border-radius: 5px; }
.td-fout     { font-size: 11px; color: #C0392B; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-fout-big { font-size: 12px; color: #C0392B; max-width: 300px; }
.td-van      { color: var(--text-med); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-sub      { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-empty    { color: var(--text-muted); }
.type-badge  { background: var(--light-bg); color: var(--text-med); padding: 2px 8px; border-radius: 6px; font-size: 11px; }

/* ── Bron overzicht ── */
.bron-grid   { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.bron-card   { background: var(--card); border-radius: 12px; border: 1px solid var(--border); padding: 20px; }
.bron-card h3 { font-size: 13px; font-weight: 700; margin-bottom: 14px; color: var(--text); }
.bron-row    { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.bron-label  { min-width: 100px; }
.bron-bar-wrap { flex: 1; }
.bron-bar-bg { background: var(--light-bg); border-radius: 4px; height: 8px; overflow: hidden; }
.bron-bar-fill { height: 100%; border-radius: 4px; transition: width .3s; }
.bron-nums   { min-width: 120px; font-size: 11px; text-align: right; }

/* ── Tarieven grid ── */
.tg-toolbar  { display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap; }
.tg-filter-wrap { position:relative; }
.tg-filter-icon { position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--text-muted); }
.tg-filter-inp  { padding:7px 12px 7px 32px;border:1px solid var(--border);border-radius:8px;font-size:12px;background:var(--card);color:var(--text);outline:none;width:240px; }
.tg-filter-inp:focus { border-color:var(--accent);box-shadow:0 0 0 3px rgba(139,26,46,.12); }
.tg-bulk-bar { display:flex;align-items:center;gap:8px;background:#F5E8C8;border:1px solid #D4A843;border-radius:8px;padding:6px 12px; }
.tg-bulk-btn  { padding:5px 12px;font-size:11px;font-weight:600;border:none;border-radius:6px;cursor:pointer; }
.tg-bulk-hide { background:#8B1A2E;color:white; }
.tg-bulk-hide:hover { background:#6B1220; }
.tg-bulk-cancel { background:var(--light-bg);color:var(--text-med); }
.tg-bulk-cancel:hover { background:var(--border); }
.tg-wrap   { overflow-x: auto; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(44,26,15,.04); }
.tg-table  { border-collapse: collapse; background: var(--card); min-width: 100%; }
.tg-table thead tr { background: var(--sidebar); position: sticky; top: 0; z-index: 2; }
.tg-th     { padding: 9px 10px; font-size: 10px; font-weight: 700; color: #B8A090; text-transform: uppercase; letter-spacing: .6px; white-space: nowrap; text-align: center; border-right: 1px solid var(--sidebar-bdr); }
.tg-th-cb   { width:36px;padding:9px 10px; }
.tg-th-naam  { text-align: left; min-width: 200px; padding: 9px 14px; }
.tg-th-allin { min-width: 80px; }
.tg-th-save  { width: 90px; }
.tg-th-term  { color: var(--term-color); }
.tg-row    { border-bottom: 1px solid var(--border-light); }
.tg-row:last-child { border-bottom: none; }
.tg-row:hover { background: var(--light-bg); }
.tg-row-hidden { opacity:.55; }
.tg-row.tg-selected { background: var(--accent-light); }
.tg-cb-cell { padding:6px 8px;text-align:center; }
.tg-cb      { width:14px;height:14px;cursor:pointer;accent-color:var(--accent); }
.tg-naam   { padding: 8px 14px; display: flex; align-items: center; gap: 10px; min-width: 200px; white-space: nowrap; }
.tg-dot    { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.tg-naam-text { font-size: 12px; font-weight: 600; color: var(--text); }
.tg-naam-sub  { font-size: 10px; color: var(--text-muted); margin-top: 1px; display:flex;align-items:center;gap:4px; }
.tg-bron   { padding:1px 6px;border-radius:10px;font-size:10px;font-weight:600; }
.tg-allin-cell { padding: 6px 8px; text-align: center; }
.tg-allin-btn { padding: 4px 10px; font-size: 11px; font-weight: 600; border-radius: 20px; border: 1.5px solid var(--border); background: var(--card); color: var(--text-med); cursor: pointer; white-space: nowrap; transition: all .15s; }
.tg-allin-btn:hover { border-color: var(--accent); color: var(--accent); }
.tg-allin-on  { background: var(--accent); border-color: var(--accent); color: white; }
.tg-allin-on:hover { background: var(--accent-hov); }
.tg-cell   { padding: 5px 6px; text-align: center; border-right: 1px solid var(--border-light); }
.tg-dimmed { background: var(--light-bg); }
.tg-dimmed .tg-inp { background: var(--border-light); color: var(--text-muted); }
.tg-inp    { width: 68px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 6px; font-size: 12px; text-align: right; background: white; color: var(--text); outline: none; transition: border-color .15s; }
.tg-inp:focus  { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(139,26,46,.12); }
.tg-inp:disabled { cursor: default; background: var(--light-bg); }
.tg-save-cell  { padding: 5px 8px; text-align: center; white-space: nowrap; }
.tg-save-btn   { padding: 5px 10px; background: var(--accent); color: white; border: none; border-radius: 7px; font-size: 12px; cursor: pointer; transition: background .15s; }
.tg-save-btn:hover { background: var(--accent-hov); }
.tg-save-btn:disabled { background: var(--text-muted); cursor: default; }
.tg-ok         { font-size: 13px; color: #2D7A4F; font-weight: 700; margin-left: 2px; }
.tg-hide-btn   { margin-left:4px;padding:4px 7px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;color:var(--text-muted);transition:all .15s; }
.tg-hide-btn:hover { background:#FAD7D7;border-color:#E8AAAA;color:#8B1A1A; }
.tg-herstel-btn { padding:4px 10px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;color:var(--accent);transition:all .15s; }
.tg-herstel-btn:hover { background:var(--accent-light);border-color:var(--accent); }
.tg-hidden-sep-cell { padding:10px 14px; }
.tg-show-hidden-btn { background:none;border:none;font-size:12px;color:var(--text-med);cursor:pointer;text-decoration:underline; }
.tg-show-hidden-btn:hover { color:var(--text); }
.tg-dest-btn { margin-left:4px;padding:4px 8px;background:var(--navy-light);border:1px solid #C3D1E8;border-radius:6px;font-size:12px;cursor:pointer;color:var(--navy);transition:all .15s; }
.tg-dest-btn:hover { background:#B0C4DE;border-color:#8899BB; }

/* ── Per-bestemming modal ── */
.bt-modal-overlay { display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;align-items:center;justify-content:center; }
.bt-modal-overlay.open { display:flex; }
.bt-modal-box { background:var(--card);border-radius:16px;width:720px;max-width:96vw;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px rgba(0,0,0,.35); }
.bt-modal-head { padding:14px 20px;border-bottom:1px solid var(--sidebar-bdr);display:flex;align-items:center;justify-content:space-between;background:var(--sidebar);flex-shrink:0; }
.bt-modal-title { font-size:14px;font-weight:700;color:#F5F0E8; }
.bt-modal-sub { font-size:11px;color:#9E8A75;margin-top:2px; }
.bt-modal-close { background:none;border:none;color:#9E8A75;font-size:18px;cursor:pointer;padding:4px 8px;border-radius:6px;line-height:1;transition:color .15s; }
.bt-modal-close:hover { color:#F5F0E8; }
.bt-modal-body { overflow-y:auto;flex:1;padding:16px; }

/* ── Per-bestemming tarieven ── */
.bt-page         { max-width: 860px; }
.bt-header-bar   { display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:20px;flex-wrap:wrap; }
.bt-title        { font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px; }
.bt-desc         { font-size:12px;color:var(--text-muted); }
.bt-sel-wrap     { display:flex;flex-direction:column;gap:4px;min-width:260px; }
.bt-sel-label    { font-size:11px;font-weight:600;color:var(--text-med);text-transform:uppercase;letter-spacing:.6px; }
.bt-klant-sel    { padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--card);color:var(--text);outline:none;cursor:pointer; }
.bt-klant-sel:focus { border-color:var(--accent);box-shadow:0 0 0 3px rgba(139,26,46,.12); }
.bt-card         { background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(44,26,15,.04); }
.bt-table-wrap   { overflow-x:auto; }
.bt-table        { width:100%;border-collapse:collapse; }
.bt-table thead tr { background:var(--sidebar); }
.bt-th           { padding:9px 14px;font-size:10px;font-weight:700;color:#B8A090;text-transform:uppercase;letter-spacing:.6px;text-align:left;white-space:nowrap; }
.bt-th-tarief    { width:140px;text-align:right; }
.bt-th-del       { width:44px; }
.bt-row          { border-bottom:1px solid var(--border-light); }
.bt-row:last-child { border-bottom:none; }
.bt-row:hover    { background:var(--light-bg); }
.bt-td           { padding:6px 10px;vertical-align:middle; }
.bt-inp-plaats   { width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;background:white;color:var(--text);outline:none; }
.bt-inp-plaats:focus { border-color:var(--accent);box-shadow:0 0 0 2px rgba(139,26,46,.12); }
.bt-tarief-cell  { display:flex;align-items:center;gap:5px;justify-content:flex-end; }
.bt-eur-sign     { color:var(--text-muted);font-size:13px; }
.bt-inp-tarief   { width:90px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;text-align:right;background:white;color:var(--text);outline:none; }
.bt-inp-tarief:focus { border-color:var(--accent);box-shadow:0 0 0 2px rgba(139,26,46,.12); }
.bt-del-btn      { padding:4px 9px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:12px;cursor:pointer;color:var(--text-muted);transition:all .15s; }
.bt-del-btn:hover { background:#FAD7D7;border-color:#E8AAAA;color:#8B1A1A; }
.bt-footer       { display:flex;align-items:center;padding:10px 14px;border-top:1px solid var(--border-light);background:var(--light-bg); }
.bt-add-btn      { padding:6px 14px;background:var(--card);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;color:var(--accent);transition:all .15s; }
.bt-add-btn:hover { background:var(--accent-light);border-color:var(--accent); }
.bt-save-btn     { padding:6px 16px;background:var(--accent);color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s; }
.bt-save-btn:hover { background:var(--accent-hov); }
.bt-save-btn:disabled { background:var(--text-muted);cursor:default; }
.bt-ok           { font-size:12px;color:#2D7A4F;font-weight:700; }
.bt-placeholder  { padding:60px 20px;text-align:center;color:var(--text-muted);font-size:14px; }

/* ── Gebruikers-tab ────────────────────────────────────────────────────────── */
.u-wrap { background:var(--card); border-radius:12px; padding:24px; border:1px solid var(--border); }
.u-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
.u-head h2 { font-size:18px; color:var(--text); }
.u-add { padding:8px 16px; background:var(--accent); color:white; border:none; border-radius:8px; font-weight:600; cursor:pointer; font-size:13px; }
.u-add:hover { background:var(--accent-hov); }
.u-tbl { width:100%; border-collapse:collapse; font-size:13px; }
.u-tbl th { text-align:left; padding:10px; border-bottom:2px solid var(--border); color:var(--text-med); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
.u-tbl td { padding:12px 10px; border-bottom:1px solid var(--border-light); vertical-align:top; }
.u-tbl tr:hover { background:#FAF6EE; }
.u-tag { display:inline-block; padding:2px 8px; background:#EDE7DC; color:#5C4A34; border-radius:12px; font-size:10px; margin:1px; font-family:monospace; }
.u-tag-owner { background:#8B1A2E22; color:#8B1A2E; font-weight:700; font-family:inherit; }
.u-tag-su    { background:#1B2A4A22; color:#1B2A4A; font-weight:700; font-family:inherit; }
.u-tag-none  { color:#9E8A75; font-style:italic; font-size:11px; }
.u-perms     { max-width:380px; }
.u-btn       { padding:5px 11px; background:#EDE7DC; color:#2C1A0F; border:none; border-radius:6px; font-size:12px; cursor:pointer; margin-left:4px; }
.u-btn:hover { background:#DDD3C4; }
.u-btn-danger { background:#FAD7D7; color:#8B1A1A; }
.u-btn-danger:hover { background:#F4B8B8; }
.u-btn-primary { background:var(--accent); color:white; }
.u-btn-primary:hover { background:var(--accent-hov); }
.u-modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:1000; align-items:center; justify-content:center; padding:20px; }
.u-modal-overlay.show { display:flex; }
.u-modal { background:var(--card); border-radius:12px; width:100%; max-width:580px; max-height:90vh; display:flex; flex-direction:column; }
.u-modal-head { padding:18px 22px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
.u-modal-head h3 { font-size:16px; color:var(--text); }
.u-x { background:transparent; border:none; font-size:18px; cursor:pointer; color:var(--text-med); }
.u-modal-body { padding:18px 22px; overflow-y:auto; }
.u-modal-body label { display:block; font-size:11px; color:var(--text-med); text-transform:uppercase; letter-spacing:.5px; font-weight:600; margin:14px 0 6px; }
.u-modal-body input[type=text],.u-modal-body input[type=password] { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:6px; font-size:14px; }
.u-modal-body input:focus { outline:none; border-color:var(--accent); }
.u-hint { color:var(--text-muted); text-transform:none; font-weight:400; letter-spacing:0; font-size:11px; }
.u-pcb { display:flex; align-items:center; gap:6px; font-size:13px; text-transform:none; letter-spacing:0; color:var(--text); cursor:pointer; padding:4px 0; font-weight:400; margin:0; }
.u-pcb input { margin:0; }
.u-owner-row { padding:10px 12px; background:#FAF6EE; border:1px solid var(--border); border-radius:6px; margin-top:14px; }
.u-perms-grid { display:grid; grid-template-columns:1fr 1fr; gap:4px 16px; margin-top:10px; padding:14px; background:#FAF6EE; border-radius:6px; }
.u-modal-foot { padding:14px 22px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:8px; }
</style>
</head>
<body>
<div class="layout">

<!-- ── Sidebar ── -->
<aside class="sidebar">
  <div class="sb-logo">
    <div class="sb-logo-text">Automating <span>Logistics</span></div>
    <div class="sb-logo-sub">${esc(tenant.name)}</div>
  </div>
  <nav class="sb-nav">
    <div class="sb-section">Overzicht</div>
    ${perms.view_runs        ? `<a href="${base}&periode=${periode}&tab=runs"         class="sb-link ${tab==='runs'?'active':''}">⚡ Runs</a>` : ''}
    ${perms.view_opdrachten  ? `<a href="${base}&periode=${periode}&tab=opdrachten"   class="sb-link ${tab==='opdrachten'?'active':''}">📦 Opdrachten <span class="sb-cnt">${totOp}</span></a>` : ''}
    ${perms.view_overgeslagen? `<a href="${base}&periode=${periode}&tab=overgeslagen" class="sb-link ${tab==='overgeslagen'?'active':''}">⏭ Overgeslagen <span class="sb-cnt">${skipVl}</span></a>` : ''}
    ${perms.view_fouten      ? `<a href="${base}&periode=${periode}&tab=fouten"       class="sb-link ${tab==='fouten'?'active':''}">⚠️ Fouten ${(foutOp+foutVl)>0 ? `<span class="sb-cnt err">${foutOp+foutVl}</span>` : `<span class="sb-cnt">0</span>`}</a>` : ''}
    ${(perms.view_tarieven || perms.manage_users) ? `<div class="sb-section" style="margin-top:12px">Beheer</div>` : ''}
    ${perms.view_tarieven ? `<a href="${base}&tab=prijsafspraken" class="sb-link ${tab==='prijsafspraken'?'active':''}">💶 Tarieven</a>` : ''}
    ${perms.manage_users  ? `<a href="${base}&tab=gebruikers"     class="sb-link ${tab==='gebruikers'?'active':''}">👥 Gebruikers</a>` : ''}
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
      <span style="font-size:11px;color:#9E8A75">${periodeLabel(periode)}</span>
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
      <span style="font-size:11px;color:#9E8A75;padding:0 8px;border-left:1px solid #DDD3C4">
        ${esc(user.username)}${user.is_superuser ? ' · superuser' : (membership?.is_owner ? ' · owner' : '')}
      </span>
      ${showTenantSwitch ? `<a href="/" class="logout-btn" title="Wissel tenant">⇄ Tenant</a>` : ''}
      <a href="/api/logout" class="logout-btn" title="Uitloggen">⎋ Uitloggen</a>
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

<!-- ── Per-bestemming modal ── -->
<div id="bt-modal-overlay" class="bt-modal-overlay" onclick="if(event.target===this)btCloseModal()">
  <div class="bt-modal-box">
    <div class="bt-modal-head">
      <div>
        <div class="bt-modal-title">📍 Tarieven per bestemming</div>
        <div class="bt-modal-sub" id="bt-modal-sub"></div>
      </div>
      <button class="bt-modal-close" onclick="btCloseModal()">✕</button>
    </div>
    <div class="bt-modal-body">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Stel per klant/laadplaats een afwijkend tarief in. Laat leeg om het standaard klanttarief te gebruiken.</div>
      <div class="bt-card">
        <div class="bt-table-wrap">
          <table class="bt-table">
            <thead><tr>
              <th class="bt-th">Naam (klant)</th>
              <th class="bt-th">Plaats</th>
              <th class="bt-th bt-th-tarief">Tarief (€)</th>
              <th class="bt-th bt-th-del"></th>
            </tr></thead>
            <tbody id="bt-body"></tbody>
          </table>
        </div>
        <div class="bt-footer">
          <button class="bt-add-btn" onclick="btAddRow()">＋ Bestemming toevoegen</button>
          <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
            <span class="bt-ok" id="bt-ok" style="display:none">✓ Opgeslagen</span>
            <button class="bt-save-btn" id="bt-save-btn">💾 Opslaan</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
// Auto-refresh elke 90 seconden (niet op tarieven-tabs — voorkomt verlies van aanpassingen)
const _noRefreshTabs = ['tab=prijsafspraken'];
if (!_noRefreshTabs.some(t => location.search.includes(t))) {
  setTimeout(() => location.reload(), 90000);
}

// ── Per-bestemming tarieven ──────────────────────────────────────────────────
const BT_DATA = ${JSON.stringify(btDataForJs).replace(/<\//g, '<\\/')};
let btCurrentKlant = null;

function btSelectKlant(klant) {
  btCurrentKlant = klant;
  const container   = document.getElementById('bt-container');
  const placeholder = document.getElementById('bt-placeholder');
  if (!klant) {
    container.style.display   = 'none';
    placeholder.style.display = '';
    return;
  }
  container.style.display   = '';
  placeholder.style.display = 'none';
  btRenderRows(BT_DATA[klant] || []);
}

function btRenderRows(tarieven) {
  const tbody = document.getElementById('bt-body');
  tbody.innerHTML = '';
  for (const t of tarieven) {
    tbody.appendChild(btMakeRow(t.naam || '', t.plaats || '', t.tarief ?? ''));
  }
}

function btMakeRow(naam, plaats, tarief) {
  const tr = document.createElement('tr');
  tr.className = 'bt-row';

  const td1 = document.createElement('td');
  td1.className = 'bt-td';
  td1.innerHTML = '<input type="text" class="bt-inp-naam" placeholder="bijv. Logwise BV">';
  td1.querySelector('input').value = naam;

  const td2 = document.createElement('td');
  td2.className = 'bt-td';
  td2.innerHTML = '<input type="text" class="bt-inp-plaats" placeholder="bijv. Rotterdam">';
  td2.querySelector('input').value = plaats;

  const td3 = document.createElement('td');
  td3.className = 'bt-td';
  td3.innerHTML = '<div class="bt-tarief-cell"><span class="bt-eur-sign">€</span><input type="number" class="bt-inp-tarief" step="0.01" min="0" placeholder="0.00"></div>';
  td3.querySelector('input').value = tarief !== '' ? tarief : '';

  const td4 = document.createElement('td');
  td4.className = 'bt-td';
  td4.innerHTML = '<button class="bt-del-btn" title="Verwijder">✕</button>';
  td4.querySelector('button').addEventListener('click', () => tr.remove());

  tr.appendChild(td1);
  tr.appendChild(td2);
  tr.appendChild(td3);
  tr.appendChild(td4);
  return tr;
}

function btAddRow() {
  const tbody = document.getElementById('bt-body');
  tbody.appendChild(btMakeRow('', '', ''));
  tbody.lastElementChild.querySelector('.bt-inp-naam').focus();
}

async function btSave(token) {
  if (!btCurrentKlant) return;
  const rows = [...document.querySelectorAll('#bt-body .bt-row')];
  const tarieven = rows
    .map(row => ({
      naam:   row.querySelector('.bt-inp-naam').value.trim(),
      plaats: row.querySelector('.bt-inp-plaats').value.trim(),
      tarief: parseFloat(row.querySelector('.bt-inp-tarief').value) || 0
    }))
    .filter(t => (t.naam || t.plaats) && t.tarief > 0);

  const saveBtn = document.getElementById('bt-save-btn');
  const okEl    = document.getElementById('bt-ok');
  saveBtn.disabled = true;
  try {
    // Laad bestaande velden op zodat toeslagen etc. behouden blijven
    const getRes = await fetch('/api/prijsafspraken?tenant=' + encodeURIComponent(__TENANT_SLUG__));
    if (!getRes.ok) throw new Error('Laden mislukt (' + getRes.status + ')');
    const allPa   = await getRes.json();
    const existing = allPa.find(p => (p.klant || '').toLowerCase() === btCurrentKlant.toLowerCase()) || {};
    const velden  = { ...(existing.velden || {}), _tarieven: tarieven };

    const res = await fetch('/api/prijsafspraken?tenant=' + encodeURIComponent(__TENANT_SLUG__), {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ klant: btCurrentKlant, velden, all_in: existing.all_in || false })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    // Lokale cache bijwerken (bewaar naam/plaats/tarief zodat herrender correct werkt)
    BT_DATA[btCurrentKlant] = tarieven;
    if (okEl) { okEl.style.display = 'inline'; setTimeout(() => okEl.style.display = 'none', 2500); }
  } catch(e) { alert('Opslaan mislukt: ' + e.message); }
  finally { saveBtn.disabled = false; }
}

// Open modal voor per-bestemming tarieven
function tgOpenBestemmingen(klant, token) {
  btCurrentKlant = klant;
  document.getElementById('bt-modal-sub').textContent = klant;
  btRenderRows(BT_DATA[klant] || []);
  document.getElementById('bt-save-btn').onclick = () => btSave(token);
  document.getElementById('bt-modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function btCloseModal() {
  document.getElementById('bt-modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ── Tarieven grid helpers ────────────────────────────────────────────────────
const TG_TERMINAL_KEYS = new Set(['delta','euromax','rwg','botlek']);

// Filter
function tgFilter(q) {
  const s = q.toLowerCase().trim();
  document.querySelectorAll('#tg-body .tg-row').forEach(row => {
    const text = (row.dataset.klant || '').toLowerCase();
    const bron = (row.querySelector('.tg-bron')?.textContent || '').toLowerCase();
    row.style.display = (!s || text.includes(s) || bron.includes(s)) ? '' : 'none';
  });
}

// Selectie
function tgSelAll(cb) {
  document.querySelectorAll('#tg-body .tg-cb').forEach(c => {
    if (c.closest('tr').style.display !== 'none') c.checked = cb.checked;
  });
  tgSelChange();
}
function tgSelChange() {
  const sel  = [...document.querySelectorAll('#tg-body .tg-cb:checked')];
  const bar  = document.getElementById('tg-bulk-bar');
  const cnt  = document.getElementById('tg-sel-count');
  bar.style.display = sel.length ? 'flex' : 'none';
  if (cnt) cnt.textContent = sel.length + ' geselecteerd';
  document.querySelectorAll('#tg-body .tg-row').forEach(row => {
    row.classList.toggle('tg-selected', !!row.querySelector('.tg-cb:checked'));
  });
}
function tgDeselectAll() {
  document.querySelectorAll('#tg-body .tg-cb').forEach(c => c.checked = false);
  document.getElementById('tg-sel-all').checked = false;
  tgSelChange();
}

// All-in toggle
function tgToggleAllIn(btn) {
  const row   = btn.closest('tr');
  const allIn = row.dataset.allin !== '1';
  row.dataset.allin = allIn ? '1' : '0';
  btn.classList.toggle('tg-allin-on', allIn);
  btn.textContent = allIn ? '✓ All-in' : 'All-in';
  row.querySelectorAll('.tg-inp').forEach(inp => {
    if (!TG_TERMINAL_KEYS.has(inp.dataset.key)) return;
    const cell = inp.closest('td');
    if (allIn) {
      inp._prev = inp.value; inp.value = ''; inp.placeholder = '—'; inp.disabled = true;
      cell.classList.add('tg-dimmed');
    } else {
      inp.value = inp._prev ?? '0'; inp.placeholder = '0'; inp.disabled = false;
      cell.classList.remove('tg-dimmed');
    }
  });
}

// Input change
function tgChange(inp) {
  const row = inp.closest('tr');
  let v = {};
  try { v = JSON.parse(row.dataset.velden || '{}'); } catch {}
  const key = inp.dataset.key;
  if (!v[key]) v[key] = {};
  v[key].chart  = parseFloat(inp.value) || 0;
  v[key].actief = (parseFloat(inp.value) || 0) > 0;
  row.dataset.velden = JSON.stringify(v);
}

// Opslaan
async function tgSave(btn, token) {
  const row    = btn.closest('tr');
  const klant  = row.dataset.klant;
  const all_in = row.dataset.allin === '1';
  const okEl   = row.querySelector('.tg-ok');
  let velden = {};
  try { velden = JSON.parse(row.dataset.velden || '{}'); } catch {}
  row.querySelectorAll('.tg-inp').forEach(inp => {
    const key = inp.dataset.key;
    const val = parseFloat(inp.value) || 0;
    if (!velden[key]) velden[key] = {};
    velden[key].chart  = val;
    velden[key].actief = !inp.disabled && val > 0;
  });
  delete velden._negeer; // niet meesturen bij normaal opslaan
  btn.disabled = true;
  try {
    const res = await fetch('/api/prijsafspraken?tenant=' + encodeURIComponent(__TENANT_SLUG__), {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ klant, velden, all_in })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (okEl) { okEl.style.display = 'inline'; setTimeout(() => okEl.style.display = 'none', 2500); }
  } catch(e) { alert('Opslaan mislukt: ' + e.message); }
  finally { btn.disabled = false; }
}

// Verberg (rij markeren als geen klant / depot / fout)
async function tgVerberg(btn, token) {
  const row   = btn.closest('tr');
  const klant = row.dataset.klant;
  let velden  = {};
  try { velden = JSON.parse(row.dataset.velden || '{}'); } catch {}
  velden._negeer = true;
  const all_in = row.dataset.allin === '1';
  try {
    const res = await fetch('/api/prijsafspraken?tenant=' + encodeURIComponent(__TENANT_SLUG__), {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ klant, velden, all_in })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    row.style.opacity = '0';
    setTimeout(() => location.reload(), 400);
  } catch(e) { alert('Fout: ' + e.message); }
}

// Herstel verborgen rij
async function tgHerstel(btn, token) {
  const row   = btn.closest('tr');
  const klant = row.dataset.klant;
  let velden  = {};
  try { velden = JSON.parse(row.dataset.velden || '{}'); } catch {}
  delete velden._negeer;
  const all_in = row.dataset.allin === '1';
  try {
    const res = await fetch('/api/prijsafspraken?tenant=' + encodeURIComponent(__TENANT_SLUG__), {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ klant, velden, all_in })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    location.reload();
  } catch(e) { alert('Fout: ' + e.message); }
}

// Bulk verbergen
async function tgBulkVerberg(token) {
  const selected = [...document.querySelectorAll('#tg-body .tg-cb:checked')]
    .map(cb => cb.closest('tr'));
  if (!selected.length) return;
  if (!confirm(selected.length + ' rijen verbergen?')) return;
  for (const row of selected) {
    let velden = {};
    try { velden = JSON.parse(row.dataset.velden || '{}'); } catch {}
    velden._negeer = true;
    await fetch('/api/prijsafspraken?tenant=' + encodeURIComponent(__TENANT_SLUG__), {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ klant: row.dataset.klant, velden, all_in: row.dataset.allin === '1' })
    });
  }
  location.reload();
}

// Toon/verberg hidden sectie
function tgToggleHidden(btn) {
  const tbody = document.getElementById('tg-hidden-rows');
  if (!tbody) return;
  const visible = tbody.style.display !== 'none';
  tbody.style.display = visible ? 'none' : '';
  btn.textContent = visible
    ? '👁 Toon ' + tbody.querySelectorAll('tr').length + ' verborgen (depot / fout / geen klant)'
    : '🙈 Verberg verborgen rijen';
}

// ── Gebruikersbeheer (Gebruikers-tab) ───────────────────────────────────────
const __TENANT_SLUG__ = ${JSON.stringify(tenant.slug)};
const __USERS_CACHE__ = ${JSON.stringify(gebruikersData || [])};

function userClose() {
  document.getElementById('u-modal').classList.remove('show');
}
function userOpenNew() {
  document.getElementById('u-modal-title').textContent = 'Nieuwe gebruiker';
  document.getElementById('u-id').value = '';
  document.getElementById('u-username').value = '';
  document.getElementById('u-username').disabled = false;
  document.getElementById('u-password').value = '';
  document.getElementById('u-pw-hint').textContent = '(verplicht voor nieuwe gebruiker)';
  document.getElementById('u-is-owner').checked = false;
  document.querySelectorAll('#u-modal input[name=perm]').forEach(cb => cb.checked = false);
  document.getElementById('u-modal').classList.add('show');
}
function userEdit(id) {
  const u = __USERS_CACHE__.find(x => x.id === id);
  if (!u) return alert('Gebruiker niet gevonden — herlaad de pagina.');
  document.getElementById('u-modal-title').textContent = 'Gebruiker wijzigen';
  document.getElementById('u-id').value = String(u.id);
  document.getElementById('u-username').value = u.username;
  document.getElementById('u-username').disabled = true;
  document.getElementById('u-password').value = '';
  document.getElementById('u-pw-hint').textContent = '(leeg laten = niet wijzigen)';
  document.getElementById('u-is-owner').checked = !!u.is_owner;
  const perms = u.permissions || {};
  document.querySelectorAll('#u-modal input[name=perm]').forEach(cb => {
    cb.checked = !!perms[cb.value];
  });
  document.getElementById('u-modal').classList.add('show');
}
async function userSave() {
  const id       = document.getElementById('u-id').value;
  const username = document.getElementById('u-username').value.trim();
  const password = document.getElementById('u-password').value;
  const is_owner = document.getElementById('u-is-owner').checked;
  const permissions = {};
  document.querySelectorAll('#u-modal input[name=perm]').forEach(cb => {
    if (cb.checked) permissions[cb.value] = true;
  });
  const isNew = !id;
  if (isNew) {
    if (!username) return alert('Gebruikersnaam is verplicht.');
    if (!password) return alert('Wachtwoord is verplicht voor een nieuwe gebruiker.');
  }
  const url = '/api/users?tenant=' + encodeURIComponent(__TENANT_SLUG__) + (isNew ? '' : '&id=' + id);
  const body = isNew
    ? { username, password, is_owner, permissions }
    : { is_owner, permissions, ...(password ? { password } : {}) };
  try {
    const res = await fetch(url, {
      method: isNew ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return alert('Fout: ' + (data.error || res.status));
    userClose();
    location.reload();
  } catch (e) { alert('Netwerkfout: ' + e.message); }
}
async function userRemove(id, username) {
  if (!confirm('Weet je zeker dat je "' + username + '" wilt verwijderen uit deze tenant?')) return;
  try {
    const res = await fetch('/api/users?tenant=' + encodeURIComponent(__TENANT_SLUG__) + '&id=' + id, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return alert('Fout: ' + (data.error || res.status));
    location.reload();
  } catch (e) { alert('Netwerkfout: ' + e.message); }
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
