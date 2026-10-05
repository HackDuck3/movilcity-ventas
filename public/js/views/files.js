// Shop documents (admin only): contracts, supplier invoices, taxes, insurance...
import { api, state, esc, icon, toast, modal, confirmDialog, debounce, fmtDate, on, tryApi } from '../core.js';

const DEFAULT_FOLDER = 'General';
const KB = 1024;
const MB = KB * 1024;
// Must match SAFE_INLINE_TYPES in src/routes/files.js.
const PREVIEWABLE_TYPES = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain)$/;

function formatSize(bytes) {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${(bytes / MB).toFixed(1).replace('.', ',')} MB`;
}

function iconFor(mime) {
  if (mime.startsWith('image/')) return 'image';
  return mime === 'application/pdf' ? 'invoice' : 'file';
}

function fileRow(file) {
  const downloadUrl = `/api/admin/files/${file.id}/download`;
  const previewLink = PREVIEWABLE_TYPES.test(file.mime)
    ? `<a class="btn btn-ghost btn-icon" href="${downloadUrl}?inline=1" target="_blank" rel="noopener" title="Ver">${icon('eye')}</a>`
    : '';
  return `
    <tr>
      <td>
        <div class="row" style="gap:8px;flex-wrap:nowrap">
          <span class="file-ic">${icon(iconFor(file.mime))}</span>
          <div style="min-width:0">
            <b class="file-name" title="${esc(file.name)}">${esc(file.name)}</b>
            ${file.note ? `<div class="desc">${esc(file.note)}</div>` : ''}
          </div>
        </div>
      </td>
      <td class="muted">${esc(file.folder)}</td>
      <td class="r num muted">${formatSize(file.size)}</td>
      <td class="num muted">${fmtDate(file.created_at.slice(0, 10))}</td>
      <td class="muted">${esc(file.uploaded_by || '')}</td>
      <td><div class="row-actions">
        ${previewLink}
        <a class="btn btn-ghost btn-icon" href="${downloadUrl}" title="Descargar">${icon('download')}</a>
        <button class="btn btn-ghost btn-icon" data-edit="${file.id}" title="Renombrar / mover">${icon('edit')}</button>
        <button class="btn btn-ghost btn-icon btn-danger" data-delete="${file.id}" title="Borrar">${icon('trash')}</button>
      </div></td>
    </tr>`;
}

function filesTable(files, isFolderSelected) {
  if (!files.length) {
    const message = isFolderSelected
      ? 'Esta carpeta está vacía'
      : 'Todavía no hay archivos. Sube contratos, facturas de proveedores, seguros…';
    return `<div class="empty">${message}</div>`;
  }
  return `
    <table class="t">
      <thead><tr><th>Nombre</th><th>Carpeta</th><th class="r">Tamaño</th><th>Fecha</th><th>Subido por</th><th></th></tr></thead>
      <tbody>${files.map(fileRow).join('')}</tbody>
    </table>`;
}

// Sends one file as the raw request body (XMLHttpRequest because fetch cannot report upload progress).
// Resolves to an error message, or to null when the upload worked.
function uploadFile(file, folder, onProgress) {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/admin/files');
    request.setRequestHeader('X-Requested-With', 'app');
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.setRequestHeader('X-Folder', encodeURIComponent(folder));
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) return resolve(null);
      let message = '';
      try { message = JSON.parse(request.responseText).error || ''; } catch { /* not JSON */ }
      resolve(message || 'error al subir');
    };
    request.onerror = () => resolve('error de conexión');
    request.send(file);
  });
}

export async function filesView(root, params) {
  const suggestedFolders = state.settings.files.folders || [];
  let selectedFolder = params.get('carpeta') || '';
  let listing = { files: [], folders: [], total: { n: 0, size: 0 } };

  root.innerHTML = `
    <div class="page-head">
      <div><h1>Archivos de la tienda</h1><div class="sub">Solo los administradores pueden ver esta sección</div></div>
      <span class="spacer"></span>
      <label class="btn btn-primary" style="cursor:pointer">
        ${icon('upload')} Subir archivos<input type="file" multiple data-file-input hidden>
      </label>
    </div>
    <div class="files-layout">
      <aside class="card card-pad files-folders" data-folders></aside>
      <div style="min-width:0">
        <div class="dropzone" data-dropzone>
          <div class="row" style="gap:10px">
            <input type="search" data-search placeholder="Buscar por nombre o nota…" style="flex:1;min-width:160px">
            <label class="row" style="gap:6px">
              <span class="muted" style="font-size:13px">Subir a</span>
              <input type="text" data-upload-folder list="folder-list" style="width:200px" placeholder="Carpeta">
            </label>
            <datalist id="folder-list"></datalist>
          </div>
          <div class="faint" style="font-size:12.5px;margin-top:8px">
            Arrastra aquí PDFs, fotos o documentos para subirlos (máx. ${esc(state.settings.files.max_mb)} MB por archivo).
          </div>
          <div data-progress></div>
        </div>
        <div class="card" style="margin-top:14px"><div class="table-wrap" data-list><div class="empty">Cargando…</div></div></div>
      </div>
    </div>`;

  const find = (selector) => root.querySelector(selector);
  const uploadFolderInput = find('[data-upload-folder]');
  uploadFolderInput.value = selectedFolder || suggestedFolders[0] || DEFAULT_FOLDER;
  const uploadFolder = () => uploadFolderInput.value.trim() || DEFAULT_FOLDER;

  async function load() {
    const query = new URLSearchParams();
    if (selectedFolder) query.set('folder', selectedFolder);
    const search = find('[data-search]').value.trim();
    if (search) query.set('q', search);

    const loaded = await tryApi(`/admin/files?${query}`);
    if (!loaded) return;
    listing = loaded;
    renderFolders();
    find('[data-list]').innerHTML = filesTable(listing.files, !!selectedFolder);
  }

  // Suggested folders are always listed, even while empty.
  function renderFolders() {
    const fileCount = new Map(listing.folders.map(folder => [folder.folder, folder.n]));
    const names = [...new Set([...suggestedFolders, ...fileCount.keys()])];
    const link = (name, label, count) => `
      <a href="#" data-folder="${esc(name)}" class="${selectedFolder === name ? 'on' : ''}">
        ${icon('folder')}<span>${esc(label)}</span><small>${count}</small>
      </a>`;
    find('#folder-list').innerHTML = names.map(name => `<option value="${esc(name)}">`).join('');
    find('[data-folders]').innerHTML = `
      ${link('', 'Todos', listing.total.n)}
      ${names.map(name => link(name, name, fileCount.get(name) || 0)).join('')}
      <div class="faint" style="font-size:12px;margin-top:12px;padding:0 8px">Espacio usado: <b>${formatSize(listing.total.size)}</b></div>`;
  }

  async function uploadWithProgressRow(file) {
    const row = document.createElement('div');
    row.className = 'upload-row';
    row.innerHTML = `<span class="file-name">${esc(file.name)}</span><span class="bar"><i></i></span><span class="pct faint">0%</span>`;
    find('[data-progress]').appendChild(row);
    const percentLabel = row.querySelector('.pct');

    const errorMessage = await uploadFile(file, uploadFolder(), (percent) => {
      row.querySelector('i').style.width = `${percent}%`;
      percentLabel.textContent = `${percent}%`;
    });
    if (!errorMessage) {
      row.remove();
      return true;
    }
    row.classList.add('err');
    percentLabel.textContent = errorMessage;
    setTimeout(() => row.remove(), 6000);
    toast(`${file.name}: ${errorMessage}`, 'err');
    return false;
  }

  async function uploadAll(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    let uploaded = 0;
    for (const file of files) {
      if (await uploadWithProgressRow(file)) uploaded++;
    }
    if (uploaded) toast(`${uploaded} archivo(s) subido(s) a "${uploadFolder()}"`, 'ok');
    load();
  }

  function editFile(id) {
    const file = listing.files.find(candidate => candidate.id === id);
    modal({
      title: 'Editar archivo',
      body: `
        <form data-edit-form style="display:flex;flex-direction:column;gap:12px">
          <label class="field">Nombre<input type="text" name="fileName" value="${esc(file.name)}"></label>
          <label class="field">Carpeta<input type="text" name="folder" list="folder-list" value="${esc(file.folder)}"></label>
          <label class="field">Nota <span class="hint">ej.: vence el 31/12, renovar seguro…</span>
            <textarea name="note" rows="2">${esc(file.note)}</textarea>
          </label>
        </form>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>`,
      onMount: (dialog, close) => {
        dialog.querySelector('[data-ok]').onclick = async () => {
          const { fileName, folder, note } = dialog.querySelector('[data-edit-form]').elements;
          const body = { name: fileName.value, folder: folder.value, note: note.value };
          try {
            await api(`/admin/files/${file.id}`, { method: 'PUT', body });
            close();
            toast('Guardado', 'ok');
            load();
          } catch (error) {
            toast(error.message, 'err');
          }
        };
      },
    });
  }

  async function deleteFile(id) {
    const file = listing.files.find(candidate => candidate.id === id);
    const confirmed = await confirmDialog(`¿Borrar "${file.name}" definitivamente? No se puede deshacer.`, { okText: 'Borrar', danger: true });
    if (!confirmed) return;
    if (await tryApi(`/admin/files/${file.id}`, { method: 'DELETE' })) toast('Archivo borrado');
    load();
  }

  const dropzone = find('[data-dropzone]');
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('over');
    uploadAll(event.dataTransfer.files);
  });
  find('[data-file-input]').addEventListener('change', (event) => {
    uploadAll(event.target.files);
    event.target.value = '';
  });
  find('[data-search]').addEventListener('input', debounce(load, 300));
  on(root, 'click', '[data-folder]', (link, event) => {
    event.preventDefault();
    selectedFolder = link.dataset.folder;
    if (selectedFolder) uploadFolderInput.value = selectedFolder;
    load();
  });
  on(root, 'click', '[data-edit]', (button) => editFile(Number(button.dataset.edit)));
  on(root, 'click', '[data-delete]', (button) => deleteFile(Number(button.dataset.delete)));

  await load();
}
