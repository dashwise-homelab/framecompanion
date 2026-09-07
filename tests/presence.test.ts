import assert from 'node:assert/strict';
import test from 'node:test';
import { PresenceEngine } from '../src/presence/PresenceEngine';
import { isLightSpike } from '../src/presence/ambientLight';
import { vibrationPresent } from '../src/presence/vibration';

test('PresenceEngine fuses supported sources after debounce', () => {
  let now = 0;
  const engine = new PresenceEngine({ enabledSources: ['light', 'vibration'], ownerAbsenceSources: ['light'], debounceMs: 100, now: () => now });
  engine.update('light', true);
  assert.equal(engine.getSnapshot().mainPresent, false);
  now = 100;
  engine.update('light', true);
  assert.equal(engine.getSnapshot().mainPresent, true);
  assert.deepEqual(engine.getSnapshot().activeSources, ['light']);
  engine.update('light', false);
  now = 200;
  engine.update('light', false);
  assert.equal(engine.getSnapshot().mainPresent, false);
});

test('light spike requires both absolute and relative change', () => {
  assert.equal(isLightSpike(30, 2, 25, 100), true);
  assert.equal(isLightSpike(20, 10, 25, 100), false);
  assert.equal(isLightSpike(30, 20, 5, 100), false);
});

test('vibration compares energy against calibrated idle baseline', () => {
  assert.equal(vibrationPresent(0.31, 0.1, 0.2), true);
  assert.equal(vibrationPresent(0.3, 0.1, 0.2), false);
});
