/**
 * @copyright Copyright 2016-2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const util = require('util');

const AbortError = require('./lib/abort-error');
const EOFError = require('./lib/eof-error');
const SyncPromise = require('./lib/sync-promise');
const TimeoutError = require('./lib/timeout-error');

const debug = util.debuglog('promised-read');

/** Attempts to unshift result data down to a desired length.
 *
 * @param {module:stream.Readable} stream Stream into which to unshift data.
 * @param {!Buffer|string|!Array} result Read result data.
 * @param {number} desiredLength Desired length of result after unshifting.
 * @param {boolean=} emptySlice Return an empty slice when all data is
 * unshifted, rather than <code>null</code>.
 * @returns {Buffer|string|Array} Result data after unshifting, or
 * <code>null</code> if all data was unshifted and <code>emptySlice</code> is
 * falsey.
 * @private
 */
function tryUnshift(stream, result, desiredLength, emptySlice) {
  if (typeof stream.unshift !== 'function') {
    debug('Unable to unshift, stream does not have an unshift method.');
    return result;
  }

  const errorListeners = stream.listeners('error');
  stream.removeAllListeners('error');

  // Note:  Don't rely on the EventEmitter throwing on 'error' without
  // listeners, since it may be thrown in the stream's attached domain.
  let unshiftErr;
  function onUnshiftError(err) { unshiftErr = err; }
  stream.on('error', onUnshiftError);

  let resultLength = result.length;
  try {
    if (Array.isArray(result)) {
      while (resultLength > desiredLength && !unshiftErr) {
        stream.unshift(result[resultLength - 1]);
        if (!unshiftErr) {
          resultLength -= 1;
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

  if (unshiftErr) {
    debug('Unable to unshift data: ', unshiftErr);
  }

  stream.removeListener('error', onUnshiftError);
  errorListeners.forEach((errorListener) => {
    stream.on('error', errorListener);
  });

  // Use null to preserve current API.
  // eslint-disable-next-line unicorn/no-null
  return resultLength === 0 && !emptySlice ? null
    : resultLength < result.length ? result.slice(0, resultLength)
      : result;
}

/** Options for {@link read}, {@link readTo}, and {@link readUntil}.
 *
 * @typedef {{
 *   Promise: function(new:Promise)|undefined,
 *   cancellable: boolean|undefined,
 *   flowing: boolean|undefined,
 *   objectMode: boolean|undefined,
 *   timeout: number|undefined
 * }} ReadOptions
 * @property {function(new:Promise)=} Promise Promise type to return.  Default
 * for non-flowing streams is the global <code>Promise</code> type, when
 * available, or another Promises/A+ and ES6 compliant promise type.  Default
 * for flowing streams is a promise type which complies with Promises/A+ and
 * ES6 with the exception that it calls <code>onResolved</code> and
 * <code>onRejected</code> synchronously.
 * @property {boolean=} cancellable Provide <code>abortRead</code> and
 * <code>cancelRead</code> methods on the returned Promise which allow the
 * caller to abort or cancel an pending read.  This has no effect on
 * cancellation support provided by the Promise library, if any.  See
 * {@link CancellableReadPromise} for details.
 * @property {boolean=} flowing Assume that the stream is in flowing mode and
 * read data using <code>'data'</code> events.  This is the default for streams
 * without a <code>.read()</code> method.
 * @property {boolean=} objectMode Treat the stream as if it were created with
 * the <code>objectMode</code> option, meaning read results are returned in an
 * Array and are never combined.  (This is always true for non-string,
 * non-Buffer reads.)
 * @property {number=} timeout Cause the read to timeout after a given number
 * of milliseconds.  The promise will be rejected with a {@link TimeoutError}
 * which will have a <code>.read</code> property with any previously read
 * values.
 */
// var ReadOptions;

/**
 * Promise type returned by {@link read}, {@link readTo}, and
 * {@link readUntil} for {@link ReadOptions.cancellable cancellable} reads.
 *
 * <p>The returned promise will be an instance of {@link ReadOptions.Promise},
 * if set, which has the additional methods defined for this type.</p>
 *
 * <p>Note that the method names were chosen to avoid conflict with the
 * existing promise cancellation methods under consideration (e.g.
 * <code>abort</code>, and <code>cancel</code>) since they may gain defined
 * semantics which differ from the methods described here.</p>
 *
 * <p>Any promises chained from the returned promise (e.g. returned from
 * calling <code>.then()</code>) will not share the methods defined on this
 * class, which prevents abort/cancel authority from being unintentionally
 * conveyed to other consumers of the read data or its dependencies.</p>
 *
 * @class
 * @template ReturnType
 * @augments Promise<ReturnType>
 * @name CancellableReadPromise
 */
// function CancellableReadPromise() {}

/** Reads from a stream a given size or condition is met.
 *
 * @private
 */
function readInternal(stream, size, until, options) {
  const flowing =
    (options && options.flowing) || typeof stream.read !== 'function';
  let numSize =
    size === null || Number.isNaN(Number(size)) ? undefined : Number(size);
  let objectMode = Boolean(options && options.objectMode);
  const timeout = options && options.timeout;
  const ReadPromise = (options && options.Promise)
    || (flowing ? SyncPromise : Promise);

  let abortRead;
  let cancelRead;

  const promise = new ReadPromise((resolve, reject, cancelled) => {
    let isDoneReading = false;
    // Use null to preserve current API.
    // eslint-disable-next-line unicorn/no-null
    let result = null;
    let timeoutID;
    function doneReading() {
      if (isDoneReading) { return; }
      isDoneReading = true;
      /* eslint-disable no-use-before-define */
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', doReject);
      stream.removeListener('readable', readPending);
      /* eslint-enable no-use-before-define */
      if (timeoutID) { clearTimeout(timeoutID); }
    }
    function doReject(err, unshiftResult) {
      doneReading();

      if (unshiftResult && result !== null && result.length > 0) {
        result = tryUnshift(stream, result, 0);
      }

      if (result !== null) {
        if (typeof err === 'object' && err !== null) {
          // If we have read some data, include it on the error so the caller
          // can use the partial result and to avoid losing data.
          err.read = result;
        } else {
          debug('Unable to set .read on non-object reject cause.  '
            + 'Discarding data.');
        }
      }
      reject(err);
    }
    function doResolve() {
      doneReading();
      resolve(result);
    }

    /** Aborts a pending read operation, causing the Promise to be rejected.
     *
     * If the read operation is not currently pending, this does nothing.
     *
     * @function
     * @name CancellableReadPromise#abortRead
     * @see ReadOptions.cancellable
     */
    abortRead = function() {
      if (isDoneReading) { return; }
      doReject(new AbortError('read aborted'), true);
    };

    /** Cancels a pending read operation, causing the Promise never to be
     * resolved or rejected.
     *
     * If the read operation is not currently pending, this does nothing.
     *
     * @function
     * @name CancellableReadPromise#cancelRead
     * @returns {Buffer|string|Array} Any previously read data which could not
     * be unshifted, or <code>null</code> if all data was unshifted.
     * @see ReadOptions.cancellable
     */
    cancelRead = function() {
      // Use null to preserve current API.
      // eslint-disable-next-line unicorn/no-null
      if (isDoneReading) { return null; }
      // Note:  Must stop reading before unshifting to avoid emitting a
      // 'readable' event and immediately re-reading unshifted data.
      doneReading();
      if (result && result.length > 0) {
        result = tryUnshift(stream, result, 0);
      }
      return result;
    };

    // bluebird 3.x supports cancellation (when explicitly enabled by the
    // user).  It does not provide a way to query whether it is enabled
    // (AFAICT).  The third argument could be notify or something else.
    // Check for cancel method and config function to add certainty.
    // TODO:  Find a more reliable check.
    if (typeof cancelled === 'function'
        && typeof ReadPromise.prototype.cancel === 'function'
        && typeof ReadPromise.config === 'function') {
      cancelled(cancelRead);
    }

    stream.once('error', doReject);

    if (timeout !== undefined && timeout !== null) {
      timeoutID = setTimeout(() => {
        doReject(new TimeoutError(), true);
      }, timeout);
    }

    /** Calls the until function and handles its result.
     *
     * @returns {boolean} <code>true</code> if done reading, <code>false</code>
     * otherwise.
     * @private
     */
    function checkUntil(resultWithData, data, ended) {
      let desiredLength;
      try {
        desiredLength = until(resultWithData, data, ended);
      } catch (errUntil) {
        doReject(errUntil, true);
        return true;
      }

      const resultLength = result ? result.length : 0;
      if (typeof desiredLength === 'number') {
        if (desiredLength > resultLength) {
          debug(
            'until returned a desired length of %d.  '
              + 'Only have %d.  Reading up to %d.',
            desiredLength, resultLength, desiredLength,
          );
          numSize = desiredLength;
          size = desiredLength - resultLength;
        } else if (desiredLength >= 0) {
          debug(
            'until returned a desired length of %d out of %d',
            desiredLength, resultLength,
          );
          if (desiredLength < resultLength) {
            if (ended) {
              debug('Unable to unshift:  Can not unshift after end.');
            } else {
              result = tryUnshift(stream, result, desiredLength, true);
            }
          }
          doResolve();
          return true;
        } else {
          debug('until returned %d, continuing to read', desiredLength);
        }
      } else if (desiredLength === true) {
        debug('until returned true, read finished.');
        doResolve();
        return true;
      } else if (desiredLength !== undefined
          && desiredLength !== null
          && desiredLength !== false) {
        // Note:  Although this could be allowed, it causes an Error so that
        // future versions may add behavior for these values without causing
        // breakage.
        doReject(
          new TypeError(
            `non-numeric, non-boolean until() result: ${desiredLength}`,
          ),
          true,
        );
      } else {
        debug('until returned %s, continuing to read', desiredLength);
      }

      return false;
    }

    function onEnd() {
      if (until) {
        // Use null to preserve current API.
        // eslint-disable-next-line unicorn/no-null
        if (!checkUntil(result, null, true)) {
          doReject(new EOFError());
        }
      } else {
        doResolve();
      }
    }
    stream.once('end', onEnd);

    // Although reading stream internals is distasteful, it is less distasteful
    // than waiting endlessly for data that will never come because the caller
    // was not careful about handling the 'end' event.
    /* eslint-disable no-underscore-dangle */
    if (stream
        && stream._readableState
        && stream._readableState.endEmitted) {
      debug('Error:  stream has ended!  Calling read after end is unreliable!');
      onEnd();
      return;
    }
    /* eslint-enable no-underscore-dangle */

    let resultBuf;
    function onData(data) {
      if (result === null) {
        objectMode = objectMode
          || (typeof data !== 'string' && !(data instanceof Buffer));
        result = objectMode ? [data] : data;
      } else if (typeof result === 'string' && typeof data === 'string') {
        result += data;
      } else if (result instanceof Buffer && data instanceof Buffer) {
        // To avoid copying result on every read, make result a slice of
        // resultBuf which grows geometrically as necessary.
        const newResultSize = data.length + result.length;
        if (!resultBuf || newResultSize > resultBuf.length) {
          let newResultBufSize = resultBuf ? resultBuf.length : 128;
          while (newResultBufSize < newResultSize) {
            // Growth factor is a time/space tradeoff.  3/2 seems reasonable.
            // https://github.com/facebook/folly/blob/master/folly/docs/FBVector.md#memory-handling
            // Use right-shift for division to avoid unnecessary float+round
            // eslint-disable-next-line no-bitwise
            newResultBufSize = (newResultBufSize * 3) >>> 1;
          }
          resultBuf = Buffer.allocUnsafe
            ? Buffer.allocUnsafe(newResultBufSize)
            : Buffer.from(newResultBufSize);
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
          [result] = result;
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

      if (!until) {
        doResolve();
        return;
      }

      checkUntil(result, data, false);
    }

    function readPending() {
      while (!isDoneReading) {
        const data = stream.read(size);
        if (data === null) {
          if (!isDoneReading) {
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

    if (!flowing) {
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
 *
 * @param {module:stream.Readable} stream Stream from which to read.
 * @param {number=} size Number of bytes to read.  If <code>stream.read</code>
 * is a function, <code>size</code> is passed to it, guaranteeing maximum
 * result size.  Otherwise, <code>'data'</code> events will be consumed until
 * <code>size</code> bytes are read, making it a minimum rather than an exact
 * value.
 * @param {ReadOptions=} options Options.
 * @returns {Promise<Buffer|string|*>|CancellableReadPromise<Buffer|string|*>}
 * Promise with result of read or Error.  Result may be shorter than
 * <code>size</code> if <code>'end'</code> occurs and will be <code>null</code>
 * if no data can be read.  If an error occurs after reading some data, the
 * <code>.read</code> property of the error object will contain the partial
 * read result.  The promise is resolved synchronously for streams in flowing
 * mode (see README.md for details).
 */
function read(stream, size, options) {
  if (!options && typeof size === 'object') {
    options = size;
    // Use null to preserve current API.
    // eslint-disable-next-line unicorn/no-null
    size = null;
  }
  return readInternal(stream, size, undefined, options);
}

/**
 * Reads from a stream.Readable until a given test is satisfied.
 *
 * @param {module:stream.Readable} stream Stream from which to read.
 * @param {function((!Buffer|string|!Array), (Buffer|string|*)):
 * number|boolean} until Test function called with the data read so far and the
 * most recent chunk read.  If it returns a negative or falsey value, more
 * data will be read.  If it returns a non-negative number and the stream can
 * be unshifted, that many bytes will be returned and the others will be
 * unshifted into the stream.  Otherwise, all data read will be returned.  If
 * it returns a number larger than the length of the data read so far, enough
 * data to reach the requested length will be read before returning.
 * Non-numeric, non-boolean values will result in an error.
 * @param {ReadOptions=} options Options.
 * @returns {Promise<!Buffer|string|!Array>|
CancellableReadPromise<!Buffer|string|!Array>} Promise with the data read
 * and not unshifted, or an Error if one occurred.  If <code>'end'</code> is
 * emitted before <code>until</code> returns a non-negative/true value, an
 * {@link EOFError} is returned.  If an error occurs after reading some data,
 * the <code>.read</code> property of the error object will contain the partial
 * read result.  The promise is resolved synchronously for streams in flowing
 * mode (see README.md for details).
 */
function readUntil(stream, until, options) {
  if (typeof until !== 'function') {
    // Note:  Synchronous Yaku emits unhandledRejection before returning.
    // Best current option is to use an async promise, even when flowing
    const ReadPromise = (options && options.Promise) || Promise;
    return ReadPromise.reject(new TypeError('until must be a function'));
  }
  return readInternal(stream, undefined, until, options);
}

/** Reads from a stream.Readable until a given value is found.
 *
 * <p>This function calls {@link readUntil} with an <code>until</code> function
 * which uses <code>.indexOf</code> to search for <code>needle</code>.  When
 * reading Buffers and performance is paramount, consider using
 * {@link readUntil} directly with an optional function for the problem (e.g.
 * {@link
 * https://www.npmjs.com/package/buffer-indexof-fast buffer-indexof-fast} for
 * single-character search).</p>
 *
 * <p>Doc note:  options should be a ReadToOptions type which extends
 * {@link ReadOptions}, but record types can't currently be extended.
 * See {@link https://github.com/google/closure-compiler/issues/604}.</p>
 *
 * @param {module:stream.Readable} stream Stream from which to read.
 * @param {!Buffer|string|*} needle Value to search for in the read result.
 * The stream will be read until this value is found or <code>'end'</code> or
 * <code>'error'</code> is emitted.
 * @param {ReadOptions=} options Options.  This function additionally supports
 * an <code>endOK</code> option which prevents {@link EOFError} on
 * <code>'end'</code>.
 * @returns {Promise<Buffer|string|Array>|
 * CancellableReadPromise<Buffer|string|Array>} Promise with the data read, up
 * to and including <code>needle</code>, or an Error if one occurs.  If
 * <code>stream</code> does not support <code>unshift</code>, the result may
 * include additional data.  If <code>'end'</code> is emitted before
 * <code>needle</code> is found, an {@link EOFError} is returned, unless
 * <code>options.endOK</code> is truthy in which case any remaining data is
 * returned or <code>null</code> if none was read.  If an error occurs after
 * reading some data, the <code>.read</code> property of the error object will
 * contain the partial read result.  The promise is resolved synchronously for
 * streams in flowing mode (see README.md for details).
 */
function readTo(stream, needle, options) {
  const endOK = Boolean(options && (options.endOK || options.endOk));
  let needleForIndexOf;
  let needleLength;
  function until(result, chunk, ended) {
    if (ended) {
      return endOK ? result ? result.length : 0 : -1;
    }

    if (Array.isArray(result)) {
      // objectMode.  Use strict equality, like Array.prototype.indexOf
      return chunk === needle ? result.length : -1;
    }

    // Calculate the length of the needle, as used by indexOf and perform the
    // type conversion done by indexOf once, to avoid converting on every call
    if (needleLength === undefined) {
      if (typeof result === 'string') {
        needleForIndexOf = String(needle);
        needleLength = needleForIndexOf.length;
      } else if (result instanceof Buffer) {
        if (typeof needle === 'number') {
          // buffertools requires a Buffer or string
          // buffer-indexof-polyfill converts number to Buffer on each call
          needleForIndexOf = result.indexOf ? needle
            : Buffer.from ? Buffer.from([needle])
              : Buffer.from([needle]);
          needleLength = 1;
        } else if (typeof needle === 'string') {
          needleForIndexOf = needle;
          needleLength = Buffer.byteLength(needle);
        } else if (needle instanceof Buffer) {
          needleForIndexOf = needle;
          needleLength = needle.length;
        }
      }

      if (needleLength === undefined) {
        throw new TypeError(`Unsupported indexOf argument types: ${
          Object.prototype.toString.call(result)}.indexOf(${
          Object.prototype.toString.call(needle)})`);
      }

      // Buffer.prototype.indexOf returns -1 for 0-length string/Buffer.
      // To be consistent with string, we return 0.
      // Note:  If removing this check, remove + 1 from start calc when 0.
      if (needleLength === 0) {
        return 0;
      }
    }

    const start =
      Math.max((result.length - chunk.length - needleLength) + 1, 0);
    const needleIndex = result.indexOf(needleForIndexOf, start);
    if (needleIndex < 0) {
      return -1;
    }

    return needleIndex + needleLength;
  }
  return readInternal(stream, undefined, until, options);
}

// "until" function which returns true once ended
function untilEnded(result, chunk, ended) {
  return ended;
}

/** Reads from a stream.Readable until 'end' is emitted.
 *
 * @param {module:stream.Readable} stream Stream from which to read.
 * @param {ReadOptions=} options Options.
 * @returns {Promise<!Buffer|string|!Array>|
 * CancellableReadPromise<!Buffer|string|!Array>} Promise with the data read,
 * <code>null</code> if no data was read, or an <code>Error</code> if one
 * occurred.  If an error occurs after reading some data, the
 * <code>.read</code> property of the error object will contain the partial
 * read result.  The promise is resolved synchronously for streams in flowing
 * mode (see README.md for details).
 */
function readToEnd(stream, options) {
  return readInternal(stream, undefined, untilEnded, options);
}

/** Reads from a stream.Readable until a given expression is matched.
 *
 * <p>This function calls {@link readUntil} with an <code>until</code> function
 * which applies <code>regexp</code> to the data read.</p>
 *
 * <p>Doc note:  options should be a ReadToMatchOptions type which extends
 * ReadToOptions, but record types can't currently be extended.
 * See {@link https://github.com/google/closure-compiler/issues/604}.</p>
 *
 * @param {module:stream.Readable<string>} stream Stream from which to read.
 * This stream must produce strings (so call <code>.setEncoding</code> if
 * necessary).
 * @param {!RegExp|string} regexp Expression to find in the read result.
 * The stream will be read until this value is matched or <code>'end'</code> or
 * <code>'error'</code> is emitted.
 * @param {ReadOptions=} options Options.  This function additionally supports
 * an <code>endOK</code> option which prevents {@link EOFError} on
 * <code>'end'</code> and a <code>maxMatchLen</code> option which specifies
 * the maximum length of a match, which allow additional search optimizations.
 * @returns {Promise<string>|CancellableReadPromise<string>} Promise with the
 * data read, up to and including the data matched by <code>regexp</code>, or
 * an Error if one occurs.  If <code>stream</code> does not support
 * <code>unshift</code>, the result may include additional data.  If
 * <code>'end'</code> is emitted before <code>regexp</code> is matched, an
 * {@link EOFError} is returned, unless <code>options.endOK</code> is truthy in
 * which case any remaining data is returned or <code>null</code> if none was
 * read.  If an error occurs after reading some data, the <code>.read</code>
 * property of the error object will contain the partial read result.  The
 * promise is resolved synchronously for streams in flowing mode (see README.md
 * for details).
 */
function readToMatch(stream, regexp, options) {
  const endOK = Boolean(options && (options.endOK || options.endOk));
  const maxMatchLen = Number(options && options.maxMatchLen);
  // Convert to RegExp where necessary, like String.prototype.match
  // Make sure RegExp has global flag so lastIndex will be set
  if (!(regexp instanceof RegExp)) {
    try {
      regexp = new RegExp(regexp, 'g');
    } catch (errRegExp) {
      // Note:  Synchronous Yaku emits unhandledRejection before returning.
      // Best current option is to use an async promise, even when flowing
      const ReadPromise = (options && options.Promise) || Promise;
      return ReadPromise.reject(errRegExp);
    }
  } else if (!regexp.global) {
    regexp = new RegExp(regexp.source, `${regexp.flags || ''}g`);
  }
  function until(result, chunk, ended) {
    if (ended) {
      return endOK ? result ? result.length : 0 : -1;
    }

    if (typeof result !== 'string') {
      throw new TypeError('readToMatch requires a string stream'
          + ' (use constructor options.encoding or .setEncoding method)');
    }

    regexp.lastIndex = maxMatchLen
      ? Math.max((result.length - chunk.length - maxMatchLen) + 1, 0)
      : 0;
    if (regexp.test(result)) {
      return regexp.lastIndex;
    }

    return -1;
  }
  return readInternal(stream, undefined, until, options);
}

module.exports = {
  AbortError,
  EOFError,
  TimeoutError,
  read,
  readUntil,
  readTo,
  readToEnd,
  readToMatch,
};
