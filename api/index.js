const path = require('node:path');
const {createApp} = require('../backend/app.cjs');
const {loadConfig} = require('../backend/config.cjs');
const app = createApp({config:loadConfig(process.env),root:path.join(process.cwd(),'dist')});

module.exports = function handler(req,res) {
  const url = new URL(req.url,'https://localhost');
  const route = url.searchParams.get('__nereaPath');
  if (route) {
    url.searchParams.delete('__nereaPath');
    req.url = route + (url.searchParams.size ? `?${url.searchParams}` : '');
  }
  return app(req,res);
};
