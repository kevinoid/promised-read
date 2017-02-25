/**
 * @copyright Copyright 2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

var TimeoutError = require('../../lib/timeout-error');
var assert = require('assert');

describe('TimeoutError', function() {
  it('sets .message from argument', function() {
    var testMsg = 'test message';
    var a = new TimeoutError(testMsg);
    assert.strictEqual(a.message, testMsg);
  });

  it('can be instantiated without arguments', function() {
    var a = new TimeoutError();
    assert(a.message, 'has default message');
  });

  it('can be instantiated without new', function() {
    var testMsg = 'test message';
    var a = TimeoutError(testMsg);
    assert(a instanceof TimeoutError);
    assert.strictEqual(a.message, testMsg);
  });

  it('inherits from Error', function() {
    var testMsg = 'test message';
    var a = new TimeoutError(testMsg);
    assert(a instanceof Error);
  });
});
