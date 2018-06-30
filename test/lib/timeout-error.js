/**
 * @copyright Copyright 2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const assert = require('assert');
const TimeoutError = require('../../lib/timeout-error');

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

  it('can be instantiated without new', () => {
    const testMsg = 'test message';
    const a = TimeoutError(testMsg);
    assert(a instanceof TimeoutError);
    assert.strictEqual(a.message, testMsg);
  });

  it('inherits from Error', () => {
    const testMsg = 'test message';
    const a = new TimeoutError(testMsg);
    assert(a instanceof Error);
  });
});
