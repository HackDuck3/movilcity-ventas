// Notices: policies, price lists and announcements written once and printed on the shop's design.
import { api, state, esc, icon, fmtDate, toast, isAdmin, confirmDialog, on, redrawOnResize, tryApi } from '../core.js';
import { noticeA4 } from '../notice.js';
import { printDocument } from '../invoice.js';

const SECTION = '#/comunicados';
const NEW_NOTICE = { title: '', subtitle: '', body: '# Primer apartado\nEscribe aquí el texto.\n- Un punto\n- Otro punto' };

const MARKUP_HELP = `
  <div class="notice markup-help">
    <b>Cómo dar formato</b>
    <code># Título</code> empieza un apartado ·
    <code>- texto</code> hace una lista ·
    <code>| a | b |</code> hace una tabla (la primera fila es la cabecera) ·
    <code>**texto**</code> lo pone en negrita
  </div>`;

export function noticesView(root, params, sub) {
  if (sub === 'nuevo') return renderNotice(root, null);
  if (sub) return renderNotice(root, Number(sub));
  return renderList(root);
}

const printNotice = (notice) => printDocument(noticeA4(notice, state.settings), { format: 'a4', filename: notice.title || 'Comunicado' });

// ---- List
async function renderList(root) {
  const notices = await api('/notices');
  const row = (notice) => `
    <tr class="clickable" data-id="${notice.id}">
      <td><b>${esc(notice.title)}</b>${notice.subtitle ? `<div class="desc">${esc(notice.subtitle)}</div>` : ''}</td>
      <td class="num muted">${fmtDate(notice.updated_at.slice(0, 10))}</td>
    </tr>`;

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Comunicados</h1><div class="sub">Políticas, tarifas y avisos de la tienda, listos para imprimir</div></div>
      <span class="spacer"></span>
      ${isAdmin() ? `<a class="btn btn-primary" href="${SECTION}/nuevo">${icon('plus')} Nuevo comunicado</a>` : ''}
    </div>
    <div class="card"><div class="table-wrap">
      ${notices.length ? `
        <table class="t">
          <thead><tr><th>Título</th><th>Última modificación</th></tr></thead>
          <tbody>${notices.map(row).join('')}</tbody>
        </table>` : '<div class="empty">Todavía no hay comunicados</div>'}
    </div></div>`;

  on(root, 'click', '[data-id]', (element) => { location.hash = `${SECTION}/${element.dataset.id}`; });
}

// ---- One notice: admins edit it with a live preview; everyone else sees it ready to print
async function renderNotice(root, id) {
  const notice = id ? await tryApi(`/notices/${id}`) : { ...NEW_NOTICE };
  if (!notice) return;
  const canEdit = isAdmin();

  root.innerHTML = `
    <div class="page-head">
      <a class="btn btn-icon" href="${SECTION}" title="Volver">${icon('left')}</a>
      <div><h1>${id ? esc(notice.title) : 'Nuevo comunicado'}</h1></div>
      <span class="spacer"></span>
      <button class="btn ${canEdit ? '' : 'btn-primary'}" data-print>${icon('print')} Imprimir / Guardar PDF</button>
      ${canEdit && id ? `<button class="btn btn-danger" data-delete>${icon('trash')} Borrar</button>` : ''}
    </div>
    <div class="${canEdit ? 'inv-layout' : ''}">
      ${canEdit ? `
        <div class="card card-pad">
          <form data-form autocomplete="off" style="display:flex;flex-direction:column;gap:14px">
            <label class="field">Título<input type="text" name="title" value="${esc(notice.title)}" placeholder="Ej.: Política de cambios y devoluciones"></label>
            <label class="field">Subtítulo <span class="hint">opcional</span><input type="text" name="subtitle" value="${esc(notice.subtitle)}"></label>
            <label class="field">Texto<textarea name="body" rows="22" class="notice-editor">${esc(notice.body)}</textarea></label>
            ${MARKUP_HELP}
            <div class="row"><button class="btn btn-primary" type="submit">Guardar</button></div>
          </form>
        </div>` : ''}
      <div class="inv-preview-wrap" ${canEdit ? '' : 'style="position:static"'}><div class="inv-preview-scale" data-preview></div></div>
    </div>`;

  const form = root.querySelector('[data-form]');
  const preview = root.querySelector('[data-preview]');
  const previewFrame = root.querySelector('.inv-preview-wrap');

  // What the form holds right now, or the saved notice for those who cannot edit.
  function current() {
    if (!form) return notice;
    return { ...notice, title: form.elements.title.value, subtitle: form.elements.subtitle.value, body: form.elements.body.value };
  }

  function renderPreview() {
    preview.innerHTML = noticeA4(current(), state.settings);
    const page = preview.firstElementChild;
    const scale = Math.min(1, (previewFrame.clientWidth - 36) / page.offsetWidth);
    preview.style.transform = `scale(${scale})`;
    preview.style.width = `${page.offsetWidth}px`;
    preview.style.height = `${page.offsetHeight * scale}px`;
  }

  async function save() {
    const { title, subtitle, body } = current();
    const saved = id
      ? await tryApi(`/admin/notices/${id}`, { method: 'PUT', body: { title, subtitle, body } })
      : await tryApi('/admin/notices', { method: 'POST', body: { title, subtitle, body } });
    if (!saved) return;
    toast('Comunicado guardado', 'ok');
    if (!id) location.hash = `${SECTION}/${saved.id}`;
  }

  async function remove() {
    const confirmed = await confirmDialog(`¿Borrar "${notice.title}"? No se puede deshacer.`, { okText: 'Borrar', danger: true });
    if (!confirmed) return;
    if (await tryApi(`/admin/notices/${id}`, { method: 'DELETE' })) location.hash = SECTION;
  }

  on(root, 'click', '[data-print]', () => printNotice(current()));
  on(root, 'click', '[data-delete]', remove);
  if (form) {
    form.addEventListener('input', renderPreview);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      save();
    });
  }
  renderPreview();
  redrawOnResize(previewFrame, renderPreview);
}
