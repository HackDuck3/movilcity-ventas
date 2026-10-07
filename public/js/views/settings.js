// Settings screen. To add an option: add it to DEFAULT_SETTINGS (src/defaults.js) and to a section of SCHEMAS below.
import {
  api, state, esc, icon, toast, modal, applyAppearance, moneyInput, parseMoney, today, confirmDialog, on, reloadView, tryApi,
} from '../core.js';
import { guillocheBand, emblem } from '../security-pattern.js';
import { paperSeed, initialsOf } from '../paper.js';

// The settings menu. A tab is either a form generated from SCHEMAS or one of the custom screens in CUSTOM_TABS.
const TAB_GROUPS = [
  { title: 'Negocio', tabs: [['tienda', 'Tienda'], ['apariencia', 'Apariencia'], ['modulos', 'Módulos']] },
  { title: 'Catálogo', tabs: [['productos', 'Productos'], ['gastos', 'Motivos de gasto']] },
  { title: 'Equipo', tabs: [['usuarios', 'Usuarios'], ['permisos', 'Permisos']] },
  { title: 'Mostrador', tabs: [['ventas', 'Ventas'], ['facturas', 'Tickets y facturas'], ['reparaciones', 'Reparaciones'], ['compras', 'Compras']] },
  { title: 'Datos', tabs: [['archivos', 'Archivos'], ['datos', 'Datos y copias']] },
];
const DEFAULT_TAB = 'tienda';

