import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES } from '../src/lib/types';
import { applyPreset, normalizePreferences, readDevicePreferences, writeDevicePreferences, typographyKey } from '../src/lib/reading-preferences';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test('phone and iPad preserve independent last-applied appearance for the same account', () => {
  const phone = storage(), ipad = storage();
  writeDevicePreferences(phone, 'account', { ...DEFAULT_PREFERENCES, font: 'verdana', fontSize: 28, margins: 16 });
  writeDevicePreferences(ipad, 'account', { ...DEFAULT_PREFERENCES, font: 'palatino', fontSize: 21, margins: 40 });
  assert.equal(readDevicePreferences(phone, 'account').fontSize, 28);
  assert.equal(readDevicePreferences(ipad, 'account').fontSize, 21);
  assert.equal(readDevicePreferences(phone, 'account').font, 'verdana');
  assert.equal(readDevicePreferences(ipad, 'account').font, 'palatino');
});
test('different accounts in one browser do not share appearance', () => {
  const browser = storage(); writeDevicePreferences(browser, 'a', { ...DEFAULT_PREFERENCES, fontSize: 30 });
  assert.equal(readDevicePreferences(browser, 'b').fontSize, DEFAULT_PREFERENCES.fontSize);
  assert.equal(readDevicePreferences(browser, 'a').fontSize, 30);
});
test('legacy local settings migrate with safe defaults for new controls', () => {
  const browser = storage(); browser.setItem('folio-preferences:a', JSON.stringify({ theme: 'dark', font: 'serif', fontSize: 23, lineHeight: 1.8 }));
  const p = readDevicePreferences(browser, 'a'); assert.equal(p.fontSize, 23); assert.equal(p.preset, 'quiet'); assert.equal(p.bold, false); assert.equal(p.letterSpacing, 0);
  assert.equal(browser.getItem('folio-preferences:a'), null); assert.deepEqual(readDevicePreferences(browser, 'a'), p);
});
test('corrupt settings and unsupported fonts cannot break the reader', () => {
  const browser = storage(); browser.setItem('folio-device-reading:v1:a', '{broken');
  assert.deepEqual(readDevicePreferences(browser, 'a'), DEFAULT_PREFERENCES);
  const p = normalizePreferences({ font: 'url(unsafe)', fontSize: 500, lineHeight: NaN, margins: -500, bold: 'true' });
  assert.equal(p.font, 'serif'); assert.equal(p.fontSize, 40); assert.equal(p.lineHeight, 1.7); assert.equal(p.margins, 12); assert.equal(p.bold, false);
});
test('presets preserve chosen size and brightness while applying their typography', () => {
  const p = applyPreset({ ...DEFAULT_PREFERENCES, fontSize: 27, brightness: 85 }, 'bold');
  assert.equal(p.bold, true); assert.equal(p.fontSize, 27); assert.equal(p.brightness, 85);
});
test('spacing and justification need anchor-preserving reflow; color and brightness do not', () => {
  const p = DEFAULT_PREFERENCES;
  for (const change of [{ letterSpacing: .05 }, { wordSpacing: .2 }, { margins: 40 }, { justify: true }, { bold: true }]) assert.notEqual(typographyKey({ ...p, ...change }), typographyKey(p));
  assert.equal(typographyKey({ ...p, theme: 'dark', brightness: 80 }), typographyKey(p));
});
test('storage failures are reported to the settings sheet instead of claiming a save', () => {
  const browser = storage(); browser.setItem = () => { throw new Error('Blocked'); };
  assert.throws(() => writeDevicePreferences(browser, 'a', DEFAULT_PREFERENCES), /Blocked/);
});
