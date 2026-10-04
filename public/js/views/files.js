// Shop documents (admin only): contracts, supplier invoices, taxes, insurance...
import { api, state, esc, icon, toast, modal, confirmDialog, debounce, fmtDate } from '../core.js';

const fmtSize = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`;
const iconFor = (mime) => mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'invoice' : 'file';
const canPreview = (mime) => /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain)$/.test(mime);

export async function filesView(root, params) {
  let folder = params.get('carpeta') || '';
  const suggested = state.settings.files.folders || [];

  root.innerHTML = `
    <div class="page-head"><div><h1>Archivos de la tienda</h1><div class="sub">Solo los administradores pueden ver esta sección</div></div>
      <span class="spacer"></span>
      <label class="btn btn-primary" style="cursor:pointer">${icon('upload')} Subir archivos<input type="file" multiple data-input hidden></label>
    </div>
    <div class="files-layout">
      <aside class="card card-pad files-folders" data-folders></aside>
      <div style="min-width:0">
        <div class="dropzone" data-drop>
          <div class="row" style="gap:10px">
            <input type="search" data-q placeholder="Buscar por nombre o nota…" style="flex:1;min-width:160px">
            <label class="row" style="gap:6px"><span class="muted" style="font-size:13px">Subir a</span>
              <input type="text" data-target list="folder-list" style="width:200px" placeholder="Carpeta"></label>
            <datalist id="folder-list"></datalist>
          </div>
          <div class="faint" style="font-size:12.5px;margin-top:8px">Arrastra aquí PDFs, fotos o documentos para subirlos (máx. ${esc(state.settings.files.max_mb)} MB por archivo).</div>
          <div data-progress></div>
        </div>
        <div class="card" style="margin-top:14px"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const target = $('[data-target]');
  target.value = folder || suggested[0] || 'General';

  let data;
  async function load() {
    const q = $('[data-q]').value.trim();
    const qs = new URLSearchParams(); if (folder) qs.set('folder', folder); if (q) qs.set('q', q);
    try { data = await api('/admin/files?' + qs); } catch (e) { toast(e.message, 'err'); return; }
    const known = new Map(data.folders.map(f => [f.folder, f]));
    const names = [...new Set([...suggested, ...known.keys()])];
    $('#folder-list').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
    $('[data-folders]').innerHTML = `
      <a href="#" data-folder="" class="${!folder ? 'on' : ''}">${icon('folder')}<span>Todos</span><small>${data.total.n}</small></a>
      ${names.map(n => `<a href="#" data-folder="${esc(n)}" class="${folder === n ? 'on' : ''}">${icon('folder')}<span>${esc(n)}</span><small>${known.get(n)?.n || 0}</small></a>`).join('')}
      <div class="faint" style="font-size:12px;margin-top:12px;padding:0 8px">Espacio usado: <b>${fmtSize(data.total.size)}</b></div>`;
    $('[data-list]').innerHTML = data.files.length ? `<table class="t"><thead><tr><th>Nombre</th><th>Carpeta</th><th class="r">Tamaño</th><th>Fecha</th><th>Subido por</th><th></th></tr></thead>
      <tbody>${data.files.map(f => `<tr>
        <td><div class="row" style="gap:8px;flex-wrap:nowrap"><span class="file-ic">${icon(iconFor(f.mime))}</span>
          <div style="min-width:0"><b class="file-name" title="${esc(f.name)}">${esc(f.name)}</b>${f.note ? `<div class="desc">${esc(f.note)}</div>` : ''}</div></div></td>
        <td class="muted">${esc(f.folder)}</td><td class="r num muted">${fmtSize(f.size)}</td>
        <td class="num muted">${fmtDate(f.created_at.slice(0, 10))}</td><td class="muted">${esc(f.uploaded_by || '')}</td>
        <td><div class="row-actions">
          ${canPreview(f.mime) ? `<a class="btn btn-ghost btn-icon" href="/api/admin/files/${f.id}/download?inline=1" target="_blank" rel="noopener" title="Ver">${icon('eye')}</a>` : ''}
          <a class="btn btn-ghost btn-icon" href="/api/admin/files/${f.id}/download" title="Descargar">${icon('download')}</a>
          <button class="btn btn-ghost btn-icon" data-edit="${f.id}" title="Renombrar / mover">${icon('edit')}</button>
          <button class="btn btn-ghost btn-icon btn-danger" data-del="${f.id}" title="Borrar">${icon('trash')}</button>
        </div></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${folder ? 'Esta carpeta está vacía' : 'Todavía no hay archivos. Sube contratos, facturas de proveedores, seguros…'}</div>`;
  }

  // ---- upload with progress bar
  function upload(file) {
    return new Promise((resolve) => {
      const row = document.createElement('div');
      row.className = 'upload-row';
      row.innerHTML = `<span class="file-name">${esc(file.name)}</span><span class="bar"><i></i></span><span class="pct faint">0%</span>`;
      $('[data-progress]').appendChild(row);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/admin/files');
      xhr.setRequestHeader('X-Requested-With', 'app');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.setRequestHeader('X-Folder', encodeURIComponent(target.value.trim() || 'General'));
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = Math.round((e.loaded / e.total) * 100);
        row.querySelector('i').style.width = p + '%'; row.querySelector('.pct').textContent = p + '%';
      };
      xhr.onload = () => {
        let msg = ''; try { msg = JSON.parse(xhr.responseText).error || ''; } catch { /* sin json */ }
        if (xhr.status >= 200 && xhr.status < 300) { row.remove(); resolve(true); }
        else { row.querySelector('.pct').textContent = msg || 'Error'; row.classList.add('err'); setTimeout(() => row.remove(), 6000); toast(`${file.name}: ${msg || 'error al subir'}`, 'err'); resolve(false); }
      };
      xhr.onerror = () => { row.querySelector('.pct').textContent = 'Error de conexión'; row.classList.add('err'); resolve(false); };
      xhr.send(file);
    });
  }
  async function uploadAll(files) {
    const list = [...files]; if (!list.length) return;
    let ok = 0;
    for (const f of list) if (await upload(f)) ok++;
    if (ok) toast(`${ok} archivo(s) subido(s) a "${target.value.trim() || 'General'}"`, 'ok');
    load();
  }
  $('[data-input]').addEventListener('change', (e) => { uploadAll(e.target.files); e.target.value = ''; });
  const drop = $('[data-drop]');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); uploadAll(e.dataTransfer.files); });

  // ---- folders, search, edit, delete
  $('[data-folders]').addEventListener('click', (e) => {
    const a = e.target.closest('[data-folder]'); if (!a) return; e.preventDefault();
    folder = a.dataset.folder; if (folder) target.value = folder; load();
  });
  $('[data-q]').addEventListener('input', debounce(load, 300));
  $('[data-list]').addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) {
      const f = data.files.find(x => x.id === Number(ed.dataset.edit));
      modal({
        title: 'Editar archivo',
        body: `<form data-ef style="display:flex;flex-direction:column;gap:12px">
          <label class="field">Nombre<input type="text" name="fname" value="${esc(f.name)}"></label>
          <label class="field">Carpeta<input type="text" name="folder" list="folder-list" value="${esc(f.folder)}"></label>
          <label class="field">Nota <span class="hint">ej.: vence el 31/12, renovar seguro…</span><textarea name="note" rows="2">${esc(f.note)}</textarea></label></form>`,
        foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>`,
        onMount: (el, close) => {
          el.querySelector('[data-ok]').onclick = async () => {
            const fm = el.querySelector('[data-ef]').elements;
            try { await api(`/admin/files/${f.id}`, { method: 'PUT', body: { name: fm.namedItem('fname').value, folder: fm.namedItem('folder').value, note: fm.namedItem('note').value } }); close(); toast('Guardado', 'ok'); load(); }
            catch (err) { toast(err.message, 'err'); }
          };
        },
      });
    }
    if (del) {
      const f = data.files.find(x => x.id === Number(del.dataset.del));
      if (!(await confirmDialog(`¿Borrar "${f.name}" definitivamente? No se puede deshacer.`, { okText: 'Borrar', danger: true }))) return;
      try { await api(`/admin/files/${f.id}`, { method: 'DELETE' }); toast('Archivo borrado'); load(); } catch (err) { toast(err.message, 'err'); }
    }
  });

  await load();
}
