// Boot, login screen, layout and hash-based navigation.
import { api, state, esc, icon, toast, modal, applyAppearance, isAdmin, can, on } from './core.js';
import { cashRegisterView } from './views/cash-register.js';
import { dashboardView } from './views/dashboard.js';
import { movementsView } from './views/movements.js';
import { ticketsView, invoicesView } from './views/invoices.js';
import { repairsView } from './views/repairs.js';
import { stockView } from './views/stock.js';
import { searchView } from './views/search.js';
import { customersView } from './views/customers.js';
import { purchasesView } from './views/purchases.js';
import { noticesView } from './views/notices.js';
import { filesView } from './views/files.js';
import { settingsView } from './views/settings.js';

const root = document.getElementById('root');
const MOBILE_BAR_LINKS = 4;
const DAY_CHECK_INTERVAL = 5 * 60e3;

// `segment` is the first part of the URL hash (#/caja). `access` decides who sees the screen.
// The menu lists the routes in this order, under the group titles of NAV_GROUPS.
const NAV_GROUPS = ['', 'Mostrador', 'Móviles', 'Gestión'];
const ROUTES = [
  { segment: 'buscar', view: searchView, access: 'all', icon: 'search', label: 'Buscar', group: '' },
  { segment: 'caja', view: cashRegisterView, access: 'all', icon: 'cash', label: 'Caja', group: 'Mostrador' },
  { segment: 'reparaciones', view: repairsView, access: 'repairs', icon: 'wrench', label: 'Reparaciones', group: 'Mostrador' },
  { segment: 'tickets', view: ticketsView, access: 'invoices', icon: 'receipt', label: 'Tickets', group: 'Mostrador' },
  { segment: 'facturas', view: invoicesView, access: 'invoices', icon: 'invoice', label: 'Facturas', group: 'Mostrador' },
  { segment: 'clientes', view: customersView, access: 'customers', icon: 'users', label: 'Clientes', group: 'Mostrador' },
  { segment: 'stock', view: stockView, access: 'stock', icon: 'phone', label: 'Stock', group: 'Móviles' },
  { segment: 'compras', view: purchasesView, access: 'purchases', icon: 'swap', label: 'Compras', group: 'Móviles' },
  { segment: 'panel', view: dashboardView, access: 'admin', icon: 'chart', label: 'Panel', group: 'Gestión' },
  { segment: 'movimientos', view: movementsView, access: 'admin', icon: 'list', label: 'Movimientos', group: 'Gestión' },
  { segment: 'comunicados', view: noticesView, access: 'notices', icon: 'file', label: 'Comunicados', group: 'Gestión' },
  { segment: 'archivos', view: filesView, access: 'files', icon: 'folder', label: 'Archivos', group: 'Gestión' },
  { segment: 'ajustes', view: settingsView, access: 'admin', icon: 'settings', label: 'Ajustes', group: 'Gestión' },
];
// The phone bar only fits four links, taken in this order of preference; the rest go in the "Más" sheet.
const MOBILE_BAR_PREFERENCE = ['caja', 'reparaciones', 'tickets', 'buscar', 'stock', 'facturas'];

function canAccess(access) {
  const { modules } = state.settings;
  switch (access) {
    case 'all': return true;
    case 'admin': return isAdmin();
    case 'invoices': return modules.invoices && can('worker_create_invoices');
    case 'repairs': return modules.repairs && can('worker_create_repairs');
    case 'stock': return modules.stock;
    case 'customers': return modules.customers;
    case 'notices': return modules.notices;
    case 'purchases': return modules.purchases && can('worker_create_purchases');
    case 'files': return modules.files && isAdmin();
    default: return false;
  }
}

// ---- Login / first-run setup
function renderAuthScreen(status) {
  const isSetup = status.needsSetup;
  const setupFields = `
    <label class="field">Nombre de la tienda<input name="shopName" value="${esc(status.shop.name)}" required></label>
    <label class="field">Tu nombre<input name="name" required></label>`;

  root.innerHTML = `
    <div class="auth"><div class="card">
      ${status.shop.logo ? `<img src="${esc(status.shop.logo)}" style="max-height:52px;margin-bottom:12px" alt="">` : ''}
      <h1>${isSetup ? 'Bienvenido' : esc(status.shop.name)}</h1>
      <div class="muted">${isSetup
        ? 'Primera puesta en marcha: crea la cuenta del administrador (dueño).'
        : 'Control de ventas · Entra con tu usuario'}</div>
      <form data-auth-form>
        ${isSetup ? setupFields : ''}
        <label class="field">Usuario
          <input name="username" autocomplete="username" autocapitalize="none" required>
        </label>
        <label class="field">Contraseña${isSetup ? ' <span class="hint">mínimo 6 caracteres</span>' : ''}
          <input name="password" type="password" autocomplete="${isSetup ? 'new-password' : 'current-password'}" required>
        </label>
        <button class="btn btn-primary" type="submit">${isSetup ? 'Crear y entrar' : 'Entrar'}</button>
      </form>
    </div></div>`;

  const form = root.querySelector('[data-auth-form]');
  setTimeout(() => form.querySelector('input').focus(), 30);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api(isSetup ? '/setup' : '/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      location.hash = '#/';
      boot();
    } catch (error) {
      toast(error.message, 'err');
    }
  });
}

// ---- Layout
const navLink = (route) => `<a href="#/${route.segment}" data-nav="${route.segment}">${icon(route.icon)}${route.label}</a>`;

// The sidebar menu: each group title followed by the links this user can open.
function groupedNavHtml(routes) {
  return NAV_GROUPS.map(group => {
    const links = routes.filter(route => route.group === group);
    if (!links.length) return '';
    return (group ? `<div class="sep">${group}</div>` : '') + links.map(navLink).join('');
  }).join('');
}

