// Boot, login screen, layout and hash-based navigation.
import { api, state, esc, icon, toast, modal, applyAppearance, isAdmin, can } from './core.js';
import { cashRegisterView } from './views/cash-register.js';
import { dashboardView } from './views/dashboard.js';
import { movementsView } from './views/movements.js';
import { ticketsView, invoicesView } from './views/invoices.js';
import { filesView } from './views/files.js';
import { settingsView } from './views/settings.js';

const root = document.getElementById('root');

// [url segment, view, who can see it, icon, menu label]
const ROUTES = [
  ['panel', dashboardView, 'admin', 'chart', 'Panel'],
  ['caja', cashRegisterView, 'all', 'cash', 'Caja'],
  ['tickets', ticketsView, 'invoices', 'receipt', 'Tickets'],
  ['facturas', invoicesView, 'invoices', 'invoice', 'Facturas'],
  ['movimientos', movementsView, 'admin', 'list', 'Movimientos'],
  ['archivos', filesView, 'files', 'folder', 'Archivos'],
  ['ajustes', settingsView, 'admin', 'settings', 'Ajustes'],
];
const allowed = (who) => who === 'all' || (who === 'admin' && isAdmin()) ||
  (who === 'invoices' && state.settings.modules.invoices && can('worker_create_invoices')) ||
  (who === 'files' && isAdmin() && state.settings.modules.files);

// ---- Login / first-run setup
function authScreen(status) {
  const setup = status.needsSetup;
  root.innerHTML = `<div class="auth"><div class="card">
    ${status.shop.logo ? `<img src="${esc(status.shop.logo)}" style="max-height:52px;margin-bottom:12px" alt="">` : ''}
    <h1>${setup ? 'Bienvenido' : esc(status.shop.name)}</h1>
    <div class="muted">${setup ? 'Primera puesta en marcha: crea la cuenta del administrador (dueño).' : 'Control de ventas · Entra con tu usuario'}</div>
    <form data-f>
      ${setup ? `<label class="field">Nombre de la tienda<input name="shopName" value="${esc(status.shop.name)}" required></label>
                 <label class="field">Tu nombre<input name="name" required></label>` : ''}
      <label class="field">Usuario<input name="username" autocomplete="username" autocapitalize="none" required></label>
      <label class="field">Contraseña${setup ? ' <span class="hint">mínimo 6 caracteres</span>' : ''}<input name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
      <button class="btn btn-primary" type="submit">${setup ? 'Crear y entrar' : 'Entrar'}</button>
    </form></div></div>`;
  const f = root.querySelector('[data-f]');
  setTimeout(() => f.querySelector('input').focus(), 30);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(f));
    try {
      await api(setup ? '/setup' : '/login', { method: 'POST', body: b });
      location.hash = '#/';
      boot();
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ---- Layout
function layout() {
  const s = state.settings;
  const links = ROUTES.filter(r => allowed(r[2]));
  const logo = s.shop.logo ? `<img src="${esc(s.shop.logo)}" alt="">` : `<span class="logo-fallback">${esc((s.shop.name || 'M')[0])}</span>`;
  root.innerHTML = `<div class="app">
    <aside class="sidebar">
      <div class="brand">${logo}<div><b>${esc(s.shop.name)}</b><small>Control de ventas</small></div></div>
      <nav class="nav">${links.map(([k, , , ic, label]) => `<a href="#/${k}" data-nav="${k}">${icon(ic)}${label}</a>`).join('')}</nav>
      <div class="me">
        <b>${esc(state.user.name)}</b><span class="role-badge">${isAdmin() ? 'Administrador' : 'Trabajador'}</span>
        <div class="row" style="margin-top:10px;gap:4px">
          <button class="btn btn-ghost btn-sm" data-pass title="Cambiar contraseña">${icon('key')}</button>
          <button class="btn btn-ghost btn-sm" data-theme-toggle title="Modo claro/oscuro">${icon(s.appearance.dark ? 'sun' : 'moon')}</button>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" data-logout>${icon('logout')} Salir</button>
        </div>
      </div>
    </aside>
    <main class="main" id="view"></main>
    <nav class="mobile-bar">${links.slice(0, 4).map(([k, , , ic, label]) => `<a href="#/${k}" data-nav="${k}">${icon(ic)}${label}</a>`).join('')}
      <a href="#" data-more>${icon('list')}Más</a></nav>
    <div class="mobile-sheet hidden" data-sheet><div class="sheet-card">
      ${links.slice(4).map(([k, , , ic, label]) => `<a href="#/${k}" data-nav="${k}">${icon(ic)}${label}</a>`).join('')}
      <a href="#" data-pass-m>${icon('key')}Cambiar contraseña</a>
      <a href="#" data-logout-m>${icon('logout')}Salir (${esc(state.user.name)})</a>
    </div></div>
  </div>`;
  const logout = async (e) => { e && e.preventDefault(); await api('/logout', { method: 'POST' }); location.hash = '#/'; location.reload(); };
  root.querySelector('[data-logout]').onclick = logout;
  root.querySelector('[data-logout-m]').onclick = logout;
  const sheet = root.querySelector('[data-sheet]');
  root.querySelector('[data-more]').onclick = (e) => { e.preventDefault(); sheet.classList.toggle('hidden'); };
  sheet.onclick = (e) => { if (e.target === sheet || e.target.closest('a')) sheet.classList.add('hidden'); };
  root.querySelector('[data-pass-m]').onclick = (e) => { e.preventDefault(); changePassword(); };
  root.querySelector('[data-pass]').onclick = changePassword;
  root.querySelector("[data-theme-toggle]").onclick = () => {
    // Per-device preference; the default theme is chosen in Settings.
    const dark = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* storage unavailable */ }
    root.querySelector("[data-theme-toggle]").innerHTML = icon(dark ? 'sun' : 'moon');
  };
}

