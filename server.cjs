const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'dist');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpeg':'image/jpeg'};
http.createServer((req,res) => { const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)); if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); } fs.readFile(file,(error,data) => { res.writeHead(error ? 404 : 200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream'}); res.end(error ? 'Not found' : data); }); }).listen(4173,'127.0.0.1',() => console.log('Local: http://127.0.0.1:4173'));
