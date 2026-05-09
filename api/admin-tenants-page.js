// api/admin-tenants-page.js
//
// GET /admin/tenants → HTML-pagina met lijst tenants + formulier nieuwe tenant.
// Gebruikt fetch() naar /api/admin/tenants — dezelfde sessie-cookie wordt
// meegestuurd dus geen extra auth-stap nodig.
//
// Stijl matcht de tenant-picker in index.js (dark burgundy).

import { requireLogin } from '../utils/auth.js';

export default async function handler(req, res) {
  const user = await requireLogin(req, res);
  if (!user) return;

  if (!user.is_superuser) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(shellPage('403', `<h1>403</h1><p>Alleen superusers mogen tenants beheren.</p><p><a href="/">Terug</a></p>`));
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><title>Tenants beheren</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#1E1209;color:#F5F0E8;min-height:100vh;padding:48px 20px}
.wrap{max-width:1080px;margin:0 auto}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px}
.brand{font-size:22px;font-weight:800}.brand span{color:#8B1A2E}
.who{font-size:13px;color:#9E8A75}.who a{color:#F5F0E8;margin-left:14px}
h1{font-size:24px;margin-bottom:18px;font-weight:600}
h2{font-size:16px;margin:28px 0 12px;font-weight:600;color:#9E8A75;text-transform:uppercase;letter-spacing:1px}
.card{background:#2E1A0B;border:1px solid #3D2A1A;border-radius:12px;padding:22px;margin-bottom:14px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #3D2A1A;font-size:13px}
th{font-weight:600;color:#9E8A75;text-transform:uppercase;letter-spacing:.5px;font-size:11px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px}
.badge-on{background:#1E3A1E;color:#7FCB7F}
.badge-off{background:#3A1E1E;color:#CB7F7F}
.tile{display:inline-block;padding:6px 14px;background:#3D2A1A;border-radius:6px;text-decoration:none;color:#F5F0E8;font-size:13px;margin-right:6px}
.tile:hover{background:#5D3A2A}
form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
label{display:block;font-size:12px;color:#9E8A75;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
input[type=text],input[type=password]{width:100%;padding:10px 12px;background:#1E1209;border:1px solid #3D2A1A;color:#F5F0E8;border-radius:6px;font-size:14px;font-family:inherit}
input:focus{outline:none;border-color:#8B1A2E}
.btn{padding:11px 22px;background:#8B1A2E;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:14px}
.btn:hover{background:#6e1525}
.btn:disabled{opacity:.5;cursor:not-allowed}
.full{grid-column:1/-1}
.melding{padding:14px 18px;border-radius:8px;margin-top:18px;font-size:14px}
.melding-ok{background:#1E3A1E;color:#C7F2C7;border:1px solid #2A5A2A}
.melding-fout{background:#3A1E1E;color:#F2C7C7;border:1px solid #5A2A2A}
.creds{background:#1E1209;padding:14px;border-radius:6px;margin-top:10px;font-family:'Menlo','Monaco',monospace;font-size:13px;line-height:1.7}
.creds strong{color:#8B1A2E}
.creds-warn{color:#E8A87C;font-size:12px;margin-top:8px}
small{color:#9E8A75;font-size:12px;display:block;margin-top:4px}
</style></head>
<body>
<div class="wrap">
  <div class="head">
    <div class="brand">Automating <span>Logistics</span></div>
    <div class="who">${escapeHtml(user.username)} (superuser)
      <a href="/">Terug</a><a href="/api/logout">Uitloggen</a>
    </div>
  </div>

  <h1>Tenants beheren</h1>

  <div class="card">
    <h2 style="margin-top:0">Nieuwe tenant aanmaken</h2>
    <form id="newTenantForm">
      <div>
        <label for="name">Bedrijfsnaam *</label>
        <input type="text" id="name" name="name" required placeholder="Berkhof Logistics">
      </div>
      <div>
        <label for="slug">Slug</label>
        <input type="text" id="slug" name="slug" placeholder="(automatisch uit naam)">
        <small>Alleen a-z, 0-9, -</small>
      </div>
      <div>
        <label for="adminUsername">Admin username *</label>
        <input type="text" id="adminUsername" name="adminUsername" required placeholder="berkhof-admin">
      </div>
      <div>
        <label for="adminPassword">Admin wachtwoord</label>
        <input type="text" id="adminPassword" name="adminPassword" placeholder="(automatisch genereren)">
      </div>
      <div class="full">
        <button type="submit" class="btn" id="submitBtn">Tenant + admin aanmaken</button>
      </div>
    </form>
    <div id="resultaat"></div>
  </div>

  <h2>Bestaande tenants</h2>
  <div class="card">
    <table id="tenantsTable">
      <thead><tr><th>Naam</th><th>Slug</th><th>Status</th><th>Acties</th></tr></thead>
      <tbody><tr><td colspan="4" style="color:#9E8A75;text-align:center;padding:20px">Laden…</td></tr></tbody>
    </table>
  </div>
</div>

<script>
async function laadTenants() {
  const tbody = document.querySelector('#tenantsTable tbody');
  try {
    const r = await fetch('/api/admin/tenants');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'fout bij laden');
    if (!j.tenants.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color:#9E8A75;text-align:center;padding:20px">Nog geen tenants</td></tr>';
      return;
    }
    tbody.innerHTML = j.tenants.map(t => \`
      <tr>
        <td><strong>\${esc(t.name)}</strong></td>
        <td><code>\${esc(t.slug)}</code></td>
        <td><span class="badge \${t.is_active ? 'badge-on' : 'badge-off'}">
          \${t.is_active ? 'actief' : 'inactief'}
        </span></td>
        <td>
          <a href="/\${esc(t.slug)}" class="tile">Open dashboard →</a>
          <a href="/api/users?tenant=\${esc(t.slug)}" class="tile">Users</a>
        </td>
      </tr>\`).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:#CB7F7F">Fout: '+esc(e.message)+'</td></tr>';
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

document.querySelector('#newTenantForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.querySelector('#submitBtn');
  const out = document.querySelector('#resultaat');
  btn.disabled = true; btn.textContent = 'Bezig…';
  out.innerHTML = '';

  const data = {
    name: document.querySelector('#name').value.trim(),
    slug: document.querySelector('#slug').value.trim() || undefined,
    adminUsername: document.querySelector('#adminUsername').value.trim(),
    adminPassword: document.querySelector('#adminPassword').value.trim() || undefined,
  };

  try {
    const r = await fetch('/api/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'onbekende fout');

    const ww = j.adminUser.password;
    out.innerHTML = \`
      <div class="melding melding-ok">
        ✓ \${esc(j.melding)}
        <div class="creds">
          <div><strong>Tenant:</strong> \${esc(j.tenant.name)} (slug: \${esc(j.tenant.slug)})</div>
          <div><strong>Login URL:</strong> <a href="\${esc(j.loginUrl)}" style="color:#E8A87C">\${location.origin}\${esc(j.loginUrl)}</a></div>
          <div><strong>Username:</strong> \${esc(j.adminUser.username)}</div>
          \${ww ? '<div><strong>Wachtwoord:</strong> ' + esc(ww) + '</div>' : '<div><em>(bestaande user — wachtwoord onveranderd)</em></div>'}
          \${ww ? '<div class="creds-warn">⚠️ Kopieer dit wachtwoord nu, het wordt niet bewaard.</div>' : ''}
        </div>
      </div>\`;
    document.querySelector('#newTenantForm').reset();
    laadTenants();
  } catch (e) {
    out.innerHTML = '<div class="melding melding-fout">✗ ' + esc(e.message) + '</div>';
  } finally {
    btn.disabled = false; btn.textContent = 'Tenant + admin aanmaken';
  }
});

// Slug-suggestie tijdens typen
document.querySelector('#name').addEventListener('input', (e) => {
  const slugIn = document.querySelector('#slug');
  if (!slugIn.value) {
    const sug = e.target.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    slugIn.placeholder = sug || '(automatisch uit naam)';
  }
});

laadTenants();
</script>
</body></html>`);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function shellPage(title, body) {
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:'Segoe UI',sans-serif;background:#1E1209;color:#F5F0E8;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.box{max-width:480px;text-align:center;background:#2E1A0B;padding:40px;border-radius:12px;border:1px solid #3D2A1A}
h1{color:#8B1A2E;margin:0 0 12px}p{color:#9E8A75;margin:8px 0}a{color:#F5F0E8}
</style></head><body><div class="box">${body}</div></body></html>`;
}
