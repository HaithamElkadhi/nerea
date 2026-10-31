document.documentElement.classList.add('js-ready');
const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } }), {threshold: .08});
document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('nav');
menuButton.addEventListener('click', () => { const open = navigation.classList.toggle('open'); menuButton.setAttribute('aria-expanded', String(open)); menuButton.textContent = open ? 'Chiudi' : 'Menu'; });
navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', () => { navigation.classList.remove('open'); menuButton.setAttribute('aria-expanded', 'false'); menuButton.textContent = 'Menu'; }));
document.querySelectorAll('.activity-list details').forEach(detail => detail.addEventListener('toggle', () => { if (detail.open) document.querySelectorAll('.activity-list details').forEach(other => { if (other !== detail) other.open = false; }); }));
document.querySelector('.project-open').addEventListener('click', () => document.querySelector('#project-dialog').showModal());
document.querySelector('#privacy-open').addEventListener('click', () => document.querySelector('#privacy-dialog').showModal());
document.querySelectorAll('dialog').forEach(dialog => { dialog.querySelector('.close-dialog').addEventListener('click', () => dialog.close()); dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } }); });
// Content comes from the server; credentials never enter the public browser bundle.
const contentDialog = document.querySelector('#content-dialog');
const photoLightbox = document.querySelector('#photo-lightbox');
photoLightbox.addEventListener('click', event => { if (event.target === photoLightbox) photoLightbox.close(); });
function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}
function safeUrl(value, image = false) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, location.origin);
    if (image && ['https:', 'http:'].includes(url.protocol)) return url.href;
    if (!image && url.protocol === 'https:') return url.href;
  } catch (_) { /* Invalid URLs simply have no actionable control. */ }
  return null;
}
function contentImage(item, className) {
  const url = safeUrl(item.imageUrl, true) || galleryPhotos(item)[0]?.url;
  if (!url) return null;
  const image = element('img', className);
  image.src = url;
  image.alt = item.title || '';
  image.loading = 'lazy';
  image.addEventListener('error', () => image.remove(), {once: true});
  return image;
}

