/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const {inherits} = require('util');

/** Constructs an AbortError.
 *
 * @class Represents an error caused by an action being aborted.
 * @constructor
 * @param {string=} message Human-readable description of the error.
 */
function AbortError(message) {
  // Like http://www.ecma-international.org/ecma-262/6.0/#sec-error-message
  if (!(this instanceof AbortError)) { return new AbortError(message); }
  Error.captureStackTrace(this, AbortError);
  if (message !== undefined) {
    Object.defineProperty(this, 'message', {
      value: String(message),
      configurable: true,
      writable: true
    });
  }
}
inherits(AbortError, Error);
AbortError.prototype.message = 'aborted';
AbortError.prototype.name = 'AbortError';

module.exports = AbortError;
