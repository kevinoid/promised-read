/**
 * @copyright Copyright 2016-2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

// Use safe-buffer as Buffer until support for Node < 4 is dropped
// eslint-disable-next-line no-shadow
var Buffer = require('safe-buffer').Buffer;
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;

/** Creates a non-Readable (i.e. pre-0.10) stream similar to
 * {@link stream.PassThrough}.
 *
 * @constructor
 * @param {Object} options Stream options
 */
function PassThroughEmitter(options) {
  EventEmitter.call(this);
  this.encoding = (options && options.encoding) || null;
  this.objectMode = Boolean(options && options.objectMode);
}
inherits(PassThroughEmitter, EventEmitter);

PassThroughEmitter.prototype.end = function end(chunk, encoding, callback) {
  var self = this;
  if (!callback && typeof encoding === 'function') {
    callback = encoding;
    encoding = null;
  }
  if (chunk) {
    self.write(chunk, encoding);
  }
  if (callback) {
    self.once('finish', callback);
  }
  process.nextTick(function() {
    self.emit('finish');
    self.emit('end');
  });
};

PassThroughEmitter.prototype.write = function write(chunk, encoding, callback) {
  var self = this;
  if (!callback && typeof encoding === 'function') {
    callback = encoding;
    encoding = null;
  }
  if (!self.objectMode && typeof chunk === 'string') {
    chunk = Buffer.from(chunk, encoding);
  }
  var data =
    self.objectMode || !self.encoding || !Buffer.isBuffer(chunk) ? chunk :
      chunk.toString(self.encoding);
  process.nextTick(function() {
    self.emit('data', data);
    if (callback) {
      callback(null);
    }
  });
};

module.exports = PassThroughEmitter;
