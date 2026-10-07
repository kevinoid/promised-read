/**
 * @copyright Copyright 2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const assert = require('node:assert');

const EOFError = require('../../lib/eof-error.js');

describe('EOFError', () => {
  it('sets .message from argument', () => {
    const testMsg = 'test message';
    const a = new EOFError(testMsg);
    assert.strictEqual(a.message, testMsg);
  });

  it('can be instantiated without arguments', () => {
    const a = new EOFError();
    assert(a.message, 'has default message');
  });

  it('can not be instantiated without new', () => {
    // eslint-disable-next-line new-cap, unicorn/throw-new-error
    assert.throws(() => EOFError('test message'), TypeError);
  });

  it('inherits from Error', () => {
    const testMsg = 'test message';
    const a = new EOFError(testMsg);
    assert(a instanceof Error);
  });
});
