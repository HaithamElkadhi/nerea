const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const {createApp} = require('../backend/app.cjs');
const {loadConfig} = require('../backend/config.cjs');
const {createAirtable,validateImage,validateContent} = require('../backend/airtable.cjs');
const ID = 'rec12345678901234';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=';
function mockAirtable() {
  const tables = new Map(); const calls = []; let attachmentCount = 0;
  const fetch = async (address,options = {}) => {
    const url = new URL(address); calls.push({url,options});
    const parts = url.pathname.split('/').filter(Boolean); const table = parts[2]; const id = parts[3];
    const json = options.body ? JSON.parse(options.body) : null;
    if (url.hostname === 'content.airtable.com') {
      const record = [...tables.values()].flat().find(record => record.id === parts[2]);
      attachmentCount++;
      record.fields.Image = [...(record.fields.Image || []),{id:'att'+String(attachmentCount).padStart(14,'0'),url:`https://v5.airtableusercontent.com/example-${attachmentCount}.png`,filename:json.filename}];
      return Response.json({id:record.id,fields:{fldImage:record.fields.Image}});
    }
    if (!tables.has(table)) tables.set(table,[]);
    const records = tables.get(table);
    if (options.method === 'POST') { const record = {id:ID,fields:json.fields}; records.push(record); return Response.json(record); }
    if (id) {
      const record = records.find(record => record.id === id);
      if (!record) return Response.json({error:'NOT_FOUND'},{status:404});
      if (options.method === 'PATCH') {
        const cover = record.fields.Image;
        Object.assign(record.fields,json.fields);
        if (json.fields.Image) record.fields.Image = json.fields.Image.map(item => cover.find(image => image.id === item.id));
      }
      return Response.json(record);
    }
    const published = url.searchParams.has('filterByFormula');
    return Response.json({records:records.filter(record => !published || record.fields.Published)});
  };
  return {fetch,tables,calls};
}
async function fixture(t,env = {AIRTABLE_TOKEN:'test-token'}) {
  const mock = mockAirtable(); const config = loadConfig(env);
  const server = http.createServer(createApp({config,root:path.join(__dirname,'../dist'),fetchImpl:mock.fetch,airtableInterval:0}));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function request(route,method = 'GET',data,extra = {}) {
    const response = await fetch(origin+route,{method,headers:{'Content-Type':'application/json','X-Nerea-Admin':'1',Origin:origin,...(cookie ? {Cookie:cookie} : {}),...extra},body:data === undefined ? undefined : JSON.stringify(data)});
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  }
  async function login() { const response = await request('/api/admin/login','POST',{username:'admin',password:'admin'}); assert.equal(response.status,200); return response; }
  return {request,login,mock,config,getCookie:() => cookie,origin};
}
test('admin routes require a valid signed session, including protection against forged cookies',async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/content?type=projects')).status,401);
  assert.equal((await f.request('/api/admin/session','GET',undefined,{Cookie:'nerea_session=fake.signature'})).status,401);
  const response = await f.login();
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.equal((await f.request('/api/admin/session')).status,200);
});
test('login rejects incorrect credentials and rate limits repeated attempts',async t => {
  const f = await fixture(t);
  for (let i=0;i<8;i++) assert.equal((await f.request('/api/admin/login','POST',{username:'admin',password:'wrong'})).status,401);
  assert.equal((await f.request('/api/admin/login','POST',{username:'admin',password:'admin'})).status,429);
});
test('cross-origin mutations and missing CSRF headers are rejected',async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/login','POST',{username:'admin',password:'admin'},{Origin:'https://other.example'})).status,403);
  assert.equal((await f.request('/api/admin/login','POST',{username:'admin',password:'admin'},{'X-Nerea-Admin':''})).status,403);
});
test('malformed login input returns a validation error',async t => {
  const f = await fixture(t);
  for (const input of [null,[],{username:12,password:'admin'}]) assert.equal((await f.request('/api/admin/login','POST',input)).status,400);
});
test('logout invalidates a previously issued session',async t => {
  const f = await fixture(t); await f.login(); const old = f.getCookie();
  assert.equal((await f.request('/api/admin/logout','POST')).status,200);
  assert.equal((await f.request('/api/admin/session','GET',undefined,{Cookie:old})).status,401);
});
test('create, edit, publish and unpublish content; drafts never enter the public API',async t => {
  const f = await fixture(t); await f.login();
  const created = await f.request('/api/admin/content?type=projects','POST',{title:'Laboratorio',description:'Un incontro per crescere',published:false});
  assert.equal(created.status,201); assert.equal((await created.json()).record.id,ID);
  assert.deepEqual((await (await f.request('/api/content')).json()).projects,[]);
  const edit = await f.request(`/api/admin/content/${ID}?type=projects`,'PATCH',{title:'Laboratorio aperto',published:true});
  assert.equal(edit.status,200);
  const content = await (await f.request('/api/content')).json();
  assert.equal(content.projects[0].title,'Laboratorio aperto'); assert.equal(content.projects[0].description,'Un incontro per crescere');
  assert.ok(!JSON.stringify(content).includes('test-token'));
  await f.request(`/api/admin/content/${ID}?type=projects`,'PATCH',{published:false});
  assert.deepEqual((await (await f.request('/api/content')).json()).projects,[]);
});
test('events, news and donation configuration round-trip to separate tables',async t => {
  const f = await fixture(t); await f.login();
  for (const type of ['events','news','donations']) {
    const response = await f.request(`/api/admin/content?type=${type}`,'POST',{title:type,description:'Descrizione',date:'2026-11-02',location:'Napoli',link:'https://example.org/support',iban:type === 'donations' ? 'TEST-IBAN' : '',buttonLabel:'Sostieni',published:true,sortOrder:2});
    assert.equal(response.status,201);
  }
  const data = await (await f.request('/api/content')).json();
  assert.equal(data.events[0].date,'2026-11-02'); assert.equal(data.news[0].title,'news'); assert.equal(data.donations[0].iban,'TEST-IBAN');
});
test('photo upload verifies table membership and sends base64 directly to Airtable',async t => {
  const f = await fixture(t); await f.login();
  await f.request('/api/admin/content?type=projects','POST',{title:'Foto',published:true});
  const file = {filename:'cover.png',contentType:'image/png',base64:PNG};
  assert.equal((await f.request(`/api/admin/upload?type=news&recordId=${ID}`,'POST',file)).status,404);
  const response = await f.request(`/api/admin/upload?type=projects&recordId=${ID}`,'POST',file);
  assert.equal(response.status,200); assert.match((await response.json()).imageUrl,/airtableusercontent/);
  const upload = f.mock.calls.find(call => call.url.hostname === 'content.airtable.com');
  assert.equal(JSON.parse(upload.options.body).file,PNG);
  assert.equal(upload.options.headers.Authorization,'Bearer test-token');
});
test('invalid fields, dates, links, image formats and file signatures are rejected',() => {
  for (const input of [{title:''},{title:'a',date:'2026-02-30'},{title:'a',link:'javascript:alert(1)'},{title:'a',published:'true'},{title:'a',sortOrder:1.5},null]) assert.throws(() => validateContent(input));
  assert.throws(() => validateImage({filename:'x.png',contentType:'image/png',base64:Buffer.from('<script>').toString('base64')}));
  assert.throws(() => validateImage({filename:'x.svg',contentType:'image/svg+xml',base64:PNG}));
  assert.throws(() => validateImage({filename:'../x.png',contentType:'image/png',base64:PNG}));
  assert.equal(validateImage({filename:'x.png',contentType:'image/png',base64:PNG}).file,PNG);
});
test('project gallery appends photos without replacing the first cover',async t => {
  const f = await fixture(t); await f.login();
  await f.request('/api/admin/content?type=projects','POST',{title:'Gallery',published:true});
  const one = await (await f.request(`/api/admin/upload?type=projects&recordId=${ID}`,'POST',{filename:'one.png',contentType:'image/png',base64:PNG})).json();
  const twoResponse = await f.request(`/api/admin/upload?type=projects&recordId=${ID}`,'POST',{filename:'two.png',contentType:'image/png',base64:PNG});
  assert.equal(twoResponse.status,200); const two = await twoResponse.json();
  assert.equal(two.record.images.length,2); assert.equal(two.imageUrl,one.imageUrl);
  assert.deepEqual(two.record.images.map(image => image.filename),['one.png','two.png']);
  const publicContent = await (await f.request('/api/content')).json();
  assert.equal(publicContent.projects[0].images.length,2);
});
test('gallery ordering selects the cover and supports removing an image or clearing the gallery',async t => {
  const f = await fixture(t); await f.login();
  await f.request('/api/admin/content?type=projects','POST',{title:'Gallery'});
  for (const filename of ['a.png','b.png']) await f.request(`/api/admin/upload?type=projects&recordId=${ID}`,'POST',{filename,contentType:'image/png',base64:PNG});
  const records = (await (await f.request('/api/admin/content?type=projects')).json()).records;
  const [a,b] = records[0].images;
  const reorder = await f.request(`/api/admin/gallery?type=projects&recordId=${ID}`,'PATCH',{imageIds:[b.id,a.id]});
  assert.equal(reorder.status,200); const ordered = (await reorder.json()).record;
  assert.equal(ordered.imageUrl,b.url); assert.deepEqual(ordered.images.map(image=>image.id),[b.id,a.id]);
  const removed = await f.request(`/api/admin/gallery?type=projects&recordId=${ID}`,'PATCH',{imageIds:[a.id]});
  assert.equal((await removed.json()).record.images.length,1);
  const cleared = await f.request(`/api/admin/gallery?type=projects&recordId=${ID}`,'PATCH',{imageIds:[]});
  const empty=(await cleared.json()).record; assert.deepEqual(empty.images,[]); assert.equal(empty.imageUrl,'');
});
test('gallery edits require login and reject duplicate, unknown and foreign attachments',async t => {
  const f = await fixture(t);
  assert.equal((await f.request(`/api/admin/gallery?type=projects&recordId=${ID}`,'PATCH',{imageIds:[]})).status,401);
  await f.login(); await f.request('/api/admin/content?type=projects','POST',{title:'Gallery'});
  for (const imageIds of [['att00000000000001'],['att00000000000001','att00000000000001'],null,'bad']) {
    assert.equal((await f.request(`/api/admin/gallery?type=projects&recordId=${ID}`,'PATCH',{imageIds})).status,400);
  }
  assert.equal((await f.request(`/api/admin/gallery?type=projects&recordId=rec00000000000000`,'PATCH',{imageIds:[]})).status,404);
  assert.equal((await f.request(`/api/admin/gallery?type=news&recordId=${ID}`,'PATCH',{imageIds:[]})).status,400);
});
test('non-project image uploads still replace their single cover',async t => {
  const f=await fixture(t); await f.login(); await f.request('/api/admin/content?type=news','POST',{title:'News'});
  for(const filename of ['a.png','b.png']) {
    const response=await f.request(`/api/admin/upload?type=news&recordId=${ID}`,'POST',{filename,contentType:'image/png',base64:PNG});
    assert.equal(response.status,200);
  }
  const record=(await (await f.request('/api/admin/content?type=news')).json()).records[0];
  assert.equal(record.images.length,1); assert.equal(record.images[0].filename,'b.png');
});
test('gallery limit prevents uploads beyond twenty images before sending file bytes',async t => {
  const f=await fixture(t); await f.login(); await f.request('/api/admin/content?type=projects','POST',{title:'Full gallery'});
  f.mock.tables.get(f.config.tables.projects)[0].fields.Image=Array.from({length:20},(_,i)=>({id:'att'+String(i).padStart(14,'0'),url:'https://example.org/image.png'}));
  const response=await f.request(`/api/admin/upload?type=projects&recordId=${ID}`,'POST',{filename:'extra.png',contentType:'image/png',base64:PNG});
  assert.equal(response.status,400);
  assert.equal(f.mock.calls.filter(call=>call.url.hostname==='content.airtable.com').length,0);
});
test('stale gallery edits are rejected without removing newer attachments',async t => {
  const f=await fixture(t); await f.login(); await f.request('/api/admin/content?type=projects','POST',{title:'Gallery'});
  const upload=await f.request(`/api/admin/upload?type=projects&recordId=${ID}`,'POST',{filename:'a.png',contentType:'image/png',base64:PNG});
  const image=(await upload.json()).record.images[0];
  const stale=await f.request(`/api/admin/gallery?type=projects&recordId=${ID}`,'PATCH',{imageIds:[],expectedImageIds:[]});
  assert.equal(stale.status,409);
  assert.equal(f.mock.tables.get(f.config.tables.projects)[0].fields.Image[0].id,image.id);
});
test('missing token is explicit and never silently saves locally',async t => {
  const f = await fixture(t,{}); await f.login();
  assert.equal((await (await f.request('/api/content')).json()).configured,false);
  const response = await f.request('/api/admin/content?type=projects','POST',{title:'Not saved'});
  assert.equal(response.status,503); assert.match((await response.json()).error,/AIRTABLE_TOKEN/); assert.equal(f.mock.calls.length,0);
});
test('invalid content type cannot select an arbitrary Airtable table',async t => {
  const f = await fixture(t); await f.login();
  assert.equal((await f.request('/api/admin/content?type=other')).status,400);
  assert.equal(f.mock.calls.length,0);
});
test('static files are served but secrets and encoded traversal are inaccessible',async t => {
  const f = await fixture(t,{});
  assert.equal((await f.request('/')).status,200);
  assert.equal((await f.request('/admin')).status,200);
  assert.equal((await f.request('/.env')).status,403);
  assert.notEqual((await f.request('/..%5c.env')).status,200);
  const response = await f.request('/backend/config.cjs'); assert.equal(response.status,404);
});
test('Airtable list pagination and public filtering preserve all published records',async () => {
  let calls = 0; const config = loadConfig({AIRTABLE_TOKEN:'test'});
  const client = createAirtable(config,async url => { calls++; const offset = new URL(url).searchParams.get('offset'); return Response.json(offset ? {records:[{id:'recB',fields:{Title:'B',Published:true}}]} : {records:[{id:'recA',fields:{Title:'A',Published:true}},{id:'recDraft',fields:{Title:'Hidden'}}],offset:'next'}); },0);
  const records = await client.list('projects',true); assert.equal(calls,2); assert.deepEqual(records.map(r=>r.title),['A','B']);
});
test('Airtable authorization failures never expose upstream secrets',async () => {
  const client = createAirtable(loadConfig({AIRTABLE_TOKEN:'secret-token'}),async () => Response.json({error:'secret-token'},{status:403}),0);
  await assert.rejects(client.list('projects'),error => error.status === 502 && !error.message.includes('secret-token'));
});
test('production refuses default password and uses explicit configuration',() => {
  assert.throws(() => loadConfig({NODE_ENV:'production'}));
  const config = loadConfig({NODE_ENV:'production',ADMIN_PASSWORD:'a-long-unique-password',SESSION_SECRET:'x'.repeat(40),PUBLIC_ORIGIN:'https://nerea.example'});
  assert.equal(config.production,true);
});
