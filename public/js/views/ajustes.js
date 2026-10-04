// Ajustes (estilo "panel de WordPress"): todo se configura desde aquí sin tocar código.
// Para añadir una opción nueva: añádela en DEFAULT_SETTINGS (src/db.js) y en SCHEMAS (abajo).
import { api, state, esc, icon, toast, modal, applyAppearance, moneyInput, parseMoney, today, confirmDialog } from '../core.js';

const TABS = [
  ['tienda', 'Tienda'], ['apariencia', 'Apariencia'], ['productos', 'Productos'], ['gastos', 'Motivos de gasto'],
  ['usuarios', 'Usuarios'], ['permisos', 'Permisos'], ['ventas', 'Ventas'], ['facturas', 'Tickets y facturas'], ['archivos', 'Archivos'], ['modulos', 'Módulos'], ['datos', 'Datos y copias'],
];

// Formularios generados automáticamente a partir de este esquema
const SCHEMAS = {
  tienda: { key: 'shop', intro: 'Estos datos aparecen en el PDF de cada ticket y factura. Como autónomo, en las facturas deben figurar tu nombre y apellidos y tu NIF (el nombre comercial es opcional).', fields: [
    ['name', 'text', 'Nombre comercial', 'El nombre grande de arriba (ej. Movil City)'],
    ['legal_name', 'text', 'Nombre y apellidos del titular', 'Obligatorio en facturas (o razón social si es una sociedad)'],
    ['nif', 'text', 'NIF', 'Obligatorio en tickets y facturas'],
    ['address1', 'text', 'Dirección (línea 1)'], ['address2', 'text', 'Dirección (línea 2)', 'CP, ciudad, provincia'],
    ['phone', 'text', 'Teléfono'], ['email', 'text', 'Email'], ['logo', 'image', 'Logo', 'PNG/JPG, se muestra en facturas y en el menú', true],
  ] },
  apariencia: { key: 'appearance', fields: [
    ['appName', 'text', 'Nombre de la aplicación', 'Se ve en la pestaña del navegador'],
    ['primary', 'color', 'Color principal'], ['accent', 'color', 'Color de acento'],
    ['dark', 'bool', 'Modo oscuro', 'Útil si la pantalla está muchas horas encendida'],
    ['density', 'select', 'Densidad', '', false, [['normal', 'Normal'], ['compact', 'Compacta']]],
  ] },
  permisos: { key: 'permissions', intro: 'Qué puede ver y hacer un TRABAJADOR. Los administradores lo ven todo. Estos límites se aplican en el servidor: aunque alguien sepa programar, no puede saltárselos desde el navegador.', fields: [
    ['worker_see_daily_sales', 'bool', 'Ver el total vendido del día'],
    ['worker_see_daily_profit', 'bool', 'Ver el beneficio (por venta y total del día)'],
    ['worker_see_daily_expenses', 'bool', 'Ver todos los gastos del día', 'Si está desactivado, solo ve los gastos que él mismo registra'],
    ['worker_add_expenses', 'bool', 'Puede registrar gastos'],
    ['worker_create_invoices', 'bool', 'Puede hacer facturas y tickets'],
    ['worker_edit_minutes', 'number', 'Minutos para corregir o borrar sus propios apuntes', '0 = nunca. Pasado este tiempo, solo el administrador puede corregir.'],
    ['worker_history_days', 'number', 'Días anteriores que puede consultar', '0 = solo el día de hoy'],
  ] },
  ventas: { key: 'sales', fields: [
    ['profit_input', 'select', 'Cómo se apunta la ganancia', 'Con "ambos", al escribir el coste se calcula el beneficio y viceversa', true,
      [['both', 'Coste y beneficio (se calculan entre sí)'], ['profit', 'Solo beneficio (como en tu hoja)'], ['cost', 'Solo coste (el beneficio se calcula)']]],
    ['ask_payment_method', 'bool', 'Preguntar forma de pago', 'Permite cuadrar el efectivo de la caja al cerrar'],
    ['payment_methods', 'list', 'Formas de pago', 'Una por línea', true],
    ['require_description_over', 'number', 'Descripción obligatoria a partir de (€)', 'Ej.: 100 → al vender un móvil obliga a poner modelo/IMEI. 0 = nunca'],
  ] },
  facturas: { key: 'invoice', intro: 'Tickets y facturas llevan series de numeración separadas, como exige la normativa. Los números son correlativos: no los cambies una vez empezado el año salvo para corregir un error.', fields: [
    ['ticket_prefix', 'text', 'Serie de tickets (prefijo)', 'Ej.: "T-" → T-1, T-2…'], ['ticket_next_number', 'number', 'Próximo número de ticket'],
    ['prefix', 'text', 'Serie de facturas (prefijo)', 'Ej.: "F-" o "2026-"'], ['next_number', 'number', 'Próximo número de factura'],
    ['ticket_title', 'text', 'Título en tickets', 'Nombre legal: "Factura simplificada"'], ['title', 'text', 'Título en facturas'],
    ['ticket_format', 'select', 'Formato de impresión de los tickets', '', false, [['ticket', 'Ticket térmico 80 mm'], ['a4', 'Folio A4 (mismo diseño que la factura)']]],
    ['warranties', 'pairs', 'Tipos de garantía', 'Nombre y texto que se imprime. Asigna uno a cada producto en Ajustes → Productos; se puede cambiar en cada línea del ticket o factura.', true],
    ['footer', 'textarea', 'Pie de página', 'Ej.: datos registrales, política de devoluciones…', true],
    ['show_vat', 'bool', 'Desglosar IVA por defecto', 'Valor inicial del interruptor "Desglosar IVA" al hacer un ticket o factura'],
    ['vat_rate', 'number', 'Tipo de IVA (%)'],
    ['color_shop', 'color', 'Color del nombre de la tienda'], ['color_title', 'color', 'Color del título y cabeceras'], ['color_accent', 'color', 'Color de fecha y total'],
  ] },
  modulos: { key: 'modules', intro: 'Activa o desactiva partes de la aplicación (como los plugins de WordPress).', fields: [
    ['invoices', 'bool', 'Tickets y facturas'], ['payment_methods', 'bool', 'Formas de pago'], ['files', 'bool', 'Archivos de la tienda', 'Solo visible para administradores'],
  ] },
  archivos: { key: 'files', intro: 'Los archivos se guardan en la carpeta data/files del servidor y solo los administradores pueden verlos o descargarlos.', fields: [
    ['folders', 'list', 'Carpetas sugeridas', 'Una por línea. También puedes escribir una carpeta nueva al subir.', true],
    ['max_mb', 'number', 'Tamaño máximo por archivo (MB)'],
  ] },
};

