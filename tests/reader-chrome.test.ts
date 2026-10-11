import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingGesture, visibleChrome } from '../src/lib/reader-chrome';

test('reader hides controls after intentional down scrolling and reveals on up scrolling', () => {
  let state = visibleChrome();
  state = readingGesture(state, 20); assert.equal(state.hidden, false);
  state = readingGesture(state, 30); assert.equal(state.hidden, true);
  state = readingGesture(state, -10); assert.equal(state.hidden, true);
  state = readingGesture(state, -15); assert.equal(state.hidden, false);
});
test('reader ignores gesture noise and resets distance when direction changes', () => {
  const state = visibleChrome();
  for (const delta of [0, 1, -1, NaN, Infinity]) assert.equal(readingGesture(state, delta), state);
  let next = readingGesture(state, 40);
  next = readingGesture(next, -10);
  next = readingGesture(next, 10);
  assert.equal(next.hidden, false); assert.equal(next.distance, 10);
});
test('revealing controls resets accumulated travel so the next gesture starts fresh', () => {
  assert.equal(readingGesture(visibleChrome(), 15).hidden, false);
  assert.equal(readingGesture(visibleChrome(), 200).hidden, true);
});