function renderLayout() {
  const { shop, appearance } = state.settings;
  const links = ROUTES.filter(route => canAccess(route.access));
  const mobileBar = MOBILE_BAR_PREFERENCE
    .map(segment => links.find(route => route.segment === segment))
    .filter(Boolean)
    .slice(0, MOBILE_BAR_LINKS);
  const mobileSheet = links.filter(route => !mobileBar.includes(route));
  const logo = shop.logo
    ? `<img src="${esc(shop.logo)}" alt="">`
    : `<span class="logo-fallback">${esc((shop.name || 'M')[0])}</span>`;

  root.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand">${logo}<div><b>${esc(shop.name)}</b><small>Control de ventas</small></div></div>
        <nav class="nav">${groupedNavHtml(links)}</nav>
        <div class="me">
          <b>${esc(state.user.name)}</b><span class="role-badge">${isAdmin() ? 'Administrador' : 'Trabajador'}</span>
          <div class="row" style="margin-top:10px;gap:4px">
            <button class="btn btn-ghost btn-sm" data-change-password title="Cambiar contraseña">${icon('key')}</button>
            <button class="btn btn-ghost btn-sm" data-theme-toggle title="Modo claro/oscuro">${icon(appearance.dark ? 'sun' : 'moon')}</button>
            <span class="spacer"></span>
            <button class="btn btn-ghost btn-sm" data-logout>${icon('logout')} Salir</button>
          </div>
        </div>
      </aside>
      <main class="main" id="view"></main>
      <nav class="mobile-bar">
        ${mobileBar.map(navLink).join('')}
        <a href="#" data-more>${icon('list')}Más</a>
      </nav>
      <div class="mobile-sheet hidden" data-sheet><div class="sheet-card">
        ${mobileSheet.map(navLink).join('')}
        <a href="#" data-change-password>${icon('key')}Cambiar contraseña</a>
        <a href="#" data-logout>${icon('logout')}Salir (${esc(state.user.name)})</a>
      </div></div>
    </div>`;

  const sheet = root.querySelector('[data-sheet]');
  on(root, 'click', '[data-logout]', (_, event) => { event.preventDefault(); logout(); });
  on(root, 'click', '[data-change-password]', (_, event) => { event.preventDefault(); openChangePassword(); });
  on(root, 'click', '[data-more]', (_, event) => { event.preventDefault(); sheet.classList.toggle('hidden'); });
  on(root, 'click', '[data-theme-toggle]', toggleTheme);
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet || event.target.closest('a')) sheet.classList.add('hidden');
  });
}

async function logout() {
  await api('/logout', { method: 'POST' });
  location.hash = '#/';
  location.reload();
}

// Per-device preference; the default theme is chosen in Settings.
function toggleTheme(button) {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch { /* storage unavailable */ }
  button.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
}

function applySavedTheme() {
  try {
    const theme = localStorage.getItem('theme');
    if (theme) document.documentElement.dataset.theme = theme;
  } catch { /* storage unavailable */ }
}

function openChangePassword() {
  modal({
    title: 'Cambiar mi contraseña',
    body: `
      <form data-password-form style="display:flex;flex-direction:column;gap:12px">
        <label class="field">Contraseña actual<input type="password" name="current" autocomplete="current-password"></label>
        <label class="field">Nueva contraseña o PIN<input type="password" name="password" autocomplete="new-password"></label>
      </form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>`,
    onMount: (dialog, close) => {
      dialog.querySelector('[data-ok]').onclick = async () => {
        const body = Object.fromEntries(new FormData(dialog.querySelector('[data-password-form]')));
        try {
          await api('/me/password', { method: 'POST', body });
          toast('Contraseña cambiada', 'ok');
          close();
        } catch (error) {
          toast(error.message, 'err');
        }
      };
    },
  });
}

// ---- Navigation
// Hash format: #/segment/sub?query  (for example #/facturas/nueva?venta=12)
async function renderCurrentRoute() {
  if (!state.user) return;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [segment, sub] = path.split('/');
  const route = ROUTES.find(candidate => candidate.segment === segment && canAccess(candidate.access));
  if (!route) {
    location.replace(`#/${isAdmin() ? 'panel' : 'caja'}`);
    return;
  }

  root.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === segment));
  // A fresh container per navigation drops the listeners of the previous screen.
  const container = document.createElement('div');
  document.getElementById('view').replaceChildren(container);
  window.scrollTo(0, 0);
  try {
    await route.view(container, new URLSearchParams(query), sub);
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="empty">Error: ${esc(error.message)}</div>`;
  }
}

async function boot() {
  let status;
  try {
    status = await api('/status');
  } catch {
    root.innerHTML = '<div class="empty">No se puede conectar con el servidor.</div>';
    return;
  }
  applyAppearance(status.appearance);

  let session = null;
  try { session = await api('/me'); } catch { /* not logged in */ }
  if (!session || status.needsSetup) return renderAuthScreen(status);

  state.user = session.user;
  state.settings = session.settings;
  state.today = session.today;
  state.categories = await api('/categories');
  applyAppearance(state.settings.appearance);
  applySavedTheme();
  renderLayout();
  renderCurrentRoute();
}

// If the app stays open overnight, reload when the day changes so "today" is right.
async function reloadOnNewDay() {
  if (!state.user) return;
  try {
    const session = await api('/me');
    if (session.today !== state.today) location.reload();
  } catch { /* ignore */ }
}

window.addEventListener('hashchange', renderCurrentRoute);
window.addEventListener('layout-refresh', () => { renderLayout(); renderCurrentRoute(); });
setInterval(reloadOnNewDay, DAY_CHECK_INTERVAL);

boot();