// Each schema becomes a form. `key` is the settings group it edits; fields are grouped under section titles.
// Field types: text, textarea, longtext, number, bool, color, select (needs options), list (one per line),
// pairs (name + text rows), image and pattern (the seed of the security paper, with a preview).
const SCHEMAS = {
  tienda: {
    key: 'shop',
    intro: 'Estos datos aparecen en todos los documentos que imprimes. En las facturas son obligatorios el nombre del titular y el NIF.',
    sections: [
      {
        title: 'Nombre y logo',
        fields: [
          { name: 'name', type: 'text', label: 'Nombre comercial', hint: 'El nombre grande de los documentos y del menú' },
          { name: 'logo', type: 'image', label: 'Logo', hint: 'PNG o JPG' },
        ],
      },
      {
        title: 'Datos fiscales',
        fields: [
          { name: 'legal_name', type: 'text', label: 'Titular', hint: 'Nombre y apellidos, o razón social' },
          { name: 'nif', type: 'text', label: 'NIF' },
          { name: 'address1', type: 'text', label: 'Dirección', hint: 'Calle y número' },
          { name: 'address2', type: 'text', label: 'Código postal y ciudad' },
        ],
      },
      {
        title: 'Contacto',
        fields: [
          { name: 'phone', type: 'text', label: 'Teléfono' },
          { name: 'email', type: 'text', label: 'Email' },
        ],
      },
    ],
  },
  apariencia: {
    key: 'appearance',
    sections: [
      {
        fields: [
          { name: 'appName', type: 'text', label: 'Nombre de la aplicación', hint: 'Se ve en la pestaña del navegador', wide: true },
          { name: 'primary', type: 'color', label: 'Color principal' },
          { name: 'accent', type: 'color', label: 'Color de acento' },
          { name: 'dark', type: 'bool', label: 'Modo oscuro', hint: 'Útil si la pantalla está muchas horas encendida' },
          { name: 'density', type: 'select', label: 'Densidad', options: [['normal', 'Normal'], ['compact', 'Compacta']] },
        ],
      },
    ],
  },
  modulos: {
    key: 'modules',
    intro: 'Activa solo las partes de la aplicación que uses. Las desactivadas desaparecen del menú; sus datos no se borran.',
    sections: [
      {
        title: 'Secciones del menú',
        fields: [
          { name: 'invoices', type: 'bool', label: 'Tickets y facturas' },
          { name: 'repairs', type: 'bool', label: 'Reparaciones' },
          { name: 'stock', type: 'bool', label: 'Stock de móviles' },
          { name: 'purchases', type: 'bool', label: 'Compras de segunda mano' },
          { name: 'files', type: 'bool', label: 'Archivos de la tienda', hint: 'Solo visible para administradores' },
        ],
      },
      {
        title: 'Opciones',
        fields: [
          { name: 'payment_methods', type: 'bool', label: 'Formas de pago', hint: 'Apuntar cómo se cobra cada venta' },
        ],
      },
    ],
  },
  permisos: {
    key: 'permissions',
    intro: 'Lo que puede ver y hacer un trabajador. Los administradores lo ven todo. Estos límites los aplica el servidor: no se pueden saltar desde el navegador.',
    sections: [
      {
        title: 'Qué ve',
        fields: [
          { name: 'worker_see_daily_sales', type: 'bool', label: 'El total vendido del día' },
          { name: 'worker_see_daily_profit', type: 'bool', label: 'El beneficio', hint: 'Por venta y total del día; también el coste de los móviles en stock' },
          { name: 'worker_see_daily_expenses', type: 'bool', label: 'Todos los gastos del día', hint: 'Desactivado: solo los gastos que él mismo registra' },
          { name: 'worker_history_days', type: 'number', label: 'Días anteriores que puede consultar', hint: '0 = solo hoy' },
        ],
      },
      {
        title: 'Qué puede hacer',
        fields: [
          { name: 'worker_add_expenses', type: 'bool', label: 'Registrar gastos' },
          { name: 'worker_create_invoices', type: 'bool', label: 'Hacer tickets y facturas' },
          { name: 'worker_create_repairs', type: 'bool', label: 'Gestionar reparaciones' },
          { name: 'worker_create_purchases', type: 'bool', label: 'Comprar móviles de segunda mano', hint: 'Verá los datos de los vendedores, pero no las fotos de DNI ya guardadas' },
          { name: 'worker_edit_minutes', type: 'number', label: 'Minutos para corregir o borrar sus apuntes', hint: '0 = nunca. Después solo puede el administrador' },
        ],
      },
    ],
  },
  ventas: {
    key: 'sales',
    sections: [
      {
        title: 'Beneficio',
        fields: [
          {
            name: 'profit_input', type: 'select', label: 'Cómo se apunta la ganancia de cada venta', wide: true,
            options: [['both', 'Coste y beneficio (cada uno calcula el otro)'], ['profit', 'Solo beneficio'], ['cost', 'Solo coste (el beneficio se calcula)']],
          },
        ],
      },
      {
        title: 'Formas de pago',
        fields: [
          { name: 'ask_payment_method', type: 'bool', label: 'Preguntar la forma de pago', hint: 'Permite cuadrar el efectivo al cerrar', wide: true },
          { name: 'payment_methods', type: 'list', label: 'Formas de pago', hint: 'Una por línea', wide: true },
        ],
      },
      {
        title: 'Descripción',
        fields: [
          { name: 'require_description_over', type: 'number', label: 'Obligatoria a partir de (€)', hint: 'Ej.: 100 obliga a anotar modelo o IMEI al vender un móvil. 0 = nunca' },
        ],
      },
    ],
  },
  facturas: {
    key: 'invoice',
    intro: 'Tickets y facturas llevan series de numeración separadas y correlativas. No cambies los números a mitad de año salvo para corregir un error.',
    sections: [
      {
        title: 'Numeración',
        fields: [
          { name: 'ticket_prefix', type: 'text', label: 'Serie de tickets (prefijo)', hint: 'Ej.: "T-" → T-1, T-2…' },
          { name: 'ticket_next_number', type: 'number', label: 'Próximo número de ticket' },
          { name: 'prefix', type: 'text', label: 'Serie de facturas (prefijo)', hint: 'Ej.: "F-" o "2026-"' },
          { name: 'next_number', type: 'number', label: 'Próximo número de factura' },
        ],
      },
      {
        title: 'Textos',
        fields: [
          { name: 'ticket_title', type: 'text', label: 'Título de los tickets', hint: 'Nombre legal: "Factura simplificada"' },
          { name: 'title', type: 'text', label: 'Título de las facturas' },
          { name: 'footer', type: 'textarea', label: 'Pie de página', hint: 'Ej.: política de devoluciones', wide: true },
        ],
      },
      {
        title: 'Garantías',
        fields: [
          { name: 'warranties', type: 'pairs', label: 'Tipos de garantía', wide: true, hint: 'Nombre y texto que se imprime. Cada producto tiene el suyo en Productos y se puede cambiar en cada línea.' },
        ],
      },
      {
        title: 'IVA',
        fields: [
          { name: 'show_vat', type: 'bool', label: 'Desglosar IVA por defecto', hint: 'Valor inicial del interruptor al hacer un ticket o factura' },
          { name: 'vat_rate', type: 'number', label: 'Tipo de IVA (%)' },
        ],
      },
      {
        title: 'Impresión de tickets',
        fields: [
          { name: 'ticket_format', type: 'select', label: 'Dónde se imprimen', options: [['ticket', 'Impresora térmica de tickets'], ['a4', 'Folio A4, con el diseño de la factura']] },
          { name: 'paper_width', type: 'select', label: 'Ancho del papel térmico', hint: 'Lo indica la etiqueta de la impresora', options: [['58', '58 mm'], ['80', '80 mm']] },
          { name: 'qr_url', type: 'text', label: 'Enlace del código QR al pie', hint: 'Ej.: tus reseñas de Google o https://wa.me/34600000000. Vacío = sin QR', wide: true },
          { name: 'qr_caption', type: 'text', label: 'Texto bajo el código QR' },
        ],
      },
      {
        title: 'Diseño de la factura',
        fields: [
          {
            name: 'paper_style', type: 'select', label: 'Papel', wide: true,
            options: [['security', 'Papel de seguridad: marco, marca de agua, emblema y microtexto'], ['plain', 'Liso, sin dibujos']],
          },
          {
            name: 'paper_seed', type: 'pattern', label: 'Dibujo del papel', wide: true,
            hint: 'Cada texto da un dibujo distinto. Vacío: el que sale del nombre y el NIF de tu tienda',
          },
          { name: 'color_shop', type: 'color', label: 'Color del nombre de la tienda' },
          { name: 'color_title', type: 'color', label: 'Color del título, las cabeceras y el dibujo' },
          { name: 'color_accent', type: 'color', label: 'Color del total y segundo color del dibujo' },
        ],
      },
    ],
  },
  reparaciones: {
    key: 'repairs',
    sections: [
      {
        title: 'Numeración',
        fields: [
          { name: 'prefix', type: 'text', label: 'Serie (prefijo)', hint: 'Ej.: "R-" → R-1, R-2…' },
          { name: 'next_number', type: 'number', label: 'Próximo número' },
        ],
      },
      {
        title: 'Resguardo',
        fields: [
          { name: 'print_format', type: 'select', label: 'Formato', wide: true, options: [['a4', 'Folio A4 apaisado con dos copias (cliente y tienda)'], ['ticket', 'Impresora térmica de tickets']] },
          { name: 'faults', type: 'list', label: 'Reparaciones habituales', hint: 'Una por línea. Son las casillas que se marcan al recibir un móvil', wide: true, rows: 8 },
          { name: 'disclaimer', type: 'textarea', label: 'Aviso destacado', wide: true },
          { name: 'conditions', type: 'longtext', label: 'Condiciones del servicio', hint: 'Un párrafo por línea', wide: true },
        ],
      },
      {
        title: 'Avisos',
        fields: [
          { name: 'reminder_days', type: 'number', label: 'Avisar de reparaciones sin recoger tras (días)' },
          { name: 'ready_message', type: 'textarea', label: 'Mensaje de WhatsApp "ya está listo"', hint: 'Admite {nombre}, {terminal}, {numero}, {importe} y {tienda}', wide: true },
        ],
      },
    ],
  },
  compras: {
    key: 'purchases',
    intro: 'Contrato para comprar móviles de segunda mano a particulares. Las cláusulas son un borrador: pide a tu gestoría que las revise.',
    sections: [
      {
        title: 'Numeración',
        fields: [
          { name: 'prefix', type: 'text', label: 'Serie (prefijo)', hint: 'Ej.: "C-" → C-1, C-2…' },
          { name: 'next_number', type: 'number', label: 'Próximo número' },
        ],
      },
      {
        title: 'Contrato',
        fields: [
          { name: 'terms', type: 'longtext', label: 'Cláusulas', hint: 'Un párrafo por línea', wide: true },
        ],
      },
    ],
  },
  archivos: {
    key: 'files',
    intro: 'Los archivos se guardan en la carpeta data/files del servidor y solo los administradores pueden verlos o descargarlos.',
    sections: [
      {
        fields: [
          { name: 'folders', type: 'list', label: 'Carpetas sugeridas', hint: 'Una por línea. También puedes escribir una carpeta nueva al subir', wide: true },
          { name: 'max_mb', type: 'number', label: 'Tamaño máximo por archivo (MB)' },
        ],
      },
    ],
  },
};