export async function ajustesView(root, params) {
  const tab = params.get('tab') || 'tienda';
  root.innerHTML = `
    <div class="page-head"><div><h1>Ajustes</h1><div class="sub">Personaliza la aplicación a tu manera</div></div></div>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/ajustes?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div data-body></div>`;
  const body = root.querySelector('[data-body]');
  if (SCHEMAS[tab]) return schemaForm(body, SCHEMAS[tab]);
  if (tab === 'productos') return categoriesTab(body, 'sale');
  if (tab === 'gastos') return categoriesTab(body, 'expense');
  if (tab === 'usuarios') return usersTab(body);
  if (tab === 'datos') return dataTab(body);
}

// ------------------------------------------------------------------ formulario genérico
const pairRow = (pair = { name: '', text: '' }) => `<div class="pair">
  <input type="text" data-pair-name placeholder="Nombre" value="${esc(pair.name)}">
  <input type="text" data-pair-text placeholder="Texto que se imprime" value="${esc(pair.text)}">
  <button type="button" class="btn btn-ghost btn-icon" data-pair-remove title="Quitar">${icon('trash')}</button></div>`;

async function schemaForm(body, schema) {
  const values = (await api('/admin/settings'))[schema.key];
  const field = ([name, type, label, hint = '', wide = false, options = []]) => {
    const v = values[name];
    const h = hint ? `<span class="hint">${esc(hint)}</span>` : '';
    const cls = `field ${wide ? 'wide' : ''}`;
    switch (type) {
      case 'bool': return `<label class="check ${wide ? 'wide' : ''}"><input type="checkbox" name="${name}" ${v ? 'checked' : ''}><span><b>${esc(label)}</b>${hint ? `<span class="muted">${esc(hint)}</span>` : ''}</span></label>`;
      case 'number': return `<label class="${cls}">${esc(label)} ${h}<input type="number" name="${name}" value="${esc(v)}" step="any"></label>`;
      case 'textarea': return `<label class="${cls}">${esc(label)} ${h}<textarea name="${name}" rows="2">${esc(v)}</textarea></label>`;
      case 'color': return `<label class="${cls}">${esc(label)} ${h}<span class="color-input"><input type="color" name="${name}" value="${esc(v)}"><code>${esc(v)}</code></span></label>`;
      case 'select': return `<label class="${cls}">${esc(label)} ${h}<select name="${name}">${options.map(([ov, ol]) => `<option value="${ov}" ${ov === v ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select></label>`;
      case 'pairs': return `<div class="${cls}">${esc(label)} ${h}<div class="pairs-edit" data-pairs="${name}">${(v || []).map(pairRow).join('')}</div>
          <div><button type="button" class="btn btn-sm" data-pair-add="${name}">${icon('plus')} Añadir</button></div></div>`;
      case 'list': return `<label class="${cls}">${esc(label)} ${h}<textarea name="${name}" data-list rows="4">${esc((v || []).join('\n'))}</textarea></label>`;
      case 'image': return `<div class="${cls}">${esc(label)} ${h}<div class="row">
          <img data-img-preview src="${esc(v || '')}" style="max-height:56px;max-width:180px;border:1px solid var(--border);border-radius:8px;padding:4px;${v ? '' : 'display:none'}">
          <input type="file" accept="image/*" data-img="${name}"><input type="hidden" name="${name}" value="${esc(v || '')}">
          <button type="button" class="btn btn-sm" data-img-clear>Quitar</button></div></div>`;
      default: return `<label class="${cls}">${esc(label)} ${h}<input type="text" name="${name}" value="${esc(v)}"></label>`;
    }
  };
  body.innerHTML = `<form class="card card-pad" data-form style="max-width:900px">
    ${schema.intro ? `<div class="notice" style="margin-bottom:16px">${esc(schema.intro)}</div>` : ''}
    <div class="settings-grid">${schema.fields.map(field).join('')}</div>
    <div class="row" style="margin-top:18px"><button class="btn btn-primary" type="submit">Guardar cambios</button><span class="faint" data-status></span></div>
  </form>`;
  const form = body.querySelector('[data-form]');

  form.querySelectorAll('input[type=color]').forEach(c => c.addEventListener('input', () => { c.nextElementSibling.textContent = c.value; }));
  form.querySelectorAll('[data-img]').forEach(inp => inp.addEventListener('change', () => {
    const file = inp.files[0]; if (!file) return;
    resizeImage(file, 400).then(url => {
      form.elements[inp.dataset.img].value = url;
      const p = form.querySelector('[data-img-preview]'); p.src = url; p.style.display = '';
    });
  }));
  form.addEventListener('click', (e) => {
    const add = e.target.closest('[data-pair-add]');
    if (add) form.querySelector(`[data-pairs="${add.dataset.pairAdd}"]`).insertAdjacentHTML('beforeend', pairRow());
    const remove = e.target.closest('[data-pair-remove]');
    if (remove) remove.closest('.pair').remove();
  });
  const clr = form.querySelector('[data-img-clear]');
  if (clr) clr.addEventListener('click', () => { form.querySelector('input[type=hidden]').value = ''; form.querySelector('[data-img-preview]').style.display = 'none'; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = {};
    for (const [name, type] of schema.fields) {
      if (type === 'pairs') {
        out[name] = [...form.querySelectorAll(`[data-pairs="${name}"] .pair`)].map(row => ({
          name: row.querySelector('[data-pair-name]').value.trim(), text: row.querySelector('[data-pair-text]').value.trim(),
        })).filter(pair => pair.name);
        continue;
      }
      const el = form.elements[name]; if (!el) continue;
      if (type === 'bool') out[name] = el.checked;
      else if (type === 'number') out[name] = Number(el.value);
      else if (type === 'list') out[name] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
      else out[name] = el.value;
    }
    try {
      const saved = await api(`/admin/settings/${schema.key}`, { method: 'PUT', body: out });
      state.settings[schema.key] = saved;
      if (schema.key === 'appearance') applyAppearance(saved);
      if (['shop', 'appearance', 'modules'].includes(schema.key)) window.dispatchEvent(new Event('layout-refresh'));
      toast('Ajustes guardados', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
}

function resizeImage(file, max) {
  return new Promise((resolve) => {
    const img = new Image(); const r = new FileReader();
    r.onload = () => { img.src = r.result; };
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    r.readAsDataURL(file);
  });
}

// ------------------------------------------------------------------ categorías
async function categoriesTab(body, kind) {
  const isSale = kind === 'sale';
  let cats = (await api('/categories?all=1')).filter(c => c.kind === kind);
  cats.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const warranties = state.settings.invoice.warranties.map(w => w.name);

  body.innerHTML = `
    <div class="notice" style="margin-bottom:14px">${isSale
      ? 'Los productos <b>favoritos</b> (★) salen primero al registrar una venta. Puedes poner un precio y beneficio sugeridos que se rellenan solos. Desactivar un producto lo oculta sin borrar su historial.'
      : 'Marca como <b>Mercancía</b> las compras de producto para revender (móviles, fundas…) y como <b>Operativo</b> el resto (alquiler, luz, comida…). Así el beneficio neto no cuenta dos veces lo que ya restaste en cada venta.'}</div>
    <form class="card card-pad" data-new style="margin-bottom:14px">
      <div class="row">
        <input type="color" name="color" value="#2a78d6" class="swatch" style="width:38px;height:38px">
        <input type="text" name="name" placeholder="${isSale ? 'Nuevo producto o servicio…' : 'Nuevo motivo de gasto…'}" style="flex:1;min-width:180px" required>
        ${isSale ? '' : '<select name="expense_type" style="width:auto"><option value="stock">Mercancía</option><option value="operating">Operativo</option></select>'}
        <button class="btn btn-primary" type="submit">${icon('plus')} Añadir</button>
      </div>
    </form>
    <div class="card"><div class="table-wrap" data-list></div></div>`;

  const list = body.querySelector('[data-list]');
  function draw() {
    list.innerHTML = `<table class="t"><thead><tr><th style="width:70px">Orden</th><th>Color</th><th>Nombre</th>
      ${isSale ? '<th>Precio sugerido</th><th>Beneficio sugerido</th><th>Garantía</th><th>Favorito</th>' : '<th>Tipo</th>'}<th>Activo</th></tr></thead>
      <tbody>${cats.map((c, i) => `<tr data-id="${c.id}" style="${c.active ? '' : 'opacity:.5'}">
        <td><div class="row" style="gap:0"><button class="btn btn-ghost btn-icon" data-up ${i === 0 ? 'disabled' : ''}>${icon('up')}</button><button class="btn btn-ghost btn-icon" data-down ${i === cats.length - 1 ? 'disabled' : ''}>${icon('down')}</button></div></td>
        <td><input type="color" class="swatch" data-f="color" value="${esc(c.color)}"></td>
        <td><input type="text" data-f="name" value="${esc(c.name)}" style="min-width:160px"></td>
        ${isSale ? `<td><input type="text" data-f="default_price" inputmode="decimal" placeholder="—" value="${c.default_price == null ? '' : moneyInput(c.default_price)}" style="width:100px"></td>
          <td><input type="text" data-f="default_profit" inputmode="decimal" placeholder="—" value="${c.default_profit == null ? '' : moneyInput(c.default_profit)}" style="width:100px"></td>
          <td><select data-f="warranty" style="width:auto">${['', ...warranties].map(w => `<option value="${esc(w)}" ${w === (c.warranty || '') ? 'selected' : ''}>${w ? esc(w) : 'Sin garantía'}</option>`).join('')}</select></td>
          <td><button class="btn btn-ghost btn-icon" data-fav title="Favorito" style="color:${c.favorite ? '#eab308' : 'var(--text-3)'}">${icon('star')}</button></td>`
        : `<td><select data-f="expense_type" style="width:auto"><option value="stock" ${c.expense_type === 'stock' ? 'selected' : ''}>Mercancía</option><option value="operating" ${c.expense_type !== 'stock' ? 'selected' : ''}>Operativo</option></select></td>`}
        <td><input type="checkbox" data-f="active" ${c.active ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary)"></td>
      </tr>`).join('')}</tbody></table>`;
  }
  async function saveCat(c) {
    try { await api(`/admin/categories/${c.id}`, { method: 'PUT', body: c }); toast('Guardado', 'ok'); await refreshCategories(); }
    catch (e) { toast(e.message, 'err'); }
  }
  list.addEventListener('change', (e) => {
    const tr = e.target.closest('[data-id]'); const f = e.target.dataset.f; if (!tr || !f) return;
    const c = cats.find(x => x.id === Number(tr.dataset.id));
    if (f === 'active') c.active = e.target.checked ? 1 : 0;
    else if (f === 'default_price' || f === 'default_profit') { const n = parseMoney(e.target.value); c[f] = Number.isFinite(n) ? n : null; }
    else c[f] = e.target.value;
    saveCat(c); if (f === 'active') draw();
  });
  list.addEventListener('click', async (e) => {
    const tr = e.target.closest('[data-id]'); if (!tr) return;
    const i = cats.findIndex(x => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-fav]')) { cats[i].favorite = cats[i].favorite ? 0 : 1; draw(); return saveCat(cats[i]); }
    const dir = e.target.closest('[data-up]') ? -1 : e.target.closest('[data-down]') ? 1 : 0;
    if (!dir) return;
    [cats[i], cats[i + dir]] = [cats[i + dir], cats[i]];
    draw();
    await api('/admin/categories/reorder', { method: 'POST', body: { ids: cats.map(c => c.id) } });
    await refreshCategories();
  });
  body.querySelector('[data-new]').addEventListener('submit', async (e) => {
    e.preventDefault(); const v = (n) => e.target.elements.namedItem(n);
    try {
      await api('/admin/categories', { method: 'POST', body: { kind, name: v('name').value, color: v('color').value, expense_type: v('expense_type') ? v('expense_type').value : undefined } });
      toast('Añadido', 'ok'); await refreshCategories(); categoriesTab(body, kind);
    } catch (err) { toast(err.message, 'err'); }
  });
  draw();
}

async function refreshCategories() { state.categories = await api('/categories'); }

// ------------------------------------------------------------------ usuarios
async function usersTab(body) {
  const users = await api('/admin/users');
  body.innerHTML = `
    <div class="row" style="margin-bottom:14px"><div class="muted">Cada persona entra con su usuario: así sabes quién registra cada venta.</div><span class="spacer"></span>
      <button class="btn btn-primary" data-new>${icon('plus')} Nuevo usuario</button></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Alta</th><th></th></tr></thead>
      <tbody>${users.map(u => `<tr><td><b>${esc(u.name)}</b>${u.id === state.user.id ? ' <span class="faint">(tú)</span>' : ''}</td><td class="muted">${esc(u.username)}</td>
        <td><span class="role-badge">${u.role === 'admin' ? 'Administrador' : 'Trabajador'}</span></td>
        <td>${u.active ? 'Activo' : '<span class="neg">Desactivado</span>'}</td><td class="faint">${esc(String(u.created_at).slice(0, 10))}</td>
        <td class="r"><button class="btn btn-sm" data-edit="${u.id}">${icon('edit')} Editar</button></td></tr>`).join('')}</tbody></table></div></div>`;

  const open = (u) => modal({
    title: u ? `Editar ${u.name}` : 'Nuevo usuario',
    body: `<form data-uf class="settings-grid">
      <label class="field">Nombre<input type="text" name="name" value="${esc(u ? u.name : '')}" required></label>
      <label class="field">Usuario (para entrar)<input type="text" name="username" value="${esc(u ? u.username : '')}" ${u ? 'disabled' : ''} required autocapitalize="none"></label>
      <label class="field">Rol<select name="role"><option value="worker">Trabajador</option><option value="admin" ${u && u.role === 'admin' ? 'selected' : ''}>Administrador / dueño</option></select></label>
      <label class="field">${u ? 'Nueva contraseña o PIN' : 'Contraseña o PIN'} <span class="hint">${u ? 'déjalo vacío para no cambiarla' : 'mínimo 4 caracteres'}</span><input type="password" name="password" autocomplete="new-password"></label>
      ${u ? `<label class="check wide"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}><span><b>Activo</b><span class="muted">Desactívalo cuando alguien deje de trabajar contigo (se conserva su historial).</span></span></label>` : ''}
    </form>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>`,
    onMount: (el, close) => {
      el.querySelector('[data-ok]').onclick = async () => {
        const f = el.querySelector('[data-uf]'); const v = (n) => f.elements.namedItem(n);
        const b = { name: v('name').value, role: v('role').value, password: v('password').value };
        try {
          if (u) { b.active = v('active').checked; await api(`/admin/users/${u.id}`, { method: 'PUT', body: b }); }
          else { b.username = v('username').value; await api('/admin/users', { method: 'POST', body: b }); }
          toast('Usuario guardado', 'ok'); close(); usersTab(body);
        } catch (e) { toast(e.message, 'err'); }
      };
    },
  });
  body.querySelector('[data-new]').onclick = () => open(null);
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => open(users.find(u => u.id === Number(b.dataset.edit))));
}

// ------------------------------------------------------------------ datos
function dataTab(body) {
  const t = today();
  body.innerHTML = `
    <div class="grid-2">
      <div class="card card-pad">
        <h3>Exportar a Excel (CSV)</h3>
        <p class="muted" style="margin-top:0">Descarga los movimientos de un periodo. Se abre directamente con Excel o Google Sheets.</p>
        <div class="row"><input type="date" data-from value="${t.slice(0, 5)}01-01" style="width:auto"> – <input type="date" data-to value="${t}" style="width:auto">
          <a class="btn" data-export>${icon('download')} Descargar CSV</a></div>
      </div>
      <div class="card card-pad">
        <h3>Copia de seguridad</h3>
        <p class="muted" style="margin-top:0">La app guarda una copia automática cada día en <code>data/backups</code> (últimos 30 días). Aquí puedes descargar una copia de la base de datos ahora (ventas, facturas, ajustes). <b>Los archivos de la tienda no van dentro</b>: están en <code>data/files</code>; en Umbrel, activa las copias de seguridad de la app para incluirlos.</p>
        <a class="btn btn-primary" href="/api/admin/backup">${icon('download')} Descargar copia (.db)</a>
      </div>
      <div class="card card-pad wide" style="grid-column:1/-1">
        <h3>Importar movimientos desde CSV</h3>
        <p class="muted" style="margin-top:0">Para traer datos de tus hojas antiguas. Columnas mínimas: <code>fecha; categoria; importe</code>. Opcionales: <code>tipo</code> (venta/gasto), <code>beneficio</code>, <code>descripcion</code>, <code>metodo_pago</code>, <code>tipo_gasto</code>. Las categorías que no existan se crean solas.</p>
        <div class="row"><input type="file" accept=".csv,text/csv" data-file><button class="btn" data-import disabled>${icon('upload')} Importar</button></div>
        <pre class="faint" style="font-size:12px;margin:12px 0 0;white-space:pre-wrap;word-break:break-all">fecha;tipo;categoria;descripcion;importe;beneficio;metodo_pago
01/09/2026;venta;Tarjeta SIM;;15,00;12,00;Efectivo
01/09/2026;gasto;Compra de móviles;mobile iphone 17;650,00;;</pre>
        <div data-result style="margin-top:10px"></div>
      </div>
    </div>`;
  const ex = body.querySelector('[data-export]');
  const upd = () => { ex.href = `/api/admin/export.csv?from=${body.querySelector('[data-from]').value}&to=${body.querySelector('[data-to]').value}`; };
  body.querySelectorAll('[data-from],[data-to]').forEach(i => i.addEventListener('change', upd)); upd();
  const file = body.querySelector('[data-file]'), btn = body.querySelector('[data-import]');
  file.addEventListener('change', () => { btn.disabled = !file.files.length; });
  btn.addEventListener('click', async () => {
    const text = await file.files[0].text();
    const n = text.split('\n').filter(l => l.trim()).length - 1;
    if (!(await confirmDialog(`Se van a importar ${n} filas. ¿Continuar?`))) return;
    try {
      const r = await api('/admin/import', { method: 'POST', body: { csv: text } });
      body.querySelector('[data-result]').innerHTML = `<div class="notice">Importados <b>${r.imported}</b> movimientos.${r.errors.length ? `<br>${r.errors.map(esc).join('<br>')}` : ''}</div>`;
      await refreshCategories();
    } catch (e) { toast(e.message, 'err'); }
  });
}
