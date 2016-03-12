/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */
'use strict';

var AbortError = require('./lib/abort-error');
var AnyPromise = require('any-promise');
var EOFError = require('./lib/eof-error');
var TimeoutError = require('./lib/timeout-error');

/** Attempts to unshift result data down to a desired length.
 * @param {stream.Readable} stream Stream into which to unshift data.
 * @param {!Buffer|string|!Array} result Read result data.
 * @param {number} desiredLength Desired length of result after unshifting.
 * @return {!Buffer|string|!Array} Result data after unshifting.
 * <code>null</code> if all data was unshifted.
 * @private
 */
function tryUnshift(stream, result, desiredLength) {
  if (typeof stream.unshift !== 'function') {
    // debug('stream does not support unshift');
    return result;
  }

  var errorListeners = stream.listeners('error');
  stream.removeAllListeners('error');

  // Note:  Don't rely on the EventEmitter throwing on 'error' without
  // listeners, since it may be thrown in the stream's attached domain.
  var unshiftErr;
  function onUnshiftError(err) { unshiftErr = err; }
  stream.on('error', onUnshiftError);

  var resultLength = result.length;
  try {
    if (Array.isArray(result)) {
      while (resultLength > desiredLength && !unshiftErr) {
        stream.unshift(result[resultLength - 1]);
        if (!unshiftErr) {
          --resultLength;
        }
      }
    } else {
      stream.unshift(result.slice(desiredLength));
      if (!unshiftErr) {
        resultLength = desiredLength;
      }
    }
  } catch (err) {
    unshiftErr = err;
  }

  // if (unshiftErr) { debug('error unshifting', unshiftErr); }

  stream.removeListener('error', onUnshiftError);
  errorListeners.forEach(function(errorListener) {
    stream.on('error', errorListener);
  });

  return resultLength === 0 ? null :
    resultLength < result.length ? result.slice(0, resultLength) :
    result;
}

/** Options for {@link read}, {@link readTo}, and {@link readUntil}.
 *
 * @typedef {{
 *   Promise: function(new:Promise)|undefined,
 *   cancellable: boolean|undefined,
 *   objectMode: boolean|undefined,
 *   timeout: number|undefined
 * }} ReadOptions
 * @property {function(new:Promise)=} Promise Promise type to return.  Default
 * is the type returned by the {@link https://www.npmjs.com/package/any-promise
 * any-promise} module.
 * @property {boolean=} cancellable Provide <code>abortRead</code> and
 * <code>cancelRead</code> methods on the returned Promise which allow the
 * caller to abort or cancel an pending read.  This has no effect on
 * cancellation support provided by the Promise library, if any.
 *
 * <strong>Note:</strong> Any consumers of the read result which which do not
 * require abort/cancel authority should be given a Promise chained from the
 * returned one (e.g. the result of calling <code>.then()</code> on it) to
 * avoid granting abort/cancel authority for the read.
 * @property {boolean=} objectMode Treat the stream as if it were created with
 * the objectMode option, meaning read results are returned in an Array and
 * are never combined.  (This is always true for non-string, non-Buffer reads.)
 * @property {number=} timeout Cause the read to timeout after a given number
 * of milliseconds.  The promise will be rejected with a TimeoutError which
 * will have a <code>.read</code> property with any previously read values.
 */
// var ReadOptions;

/** Promise type returned by {@link read}, {@link readTo}, and
 * {@link readUntil} for {@link ReadOptions.cancellable cancellable} reads.
 *
 * The returned promise will be an instance of <code>options.Promise</code>,
 * if set, which has the additional methods defined for this type.
 *
 * Note that the method names were chosen to avoid conflict with the existing
 * promise cancellation methods under consideration (abort, cancel) since they
 * may gain defined semantics which differ from the methods described here.
 *
 * Any promises chained from the returned promise (e.g. returned from calling
 * <code>.then</code>) will not share the methods defined on this class, which
 * prevents abort/cancel authority from being unintentionally conveyed to other
 * consumers of the read data or its dependencies.
 *
 * @template ReturnType
 * @constructor
 * @extends Promise<ReturnType>
 */
// function CancellableReadPromise() {}