// Ready-made colour combinations. Choosing one sets the app's colours and the documents' colours together:
// `primary` is the main colour, `accent` the highlight (totals) and `shop` the shop's name on documents.
const PALETTES = [
  { name: 'Índigo y rosa', primary: '#283593', accent: '#e91e63', shop: '#6c63e6' },
  { name: 'Azul noche y oro', primary: '#14213d', accent: '#a16207', shop: '#14213d' },
  { name: 'Verde billete', primary: '#14532d', accent: '#b45309', shop: '#166534' },
  { name: 'Grafito y cian', primary: '#1f2937', accent: '#0e7490', shop: '#0e7490' },
  { name: 'Burdeos y azul', primary: '#7f1d3a', accent: '#1d4e89', shop: '#7f1d3a' },
];

// Tabs that are not a plain form.
const CUSTOM_TABS = {
  apariencia: renderAppearance,
  productos: (body) => renderCategories(body, 'sale'),
  gastos: (body) => renderCategories(body, 'expense'),
  usuarios: renderUsers,
  datos: renderDataTools,
};

// Changing these groups alters the menu or the theme, so the layout is redrawn after saving.
const GROUPS_THAT_AFFECT_LAYOUT = ['shop', 'appearance', 'modules'];
const LOGO_MAX_SIDE = 400;

function menuHtml(currentTab) {
  return TAB_GROUPS.map(group => `
    <div class="sep">${group.title}</div>
    ${group.tabs.map(([key, label]) => `<a href="#/ajustes?tab=${key}" class="${key === currentTab ? 'on' : ''}">${label}</a>`).join('')}`).join('');
}

