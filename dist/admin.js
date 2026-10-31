'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  const form = $('#edit-form');
  const dialog = $('#editor');
  const config = {
    projects: ['I progetti', 'Racconta le iniziative e le persone che le rendono possibili.', 'Nuovo progetto', 'PROGETTO'],
    events: ['Gli eventi', 'Crea un appuntamento e invita la comunità a partecipare.', 'Nuovo evento', 'EVENTO'],
    news: ['Le notizie', 'Condividi aggiornamenti, traguardi e storie dall’associazione.', 'Nuova notizia', 'NOTIZIA'],
    donations: ['Le donazioni', 'Spiega come sostenere Nerea e aggiungi un link o un IBAN.', 'Nuova donazione', 'DONAZIONE']
  };
  let type = 'projects';
  let records = [];
  let requestId = 0;
  let previewUrl = null;
  let saving = false;
  let gallery = [];
  let persistedImageIds = [];
  let singleFile = null;
  const galleryView = element('div', 'gallery-grid');
  $('.photo-picker').after(galleryView);
  async function api(url, options = {}) {
    let response;
    try { response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', 'X-Nerea-Admin': '1', ...options.headers } }); }
    catch { throw new Error('Connessione al server non disponibile. Controlla la connessione e riprova.'); }
    let body;
    try { body = await response.json(); } catch { throw new Error('Risposta del server non valida. Riprova tra poco.'); }
    if (!response.ok) {
      if (response.status === 401 && !url.endsWith('/login')) showLogin();
      throw new Error(body.error || body.message || 'Operazione non riuscita. Riprova tra poco.');
    }
    return body;
  }
  function showLogin() { $('#login-view').hidden = false; $('#dashboard').hidden = true; if (dialog.open) { dialog.close(); clearObjectUrl(); document.body.classList.remove('modal-open'); } }
  function showDashboard(session = {}) { $('#login-view').hidden = true; $('#dashboard').hidden = false; $('#configuration-notice').hidden = session.configured !== false; loadRecords(); }
  function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el; }
  function safeImage(value) { try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
  function displayRecords() {
    const grid = $('#records'); grid.replaceChildren();
    if (!records.length) {
      const empty = element('div', 'empty'); empty.append(element('h3', '', 'C’è spazio per una nuova storia.'), element('p', '', 'Aggiungi il primo contenuto. Lo ritroverai qui, insieme alle tue bozze.')); grid.append(empty); return;
    }
    records.forEach((record) => {
      const article = element('article', 'record');
      const imageUrl = safeImage(record.imageUrl);
      if (imageUrl) { const img = element('img', 'record-image'); img.src = imageUrl; img.alt = record.title || ''; img.loading = 'lazy'; article.append(img); }
      else article.append(element('div', 'record-placeholder', 'n.'));
      const body = element('div', 'record-body');
      const meta = element('div', 'record-meta'); meta.append(element('span', '', record.category || config[type][3]), element('span', `badge${record.published ? '' : ' draft'}`, record.published ? 'Pubblicato' : 'Bozza'));
      body.append(meta, element('h3', '', record.title || 'Senza titolo'), element('p', '', String(record.description || '').slice(0, 170) + (String(record.description || '').length > 170 ? '…' : '')));
      const edit = element('button', 'edit-record', 'Modifica contenuto'); edit.type = 'button'; edit.append(element('span', '', '↗')); edit.addEventListener('click', () => openEditor(record)); body.append(edit); article.append(body); grid.append(article);
    });
  }
  async function loadRecords() {
    const currentRequest = ++requestId;
    $('#page-status').textContent = 'Caricamento dei contenuti…'; $('#records').replaceChildren();
    try { const data = await api(`/api/admin/content?type=${type}`); if (currentRequest !== requestId) return; records = data.records || []; displayRecords(); $('#page-status').textContent = `${records.length} contenut${records.length === 1 ? 'o' : 'i'} · Le bozze sono visibili solo qui.`; }
    catch (error) { if (currentRequest === requestId) $('#page-status').textContent = error.message; }
  }
  function setPreview(url) {
    const img = $('#image-preview'); const usable = url || '';
    img.hidden = !usable; $('#photo-placeholder').hidden = !!usable;
    if (usable) img.src = usable; else img.removeAttribute('src');
  }
  function clearObjectUrl() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; for (const image of gallery) if (image.file) URL.revokeObjectURL(image.url); }
  function galleryChanged() { return gallery.some(image => image.file) || JSON.stringify(gallery.map(image => image.id)) !== JSON.stringify(persistedImageIds); }
  function renderGallery() {
    galleryView.replaceChildren(); galleryView.hidden = type !== 'projects';
    if (type !== 'projects') return;
    gallery.forEach((image, index) => {
      const tile = element('div', 'gallery-tile');
      const thumbnail = element('img'); thumbnail.src = image.url; thumbnail.alt = image.filename || `Fotografia ${index + 1}`;
      const badge = element('span', 'gallery-label', index === 0 ? 'Copertina' : image.file ? 'Da caricare' : `Foto ${index + 1}`);
      const actions = element('div', 'gallery-actions');
      const cover = element('button', '', 'Copertina'); cover.type = 'button'; cover.disabled = saving || index === 0; cover.setAttribute('aria-label', `Usa la foto ${index + 1} come copertina`);
      cover.addEventListener('click', () => { gallery.splice(index, 1); gallery.unshift(image); renderGallery(); });
      const remove = element('button', '', 'Rimuovi'); remove.type = 'button'; remove.disabled = saving; remove.setAttribute('aria-label', `Rimuovi la foto ${index + 1}`);
      remove.addEventListener('click', () => { gallery.splice(index, 1); if (image.file) URL.revokeObjectURL(image.url); renderGallery(); });
      actions.append(cover, remove); tile.append(thumbnail, badge, actions); galleryView.append(tile);
    });
    if (gallery.length) galleryView.append(element('p', 'gallery-count', `${gallery.length}/20 fotografie · Le modifiche saranno applicate al salvataggio.`));
  }
  function openEditor(record = {}) {
    form.reset(); clearObjectUrl(); $('#editor-error').textContent = ''; $('#photo').value = ''; singleFile = null;
    gallery = (record.images || []).map(image => ({...image, key: image.id})); persistedImageIds = gallery.map(image => image.id);
    $('#photo').multiple = type === 'projects';
    $('.photo-section > label').textContent = type === 'projects' ? 'Galleria fotografica' : 'Fotografia';
    $('.photo-section > p').textContent = type === 'projects' ? 'Aggiungi fino a 20 fotografie JPEG, PNG o WebP, massimo 5 MB ciascuna. La prima sarà la copertina. Puoi selezionare altri file senza perdere quelli già aggiunti.' : 'Scegli una foto dal computer. Formati JPEG, PNG o WebP, massimo 5 MB.';
    $('#photo').setAttribute('aria-label', type === 'projects' ? 'Aggiungi fotografie alla galleria' : 'Scegli una fotografia');
    ['id', 'title', 'description', 'category', 'date', 'location', 'imageUrl', 'link', 'iban', 'buttonLabel', 'sortOrder'].forEach((key) => { form.elements[key].value = key === 'date' ? String(record[key] || '').slice(0, 10) : record[key] ?? (key === 'sortOrder' ? 0 : ''); });
    form.elements.published.checked = !!record.published;
    $('#editor-type').textContent = config[type][3]; $('#editor-title').textContent = record.id ? 'La storia continua.' : 'Un nuovo racconto.';
    $('.donation-fields').hidden = type !== 'donations';
    ['category', 'date', 'location'].forEach((key) => { $(`[data-field="${key}"]`).hidden = type === 'donations' || (key === 'location' && type !== 'events'); });
    setPreview(type === 'projects' ? '' : safeImage(record.imageUrl)); renderGallery(); dialog.showModal(); document.body.classList.add('modal-open');
  }
  function closeEditor() { if (saving) return; dialog.close(); clearObjectUrl(); document.body.classList.remove('modal-open'); }
  $('#close-editor').addEventListener('click', closeEditor); $('#cancel-edit').addEventListener('click', closeEditor);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeEditor(); });
  $('#new-record').addEventListener('click', () => openEditor());
  document.querySelectorAll('[data-type]').forEach((button) => button.addEventListener('click', () => {
    type = button.dataset.type; document.querySelectorAll('[data-type]').forEach((tab) => tab.classList.toggle('active', tab === button));
    $('#collection-title').textContent = config[type][0]; $('#collection-description').textContent = config[type][1]; $('#new-record').replaceChildren(document.createTextNode(config[type][2] + ' '), element('span', '', '+')); loadRecords();
  }));
  $('#photo').addEventListener('change', () => {
    $('#editor-error').textContent = ''; const files = Array.from($('#photo').files); $('#photo').value = '';
    if (!files.length) return;
    if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) { $('#editor-error').textContent = 'Scegli foto JPEG, PNG o WebP di massimo 5 MB ciascuna.'; return; }
    if (type === 'projects') {
      if (gallery.length + files.length > 20) { $('#editor-error').textContent = 'La galleria può contenere al massimo 20 foto. Rimuovi alcune immagini o seleziona meno file.'; return; }
      files.forEach(file => gallery.push({key: crypto.randomUUID(), file, filename: file.name, url: URL.createObjectURL(file)})); renderGallery();
    } else {
      if (previewUrl) URL.revokeObjectURL(previewUrl); singleFile = files[0]; previewUrl = URL.createObjectURL(singleFile); setPreview(previewUrl);
    }
  });
  function readBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Impossibile leggere la fotografia. Selezionala di nuovo.')); reader.readAsDataURL(file); }); }
  async function preparePhoto(file) {
    // Leave room for base64 overhead within Vercel's 4.5 MB request limit.
    const maxBytes = 2.8 * 1024 * 1024;
    if (file.size <= maxBytes) return {filename:file.name,contentType:file.type,base64:await readBase64(file)};
    const image = await createImageBitmap(file);
    try {
      let scale = Math.min(1,2400/Math.max(image.width,image.height));
      for (let attempt=0;attempt<5;attempt++) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1,Math.round(image.width*scale)); canvas.height = Math.max(1,Math.round(image.height*scale));
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,canvas.width,canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.85));
        if (blob && blob.size <= maxBytes) return {filename:file.name.replace(/\.[^.]+$/,'')+'.jpg',contentType:'image/jpeg',base64:await readBase64(blob)};
        scale *= .75;
      }
      throw new Error('La foto è troppo grande. Scegli una versione più piccola.');
    } finally { image.close(); }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (saving) return; saving = true; const save = $('#save-record'); $('#editor-error').textContent = ''; save.textContent = 'Salvataggio…';
    const enabledControls = Array.from(form.querySelectorAll('input,textarea,button')).filter(control => !control.disabled); enabledControls.forEach(control => { control.disabled = true; });
    let draftSavedForPhoto = false;
    try {
      const file = singleFile;
      const changingPhotos = type === 'projects' ? galleryChanged() : !!file;
      const requestedPublication = form.elements.published.checked;
      const payload = {}; ['title', 'description', 'category', 'date', 'location', 'link', 'iban', 'buttonLabel'].forEach((key) => { payload[key] = form.elements[key].value.trim(); }); payload.published = changingPhotos ? false : requestedPublication; payload.sortOrder = Number(form.elements.sortOrder.value) || 0;
      const id = form.elements.id.value;
      const data = await api(`/api/admin/content${id ? '/' + encodeURIComponent(id) : ''}?type=${type}`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      const recordId = id || data.record?.id || data.id;
      if (recordId) form.elements.id.value = recordId;
      if (changingPhotos) {
        draftSavedForPhoto = true;
        if (!recordId) throw new Error('Contenuto salvato, ma manca il riferimento per caricare la foto. Riapri il contenuto dalla lista.');
        if (type === 'projects') {
          const applyOrder = async () => {
            const imageIds = gallery.filter(image => image.id).map(image => image.id);
            const result = await api(`/api/admin/gallery?type=projects&recordId=${encodeURIComponent(recordId)}`, {method: 'PATCH', body: JSON.stringify({imageIds, expectedImageIds: persistedImageIds})});
            persistedImageIds = (result.record.images || []).map(image => image.id);
            for (const image of gallery) { const savedImage = result.record.images.find(item => item.id === image.id); if (savedImage) Object.assign(image, savedImage); }
            form.elements.imageUrl.value = result.record.imageUrl || '';
          };
          save.textContent = 'Preparazione della galleria…'; await applyOrder();
          const queued = gallery.filter(image => image.file);
          for (let index = 0; index < queued.length; index++) {
            const image = queued[index]; save.textContent = `Caricamento foto ${index + 1}/${queued.length}…`;
            const previousIds = new Set(persistedImageIds);
            const uploaded = await api(`/api/admin/upload?type=projects&recordId=${encodeURIComponent(recordId)}`, {method: 'POST', body: JSON.stringify(await preparePhoto(image.file))});
            const savedImage = uploaded.record.images.find(item => !previousIds.has(item.id));
            if (!savedImage) throw new Error('Foto inviata, ma non ancora disponibile. Riapri il contenuto per verificarla.');
            URL.revokeObjectURL(image.url); Object.assign(image, savedImage); delete image.file;
            persistedImageIds = uploaded.record.images.map(item => item.id); renderGallery();
          }
          save.textContent = 'Salvataggio della copertina…'; await applyOrder();
        } else {
          save.textContent = 'Caricamento della foto…';
          const uploaded = await api(`/api/admin/upload?type=${type}&recordId=${encodeURIComponent(recordId)}`, { method: 'POST', body: JSON.stringify(await preparePhoto(file)) });
          form.elements.imageUrl.value = uploaded.imageUrl || ''; singleFile = null;
        }
        if (requestedPublication) {
          save.textContent = 'Pubblicazione…';
          await api(`/api/admin/content/${encodeURIComponent(recordId)}?type=${type}`, { method: 'PATCH', body: JSON.stringify({ ...payload, published: true }) });
        }
      }
      saving = false; closeEditor(); await loadRecords(); $('#page-status').textContent = requestedPublication ? 'Contenuto salvato e pubblicato sul sito.' : 'Bozza salvata. Puoi pubblicarla in qualsiasi momento.';
    } catch (error) { $('#editor-error').textContent = (draftSavedForPhoto ? 'Contenuto salvato come bozza. La foto o la pubblicazione non sono state completate. Riprova a salvare: non verrà creata una copia.\n' : '') + error.message; }
    finally { saving = false; enabledControls.forEach(control => { control.disabled = false; }); renderGallery(); save.replaceChildren(document.createTextNode('Salva contenuto '), element('span', '', '↗')); }
  });
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; $('#login-error').textContent = '';
    try { const session = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: event.currentTarget.elements.username.value, password: event.currentTarget.elements.password.value }) }); $('#login-form').reset(); showDashboard(session); } catch (error) { $('#login-error').textContent = error.message; } finally { button.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => { try { await api('/api/admin/logout', { method: 'POST' }); showLogin(); } catch (error) { $('#page-status').textContent = error.message; } });
  api('/api/admin/session').then((session) => { if (session.authenticated) showDashboard(session); else showLogin(); }).catch(showLogin);
})();
