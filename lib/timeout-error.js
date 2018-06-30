/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const {inherits} = require('util');

/** Constructs a TimeoutError.
 *
 * @class Represents an error caused by a timeout expiring.
 * @constructor
 * @param {string=} message Human-readable description of the error.
 */
function TimeoutError(message) {
  // Like http://www.ecma-international.org/ecma-262/6.0/#sec-error-message
  if (!(this instanceof TimeoutError)) { return new TimeoutError(message); }
  Error.captureStackTrace(this, TimeoutError);
  if (message !== undefined) {
    Object.defineProperty(this, 'message', {
      value: String(message),
      configurable: true,
      writable: true
    });
  }
}
inherits(TimeoutError, Error);
TimeoutError.prototype.message = 'timeout error'; // same as bluebird
TimeoutError.prototype.name = 'TimeoutError';

module.exports = TimeoutError;
