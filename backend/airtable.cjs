class ApiError extends Error {
  constructor(status,message) { super(message); this.status = status; }
}
const FIELD_MAP = {title:'Title',description:'Description',category:'Category',date:'Date',location:'Location',published:'Published',link:'Link',iban:'IBAN',buttonLabel:'ButtonLabel',sortOrder:'SortOrder'};
function recordFromAirtable(record) {
  const fields = record.fields || {};
  const result = {id:record.id};
  for (const [key,field] of Object.entries(FIELD_MAP)) result[key] = fields[field] ?? (key === 'published' ? false : key === 'sortOrder' ? 0 : '');
  result.images = (Array.isArray(fields.Image) ? fields.Image : []).map(image => ({id:image.id,url:image.url,filename:image.filename || ''}));
  result.imageUrl = result.images[0]?.url || '';
  return result;
}
function validateContent(input,partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400,'Contenuto non valido.');
  const fields = {};
  const limits = {title:180,description:30000,category:120,date:10,location:250,link:2000,iban:60,buttonLabel:80};
  for (const [key,max] of Object.entries(limits)) {
    if (!(key in input)) continue;
    if (typeof input[key] !== 'string' || input[key].length > max) throw new ApiError(400,`Campo non valido: ${key}.`);
    const value = input[key].trim();
    if (key === 'title' && !value) throw new ApiError(400,'Inserisci un titolo.');
    if (key === 'link' && value) {
      let url;
      try { url = new URL(value); } catch { throw new ApiError(400,'Inserisci un link HTTPS valido.'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new ApiError(400,'Il link deve usare HTTPS.');
    }
    if (key === 'date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) throw new ApiError(400,'Data non valida.');
    fields[FIELD_MAP[key]] = key === 'date' && !value ? null : value;
  }
  if (!partial && !fields.Title) throw new ApiError(400,'Inserisci un titolo.');
  if ('published' in input) {
    if (typeof input.published !== 'boolean') throw new ApiError(400,'Stato di pubblicazione non valido.');
    fields.Published = input.published;
  } else if (!partial) fields.Published = false;
  if ('sortOrder' in input) {
    if (!Number.isInteger(input.sortOrder) || Math.abs(input.sortOrder) > 1000000) throw new ApiError(400,'Ordine non valido.');
    fields.SortOrder = input.sortOrder;
  }
  if (!Object.keys(fields).length) throw new ApiError(400,'Nessun campo da aggiornare.');
  return fields;
}
function validateImage(input) {
  const {filename,contentType,base64} = input || {};
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 200 || /[\/\\\x00-\x1f]/.test(filename)) throw new ApiError(400,'Nome del file non valido.');
  if (!['image/jpeg','image/png','image/webp'].includes(contentType)) throw new ApiError(400,'Scegli una foto JPG, PNG o WebP.');
  if (typeof base64 !== 'string' || !base64.length || base64.length > 7000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ApiError(400,'File non valido.');
  const bytes = Buffer.from(base64,'base64');
  if (bytes.length > 5*1024*1024) throw new ApiError(413,'La foto deve pesare al massimo 5 MB.');
  if (bytes.toString('base64') !== base64) throw new ApiError(400,'File non valido.');
  const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = bytes.length > 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!({'image/jpeg':jpeg,'image/png':png,'image/webp':webp})[contentType]) throw new ApiError(400,'Il contenuto del file non corrisponde al formato della foto.');
  return {filename,contentType,file:base64};
}
function createAirtable(config,fetchImpl = fetch,interval = 230) {
  let queue = Promise.resolve(); let nextRequest = 0;
  function table(type) {
    if (!Object.hasOwn(config.tables,type)) throw new ApiError(400,'Tipo di contenuto non valido.');
    return encodeURIComponent(config.tables[type]);
  }
  function request(url,options = {}) {
    if (!config.token) throw new ApiError(503,'Configura AIRTABLE_TOKEN nel file .env e riavvia il server.');
    const task = queue.then(async () => {
      const wait = nextRequest-Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve,wait));
      nextRequest = Date.now()+interval;
      let response;
      try { response = await fetchImpl(url,{...options,headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)}); }
      catch { throw new ApiError(502,'Airtable non è raggiungibile. Riprova tra poco.'); }
      if (!response.ok) {
        if (response.status === 429) { nextRequest = Date.now()+30000; throw new ApiError(503,'Limite Airtable raggiunto. Attendi 30 secondi e riprova.'); }
        if ([401,403].includes(response.status)) throw new ApiError(502,'Airtable: verifica token, permessi e accesso alla base.');
        if (response.status === 404) throw new ApiError(404,'Contenuto o tabella non trovato.');
        throw new ApiError(502,'Airtable ha rifiutato la richiesta. Verifica i campi e gli ID delle tabelle.');
      }
      try { return await response.json(); } catch { throw new ApiError(502,'Risposta Airtable non valida.'); }
    });
    queue = task.catch(() => {}); return task;
  }
  const endpoint = type => `https://api.airtable.com/v0/${encodeURIComponent(config.baseId)}/${table(type)}`;
  const recordId = id => { if (!/^rec[A-Za-z0-9]{14}$/.test(id)) throw new ApiError(400,'ID del contenuto non valido.'); return id; };
  return {
    async list(type,publishedOnly = false) {
      const records = []; let offset;
      do {
        const url = new URL(endpoint(type)); url.searchParams.set('pageSize','100');
        if (publishedOnly) url.searchParams.set('filterByFormula','{Published}=1');
        if (offset) url.searchParams.set('offset',offset);
        const data = await request(url.toString());
        records.push(...data.records.map(recordFromAirtable)); offset = data.offset;
      } while (offset);
      return records.filter(record => !publishedOnly || record.published).sort((a,b) => a.sortOrder-b.sortOrder || (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title));
    },
    async save(type,input,id) {
      const fields = validateContent(input,!!id);
      const url = endpoint(type)+(id ? `/${recordId(id)}` : '');
      return recordFromAirtable(await request(url,{method:id ? 'PATCH' : 'POST',body:JSON.stringify({fields})}));
    },
    async upload(type,id,input) {
      const file = validateImage(input);
      const url = `${endpoint(type)}/${recordId(id)}`;
      // Verify membership before calling Airtable's base-wide upload endpoint.
      const previous = await request(url);
      if (type === 'projects' && (previous.fields?.Image?.length || 0) >= 20) throw new ApiError(400,'La galleria può contenere al massimo 20 foto.');
      await request(`https://content.airtable.com/v0/${encodeURIComponent(config.baseId)}/${id}/Image/uploadAttachment`,{method:'POST',body:JSON.stringify(file)});
      const current = await request(url);
      const image = current.fields?.Image?.at(-1);
      if (!image?.id) throw new ApiError(502,'Foto inviata ma non ancora disponibile. Ricarica il contenuto.');
      if (type === 'projects') return recordFromAirtable(current);
      const saved = await request(url,{method:'PATCH',body:JSON.stringify({fields:{Image:[{id:image.id}]}})});
      return recordFromAirtable(saved);
    },
    async gallery(type,id,input) {
      if (type !== 'projects') throw new ApiError(400,'La galleria è disponibile per i progetti.');
      const ids = input?.imageIds;
      if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !/^att[A-Za-z0-9]{14}$/.test(id)) || new Set(ids).size !== ids.length) throw new ApiError(400,'Elenco delle foto non valido.');
      const url = `${endpoint(type)}/${recordId(id)}`;
      const current = await request(url);
      const existing = new Set((current.fields?.Image || []).map(image => image.id));
      if (input.expectedImageIds !== undefined) {
        if (!Array.isArray(input.expectedImageIds) || input.expectedImageIds.some(id => typeof id !== 'string')) throw new ApiError(400,'Elenco delle foto non valido.');
        if (JSON.stringify(input.expectedImageIds) !== JSON.stringify([...existing])) throw new ApiError(409,'Le foto sono cambiate in un’altra finestra. Chiudi e riapri il progetto prima di salvare la galleria.');
      }
      if (ids.some(id => !existing.has(id))) throw new ApiError(400,'Una delle foto non appartiene a questo progetto. Ricarica il contenuto.');
      const saved = await request(url,{method:'PATCH',body:JSON.stringify({fields:{Image:ids.map(id => ({id}))}})});
      return recordFromAirtable(saved);
    }
  };
}
module.exports = {createAirtable,ApiError,validateContent,validateImage,recordFromAirtable};
