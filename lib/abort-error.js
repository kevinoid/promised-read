/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

/** Represents an error caused by an action being aborted. */
class AbortError extends Error {}
AbortError.prototype.message = 'aborted';
AbortError.prototype.name = 'AbortError';

module.exports = AbortError;
