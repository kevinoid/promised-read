/**
 * @copyright Copyright 2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const assert = require('node:assert');

const TimeoutError = require('../../lib/timeout-error.js');

describe('TimeoutError', () => {
  it('sets .message from argument', () => {
    const testMsg = 'test message';
    const a = new TimeoutError(testMsg);
    assert.strictEqual(a.message, testMsg);
  });

  it('can be instantiated without arguments', () => {
    const a = new TimeoutError();
    assert(a.message, 'has default message');
  });

  it('can not be instantiated without new', () => {
    // eslint-disable-next-line new-cap, unicorn/throw-new-error
    assert.throws(() => TimeoutError('test message'), TypeError);
  });

  it('inherits from Error', () => {
    const testMsg = 'test message';
    const a = new TimeoutError(testMsg);
    assert(a instanceof Error);
  });
});