function changePassword() {
  modal({
    title: 'Cambiar mi contraseña',
    body: `<form data-pf style="display:flex;flex-direction:column;gap:12px">
      <label class="field">Contraseña actual<input type="password" name="current" autocomplete="current-password"></label>
      <label class="field">Nueva contraseña o PIN<input type="password" name="password" autocomplete="new-password"></label></form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>`,
    onMount: (el, close) => {
      el.querySelector('[data-ok]').onclick = async () => {
        const b = Object.fromEntries(new FormData(el.querySelector('[data-pf]')));
        try { await api('/me/password', { method: 'POST', body: b }); toast('Contraseña cambiada', 'ok'); close(); }
        catch (e) { toast(e.message, 'err'); }
      };
    },
  });
}

// ---- Navigation
async function router() {
  if (!state.user) return;
  const hash = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = hash.split('?');
  const [name, sub] = pathPart.split('/');
  const params = new URLSearchParams(queryPart);
  let r = ROUTES.find(x => x[0] === name && allowed(x[2]));
  if (!r) { location.replace('#/' + (isAdmin() ? 'panel' : 'caja')); return; }
  root.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  const view = document.getElementById('view');
  const fresh = document.createElement('div'); // fresh container, so listeners from the previous view are dropped
  view.replaceChildren(fresh);
  window.scrollTo(0, 0);
  try { await r[1](fresh, params, sub); }
  catch (e) { console.error(e); fresh.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`; }
}

async function boot() {
  let status;
  try { status = await api('/status'); } catch (e) { root.innerHTML = `<div class="empty">No se puede conectar con el servidor.</div>`; return; }
  applyAppearance(status.appearance);
  let me = null;
  try { me = await api('/me'); } catch { /* not logged in */ }
  if (!me || status.needsSetup) return authScreen(status);
  state.user = me.user; state.settings = me.settings; state.today = me.today;
  state.categories = await api('/categories');
  applyAppearance(state.settings.appearance);
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* storage unavailable */ }
  layout();
  router();
}

window.addEventListener('hashchange', router);
window.addEventListener('layout-refresh', () => { layout(); router(); });
// If the app stays open overnight, reload when the day changes so "today" is right.
setInterval(async () => {
  if (!state.user) return;
  try { const me = await api('/me'); if (me.today !== state.today) location.reload(); } catch { /* ignore */ }
}, 5 * 60e3);

boot();