export async function settingsView(root, params) {
  const allTabs = TAB_GROUPS.flatMap(group => group.tabs.map(([key, label]) => ({ key, label, group: group.title })));
  const tab = allTabs.find(candidate => candidate.key === params.get('tab')) || allTabs.find(candidate => candidate.key === DEFAULT_TAB);

  root.innerHTML = `
    <div class="page-head"><div><h1>Ajustes</h1><div class="sub">${tab.group} · ${tab.label}</div></div></div>
    <div class="settings-layout">
      <nav class="card settings-nav">${menuHtml(tab.key)}</nav>
      <div data-body style="min-width:0"></div>
    </div>`;
  const body = root.querySelector('[data-body]');
  return CUSTOM_TABS[tab.key] ? CUSTOM_TABS[tab.key](body) : renderSchemaForm(body, SCHEMAS[tab.key]);
}

// ---- Appearance: palettes on top, then the form with the individual options
function paletteCard(palette, index) {
  const { appearance, invoice } = state.settings;
  const sameColor = (a, b) => String(a).toLowerCase() === b;
  const isInUse = sameColor(appearance.primary, palette.primary) && sameColor(appearance.accent, palette.accent)
    && sameColor(invoice.color_title, palette.primary) && sameColor(invoice.color_accent, palette.accent);
  const seed = paperSeed(state.settings);
  return `
    <div class="palette-card" style="--doc-title:${palette.primary};--doc-accent:${palette.accent};--doc-shop:${palette.shop}">
      <div class="row">
        <b>${palette.name}</b><span class="spacer"></span>
        ${isInUse ? '<span class="status-badge done">En uso</span>' : `<button type="button" class="btn btn-sm" data-use-palette="${index}">Usar</button>`}
      </div>
      <div class="palette-sample">
        ${emblem(seed, initialsOf(state.settings.shop.name))}
        <div>
          <div class="palette-shop">${esc(state.settings.shop.name)}</div>
          ${guillocheBand(seed)}
          <div class="row">
            <span class="palette-chip" style="background:${palette.primary}">Botones y títulos</span>
            <span class="palette-chip" style="background:${palette.accent}">Total</span>
          </div>
        </div>
      </div>
    </div>`;
}

// Saves the palette in both places that hold colours: the app's appearance and the documents.
async function usePalette(palette) {
  const appearance = await tryApi('/admin/settings/appearance', { method: 'PUT', body: { primary: palette.primary, accent: palette.accent } });
  const invoice = await tryApi('/admin/settings/invoice', {
    method: 'PUT',
    body: { color_shop: palette.shop, color_title: palette.primary, color_accent: palette.accent },
  });
  if (!appearance || !invoice) return;
  state.settings.appearance = appearance;
  state.settings.invoice = invoice;
  applyAppearance(appearance);
  toast(`Paleta "${palette.name}" aplicada a la app y a los documentos`, 'ok');
  window.dispatchEvent(new Event('layout-refresh'));
}

async function renderAppearance(body) {
  body.innerHTML = `
    <div class="card card-pad" style="max-width:900px;margin-bottom:16px">
      <h3 class="settings-section">Paletas</h3>
      <p class="muted" style="margin:0 0 12px">Cada paleta cambia a la vez los colores de la aplicación y los de facturas, contratos y resguardos. Puedes volver a la anterior cuando quieras.</p>
      <div class="palette-grid">${PALETTES.map(paletteCard).join('')}</div>
    </div>
    <div data-form-slot></div>`;
  on(body, 'click', '[data-use-palette]', (button) => usePalette(PALETTES[Number(button.dataset.usePalette)]));
  await renderSchemaForm(body.querySelector('[data-form-slot]'), SCHEMAS.apariencia);
}

async function refreshCategories() {
  state.categories = await api('/categories');
}

// ---- Generic form built from a schema
const pairRow = (pair = { name: '', text: '' }) => `
  <div class="pair">
    <input type="text" data-pair-name placeholder="Nombre" value="${esc(pair.name)}">
    <input type="text" data-pair-text placeholder="Texto que se imprime" value="${esc(pair.text)}">
    <button type="button" class="btn btn-ghost btn-icon" data-remove-pair title="Quitar">${icon('trash')}</button>
  </div>`;