function readInternal(stream, size, until, options) {
  var Promise = (options && options.Promise) || AnyPromise;
  var numSize = size === null || isNaN(size) ? undefined : Number(size);
  var objectMode = Boolean(options && options.objectMode);
  var timeout = options && options.timeout;

  var abortRead;
  var cancelRead;

  var promise = new Promise(function(resolve, reject, cancelled) {
    var isDone = false;
    var result = null;
    var timeoutID;
    function done() {
      if (isDone) { return; }
      isDone = true;
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', doReject);
      stream.removeListener('readable', readPending);
      if (timeoutID) { clearTimeout(timeoutID); }
    }
    function doReject(err) {
      done();

      if (result !== null) {
        if (typeof err === 'object' && err !== null) {
          // If we have read some data, include it on the error so the caller
          // can use the partial result and to avoid losing data.
          err.read = result;
        } else {
          // debug('Unable to set .read on non-object reject cause');
        }
      }
      reject(err);
    }
    function doResolve() {
      done();
      resolve(result);
    }

    /** Aborts a pending read operation, causing the Promise to be rejected.
     *
     * If the read operation is not currently pending, this does nothing.
     *
     * Note:  This method is only available for
     * {@link ReadOptions.cancellable cancellable} reads.
     *
     * @name {CancellableReadPromise#abortRead}
     * @see {ReadOptions.cancellable}
     */
    abortRead = function() {
      if (isDone) { return; }
      done();
      if (result && result.length > 0) {
        result = tryUnshift(stream, result, 0);
      }
      doReject(new AbortError('read aborted'));
    };

    /** Cancels a pending read operation, causing the Promise never to be
     * resolved or rejected.
     *
     * If the read operation is not currently pending, this does nothing.
     *
     * Note:  This method is only available for
     * {@link ReadOptions.cancellable cancellable} reads.
     *
     * @name {CancellableReadPromise#cancelRead}
     * @return Buffer|string|Array Any previously read data which could not be
     * unshifted, or <code>null</code> if all data was unshifted.
     * @see {ReadOptions.cancellable}
     */
    cancelRead = function() {
      if (isDone) { return null; }
      done();
      if (result && result.length > 0) {
        result = tryUnshift(stream, result, 0);
      }
      return result;
    };

    // bluebird 3.x supports cancellation (when explicitly enabled by the
    // user).  It does not provide a way to query whether it is enabled
    // (AFAICT).  The third argument could be when.js notify or something else.
    // The presence of the cancel method is used to deduce its function.
    if (typeof cancelled === 'function' &&
        typeof Promise.prototype.cancel === 'function') {
      cancelled(cancelRead);
    }

    stream.once('error', doReject);

    if (timeout !== undefined && timeout !== null) {
      timeoutID = setTimeout(function onTimeout() {
        done();
        if (result && result.length > 0) {
          result = tryUnshift(stream, result, 0);
        }
        doReject(new TimeoutError());
      }, timeout);
    }

    // Moved try block out of onData to allow v8 optimization of onData
    function tryUntil() {
      try {
        return until(result);
      } catch (errUntil) {
        if (result && result.length > 0) {
          result = tryUnshift(stream, result, 0);
        }
        doReject(errUntil);
        return undefined;
      }
    }

    function onEnd() {
      if (until) {
        doReject(new EOFError());
      } else {
        doResolve();
      }
    }
    stream.once('end', onEnd);

    // Although reading stream internals is distasteful, it is less distasteful
    // than waiting endlessly for data that will never come because the caller
    // was not careful about handling the 'end' event.
    if (stream &&
        stream._readableState &&
        stream._readableState.endEmitted) {
      onEnd();
      return;
    }

    var resultBuf;
    function onData(data) {
      if (result === null) {
        objectMode = objectMode ||
          (typeof data !== 'string' && !(data instanceof Buffer));
        result = objectMode ? [data] : data;
      } else if (typeof result === 'string' && typeof data === 'string') {
        result += data;
      } else if (result instanceof Buffer && data instanceof Buffer) {
        // To avoid copying result on every read, make result a slice of
        // resultBuf which grows geometrically as necessary.
        var newResultSize = data.length + result.length;
        if (!resultBuf || newResultSize > resultBuf.length) {
          var newResultBufSize = resultBuf ? resultBuf.length : 128;
          while (newResultBufSize < newResultSize) {
            // Growth factor is a time/space tradeoff.  3/2 seems reasonable.
            // https://github.com/facebook/folly/blob/master/folly/docs/FBVector.md#memory-handling
            // Use right-shift for division to avoid unnecessary float+round
            newResultBufSize = (newResultBufSize * 3) >>> 1;
          }
          resultBuf = new Buffer(newResultBufSize);
          result.copy(resultBuf);
        }
        data.copy(resultBuf, result.length);
        result = resultBuf.slice(0, newResultSize);
      } else if (Array.isArray(result)) {
        result.push(data);
      // result/data mismatch, must be in objectMode.  result becomes an Array.
      // This case is really ugly.  Well-behaved streams shouldn't use it.
      } else {
        objectMode = true;
        result = [result, data];
      }

      // When doing a single read in objectMode, behave like stream.read(size):
      // ignore size and don't wrap the result in an Array.
      if (objectMode && !until) {
        // Since resolving to null indicates EOF, we do not permit returning
        // null if it was emitted by a 'data' event.  If there is a use-case
        // for this, I'd be open to adding an option to allow it.
        // Note:  Users can use readUntil(stream, untilTrue) to get [null].
        if (result[0] === null) {
          result.shift();
          return;
        }
        if (result.length > 1) {
          result = tryUnshift(stream, result, 1);
        }
        if (result.length === 1) {
          result = result[0];
        }
        doResolve();
        return;
      }

      // If we know the target read size, check if it has been reached
      if (numSize) {
        if (result.length >= numSize) {
          if (result.length > numSize) {
            result = tryUnshift(stream, result, numSize);
          }
          doResolve();
        }
        return;
      }

      // Check if the caller thinks we are done
      var desiredLength = until ? tryUntil() : result.length;
      if (isDone) {
        return;
      }

      if (typeof desiredLength === 'number') {
        if (desiredLength >= 0) {
          if (desiredLength < result.length) {
            result = tryUnshift(stream, result, desiredLength);
          }
          doResolve();
        }
      } else if (desiredLength) {
        //  if (desiredLength !== true) {
        //    debug('Warning: non-numeric, non-boolean until() result may ' +
        //      'have specific meanings in future versions');
        //  }
        doResolve();
      }
    }

    function readPending() {
      while (!isDone) {
        var data = stream.read(size);
        if (data === null) {
          if (!isDone) {
            stream.once('readable', readPending);
          }
          return;
        }

        onData(data);
      }
    }

    if (numSize !== undefined && numSize <= 0) {
      // .read(size) will always return null.  Do it once, then done.
      if (typeof stream.read === 'function') {
        result = stream.read(size);
      }
      doResolve();
      return;
    }

    if (typeof stream.read === 'function') {
      readPending();
    } else {
      stream.on('data', onData);
    }
  });

  if (options && (options.cancellable || options.cancelable)) {
    promise.abortRead = abortRead;
    promise.cancelRead = cancelRead;
  }

  return promise;
}

