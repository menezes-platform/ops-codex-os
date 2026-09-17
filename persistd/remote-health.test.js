const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteHealth } = require('./src/remote-health');

test('remote health retries browser probe and repairs desktop before succeeding', async () => {
  let browserProbes = 0;
  let desktopProbes = 0;
  let repairs = 0;
  const health = createRemoteHealth({
    browser: { async healthCheck() { browserProbes++; return { ok: browserProbes > 1 }; } },
    desktopProbe: async () => ({ ok: ++desktopProbes > 1 }),
    desktopRepair: async () => { repairs++; return { ok: true }; },
    sleep: async () => {},
  });
  const result = await health.preflight({ RUN_ID: 'health' });
  assert.equal(result.ok, true);
  assert.equal(result.browser, 'HEALTHY');
  assert.equal(result.desktop, 'HEALTHY');
  assert.equal(result.repaired, true);
  assert.equal(browserProbes, 2);
  assert.equal(repairs, 1);
});

test('remote health fails closed when a required control layer stays unhealthy', async () => {
  const health = createRemoteHealth({
    browser: { async healthCheck() { return { ok: false }; } },
    desktopProbe: async () => ({ ok: false }),
    desktopRepair: async () => ({ ok: false }),
    sleep: async () => {},
  });
  const result = await health.preflight({ RUN_ID: 'health' });
  assert.equal(result.ok, false);
  assert.equal(result.browser, 'UNHEALTHY');
  assert.equal(result.desktop, 'UNHEALTHY');
});
test('ego browser transport exposes a bounded health probe', async () => {
  const { createEgoBrowserTransport } = require('./src/browser/ego-browser');
  let captured = '';
  const transport = createEgoBrowserTransport({ runner: async (script) => { captured = script; return { ok: true, status: 'HEALTHY' }; } });
  const result = await transport.healthCheck({ state: { RUN_ID: 'probe-run' } });
  assert.equal(result.ok, true);
  assert.match(captured, /taskSpaces\.useOrCreate/);
  assert.match(captured, /PERSISTD_RESULT/);
});
test('daemon wires remote health into every orchestrator tick', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('./src/daemon'), 'utf8');
  assert.match(source, /const remoteHealth = createRemoteHealth\(\{ browser \}\)/);
  assert.match(source, /notifier,\s*remoteHealth,\s*remoteAuthority,\s*rolloverMinutes/);
});
const installerFs = require('node:fs');
const installerPath = require('node:path').join(__dirname, '..', 'scripts', 'install.ps1');
test('installer pins the hardened Windows ego host and rewrites the ego-browser shim', { skip: !installerFs.existsSync(installerPath) }, () => {
  const source = installerFs.readFileSync(installerPath, 'utf8');
  assert.match(source, /menezes-platform\\/tool-ego-lite\\.git/);
  assert.match(source, /feat\/windows-host-state-hardening/);
  assert.match(source, /8ef136f5d263b374f4071ea664dd232b42e54929/);
  assert.match(source, /ego-lite-windows-hardened/);
  assert.match(source, /ego-browser\.cmd/);
  assert.match(source, /npm --prefix .* run build/);
});