function fieldHtml(field, value) {
  const { name, type, label, hint = '', wide = false, options = [] } = field;
  const title = `${esc(label)} ${hint ? `<span class="hint">${esc(hint)}</span>` : ''}`;
  const css = `field ${wide ? 'wide' : ''}`;

  switch (type) {
    case 'bool':
      return `
        <label class="check ${wide ? 'wide' : ''}">
          <input type="checkbox" name="${name}" ${value ? 'checked' : ''}>
          <span><b>${esc(label)}</b>${hint ? `<span class="muted">${esc(hint)}</span>` : ''}</span>
        </label>`;
    case 'number':
      return `<label class="${css}">${title}<input type="number" name="${name}" value="${esc(value)}" step="any"></label>`;
    case 'textarea':
    case 'longtext':
      return `<label class="${css}">${title}<textarea name="${name}" rows="${type === 'longtext' ? 12 : 2}">${esc(value)}</textarea></label>`;
    case 'list':
      return `<label class="${css}">${title}<textarea name="${name}" rows="${field.rows || 4}">${esc((value || []).join('\n'))}</textarea></label>`;
    case 'color':
      return `
        <label class="${css}">${title}
          <span class="color-input"><input type="color" name="${name}" value="${esc(value)}"><code>${esc(value)}</code></span>
        </label>`;
    case 'select':
      return `
        <label class="${css}">${title}
          <select name="${name}">
            ${options.map(([optionValue, optionLabel]) => `<option value="${optionValue}" ${optionValue === String(value) ? 'selected' : ''}>${esc(optionLabel)}</option>`).join('')}
          </select>
        </label>`;
    case 'pairs':
      return `
        <div class="${css}">${title}
          <div class="pairs-edit" data-pairs="${name}">${(value || []).map(pairRow).join('')}</div>
          <div><button type="button" class="btn btn-sm" data-add-pair="${name}">${icon('plus')} Añadir</button></div>
        </div>`;
    case 'pattern':
      return `
        <div class="${css}">${title}
          <div class="row">
            <input type="text" name="${name}" value="${esc(value)}" placeholder="Automático" style="flex:1;min-width:180px">
            <button type="button" class="btn btn-sm" data-random-pattern="${name}">Probar otro dibujo</button>
          </div>
          <div class="pattern-preview" data-pattern-preview="${name}"></div>
        </div>`;
    case 'image':
      return `
        <div class="${css}">${title}
          <div class="row">
            <img data-image-preview="${name}" src="${esc(value || '')}"
                 style="max-height:56px;max-width:180px;border:1px solid var(--border);border-radius:8px;padding:4px;${value ? '' : 'display:none'}">
            <input type="file" accept="image/*" data-image-input="${name}">
            <input type="hidden" name="${name}" value="${esc(value || '')}">
            <button type="button" class="btn btn-sm" data-clear-image="${name}">Quitar</button>
          </div>
        </div>`;
    default:
      return `<label class="${css}">${title}<input type="text" name="${name}" value="${esc(value)}"></label>`;
  }
}

function readField(form, field) {
  const { name, type } = field;
  if (type === 'pairs') {
    return [...form.querySelectorAll(`[data-pairs="${name}"] .pair`)]
      .map(row => ({
        name: row.querySelector('[data-pair-name]').value.trim(),
        text: row.querySelector('[data-pair-text]').value.trim(),
      }))
      .filter(pair => pair.name);
  }
  const input = form.elements[name];
  if (type === 'bool') return input.checked;
  if (type === 'number') return Number(input.value);
  if (type === 'list') return input.value.split('\n').map(line => line.trim()).filter(Boolean);
  return input.value;
}

// Shrinks an image in the browser and returns it as a data URL, so logos stay small in the database.
function resizeImage(file, maxSide) {
  return new Promise((resolve) => {
    const image = new Image();
    const reader = new FileReader();
    reader.onload = () => { image.src = reader.result; };
    image.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    reader.readAsDataURL(file);
  });
}

async function renderSchemaForm(body, schema) {
  const values = (await api('/admin/settings'))[schema.key];
  body.innerHTML = `
    <form class="card card-pad" data-form style="max-width:900px">
      ${schema.intro ? `<div class="notice" style="margin-bottom:16px">${esc(schema.intro)}</div>` : ''}
      ${schema.sections.map(section => `
        ${section.title ? `<h3 class="settings-section">${section.title}</h3>` : ''}
        <div class="settings-grid">${section.fields.map(field => fieldHtml(field, values[field.name])).join('')}</div>`).join('')}
      <div class="row" style="margin-top:18px"><button class="btn btn-primary" type="submit">Guardar cambios</button></div>
    </form>`;
  const form = body.querySelector('[data-form]');

  function setImage(name, dataUrl) {
    form.elements[name].value = dataUrl;
    const preview = form.querySelector(`[data-image-preview="${name}"]`);
    preview.src = dataUrl;
    preview.style.display = dataUrl ? '' : 'none';
  }

  // Shows the emblem and the band that the seed and colours in the form would print.
  function renderPatternPreview() {
    const preview = form.querySelector('[data-pattern-preview]');
    if (!preview) return;
    const seedInput = form.elements[preview.dataset.patternPreview];
    const seed = paperSeed({ shop: state.settings.shop, invoice: { paper_seed: seedInput.value.trim() } });
    preview.style.setProperty('--doc-title', form.elements.color_title.value);
    preview.style.setProperty('--doc-accent', form.elements.color_accent.value);
    preview.innerHTML = emblem(seed, initialsOf(state.settings.shop.name)) + guillocheBand(seed);
  }
  renderPatternPreview();
  form.addEventListener('input', renderPatternPreview);
  on(form, 'click', '[data-random-pattern]', (button) => {
    form.elements[button.dataset.randomPattern].value = Math.random().toString(36).slice(2, 8).toUpperCase();
    renderPatternPreview();
  });

  on(form, 'input', 'input[type=color]', (input) => { input.nextElementSibling.textContent = input.value; });
  on(form, 'change', '[data-image-input]', async (input) => {
    if (input.files[0]) setImage(input.dataset.imageInput, await resizeImage(input.files[0], LOGO_MAX_SIDE));
  });
  on(form, 'click', '[data-clear-image]', (button) => setImage(button.dataset.clearImage, ''));
  on(form, 'click', '[data-add-pair]', (button) => {
    form.querySelector(`[data-pairs="${button.dataset.addPair}"]`).insertAdjacentHTML('beforeend', pairRow());
  });
  on(form, 'click', '[data-remove-pair]', (button) => button.closest('.pair').remove());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = schema.sections.flatMap(section => section.fields);
    const changes = Object.fromEntries(fields.map(field => [field.name, readField(form, field)]));
    const saved = await tryApi(`/admin/settings/${schema.key}`, { method: 'PUT', body: changes });
    if (!saved) return;
    state.settings[schema.key] = saved;
    if (schema.key === 'appearance') applyAppearance(saved);
    if (GROUPS_THAT_AFFECT_LAYOUT.includes(schema.key)) window.dispatchEvent(new Event('layout-refresh'));
    toast('Ajustes guardados', 'ok');
  });
}

