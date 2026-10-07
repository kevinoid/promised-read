/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

/**
 * Represents an error caused by reaching the end-of-file (or, more
 * generally, end-of-input).
 */
class EOFError extends Error {}
EOFError.prototype.message = 'End of input';
EOFError.prototype.name = 'EOFError';

module.exports = EOFError;
