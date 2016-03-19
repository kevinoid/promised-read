promised-read
=============

[![Build status](https://img.shields.io/travis/kevinoid/promised-read.svg?style=flat)](https://travis-ci.org/kevinoid/promised-read)
[![Coverage](https://img.shields.io/codecov/c/github/kevinoid/promised-read.svg?style=flat)](https://codecov.io/github/kevinoid/promised-read?branch=master)
[![Dependency Status](https://img.shields.io/david/kevinoid/promised-read.svg?style=flat)](https://david-dm.org/kevinoid/promised-read)
[![Supported Node Version](https://img.shields.io/node/v/promised-read.svg?style=flat)](https://www.npmjs.com/package/promised-read)
[![Version on NPM](https://img.shields.io/npm/v/promised-read.svg?style=flat)](https://www.npmjs.com/package/promised-read)

Read from a stream using Promises, with support for timeouts, cancellation,
and reading up to a given point.

## Introductory Example

```js
var readTo = require('promised-read').readTo;
process.stderr.write('What is your name? ');
readTo(process.stdin, '\n').then(function(response) {
  process.stderr.write('Hello ' + response);
});
```

## Features

- Supports pre-0.10 (v1) streams and post-0.10 (v2) streams.
- Supports `objectMode` streams and decoded string streams in addition to byte
  (`Buffer`) streams.
- Supports sized reads.
- Supports reading up to an expected sequence (with unshift for over-reads).
- Supports reading until a function is satisfied (with unshift for over-reads).
- Supports read timeout and read cancellation (including [bluebird 3.x
  cancellation integration](http://bluebirdjs.com/docs/api/cancellation.html),
  when available).

## Installation

[This package](https://www.npmjs.com/package/promised-read) can be
installed using [npm](https://www.npmjs.com/), either globally or locally, by
running:

```sh
npm install promised-read
```

## Recipes

### Sized read

```js
var fs = require('fs');
var read = require('promised-read').read;
var input = fs.createReadStream('input.dat');
read(input, 1024).then(function(data) {
  if (data === null) {
    console.error('Stream ended without data.');
  } else if (data.length < 1024) {
    console.error('Stream ended before 1024 bytes could be read.');
  } else if (data.length > 1024) {
    console.error('Stream without .read() or .unshift() emitted too much data');
  } else {
    console.log('Common case.  Read requested amount.');
  }
});
```

### Read Until

```js
var fs = require('fs');
var readUntil = require('promised-read').readUntil;
var input = fs.createReadStream('input.jsons', {encoding: 'utf8'});
// Don't use this without handling '{' and '}' in strings
function untilObject(data) {
  var depth = 0;
  for (var i = 0; i < data.length; ++i) {
    var ch = data[i];
    if (ch === '{') {
      ++depth;
    } else if (ch === '}') {
      --depth;
      if (depth === 0) {
        // Length including closing bracket.  Additional data will be unshifted.
        return i + 1;
      }
    }
  }
  return -1;
}
readUntil(input, untilObject).then(function(jsonObject) {
  JSON.parse(jsonObject);
});
```

### Read Until (incremental, faster)

The `until` function can also operate on the individual chunks read, which are
passed as the second argument.  This avoids re-processing data which was
previously checked.  The previous example can be made more efficient with:

```js
var fs = require('fs');
var readUntil = require('promised-read').readUntil;
var input = fs.createReadStream('input.jsons', {encoding: 'utf8'});
var depth = 0;
// Don't use this without handling '{' and '}' in strings
function untilObject(data, chunk, ended) {
  if (!chunk) {
    // chunk === null and ended === true when called for the 'end' event
    // (chunk === null could also happen on pre-0.10 streams in objectMode)
    return -1;
  }

  for (var i = 0; i < chunk.length; ++i) {
    var ch = chunk[i];
    if (ch === '{') {
      ++depth;
    } else if (ch === '}') {
      --depth;
      if (depth === 0) {
        // Length including closing bracket.  Additional data will be unshifted.
        return data.length - chunk.length + i + 1;
      }
    }
  }
  return -1;
}
readUntil(input, untilObject).then(function(jsonObject) {
  JSON.parse(jsonObject);
});
```

### Read with Timeout

```js
var readTo = require('promised-read').readTo;
process.stderr.write('Pop Quiz: What\'s the square root of 3,448,449? ');
var promise = readTo(process.stdin, '\n', {timeout: 5000});
promise.then(
  function(response) {
    response = String(response).replace(/[^0-9]+/g, '');
    console.error(Number(response) === 1857 ? 'Impressive.' : 'Nope.');
  },
  function(err) {
    console.error(err.name === 'TimeoutError' ? 'Too slow.' : String(err));
  }
);
```

**Note:** Several promise libraries provide a `.timeout()` method which
creates a chained promise which is rejected after a delay.  Although this
works for the read consumer, it won't cancel the read operation, causing any
data read from the stream (even after the timeout) to be discarded.  A notable
exception is [bluebird](http://bluebirdjs.com/docs/api/timeout.html) when
[cancellation](http://bluebirdjs.com/docs/api/cancellation.html) is enabled,
which behaves as if `.cancel()` was called on the original promise (see
caveats below).

## Abort/Cancel Support

Although generic Promise cancellation support is still far from being
standardized (see
[cancellation-spec](https://github.com/promises-aplus/cancellation-spec/issues),
[async cancel](https://github.com/tc39/ecmascript-asyncawait/issues/27), and
[fetch abort](https://github.com/whatwg/fetch/issues/27) for discussion), this
module provides an optional module-specific mechanism for callers to abort or
cancel a pending read operation.  Passing a truthy value for
`options.cancellation` causes the returned `Promise` to provide two additional
methods:

* `.abortRead()` causes reading to cease, the promise to be rejected with an
  `AbortError`, and any previously read data to be unshifted.  If unshift is
  not supported or causes an error, the data is set as the <code>.read</code>
  property of the `AbortError`.
* `.cancelRead()` causes the reading to cease and any previously read data to
  be unshifted.  The promise will never be resolved or rejected.  If unshift is
  not supported or causes an error, the data will be returned from
  `.cancelRead()`.

**Note:** These methods grant all promise holders the authority to abort or
cancel the read operation for all observers (including the unshift
side-effects).  Any consumers of the read result which which do not require
abort/cancel authority should be given a Promise chained from the returned one
(e.g. the result of calling <code>.then()</code> on it) to avoid granting
abort/cancel authority for the read.

### Abort reading

```js
var assert = require('assert');
var read = require('promised-read').read;
var stream = require('stream');
var input = new stream.PassThrough();
var promise = read(input);
promise.catch(function(err) {
  console.log(err.name);    // AbortError
});
promise.abortRead();
// reading is stopped immediately, so any future writes are unaffected
input.write('hello');
console.log(input.read());
```

### Cancel reading

```js
var assert = require('assert');
var read = require('promised-read').read;
var stream = require('stream');
var input = new stream.PassThrough();
var promise = read(input);
promise.then(
  function(data) { throw new Error('never called'); },
  function(err) { throw new Error('never called'); }
);
promise.cancelRead();
// reading is stopped immediately, so any future writes are unaffected
input.write('hello');
console.log(input.read());
```

### Abort from `until`

The `until` argument to `readUntil` can also cause read to be aborted by
throwing an exception.  In this case, the promise is rejected with the
exception thrown by `until` rather than an `AbortError`.

```js
var fs = require('fs');
var readUntil = require('promised-read').readUntil;
var zlib = require('zlib');
var input = fs.createReadStream('archive.tar');
function untilGzipMember(data) {
  if (data.length >= 2 && data[0] !== 0x1f && data[1] !== 0x8b) {
    throw new Error('invalid gzip header');
  }
}
readUntil(input, untilGzipMember).catch(function(err) {
  console.log(err); // Error: invalid gzip header
});
```

### `bluebird` 3.x Cancellation

This module also cancels the read operation when the returned promise is
cancelled via [bluebird 3.x
cancellation](http://bluebirdjs.com/docs/api/cancellation.html).  However, use
of this method is not recommended due to a delay between when `.cancel()` is
called and when the `onCancel` listener is called which can lead to lost data
(see [#1041](https://github.com/petkaantonov/bluebird/issues/1041)).

```js
var bluebird = require('bluebird');
var readTo = require('promised-read').readTo;
bluebird.config({cancellation: true});
process.stderr.write('How does Jim spell his name?\n');
var promise = readTo(process.stdin, '\n', {Promise: bluebird});
promise.then(function(response) {
  throw new Error('never called');
});
process.stderr.write('Nevermind.\n');
// Note1:  Only use .cancel() if the stream supports unshift or it would be
// safe to discard any data which has already been read
// Note2:  Due to the delay between .cancel() and the onCancel listener,
// callers should either delay writing for at least one tick or watch for
// 'data' events during that tick to avoid losing data.
// See https://github.com/petkaantonov/bluebird/issues/1041
promise.cancel();
```

More examples can be found in the [test
specifications](https://kevinoid.github.io/promised-read/specs).

## API Docs

To use this module as a library, see the [API
Documentation](https://kevinoid.github.io/promised-read/api).

## API Warnings

### Reading after end

The [stream API](https://nodejs.org/api/stream.html) does not provide a way to
differentiate between a stream which has ended and one which does not
currently have data available.  For this reason, the `read` functions should
not be called after a stream emits `'end'` or `'error'`.  It is the caller's
responsibility to ensure that `read` is only called on streams in a readable
state.

### Synchronous resolution for flowing streams

When reading from streams which lack a `.read()` method, or when
`options.flowing` is `true`, the `onFulfilled` and `onRejected` functions
(i.e. functions added with `.then()` or `.catch()`) will be called
synchronously upon promise resolution or rejection.  This is necessary to
prevent missing stream events between resolution and the handler being called,
when another read can be started.

This behavior may be surprising, since it conflicts with [point 2.2.4 of the
Promises/A+ spec](https://promisesaplus.com/#point-34) (for an example, see [A
Promises/A Test
Suite](https://github.com/domenic/promise-tests#always-async)).  However,
since read promises are only resolved synchronously when an argument error
occurs, one of the most common pitfalls is avoided.  Additionally, once the
synchronous behavior is not necessary (e.g. after the next read has started)
asynchronous behavior can be restored by chaining to another promise class
(e.g. `Promise.resolve(readPromise)`).

Synchronous promises can also be avoided by specifying an asynchronous promise
constructor via `options.Promise`.  However, this is likely to cause missed
events if the writer is not synchronized with with reader.

## Contributing

Contributions are welcome and very much appreciated!  Please add tests to
cover any changes and ensure `npm test` passes.

If the desired change is large, complex, backwards-incompatible, can have
significantly differing implementations, or may not be in scope for this
project, opening an issue before writing the code can avoid frustration and
save a lot of time and effort.

## License

This package is available under the terms of the
[MIT License](https://opensource.org/licenses/MIT).