// ---- Products and expense reasons
const EXPENSE_TYPES = [['stock', 'Mercancía'], ['operating', 'Operativo']];

function expenseTypeSelect(attributes, selected) {
  return `
    <select ${attributes} style="width:auto">
      ${EXPENSE_TYPES.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('')}
    </select>`;
}

async function renderCategories(body, kind) {
  const isSale = kind === 'sale';
  const warrantyNames = state.settings.invoice.warranties.map(warranty => warranty.name);
  const categories = (await api('/categories?all=1'))
    .filter(category => category.kind === kind)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  const intro = isSale
    ? 'Los productos <b>favoritos</b> (★) salen primero al registrar una venta. Puedes poner un precio y beneficio sugeridos que se rellenan solos, y la <b>garantía</b> que se propone en tickets y facturas. Desactivar un producto lo oculta sin borrar su historial.'
    : 'Los motivos <b>favoritos</b> (★) aparecen sin tener que escribir al registrar un gasto. Marca como <b>Mercancía</b> las compras de producto para revender (móviles, fundas…) y como <b>Operativo</b> el resto (alquiler, luz, comida…). Así el beneficio neto no cuenta dos veces lo que ya restaste en cada venta.';

  body.innerHTML = `
    <div class="notice" style="margin-bottom:14px">${intro}</div>
    <form class="card card-pad" data-new-category style="margin-bottom:14px">
      <div class="row">
        <input type="color" name="color" value="#2a78d6" class="swatch" style="width:38px;height:38px">
        <input type="text" name="name" placeholder="${isSale ? 'Nuevo producto o servicio…' : 'Nuevo motivo de gasto…'}" style="flex:1;min-width:180px" required>
        ${isSale ? '' : expenseTypeSelect('name="expense_type"', 'stock')}
        <button class="btn btn-primary" type="submit">${icon('plus')} Añadir</button>
      </div>
    </form>
    <div class="card"><div class="table-wrap" data-list></div></div>`;

  const list = body.querySelector('[data-list]');
  const moneyCell = (category, field) => `
    <td><input type="text" data-field="${field}" inputmode="decimal" placeholder="—" style="width:100px"
               value="${category[field] == null ? '' : moneyInput(category[field])}"></td>`;

  function saleCells(category) {
    const warrantyOptions = ['', ...warrantyNames].map(name =>
      `<option value="${esc(name)}" ${name === (category.warranty || '') ? 'selected' : ''}>${name ? esc(name) : 'Sin garantía'}</option>`).join('');
    return `
      ${moneyCell(category, 'default_price')}
      ${moneyCell(category, 'default_profit')}
      <td><select data-field="warranty" style="width:auto">${warrantyOptions}</select></td>`;
  }

  const favoriteCell = (category) => `
    <td>
      <button class="btn btn-ghost btn-icon" data-toggle-favorite title="Favorito" style="color:${category.favorite ? '#eab308' : 'var(--text-3)'}">${icon('star')}</button>
    </td>`;

  function categoryRow(category, index) {
    return `
      <tr data-id="${category.id}" style="${category.active ? '' : 'opacity:.5'}">
        <td><div class="row" style="gap:0">
          <button class="btn btn-ghost btn-icon" data-move="-1" ${index === 0 ? 'disabled' : ''}>${icon('up')}</button>
          <button class="btn btn-ghost btn-icon" data-move="1" ${index === categories.length - 1 ? 'disabled' : ''}>${icon('down')}</button>
        </div></td>
        <td><input type="color" class="swatch" data-field="color" value="${esc(category.color)}"></td>
        <td><input type="text" data-field="name" value="${esc(category.name)}" style="min-width:160px"></td>
        ${isSale ? saleCells(category) : `<td>${expenseTypeSelect('data-field="expense_type"', category.expense_type === 'stock' ? 'stock' : 'operating')}</td>`}
        ${favoriteCell(category)}
        <td><input type="checkbox" data-field="active" ${category.active ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary)"></td>
      </tr>`;
  }

  function renderTable() {
    list.innerHTML = `
      <table class="t">
        <thead><tr>
          <th style="width:70px">Orden</th><th>Color</th><th>Nombre</th>
          ${isSale ? '<th>Precio sugerido</th><th>Beneficio sugerido</th><th>Garantía</th>' : '<th>Tipo</th>'}
          <th>Favorito</th>
          <th>Activo</th>
        </tr></thead>
        <tbody>${categories.map(categoryRow).join('')}</tbody>
      </table>`;
  }

  const indexOfRow = (element) => categories.findIndex(category => category.id === Number(element.closest('[data-id]').dataset.id));

  async function saveCategory(category) {
    if (!(await tryApi(`/admin/categories/${category.id}`, { method: 'PUT', body: category }))) return;
    toast('Guardado', 'ok');
    await refreshCategories();
  }

  // Each cell saves as soon as it changes.
  on(list, 'change', '[data-field]', (input) => {
    const category = categories[indexOfRow(input)];
    const field = input.dataset.field;
    if (field === 'active') {
      category.active = input.checked ? 1 : 0;
      renderTable();
    } else if (field === 'default_price' || field === 'default_profit') {
      const amount = parseMoney(input.value);
      category[field] = Number.isFinite(amount) ? amount : null;
    } else {
      category[field] = input.value;
    }
    saveCategory(category);
  });

  on(list, 'click', '[data-toggle-favorite]', (button) => {
    const category = categories[indexOfRow(button)];
    category.favorite = category.favorite ? 0 : 1;
    renderTable();
    saveCategory(category);
  });

  on(list, 'click', '[data-move]', async (button) => {
    const from = indexOfRow(button);
    const to = from + Number(button.dataset.move);
    [categories[from], categories[to]] = [categories[to], categories[from]];
    renderTable();
    await tryApi('/admin/categories/reorder', { method: 'POST', body: { ids: categories.map(category => category.id) } });
    await refreshCategories();
  });

  body.querySelector('[data-new-category]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const { name, color, expense_type: expenseType } = event.target.elements;
    const created = await tryApi('/admin/categories', {
      method: 'POST',
      body: { kind, name: name.value, color: color.value, expense_type: expenseType?.value },
    });
    if (!created) return;
    toast('Añadido', 'ok');
    await refreshCategories();
    reloadView();
  });

  renderTable();
}

