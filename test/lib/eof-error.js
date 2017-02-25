/**
 * @copyright Copyright 2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

var EOFError = require('../../lib/eof-error');
var assert = require('assert');

describe('EOFError', function() {
  it('sets .message from argument', function() {
    var testMsg = 'test message';
    var a = new EOFError(testMsg);
    assert.strictEqual(a.message, testMsg);
  });

  it('can be instantiated without arguments', function() {
    var a = new EOFError();
    assert(a.message, 'has default message');
  });

  it('can be instantiated without new', function() {
    var testMsg = 'test message';
    var a = EOFError(testMsg);
    assert(a instanceof EOFError);
    assert.strictEqual(a.message, testMsg);
  });

  it('inherits from Error', function() {
    var testMsg = 'test message';
    var a = new EOFError(testMsg);
    assert(a instanceof Error);
  });
});
