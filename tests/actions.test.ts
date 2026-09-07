import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyClaps } from '../src/audio/clapDetector';

test('clap grouping emits one action for one sequence', () => {
  assert.equal(classifyClaps([100]), 'single_clap');
  assert.equal(classifyClaps([100, 350]), 'double_clap');
  assert.equal(classifyClaps([100, 350, 700]), 'triple_clap');
  assert.equal(classifyClaps([100, 1_500]), null);
});
