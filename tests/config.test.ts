import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultConfig, migrateConfig } from '../src/config/schema';

test('configuration migration preserves launcher data and removes retired features', () => {
  const config = migrateConfig({ baseUrl: 'https://dashwise.local/', pinnedPackages: ['a'], bluetooth: { enabled: true }, camera: { enabled: true }, breathingExperiment: true }, 'tablet');
  assert.equal(config.version, 1);
  assert.equal(config.dashwiseUrl, 'https://dashwise.local/');
  assert.deepEqual(config.pinnedPackages, ['a']);
  assert.equal(config.mqtt.clientId, 'framecompanion-tablet');
  assert.equal(config.presence.screensaverTrigger, 'light');
  assert.deepEqual(config.presence.enabledSources, ['light', 'vibration']);
  assert.equal('bluetooth' in config, false);
  assert.equal('camera' in config, false);
  assert.equal('clipServer' in config, false);
});

test('unsupported presence sources are removed during migration', () => {
  const config = migrateConfig({ presence: { enabledSources: ['bluetooth', 'camera', 'vibration'], ownerAbsenceSources: ['bluetooth', 'light'], screensaverTrigger: 'camera' } });
  assert.deepEqual(config.presence.enabledSources, ['vibration']);
  assert.deepEqual(config.presence.ownerAbsenceSources, ['light']);
  assert.equal(config.presence.screensaverTrigger, 'light');
});

test('defaults retain supported presence detectors', () => {
  const config = defaultConfig('phone');
  assert.deepEqual(config.presence.ownerAbsenceSources, ['light', 'vibration']);
  assert.equal('breathingExperiment' in config.audio, false);
});
