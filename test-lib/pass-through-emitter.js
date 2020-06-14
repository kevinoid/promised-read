/**
 * @copyright Copyright 2016-2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const { EventEmitter } = require('events');
const { inherits } = require('util');

/** Creates a non-Readable (i.e. pre-0.10) stream similar to
 * {@link stream.PassThrough}.
 *
 * @class
 * @param {object} options Stream options
 */
function PassThroughEmitter(options) {
  EventEmitter.call(this);
  // Set encoding to null if not in options, as done by stream.Readable
  // eslint-disable-next-line unicorn/no-null
  this.encoding = (options && options.encoding) || null;
  this.objectMode = Boolean(options && options.objectMode);
}
inherits(PassThroughEmitter, EventEmitter);

PassThroughEmitter.prototype.end = function end(chunk, encoding, callback) {
  const self = this;
  if (!callback && typeof encoding === 'function') {
    callback = encoding;
    encoding = undefined;
  }
  if (chunk) {
    self.write(chunk, encoding);
  }
  if (callback) {
    self.once('finish', callback);
  }
  process.nextTick(() => {
    self.emit('finish');
    self.emit('end');
  });
};

PassThroughEmitter.prototype.write = function write(chunk, encoding, callback) {
  const self = this;
  if (!callback && typeof encoding === 'function') {
    callback = encoding;
    encoding = undefined;
  }
  if (!self.objectMode && typeof chunk === 'string') {
    chunk = Buffer.from(chunk, encoding);
  }
  const data =
    self.objectMode || !self.encoding || !Buffer.isBuffer(chunk) ? chunk
      : chunk.toString(self.encoding);
  process.nextTick(() => {
    self.emit('data', data);
    if (callback) {
      callback(null); // eslint-disable-line unicorn/no-null
    }
  });
};

module.exports = PassThroughEmitter;
