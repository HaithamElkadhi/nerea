const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const { createApp } = require('./backend/app.cjs');
const { loadConfig } = require('./backend/config.cjs');
const config = loadConfig(process.env);
const server = http.createServer(createApp({ config, root: path.join(__dirname, 'dist') }));
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(config.port, config.host, () => {
  console.log(`Local: http://localhost:${config.port}`);
  console.log(`Admin: http://localhost:${config.port}/admin`);
  console.log(config.token ? 'Airtable: configured' : 'Airtable: add AIRTABLE_TOKEN to .env, then restart.');
});
