const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {createAirtable,ApiError} = require('./airtable.cjs');
const SESSION_AGE = 8*60*60;
const secureEqual = (a,b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(),crypto.createHash('sha256').update(String(b)).digest());
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
function createApp({config,root,fetchImpl,airtableInterval}) {
  const store = createAirtable(config,fetchImpl,airtableInterval);
  const key = crypto.createHmac('sha256',config.secret).update(config.username+':'+config.password).digest();
  const attempts = new Map(); const revoked = new Map();
  let cached = null; let cacheUntil = 0; let pending = null; let contentRevision = 0;
  function sign(value) { return crypto.createHmac('sha256',key).update(value).digest('base64url'); }
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('nerea_session='))?.slice(14);
    if (!token || token.length > 1000 || revoked.has(token)) return null;
    const [payload,signature,...rest] = token.split('.');
    if (!payload || !signature || rest.length || !secureEqual(sign(payload),signature)) return null;
    try { const data = JSON.parse(Buffer.from(payload,'base64url').toString()); if (data.exp <= Date.now()/1000 || data.user !== config.username) return null; return {...data,token}; } catch { return null; }
  }
  function cookie(value,age = SESSION_AGE) { return `nerea_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.production ? '; Secure' : ''}`; }
  function json(res,status,data,headers = {}) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(data)); }
  async function body(req,max = 100000) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new ApiError(415,'Usa il formato JSON.');
    // Vercel's Node function helpers may already have parsed the request body.
    if (req.body !== undefined) {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(raw || '') > max) throw new ApiError(413,'File o richiesta troppo grande.');
      try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { throw new ApiError(400,'Richiesta JSON non valida.'); }
    }
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > max) throw new ApiError(413,'File o richiesta troppo grande.'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400,'Richiesta JSON non valida.'); }
  }
  function checkOrigin(req) {
    const expected = config.origin || `${config.production ? 'https' : 'http'}://${req.headers.host}`;
    if (req.headers['x-nerea-admin'] !== '1' || (req.headers.origin && req.headers.origin !== expected) || req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403,'Richiesta non autorizzata da questo sito.');
  }
  async function publicContent() {
    if (!config.token) return {configured:false,projects:[],events:[],news:[],donations:[]};
    if (cached && Date.now() < cacheUntil) return cached;
    if (!pending) {
      const revision = contentRevision;
      pending = (async () => { const result = {configured:true}; for (const type of Object.keys(config.tables)) result[type] = await store.list(type,true); if (revision === contentRevision) { cached = result; cacheUntil = Date.now()+30000; } return result; })().finally(() => { pending = null; });
    }
    return pending;
  }
  return async function app(req,res) {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    if (config.production) res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url = new URL(req.url,'http://localhost'); const route = url.pathname;
      if (route === '/api/content' && req.method === 'GET') return json(res,200,await publicContent());
      if (route.startsWith('/api/admin/')) {
        for (const [ip,data] of attempts) if (data.until < Date.now()) attempts.delete(ip);
        for (const [token,expiry] of revoked) if (expiry < Date.now()/1000) revoked.delete(token);
        if (req.method !== 'GET') checkOrigin(req);
        if (route === '/api/admin/login' && req.method === 'POST') {
          const ip = req.socket.remoteAddress; const attempt = attempts.get(ip);
          if (attempt?.count >= 8) return json(res,429,{error:'Troppi tentativi. Riprova tra 15 minuti.'},{'Retry-After':String(Math.ceil((attempt.until-Date.now())/1000))});
          const input = await body(req);
          if (!input || typeof input !== 'object' || typeof input.username !== 'string' || typeof input.password !== 'string') throw new ApiError(400,'Identifiants non valides.');
          const validUser = secureEqual(input.username,config.username); const validPassword = secureEqual(input.password,config.password);
          if (!validUser || !validPassword) { attempts.set(ip,{count:(attempt?.count || 0)+1,until:attempt?.until || Date.now()+15*60*1000}); throw new ApiError(401,'Nome utente o password non corretti.'); }
          attempts.delete(ip);
          const payload = Buffer.from(JSON.stringify({user:config.username,exp:Math.floor(Date.now()/1000)+SESSION_AGE,nonce:crypto.randomBytes(16).toString('hex')})).toString('base64url');
          return json(res,200,{authenticated:true,username:config.username,configured:!!config.token},{'Set-Cookie':cookie(`${payload}.${sign(payload)}`)});
        }
        const user = session(req); if (!user) throw new ApiError(401,'Accedi per continuare.');
        if (route === '/api/admin/session' && req.method === 'GET') return json(res,200,{authenticated:true,username:user.user,configured:!!config.token});
        if (route === '/api/admin/logout' && req.method === 'POST') { revoked.set(user.token,user.exp); return json(res,200,{ok:true},{'Set-Cookie':cookie('',0)}); }
        const type = url.searchParams.get('type'); if (!Object.hasOwn(config.tables,type)) throw new ApiError(400,'Tipo di contenuto non valido.');
        if (route === '/api/admin/content' && req.method === 'GET') return json(res,200,{records:await store.list(type)});
        const match = route.match(/^\/api\/admin\/content\/(rec[A-Za-z0-9]{14})$/);
        if ((route === '/api/admin/content' && req.method === 'POST') || (match && req.method === 'PATCH')) {
          const record = await store.save(type,await body(req),match?.[1]); cached = null; cacheUntil = 0; contentRevision++;
          return json(res,match ? 200 : 201,{record});
        }
        if (route === '/api/admin/upload' && req.method === 'POST') {
          const record = await store.upload(type,url.searchParams.get('recordId'),await body(req,7100000)); cached = null; cacheUntil = 0; contentRevision++;
          return json(res,200,{imageUrl:record.imageUrl,record});
        }
        if (route === '/api/admin/gallery' && req.method === 'PATCH') {
          const record = await store.gallery(type,url.searchParams.get('recordId'),await body(req)); cached = null; cacheUntil = 0; contentRevision++;
          return json(res,200,{record});
        }
        throw new ApiError(404,'Risorsa non trovata.');
      }
      if (route.startsWith('/api/')) throw new ApiError(404,'Risorsa non trovata.');
      if (!['GET','HEAD'].includes(req.method)) throw new ApiError(405,'Metodo non consentito.');
      let decoded; try { decoded = decodeURIComponent(route); } catch { throw new ApiError(400,'Indirizzo non valido.'); }
      const filePath = decoded === '/' ? '/index.html' : ['/admin','/admin/'].includes(decoded) ? '/admin.html' : decoded;
      const file = path.resolve(root,'.'+filePath); const relative = path.relative(root,file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part.startsWith('.')) || file.includes('\0')) throw new ApiError(403,'Accesso negato.');
      let data; try { data = await fs.readFile(file); } catch { throw new ApiError(404,'Pagina non trovata.'); }
      res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=300'});
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = error instanceof ApiError ? error.status : 500;
      if (status === 500) console.error('Request failed:',error.name);
      json(res,status,{error:status === 500 ? 'Errore del server. Riprova tra poco.' : error.message});
    }
  };
}
module.exports = {createApp};
