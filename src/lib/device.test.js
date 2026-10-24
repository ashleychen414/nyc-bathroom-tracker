import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationHelp, platformLabel } from './device.js';

test('locationHelp: iPhone Safari points to Website Settings, with the system switch as backup', () => {
  const help = locationHelp({ platform: 'ios', standalone: false, safari: true });
  assert.match(help.steps.join(' '), /Website Settings/);
  assert.match(help.steps.join(' '), /Allow/);
  assert.match(help.also, /Safari Websites/);
});

test('locationHelp: Home Screen app on iPhone uses the Settings app', () => {
  const help = locationHelp({ platform: 'ios', standalone: true, safari: true });
  assert.match(help.steps[0], /Privacy & Security → Location Services → Safari Websites → While Using the App/);
  assert.doesNotMatch(help.steps.join(' '), /Website Settings/);
  assert.equal(help.also, undefined);
});

test('locationHelp: other browsers get a generic line', () => {
  for (const args of [
    { platform: 'android', standalone: false, safari: false },
    { platform: null, standalone: false, safari: false },
    { platform: 'ios', standalone: false, safari: false }, // Chrome on iPhone
  ]) {
    const help = locationHelp(args);
    assert.deepEqual(help.steps, ["Allow location for this site in your browser's settings, then reload."]);
  }
});

test('platformLabel: one word per kind of device and mode', () => {
  const label = (args) => platformLabel({ platform: null, standalone: false, safari: false, mobile: false, ...args });
  assert.equal(label({ platform: 'ios', safari: true }), 'ios-safari');
  assert.equal(label({ platform: 'ios', safari: true, standalone: true }), 'ios-homescreen');
  assert.equal(label({ platform: 'ios' }), 'ios-other-browser');
  assert.equal(label({ platform: 'android', mobile: true }), 'android');
  assert.equal(label({ platform: 'android', standalone: true }), 'android');
  assert.equal(label({}), 'desktop');
  assert.equal(label({ mobile: true }), 'other');
});
