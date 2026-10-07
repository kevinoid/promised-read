/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

/** Represents an error caused by a timeout expiring. */
class TimeoutError extends Error {}
TimeoutError.prototype.message = 'timeout error'; // same as bluebird
TimeoutError.prototype.name = 'TimeoutError';

module.exports = TimeoutError;