function galleryPhotos(item) {
  const photos = Array.isArray(item.images) ? item.images.filter(photo => photo && safeUrl(photo.url, true)).map(photo => ({url: safeUrl(photo.url, true), filename: photo.filename || ''})) : [];
  const cover = safeUrl(item.imageUrl, true);
  if (cover && !photos.some(photo => photo.url === cover)) photos.unshift({url:cover, filename:''});
  return photos;
}
function createGallery(item) {
  const photos = galleryPhotos(item);
  if (!photos.length) return null;
  const gallery = element('section', 'photo-gallery');
  gallery.setAttribute('aria-label', `Fotografie: ${item.title || 'Nerea'}`);
  const controller = new AbortController();
  const options = {signal:controller.signal};
  const stage = element('button', 'gallery-stage');
  stage.type = 'button';
  stage.setAttribute('aria-label', 'Apri la foto a schermo intero');
  const main = element('img', 'gallery-main');
  stage.append(main, element('span', 'gallery-enlarge', 'Ingrandisci ↗'));
  const controls = element('div', 'gallery-controls');
  const previous = element('button', 'gallery-arrow', '←');
  previous.type = 'button'; previous.setAttribute('aria-label', 'Foto precedente');
  const next = element('button', 'gallery-arrow', '→');
  next.type = 'button'; next.setAttribute('aria-label', 'Foto successiva');
  const counter = element('span', 'gallery-counter');
  counter.setAttribute('role', 'status');
  controls.append(previous, counter, next);
  const thumbnails = element('div', 'gallery-thumbnails');
  thumbnails.setAttribute('aria-label', 'Scegli una fotografia');
  let index = 0;
  let lightboxController;
  let lightboxImage;
  let lightboxCounter;
  const lightbox = document.querySelector('#photo-lightbox');
  const buttons = photos.map((photo, photoIndex) => {
    const button = element('button', 'gallery-thumbnail');
    button.type = 'button';
    button.setAttribute('aria-label', `Mostra foto ${photoIndex + 1} di ${photos.length}`);
    const image = element('img');
    image.src = photo.url; image.alt = ''; image.loading = 'lazy';
    button.append(image);
    button.addEventListener('click', () => update(photoIndex), options);
    thumbnails.append(button);
    return button;
  });
  function update(value) {
    index = (value + photos.length) % photos.length;
    const caption = `${item.title || 'Nerea'} — foto ${index + 1} di ${photos.length}`;
    main.src = photos[index].url; main.alt = caption;
    counter.textContent = `${index + 1} / ${photos.length}`;
    buttons.forEach((button, buttonIndex) => button.setAttribute('aria-pressed', String(buttonIndex === index)));
    if (lightboxImage) { lightboxImage.src = photos[index].url; lightboxImage.alt = caption; lightboxCounter.textContent = counter.textContent; }
  }
  function arrows(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      update(index + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  }
  previous.addEventListener('click', () => update(index - 1), options);
  next.addEventListener('click', () => update(index + 1), options);
  contentDialog.addEventListener('keydown', event => { if (!lightbox.open) arrows(event); }, options);
  stage.addEventListener('click', () => {
    lightboxController = new AbortController();
    const lightboxOptions = {signal:lightboxController.signal};
    const body = document.querySelector('#photo-lightbox-body');
    body.replaceChildren();
    lightboxImage = element('img', 'lightbox-image');
    lightboxCounter = element('span', 'gallery-counter');
    lightboxCounter.setAttribute('role', 'status');
    const bar = element('div', 'gallery-controls lightbox-controls');
    const back = element('button', 'gallery-arrow', '←');
    back.type = 'button'; back.setAttribute('aria-label', 'Foto precedente');
    const forward = element('button', 'gallery-arrow', '→');
    forward.type = 'button'; forward.setAttribute('aria-label', 'Foto successiva');
    back.addEventListener('click', () => update(index - 1), lightboxOptions);
    forward.addEventListener('click', () => update(index + 1), lightboxOptions);
    if (photos.length === 1) { back.hidden = true; forward.hidden = true; }
    bar.append(back, lightboxCounter, forward);
    body.append(lightboxImage, bar);
    update(index);
    lightbox.addEventListener('keydown', arrows, lightboxOptions);
    lightbox.addEventListener('close', () => {
      lightboxController.abort();
      lightboxImage = null; lightboxCounter = null;
      body.replaceChildren();
      if (contentDialog.open) stage.focus();
    }, {once:true, signal:lightboxController.signal});
    lightbox.showModal();
    lightbox.querySelector('.close-dialog').focus();
  }, options);
  contentDialog.addEventListener('close', () => {
    if (lightbox.open) lightbox.close();
    controller.abort();
  }, {once:true, signal:controller.signal});
  if (photos.length === 1) { previous.hidden = true; next.hidden = true; thumbnails.hidden = true; }
  gallery.append(stage, controls, thumbnails);
  update(0);
  return gallery;
}

function formattedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('it-IT', {day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Rome'}).format(date);
}
function detailMeta(item) {
  return [item.category, formattedDate(item.date), item.location].filter(Boolean).join(' · ');
}
function externalLink(item) {
  const url = safeUrl(item.link);
  if (!url) return null;
  const link = element('a', 'button green', item.buttonLabel || 'Scopri di più ↗');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
function openContent(item) {
  const body = document.querySelector('#content-dialog-body');
  body.replaceChildren();
  const gallery = createGallery(item);
  if (gallery) body.append(gallery);
  body.append(element('span', 'section-label', detailMeta(item)));
  const title = element('h2', '', item.title);
  title.id = 'content-dialog-title';
  body.append(title, element('p', 'full-description', item.description || ''));
  const link = externalLink(item);
  if (link) body.append(link);
  contentDialog.showModal();
}
function visibleItems(items) {
  return Array.isArray(items) ? items.filter(item => item && item.published !== false).sort((a,b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)) : [];
}
function renderCards(container, items, emptyMessage, type) {
  container.replaceChildren();
  container.classList.add('content-grid');
  if (!items.length) {
    container.append(element('p', 'empty-state', emptyMessage));
    return;
  }
  items.forEach((item, index) => {
    const card = element('article', 'content-card reveal');
    const photo = contentImage(item, 'content-image');
    if (photo) {
      const cover = element('div', 'content-cover');
      cover.append(photo);
      const count = galleryPhotos(item).length;
      if (count > 1) cover.append(element('span', 'photo-count', `${count} foto`));
      card.append(cover);
    }
    else card.append(element('div', 'content-number', String(index + 1).padStart(2, '0')));
    const text = element('div', 'content-copy');
    text.append(element('div', 'project-meta', detailMeta(item) || type), element('h3', '', item.title || type), element('p', 'card-description', item.description || ''));
    const button = element('button', 'text-link', type === 'EVENTO' ? 'Scopri l’appuntamento ↗' : 'Leggi la storia ↗');
    button.type = 'button';
    button.addEventListener('click', () => openContent(item));
    text.append(button);
    card.append(text);
    container.append(card);
    observer.observe(card);
  });
}
function renderDonations(items) {
  if (!items.length) return;
  const container = document.querySelector('#donations-list');
  container.replaceChildren();
  items.forEach(item => {
    const card = element('article', 'donation-card reveal');
    const photo = contentImage(item, 'donation-image');
    if (photo) card.append(photo);
    const body = element('div', 'donation-copy');
    body.append(element('h3', '', item.title || 'Sostieni Nerea'), element('p', 'full-description', item.description || ''));
    const link = externalLink(item);
    if (link) body.append(link);
    if (item.iban) {
      const bank = element('div', 'bank-details');
      bank.append(element('span', 'section-label', 'BONIFICO BANCARIO'), element('p', 'iban-value', item.iban));
      const copy = element('button', 'text-link', 'Copia IBAN');
      copy.type = 'button';
      const feedback = element('span', 'copy-feedback');
      feedback.setAttribute('role', 'status');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(String(item.iban)); feedback.textContent = 'IBAN copiato.'; }
        catch (_) { feedback.textContent = 'Seleziona e copia l’IBAN riportato qui sopra.'; }
      });
      bank.append(copy, feedback);
      body.append(bank);
    }
    card.append(body);
    container.append(card);
    observer.observe(card);
  });
}
async function loadContent() {
  try {
    const response = await fetch('/api/content', {headers:{Accept:'application/json'}});
    if (!response.ok) return;
    const data = await response.json();
    if (!data.configured) return;
    renderCards(document.querySelector('.project-grid'), visibleItems(data.projects), 'Nuove storie stanno prendendo forma. Presto troverai qui i progetti di Nerea.', 'PROGETTO');
    renderCards(document.querySelector('#events-list'), visibleItems(data.events), 'Non ci sono appuntamenti pubblicati al momento. Torna a trovarci per scoprire i prossimi incontri.', 'EVENTO');
    renderCards(document.querySelector('#news-list'), visibleItems(data.news), 'Non ci sono ancora notizie pubblicate. Questo spazio accoglierà le novità di Nerea.', 'NOTIZIA');
    renderDonations(visibleItems(data.donations));
  } catch (_) { /* Keep the editorial content usable while the service is unavailable. */ }
}
loadContent();