// ---- Users
async function renderUsers(body) {
  const users = await api('/admin/users');
  const row = (user) => `
    <tr>
      <td><b>${esc(user.name)}</b>${user.id === state.user.id ? ' <span class="faint">(tú)</span>' : ''}</td>
      <td class="muted">${esc(user.username)}</td>
      <td><span class="role-badge">${user.role === 'admin' ? 'Administrador' : 'Trabajador'}</span></td>
      <td>${user.active ? 'Activo' : '<span class="neg">Desactivado</span>'}</td>
      <td class="faint">${esc(String(user.created_at).slice(0, 10))}</td>
      <td class="r"><button class="btn btn-sm" data-edit-user="${user.id}">${icon('edit')} Editar</button></td>
    </tr>`;

  body.innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <div class="muted">Cada persona entra con su usuario: así sabes quién registra cada venta.</div>
      <span class="spacer"></span>
      <button class="btn btn-primary" data-new-user>${icon('plus')} Nuevo usuario</button>
    </div>
    <div class="card"><div class="table-wrap">
      <table class="t">
        <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Alta</th><th></th></tr></thead>
        <tbody>${users.map(row).join('')}</tbody>
      </table>
    </div></div>`;

  // `user` is null when creating.
  function openUserDialog(user) {
    const isNew = !user;
    modal({
      title: isNew ? 'Nuevo usuario' : `Editar ${user.name}`,
      body: `
        <form data-user-form class="settings-grid">
          <label class="field">Nombre<input type="text" name="name" value="${esc(user?.name || '')}" required></label>
          <label class="field">Usuario (para entrar)
            <input type="text" name="username" value="${esc(user?.username || '')}" ${isNew ? '' : 'disabled'} required autocapitalize="none">
          </label>
          <label class="field">Rol
            <select name="role">
              <option value="worker">Trabajador</option>
              <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Administrador / dueño</option>
            </select>
          </label>
          <label class="field">${isNew ? 'Contraseña o PIN' : 'Nueva contraseña o PIN'}
            <span class="hint">${isNew ? 'mínimo 4 caracteres' : 'déjalo vacío para no cambiarla'}</span>
            <input type="password" name="password" autocomplete="new-password">
          </label>
          ${isNew ? '' : `
            <label class="check wide">
              <input type="checkbox" name="active" ${user.active ? 'checked' : ''}>
              <span><b>Activo</b><span class="muted">Desactívalo cuando alguien deje de trabajar contigo (se conserva su historial).</span></span>
            </label>`}
        </form>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>`,
      onMount: (dialog, close) => {
        dialog.querySelector('[data-ok]').onclick = async () => {
          const fields = dialog.querySelector('[data-user-form]').elements;
          const changes = { name: fields.name.value, role: fields.role.value, password: fields.password.value };
          const saved = isNew
            ? await tryApi('/admin/users', { method: 'POST', body: { ...changes, username: fields.username.value } })
            : await tryApi(`/admin/users/${user.id}`, { method: 'PUT', body: { ...changes, active: fields.active.checked } });
          if (!saved) return;
          toast('Usuario guardado', 'ok');
          close();
          reloadView();
        };
      },
    });
  }

  on(body, 'click', '[data-new-user]', () => openUserDialog(null));
  on(body, 'click', '[data-edit-user]', (button) => openUserDialog(users.find(user => user.id === Number(button.dataset.editUser))));
}

// ---- Export, import and backup
function renderDataTools(body) {
  const todayDate = today();
  body.innerHTML = `
    <div class="grid-2">
      <div class="card card-pad">
        <h3>Exportar a Excel (CSV)</h3>
        <p class="muted" style="margin-top:0">Descarga los movimientos de un periodo. Se abre directamente con Excel o Google Sheets.</p>
        <div class="row">
          <input type="date" data-export-from value="${todayDate.slice(0, 4)}-01-01" style="width:auto"> –
          <input type="date" data-export-to value="${todayDate}" style="width:auto">
          <a class="btn" data-export-link>${icon('download')} Descargar CSV</a>
        </div>
      </div>
      <div class="card card-pad">
        <h3>Copia de seguridad</h3>
        <p class="muted" style="margin-top:0">
          La app guarda una copia automática cada día en <code>data/backups</code> (últimos 30 días). Aquí puedes descargar una copia
          de la base de datos ahora (ventas, facturas, reparaciones, ajustes). <b>Los archivos de la tienda no van dentro</b>: están en
          <code>data/files</code>; en Umbrel, activa las copias de seguridad de la app para incluirlos.
        </p>
        <a class="btn btn-primary" href="/api/admin/backup">${icon('download')} Descargar copia (.db)</a>
      </div>
      <div class="card card-pad" style="grid-column:1/-1">
        <h3>Importar movimientos desde CSV</h3>
        <p class="muted" style="margin-top:0">
          Para traer datos de tus hojas antiguas. Columnas mínimas: <code>fecha; categoria; importe</code>.
          Opcionales: <code>tipo</code> (venta/gasto), <code>beneficio</code>, <code>descripcion</code>, <code>metodo_pago</code>,
          <code>tipo_gasto</code>. Las categorías que no existan se crean solas.
        </p>
        <div class="row">
          <input type="file" accept=".csv,text/csv" data-import-file>
          <button class="btn" data-import disabled>${icon('upload')} Importar</button>
        </div>
        <pre class="faint" style="font-size:12px;margin:12px 0 0;white-space:pre-wrap;word-break:break-all">fecha;tipo;categoria;descripcion;importe;beneficio;metodo_pago
01/09/2026;venta;Tarjeta SIM;;15,00;12,00;Efectivo
01/09/2026;gasto;Compra de móviles;mobile iphone 17;650,00;;</pre>
        <div data-import-result style="margin-top:10px"></div>
      </div>
    </div>`;

  const find = (selector) => body.querySelector(selector);
  const fileInput = find('[data-import-file]');
  const importButton = find('[data-import]');

  function updateExportLink() {
    find('[data-export-link]').href = `/api/admin/export.csv?from=${find('[data-export-from]').value}&to=${find('[data-export-to]').value}`;
  }

  async function importCsv() {
    const csv = await fileInput.files[0].text();
    const rowCount = csv.split('\n').filter(line => line.trim()).length - 1;
    if (!(await confirmDialog(`Se van a importar ${rowCount} filas. ¿Continuar?`))) return;
    const result = await tryApi('/admin/import', { method: 'POST', body: { csv } });
    if (!result) return;
    const errors = result.errors.length ? `<br>${result.errors.map(esc).join('<br>')}` : '';
    find('[data-import-result]').innerHTML = `<div class="notice">Importados <b>${result.imported}</b> movimientos.${errors}</div>`;
    await refreshCategories();
  }

  on(body, 'change', '[data-export-from], [data-export-to]', updateExportLink);
  fileInput.addEventListener('change', () => { importButton.disabled = !fileInput.files.length; });
  importButton.addEventListener('click', importCsv);
  updateExportLink();
}
