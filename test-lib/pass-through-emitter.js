/**
 * @copyright Copyright 2016-2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const { EventEmitter } = require('node:events');

/** A non-Readable (i.e. pre-0.10) stream similar to
 * {@link module:stream.PassThrough}.
 */
class PassThroughEmitter extends EventEmitter {
  /** Constructs a {@link PassThroughEmitter}.
   *
   * @param {object} options Stream options
   */
  constructor(options) {
    super();
    // Set encoding to null if not in options, as done by stream.Readable
    // eslint-disable-next-line unicorn/no-null
    this.encoding = (options && options.encoding) || null;
    this.objectMode = Boolean(options && options.objectMode);
  }

  end(chunk, encoding, callback) {
    if (!callback && typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }
    if (chunk) {
      this.write(chunk, encoding);
    }
    if (callback) {
      this.once('finish', callback);
    }
    queueMicrotask(() => {
      this.emit('finish');
      this.emit('end');
    });
  }

  write(chunk, encoding, callback) {
    if (!callback && typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }
    if (typeof chunk === 'string' && !this.objectMode) {
      chunk = Buffer.from(chunk, encoding);
    }
    const data =
      this.objectMode || !this.encoding || !Buffer.isBuffer(chunk) ? chunk
        : chunk.toString(this.encoding);
    queueMicrotask(() => {
      this.emit('data', data);
      if (callback) {
        callback(null); // eslint-disable-line unicorn/no-null
      }
    });
  }
}

module.exports = PassThroughEmitter;
