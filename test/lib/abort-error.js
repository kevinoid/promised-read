/**
 * @copyright Copyright 2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

var AbortError = require('../../lib/abort-error');
var assert = require('assert');

describe('AbortError', function() {
  it('sets .message from argument', function() {
    var testMsg = 'test message';
    var a = new AbortError(testMsg);
    assert.strictEqual(a.message, testMsg);
  });

  it('can be instantiated without arguments', function() {
    var a = new AbortError();
    assert(a.message, 'has default message');
  });

  it('can be instantiated without new', function() {
    var testMsg = 'test message';
    var a = AbortError(testMsg);
    assert(a instanceof AbortError);
    assert.strictEqual(a.message, testMsg);
  });

  it('inherits from Error', function() {
    var testMsg = 'test message';
    var a = new AbortError(testMsg);
    assert(a instanceof Error);
  });
});
