const crypto = require('node:crypto');
const TABLES = {projects:'tblEqE1zASY5nMIrD',events:'tblNz6Tc8tgOrI8fY',news:'tblTroq5fVUXNLlJL',donations:'tblcMGqDNEzyTRCUH'};
function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const username = env.ADMIN_USERNAME || 'admin';
  const password = env.ADMIN_PASSWORD || 'admin';
  if (production && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || password === 'admin' || password.length < 12)) throw new Error('In production set ADMIN_PASSWORD (12+ characters, not admin) and SESSION_SECRET (32+ characters).');
  if (env.PUBLIC_ORIGIN && !/^https?:\/\/[^/]+$/.test(env.PUBLIC_ORIGIN)) throw new Error('PUBLIC_ORIGIN must be an origin without a trailing slash.');
  return {production,username,password,secret:env.SESSION_SECRET || crypto.randomBytes(48).toString('hex'),token:env.AIRTABLE_TOKEN || '',baseId:env.AIRTABLE_BASE_ID || 'appczw9TmpSoUqw3g',tables:Object.fromEntries(Object.entries(TABLES).map(([type,id]) => [type,env[`AIRTABLE_${type.toUpperCase()}_TABLE_ID`] || id])),port:Number(env.PORT || 4173),host:env.HOST || '127.0.0.1',origin:env.PUBLIC_ORIGIN || ''};
}
module.exports = {loadConfig,TABLES};
