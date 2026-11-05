import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackRow, MAX_FEEDBACK } from './feedback.js';
import { describeChange, REPORTS } from './corrections.js';

test('feedback holds only the message, restroom, platform and version', () => {
  assert.deepEqual(feedbackRow('  The map is slow  ', { bathroomId: 'nyc-1', platform: 'android', version: 'abc' }), {
    message: 'The map is slow', bathroom_id: 'nyc-1', platform: 'android', app_version: 'abc',
  });
  assert.equal(feedbackRow('   ', { platform: 'android' }), null);
  assert.equal(feedbackRow('x'.repeat(MAX_FEEDBACK + 10), { platform: 'android' }).message.length, MAX_FEEDBACK);
});

test("Something's wrong: four choices, each with its own history line", () => {
  assert.deepEqual(REPORTS.map(([kind]) => kind), ['report_closed', 'report_not_here', 'report_wrong_spot', 'report_other']);
  assert.equal(describeChange({ kind: 'report_not_here' }), 'Reported not here');
  assert.equal(describeChange({ kind: 'report_wrong_spot' }), 'Reported the pin in the wrong spot');
  assert.equal(describeChange({ kind: 'report_closed' }), 'Reported closed');
});