/** Reads from a stream.Readable.
 * @param {stream.Readable} stream Stream from which to read.
 * @param {number=} size Number of bytes to read.  If <code>stream.read</code>
 * is a function, <code>size</code> is passed to it, guaranteeing exact result
 * size.  Otherwise, <code>'data'</code> events will be consumed until
 * <code>size</code> bytes are read, making it a minimum rather than an exact
 * value.
 * @param {ReadOptions=} options Options.
 * @return {Promise<Buffer|string|*>|CancellableReadPromise<Buffer|string|*>}
 * Promise with result of read or Error.  Result may be shorter than
 * <code>size</code> if <code>'end'</code> occurs and will be <code>null</code>
 * if no data is read.  If an error occurs after reading some data, the
 * <code>.read</code> property will contain the partial read result.
 */
function read(stream, size, options) {
  if (!options && typeof size === 'object') {
    options = size;
    size = null;
  }
  return readInternal(stream, size, undefined, options);
}

/** Reads from a stream.Readable until a given test is satisfied.
 * @param {stream.Readable} stream Stream from which to read.
 * @param {function(!Buffer|string|!Array): number|boolean} test Test function
 * called with the data read so far.  If it returns a negative or falsey value,
 * more data will be read.  If it returns a non-negative number and the stream
 * can be unshifted, that many bytes will be returned and the others will be
 * unshifted into the stream.  Otherwise, all data read will be returned.
 * Non-numeric, non-boolean truthy values should not be returned, since they
 * may have specific interpretations in future versions.
 * @param {ReadOptions=} options Options.
 * @return {Promise<!Buffer|string|!Array>|
 * CancellableReadPromise<!Buffer|string|!Array>} Promise with the data read
 * and not unshifted, or an Error if one occurred.  If <code>'end'</code> is
 * emitted before <code>until</code> returns a non-negative/true value, an
 * {@link EOFError} is returned.  If an error occurs after reading some data,
 * the <code>.read</code> property will contain the partial read result.
 */
function readUntil(stream, until, options) {
  if (typeof until !== 'function') {
    var Promise = (options && options.Promise) || AnyPromise;
    return Promise.reject(new TypeError('until must be a function'));
  }
  return readInternal(stream, undefined, until, options);
}

/** Reads from a stream.Readable until a given value is found.
 * @param {stream.Readable} stream Stream from which to read.
 * @param {!Buffer|string|*} needle Value to search for in the read result.
 * The stream will be read until this value is found.
 * @param {ReadOptions=} options Options.
 * @return {Promise<!Buffer|string|!Array}|
 * CancellableReadPromise<!Buffer|string|!Array>} Promise with the data read up
 * to and including <code>needle</code>, or an Error if one occurs.  If
 * <code>stream</code> does not support <code>unshift</code>, the result may
 * include additional data.  If <code>'end'</code> is emitted before
 * <code>needle</code> is found, an {@link EOFError} is returned.  If an error
 * occurs after reading some data, the <code>.read</code> property will contain
 * the partial read result.
 */
function readTo(stream, needle, options) {
  function until(result) {
    var needleIndex = result.indexOf(needle);
    if (needleIndex < 0) {
      return -1;
    }

    var needleLength =
      typeof result === 'string' ? String(needle).length :
      result instanceof Buffer ?
        typeof needle === 'number' ? 1 :
        typeof needle === 'string' ? Buffer.byteLength(needle) :
        needle.length :
      1;
    return needleIndex + needleLength;
  }
  return readInternal(stream, undefined, until, options);
}

module.exports = {
  read: read,
  readUntil: readUntil,
  readTo: readTo
};
