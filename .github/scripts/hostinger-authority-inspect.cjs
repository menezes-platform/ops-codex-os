'use strict';
const DOMAIN = 'darkslategrey-raccoon-448222.hostingersite.com';
const USER = 'u775492464';
const BASE = 'https://developers.hostinger.com/api/hosting/v1/accounts/'
  + USER + '/websites/' + DOMAIN + '/nodejs';

function selectMetadata(suffix, json) {
  const body = json?.data ?? json;
  if (suffix === '/builds/settings') {
    return { settings: Object.fromEntries(
      ['node_version', 'app_type', 'root_directory', 'entry_file', 'package_manager',
        'source_type', 'build_script'].map(k => [k, body?.[k] ?? null])) };
  }
  if (suffix === '/builds/settings/env') {
    const rows = Array.isArray(body) ? body
      : Array.isArray(body?.data) ? body.data
        : Array.isArray(body?.variables) ? body.variables : null;
    if (!rows) return { envShapeUnknown: true };
    const names = rows.filter(v => v && typeof v === 'object')
      .map(v => String(v.name || v.key || '')).filter(Boolean).sort();
    return { names, marthaEnvPresent: names.includes('PERSISTFLOW_FLEET_NODE_SECRET_CONTHABIL_MARTHA') };
  }
  const rows = Array.isArray(body) ? body
    : Array.isArray(body?.data) ? body.data : [];
  return { builds: rows.slice(0, 5).map(v => ({
    uuid: v.uuid, state: v.state, created_at: v.created_at,
    source_type: v.options?.source_type, root_directory: v.options?.root_directory,
    entry_file: v.options?.entry_file,
  })) };
}

async function inspect({ token = process.env.HOSTINGER_API_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('HOSTINGER_API_TOKEN_MISSING');
  let successful = 0;
  for (const suffix of ['/builds/settings', '/builds/settings/env', '/builds?page=1&per_page=5']) {
    const response = await fetchImpl(BASE + suffix, {
      method: 'GET', headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    console.log('HOSTINGER_API ' + suffix.split('?')[0] + ' HTTP=' + response.status);
    if (response.status !== 200) continue;
    const result = selectMetadata(suffix.split('?')[0], await response.json());
    console.log(JSON.stringify(result));
    successful++;
  }
  if (!successful) throw new Error('HOSTINGER_INSPECTION_UNAVAILABLE');
  return successful;
}

if (require.main === module) {
  inspect().catch(error => {
    console.error('INSPECT_FAILED ' + String(error.message || error).slice(0, 160));
    process.exitCode = 1;
  });
}
module.exports = { inspect, selectMetadata };
