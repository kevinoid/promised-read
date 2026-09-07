/**
 * @copyright Copyright 2016-2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const assert = require('node:assert');
const { fork } = require('node:child_process');
const stream = require('node:stream');

const BBPromise = require('bluebird');
const sinon = require('sinon');

// https://github.com/import-js/eslint-plugin-import/issues/2844
// eslint-disable-next-line import-x/extensions
const promisedRead = require('..');
const PassThroughEmitter = require('../test-lib/pass-through-emitter.js');

const {
  read,
  readTo,
  readToEnd,
  readToMatch,
  readUntil,
} = promisedRead;

// eslint-disable-next-line no-shadow
const setImmediate = globalThis.setImmediate || setTimeout;

/* The stream APIs use callbacks instead of Promises.
 * It is necessary to use callbacks to test.  Ignore lint errors about it. */
/* eslint-disable promise/catch-or-return, promise/no-callback-in-promise */

BBPromise.config({ cancellation: true });

// Many tests define helper functions which could be global.
// More readable to keep them near their point of use.
/* eslint-disable unicorn/consistent-function-scoping */

function untilNever() { return false; }

function writeEachTo(writable, inputData, cb) {
  let written = 0;
  function writeOne() {
    writable.write(inputData[written]);
    written += 1;
    if (written < inputData.length) {
      // Note: Delay between writes must be long enough for separate reads.
      // queueMicrotask() is too short.
      // nextTick() currently works, but likely not guaranteed.
      // setImmediate() guaranteed to run after I/O event callbacks.
      setImmediate(writeOne);
    } else if (cb) {
      cb();
    }
  }
  writeOne();
}

/**
 * Describes the promisedRead behavior for a given stream type.
 *
 * @private
 */
function describeWithStreamType(PassThrough) {
  describe('.read()', () => {
    it('returns a Promise with read data', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      queueMicrotask(() => {
        input.write(inputData);
      });
      const data = await read(input);
      assert.deepStrictEqual(data, inputData);
    });

    it('returns a Promise with read object', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = {};
      input.write(inputData);
      const data = await read(input);
      assert.deepStrictEqual(data, inputData);
    });

    if (PassThrough.prototype.read) {
      it('returns a Promise with available data', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        input.write(inputData);

        queueMicrotask(() => {
          // eslint-disable-next-line unicorn/prefer-await
          read(input).then(
            (data) => {
              assert.deepStrictEqual(data, inputData);
              done();
            },
            done,
          );
        });
      });
    }

    it('can read a chunk larger than writes', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = read(input, 8);
      input.write(inputData);
      queueMicrotask(() => {
        input.write(inputData);
      });
      const data = await promise;
      assert.deepStrictEqual(data, Buffer.concat([inputData, inputData]));
    });

    if (PassThrough.prototype.read) {
      it('can read a chunk smaller than writes', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        const promise = read(input, 2);
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData.slice(0, 2));
      });
    } else {
      it('can\'t read a chunk smaller than writes', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        const promise = read(input, 2);
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData);
      });

      it('can read a chunk smaller than writes w/ .unshift()', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        input.unshift = function(chunk) {
          assert.deepStrictEqual(chunk, inputData.slice(2));
        };
        const promise = read(input, 2);
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData.slice(0, 2));
      });

      it('reads a larger chunk if unshift emits error', async () => {
        const input = new PassThrough();
        input.unshift = function(chunk) {
          this.emit('error', new Error('test'));
        };
        const inputData = Buffer.from('test');
        const promise = read(input, 2);
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData);
      });

      it('reads a larger chunk if unshift throws error', async () => {
        const input = new PassThrough();
        input.unshift = function(chunk) {
          throw new Error('test');
        };
        const inputData = Buffer.from('test');
        const promise = read(input, 2);
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData);
      });

      // The value of this behavior is debatable, but the intention is that
      // unshift-specific errors (e.g. unsupported) don't cause the reader to
      // abort reading.  Since there's no way for the reader to differentiate
      // unshift errors from read errors, we suppress them.  The risk is that
      // hard errors (e.g. stream entered bad state) could also be suppressed.
      // If there is a real-world case where this occurs, this behavior may be
      // changed.
      it('does not expose unshift errors', (done) => {
        const input = new PassThrough();
        input.on('error', done);
        input.unshift = function(chunk) {
          this.emit('error', new Error('test'));
        };
        const inputData = Buffer.from('test');
        // eslint-disable-next-line unicorn/prefer-await
        read(input, 2).then(
          (data) => {
            assert.deepStrictEqual(data, inputData);
            done();
          },
          done,
        );
        input.write(inputData);
      });
    }

    it('can short-read due to end', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = read(input, 8);
      input.write(inputData);
      queueMicrotask(() => {
        input.end();
      });
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('can read an empty Array in objectMode', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = [];
      const promise = read(input);
      input.write(inputData);
      const data = await promise;
      assert.strictEqual(data, inputData);
    });

    // Just like stream.Readable.prototype.read when in objectMode
    it('reads at most one non-Buffer/string', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = [1, 2, 3];
      const promise = read(input, 2);
      for (const inputDatum of inputData) {
        input.write(inputDatum);
      }
      const data = await promise;
      assert.strictEqual(data, inputData[0]);
    });

    it('reads at most one Buffer/string if options.objectMode', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = [Buffer.from('Larry'), Buffer.from('Curly')];
      const promise = read(input, 2, { objectMode: true });
      for (const inputDatum of inputData) {
        input.write(inputDatum);
      }
      const data = await promise;
      assert.strictEqual(data, inputData[0]);
    });

    it('resolves with null when no data is read', async () => {
      const input = new PassThrough();
      const promise = read(input);
      input.end();
      const data = await promise;
      assert.strictEqual(data, null);
    });

    if (!PassThrough.prototype.read) {
      // Note:  I would be open to adding an option to allow this, if needed.
      it('does not resolve with null for null \'data\' event', async () => {
        const input = new PassThrough({ objectMode: true });
        const inputData = Buffer.from('test');
        const promise = read(input);
        input.write(null);
        input.write(inputData);
        const data = await promise;
        assert.strictEqual(data, inputData);
      });
    }

    if (stream.Readable && new PassThrough() instanceof stream.Readable) {
      it('resolves with null after end for stream.Readable', (done) => {
        // This only works for proper instances of stream.Readable and is not
        // guaranteed to work (due to use of Readable implementation details).
        const input = new PassThrough();
        input.once('end', () => {
          queueMicrotask(() => {
            read(input)
              // eslint-disable-next-line unicorn/prefer-await
              .then((data) => {
                assert.strictEqual(data, null);
              })
              // eslint-disable-next-line unicorn/prefer-await
              .then(done, done);
          });
        });
        input.end();
        // Note:  Must read after .end() for 'end' to be emitted
        input.read();
      });
    }

    it('rejects with stream error', async () => {
      const input = new PassThrough();
      const errTest = new Error('test');
      const promise = read(input);
      input.emit('error', errTest);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err, errTest);
          return true;
        },
      );
    });

    if (PassThrough.prototype.read) {
      it('does not read after error', async () => {
        const input = new PassThrough();
        const errTest = new Error('test');
        const promise = read(input);
        input.emit('error', errTest);
        input.write('data');
        await assert.rejects(
          promise,
          (err) => {
            assert.strictEqual(err, errTest);
            return true;
          },
        );
        assert.notStrictEqual(input.read(), null);
      });
    }

    if (!PassThrough.prototype.read) {
      // Note:  For 0.10 streams, read returns null until size is satisfied.
      // So this only applies to pre-0.10 streams.
      it('sets previously read data as .read on error', async () => {
        const input = new PassThrough();
        const errTest = new Error('test');
        const inputData = Buffer.from('test');
        const promise = read(input, 8);
        input.write(inputData, () => {
          input.emit('error', errTest);
        });
        await assert.rejects(
          promise,
          (err) => {
            assert.strictEqual(err, errTest);
            assert.deepStrictEqual(err.read, inputData);
            return true;
          },
        );
      });
    }

    function readWithArg(readArg, readsData) {
      let desc = `read(${readArg})`;
      if (PassThrough.prototype.read) { desc += ' calls .read and'; }
      desc += ' resolves to ';
      desc += readsData ? 'data' : 'null';
      it(desc, async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        const spy = input.read && sinon.spy(input, 'read');
        const promise = read(input, readArg);
        input.write(inputData);
        const data = await promise;
        if (readsData) {
          assert.notStrictEqual(data, null);
        } else {
          assert.strictEqual(data, null);
        }
        if (spy) {
          assert(spy.firstCall.calledWithExactly(readArg));
        }
      });
    }
    for (const readArg of [0, -1, false]) {
      readWithArg(readArg, false);
    }
    for (const readArg of [undefined, null, true]) {
      readWithArg(readArg, true);
    }

    if (PassThrough.prototype.read) {
      it('can pass an object argument to .read with options', () => {
        const input = new PassThrough();
        const readArg = {};
        const mock = sinon.mock(input)
          .expects('read')
          .once()
          .withExactArgs(readArg);
        read(input, readArg, {});
        mock.verify();
      });
    }

    it('does not lose sequential writes', async () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n'),
      ];
      const readData = [];
      function readAll(readable) {
        // Note: Can't convert to async/await because pre-0.10 streams require
        // synchronous .then() to avoid losing writes.  See README.md
        // eslint-disable-next-line unicorn/prefer-await
        return read(input, 2).then((data) => {
          if (data) {
            readData.push(data);
            return readAll(readable);
          }
          return Buffer.concat(readData);
        });
      }
      const promise = readAll(input);
      for (const data of inputData) {
        input.write(data);
      }
      input.end();
      const result = await promise;
      assert.deepStrictEqual(result, Buffer.concat(inputData));
    });

    if (!PassThrough.prototype.read) {
      it('does not lose consecutive synchronous writes', async () => {
        const input = new PassThrough();
        const inputData = [
          Buffer.from('Larry\n'),
          Buffer.from('Curly\n'),
          Buffer.from('Moe\n'),
        ];
        const readData = [];
        function readAll(readable) {
          // Note: Can't convert to async/await because pre-0.10 streams require
          // synchronous .then() to avoid losing writes.  See README.md
          // eslint-disable-next-line unicorn/prefer-await
          return read(input, 2).then((data) => {
            if (data) {
              readData.push(data);
              return readAll(readable);
            }
            return Buffer.concat(readData);
          });
        }
        const promise = readAll(input);
        for (const data of inputData) {
          input.emit('data', data);
        }
        input.emit('end');
        const result = await promise;
        assert.deepStrictEqual(result, Buffer.concat(inputData));
      });
    }

    it('returns an instance of options.Promise', () => {
      const input = new PassThrough();
      const promise = read(input, { Promise: BBPromise });
      assert(promise instanceof BBPromise);
    });

    it('does not have .abortRead or .cancelRead by default', () => {
      const input = new PassThrough();
      const promise = read(input);
      assert.strictEqual(promise.abortRead, undefined);
      assert.strictEqual(promise.cancelRead, undefined);
    });

    describe('with options.cancellable', () => {
      it('has .abortRead and .cancelRead methods', () => {
        const input = new PassThrough();
        const promise = read(input, { cancellable: true });
        assert.strictEqual(typeof promise.abortRead, 'function');
        assert.strictEqual(typeof promise.cancelRead, 'function');
      });

      it('supports .cancelable as an alias', () => {
        const input = new PassThrough();
        const promise = read(input, { cancelable: true });
        assert.strictEqual(typeof promise.abortRead, 'function');
        assert.strictEqual(typeof promise.cancelRead, 'function');
      });

      it('rejects with AbortError on .abortRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = read(input, { cancellable: true });
        // eslint-disable-next-line unicorn/prefer-await
        promise.then(
          () => {
            done(new Error('then should not be called'));
          },
          (err) => {
            try {
              assert.strictEqual(err.name, 'AbortError');
            } catch (errAssert) {
              done(errAssert);
            }
          },
        );
        promise.abortRead();

        input.write(inputData);

        // Delay long enough to ensure data is not read
        setImmediate(() => {
          if (input.read) {
            assert.deepStrictEqual(input.read(), inputData);
          }
          done();
        });
      });

      it('does not resolve, reject, or read after .cancelRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = read(input, { cancellable: true });
        // eslint-disable-next-line unicorn/prefer-await
        promise.then(
          () => {
            done(new Error('then should not be called'));
          },
          () => {
            done(new Error('catch should not be called'));
          },
        );
        promise.cancelRead();

        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(() => {
          if (input.read) {
            assert.deepStrictEqual(input.read(), inputData);
          }
          done();
        });
      });

      it('does nothing on .abortRead after .cancelRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = read(input, { cancellable: true });
        // eslint-disable-next-line unicorn/prefer-await
        promise.then(
          () => {
            done(new Error('then should not be called'));
          },
          () => {
            done(new Error('catch should not be called'));
          },
        );
        promise.cancelRead();
        promise.abortRead();

        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(() => {
          if (input.read) {
            assert.deepStrictEqual(input.read(), inputData);
          }
          done();
        });
      });

      it('does nothing on .cancelRead after .abortRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = read(input, { cancellable: true });
        // eslint-disable-next-line unicorn/prefer-await
        promise.then(
          () => {
            done(new Error('then should not be called'));
          },
          (err) => {
            try {
              assert.strictEqual(err.name, 'AbortError');
            } catch (errAssert) {
              done(errAssert);
            }
          },
        );
        promise.abortRead();
        promise.cancelRead();

        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(() => {
          if (input.read) {
            assert.deepStrictEqual(input.read(), inputData);
          }
          done();
        });
      });
    });

    it('supports bluebird 3.x cancellation', (done) => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');

      // eslint-disable-next-line unicorn/prefer-await
      const promise = read(input, { Promise: BBPromise }).then(
        () => {
          done(new Error('then should not be called'));
        },
        () => {
          done(new Error('catch should not be called'));
        },
      );
      promise.cancel();

      // Delay so that onCancel is called before write
      // See https://github.com/petkaantonov/bluebird/issues/1041
      setImmediate(() => {
        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(() => {
          if (input.read) {
            assert.deepStrictEqual(input.read(), inputData);
          }
          done();
        });
      });
    });

    describe('with options.timeout', () => {
      it('rejects with TimeoutError after timeout ms', async () => {
        const input = new PassThrough();
        await assert.rejects(
          read(input, { timeout: 1 }),
          (err) => {
            assert.strictEqual(err.name, 'TimeoutError');
            return true;
          },
        );
      });

      it('passes options.timeout of 0 to setTimeout', async () => {
        const input = new PassThrough();
        const spy = sinon.spy(globalThis, 'setTimeout');
        const promise = read(input, { timeout: 0 });
        setTimeout.restore();
        assert.strictEqual(spy.callCount, 1);
        assert.strictEqual(spy.firstCall.args[1], 0);
        await assert.rejects(
          promise,
          (err) => {
            assert.strictEqual(err.name, 'TimeoutError');
            return true;
          },
        );
      });

      if (PassThrough.prototype.read) {
        it('does not read after timeout', (done) => {
          const input = new PassThrough();
          const inputData = Buffer.from('test');
          // eslint-disable-next-line unicorn/prefer-await
          read(input, { timeout: 1 }).then(
            () => {
              done(new Error('then should not be called'));
            },
            (err) => {
              assert.strictEqual(err.name, 'TimeoutError');
              input.write(inputData);
              setImmediate(() => {
                assert.deepStrictEqual(input.read(), inputData);
                done();
              });
            },
          );
        });
      }

      it('resolves if read completes before timeout ms', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        // eslint-disable-next-line unicorn/prefer-await
        read(input, { timeout: 1 }).then((data) => {
          assert.deepStrictEqual(data, inputData);
          // Wait until after timeout to catch unhandled error
          setTimeout(done, 2);
        }, done);
        input.write(inputData);
      });
    });

    it('supports bluebird timeout with cancellation', (done) => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');

      read(input, { Promise: BBPromise })
        .timeout(2)
        // eslint-disable-next-line unicorn/prefer-await
        .then(
          () => {
            done(new Error('then should not be called'));
          },
          (err) => {
            assert.strictEqual(err.name, 'TimeoutError');
            if (input.read) {
              // Delay so that onCancel is called before write
              // See https://github.com/petkaantonov/bluebird/issues/1041
              setImmediate(() => {
                input.write(inputData);
                setImmediate(() => {
                  assert.deepStrictEqual(input.read(), inputData);
                  done();
                });
              });
            } else {
              done();
            }
          },
        );
    });
  });

  describe('.readTo()', () => {
    it('reads up to (and including) the marker', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('Larry\n');
      const promise = readTo(input, Buffer.from('\n'));
      input.write(inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('reads up to (and including) the marker with encoding', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      const inputData = 'Larry\n';
      const promise = readTo(input, '\n');
      input.write(inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('reads up to (and including) the marker in objectMode', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = 3;
      const promise = readTo(input, 3);
      input.write(inputData);
      const data = await promise;
      // Note:  readTo result is always an Array in objectMode
      assert.deepStrictEqual(data, [inputData]);
    });

    it('reads up to the marker across writes', async () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('La'),
        Buffer.from('rry\n'),
      ];
      const promise = readTo(input, Buffer.from('\n'));
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, Buffer.concat(inputData));
    });

    it('reads up to the marker across writes with encoding', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      const inputData = [
        'La',
        'rry\n',
      ];
      const promise = readTo(input, '\n');
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData.join(''));
    });

    it('reads up to the marker across writes in objectMode', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = [1, 2, 3];
      const promise = readTo(input, 3);
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('does strict equality checks for marker in objectMode', async () => {
      const input = new PassThrough({ objectMode: true });
      // Note:  null and undefined are not supported by stream.PassThrough
      const inputData = [true, 0, '', false];
      const promise = readTo(input, false);
      for (const inputDatum of inputData) {
        input.write(inputDatum);
      }
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('reads up to the marker split across writes with encoding', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      const inputData = [
        'Larry\n',
        'Cur',
        'ly\n',
        'Moe\n',
      ];
      const promise = readTo(input, 'Curly\n');
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData.slice(0, 3).join(''));
    });

    describe('uses result indexOf conversions', () => {
      it('string marker in Buffer', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\n');
        const promise = readTo(input, '\n');
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData);
      });

      it('character code marker in Buffer', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\n');
        const promise = readTo(input, '\n'.codePointAt(0));
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData);
      });

      it('Buffer marker in string', async () => {
        const input = new PassThrough({ encoding: 'utf8' });
        const inputData = 'Larry\n';
        const promise = readTo(input, Buffer.from('\n'));
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData);
      });

      it('rejects with TypeError on type mismatch', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\n');
        const promise = readTo(input, true);
        input.write(inputData);
        await assert.rejects(
          promise,
          (err) => {
            assert.strictEqual(err.name, 'TypeError');
            return true;
          },
        );
      });
    });

    it('may return data after the marker w/o .unshift', async () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('Larry\nCurly');
      const promise = readTo(input, '\n');
      input.write(inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData.slice(0, data.length));
    });

    if (PassThrough.prototype.unshift) {
      it('does not read past the marker w/ .unshift', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\nCurly');
        const promise = readTo(input, '\n');
        input.write(inputData);
        const data = await promise;
        const afterMarker = String(inputData).indexOf('\n') + 1;
        assert.deepStrictEqual(data, inputData.slice(0, afterMarker));
        assert.deepStrictEqual(input.read(), inputData.slice(afterMarker));
      });
    }

    it('does not read past the marker in objectMode', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = [1, 2, 3, 4, 5];
      const promise = readTo(input, 3);
      for (const inputDatum of inputData) {
        input.write(inputDatum);
      }
      const data = await promise;
      const afterMarker = inputData.indexOf(3) + 1;
      assert.deepStrictEqual(data, inputData.slice(0, afterMarker));
      if (input.read) {
        const expectData = inputData.slice(afterMarker);
        while (expectData.length > 0) {
          assert.deepStrictEqual(input.read(), expectData.shift());
        }
      }
    });

    it('stops reading after first write for 0-length marker', async () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n'),
      ];
      const promise = readTo(input, '');
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(
        data,
        Buffer.concat(inputData).slice(0, data.length),
      );
    });

    if (PassThrough.prototype.unshift) {
      it('returns empty Buffer for 0-length marker w/ unshift', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\n');
        const promise = readTo(input, Buffer.alloc(0));
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, Buffer.alloc(0));
        assert.deepStrictEqual(input.read(), inputData);
      });
    }

    it('treats strings as objects if options.objectMode', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = ['Larry', 'Curly', 'Moe'];
      const promise = readTo(input, 'Moe', { objectMode: true });
      for (const inputDatum of inputData) {
        input.write(inputDatum);
      }
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('can recognize objectMode late', async () => {
      // readTo expects a stream of Buffer objects until it reads a string
      // at which point it realizes the stream is in objectMode and must
      // recover gracefully.
      const input = new PassThrough({ objectMode: true });
      const inputData = [Buffer.from('test1'), 'test2'];
      const promise = readTo(input, inputData[1]);
      for (const inputDatum of inputData) {
        input.write(inputDatum);
      }
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    if (!PassThrough.prototype.read) {
      // Note:  I would be open to adding an option to allow this, if needed.
      it('can read null from \'data\' events', async () => {
        const input = new PassThrough({ objectMode: true });
        const promise = readTo(input, null);
        input.write(null);
        const data = await promise;
        assert(Array.isArray(data));
        assert.strictEqual(data.length, 1);
        assert.strictEqual(data[0], null);
      });
    }

    it('sets previously read data as .read on error', async () => {
      const input = new PassThrough();
      const errTest = new Error('test');
      const inputData = Buffer.from('test');
      const promise = readTo(input, '\n');
      input.write(inputData, () => {
        input.emit('error', errTest);
      });
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err, errTest);
          assert.deepStrictEqual(err.read, inputData);
          return true;
        },
      );
    });

    it('rejects with EOFError when no data is read', async () => {
      const input = new PassThrough();
      const promise = readTo(input, '\n');
      input.end();
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err.name, 'EOFError');
          return true;
        },
      );
    });

    it('sets previously read data as .read on EOFError', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = readTo(input, '\n');
      input.end(inputData);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err.name, 'EOFError');
          assert.deepStrictEqual(err.read, inputData);
          return true;
        },
      );
    });

    it('resolves with null when no data if options.endOK', async () => {
      const input = new PassThrough();
      const promise = readTo(input, '\n', { endOK: true });
      input.end();
      const data = await promise;
      assert.strictEqual(data, null);
    });

    it('resolves with data previously read data if options.endOK', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = readTo(input, '\n', { endOK: true });
      input.end(inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('without unshift, sets read data as .read on .abortRead', async () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('test');

      const promise = readTo(input, '\n', { cancellable: true });
      input.write(inputData);
      queueMicrotask(() => {
        promise.abortRead();
      });
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err.name, 'AbortError');
          assert.deepStrictEqual(err.read, inputData);
          return true;
        },
      );
    });

    it('without unshift, returns read data from .cancelRead', (done) => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('test');

      const promise = readTo(input, '\n', { cancellable: true });
      input.write(inputData);
      queueMicrotask(() => {
        assert.deepStrictEqual(promise.cancelRead(), inputData);
        done();
      });
    });

    it('without unshift, sets read data as .read on timeout', async () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('test');

      const promise = readTo(input, '\n', { timeout: 1 });
      input.write(inputData);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err.name, 'TimeoutError');
          assert.deepStrictEqual(err.read, inputData);
          return true;
        },
      );
    });

    if (PassThrough.prototype.unshift) {
      it('with unshift, unshifts read data on .abortRead', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = readTo(input, '\n', { cancellable: true });
        input.write(inputData);
        queueMicrotask(() => {
          promise.abortRead();
        });
        await assert.rejects(
          promise,
          (err) => {
            assert.strictEqual(err.name, 'AbortError');
            assert.strictEqual(err.read, undefined);
            return true;
          },
        );
        assert.deepStrictEqual(input.read(), inputData);
      });

      it('with unshift, unshifts read data on .cancelRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = readTo(input, '\n', { cancellable: true });
        input.write(inputData);
        // Wait until data has been read
        queueMicrotask(() => {
          promise.cancelRead();
          assert.deepStrictEqual(input.read(), inputData);
          done();
        });
      });

      it('with unshift, unshifts read data on timeout', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = readTo(input, '\n', { timeout: 1 });
        input.write(inputData);
        await assert.rejects(
          promise,
          (err) => {
            assert.strictEqual(err.name, 'TimeoutError');
            assert.strictEqual(err.read, undefined);
            return true;
          },
        );
        assert.deepStrictEqual(input.read(), inputData);
      });
    }
  });

  describe('.readToEnd()', () => {
    it('reads to stream end', async () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n'),
      ];
      const promise = readToEnd(input);
      writeEachTo(input, inputData, () => input.end());
      const data = await promise;
      assert.deepStrictEqual(data, Buffer.concat(inputData));
    });

    it('reads to stream end (encoded)', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      const inputData = [
        'Larry\n',
        'Curly\n',
        'Moe\n',
      ];
      const promise = readToEnd(input);
      writeEachTo(input, inputData, () => input.end());
      const data = await promise;
      assert.deepStrictEqual(data, inputData.join(''));
    });

    it('reads to stream end (objectMode)', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = [0, 1, 2, 3, 4];
      const promise = readToEnd(input);
      writeEachTo(input, inputData, () => input.end());
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('resolves with null when no data', async () => {
      const input = new PassThrough();
      const promise = readToEnd(input);
      input.end();
      const data = await promise;
      assert.strictEqual(data, null);
    });

    it('rejects with stream error', async () => {
      const input = new PassThrough();
      const errTest = new Error('test');
      const promise = readToEnd(input);
      input.emit('error', errTest);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err, errTest);
          return true;
        },
      );
    });
  });

  describe('.readToMatch()', () => {
    it('reads up to (and including) a RegExp', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      const inputData = 'Larry\n';
      const promise = readToMatch(input, /\n/g);
      input.write(inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('reads up to (and including) a non-global RegExp', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      const inputData = 'Larry\n';
      const promise = readToMatch(input, /\n/);
      input.write(inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('reads up to (and including) a string expression', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      const inputData = 'Larry\n';
      const promise = readToMatch(input, '\n');
      input.write(inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('reads up to (and including) a match split across writes', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      const inputData = [
        'Larry\n',
        'Cur',
        'ly\n',
        'Moe\n',
      ];
      const promise = readToMatch(input, /Curly\n/g);
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData.slice(0, 3).join(''));
    });

    it('optimizes search from options.maxMatchLen', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      const inputData = [
        'Larry\n',
        'Cur',
        'ly\n',
        'Moe\n',
      ];
      const regexp = /Curly\n/g;
      const options = { maxMatchLen: 6 };
      // Note:  We could spy on writes to .lastIndex of regexp, but this would
      // rely too much on implementation details (of readToMatch and RegExp).
      // Instead, this tests it doesn't hurt and coverage shows the codepath.
      const promise = readToMatch(input, regexp, options);
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData.slice(0, 3).join(''));
    });

    it('rejects with SyntaxError for invalid string expressions', async () => {
      const input = new PassThrough({ encoding: 'utf8' });
      await assert.rejects(
        readToMatch(input, '*'),
        (err) => {
          assert.strictEqual(err.name, 'SyntaxError');
          return true;
        },
      );
    });

    it('rejects with TypeError for non-string streams', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('Larry\n');
      const promise = readToMatch(input, /\n/g);
      input.write(inputData);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
          return true;
        },
      );
    });

    it('resolves with null when no data if options.endOK', async () => {
      const input = new PassThrough();
      const promise = readToMatch(input, /\n/g, { endOK: true });
      input.end();
      const data = await promise;
      assert.strictEqual(data, null);
    });
  });

  describe('.readUntil()', () => {
    it('continues reading when negative or non-numeric falsey', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = [0, 1, 2, 3, 4];
      let callNum = 0;
      const returnValues = [undefined, null, false, -5, true];
      function until(buffer, chunk) {
        assert(Array.isArray(buffer));
        assert(typeof chunk === 'number');
        callNum += 1;
        return returnValues[callNum - 1];
      }
      const promise = readUntil(input, until);
      for (const inputDatum of inputData) {
        input.write(inputDatum);
      }
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('stops reading on true', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = readUntil(input, () => true);
      input.write(inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    it('stops reading if matches length', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      function until(buffer, chunk) {
        return buffer.length;
      }
      const promise = readUntil(input, until);
      input.write(inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData);
    });

    if (PassThrough.prototype.unshift) {
      it('stops reading and unshifts if less than length', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return 2;
        }
        const promise = readUntil(input, until);
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData.slice(0, 2));
      });

      it('stops reading and unshifts for objectMode stream', async () => {
        const input = new PassThrough({ objectMode: true });
        const inputData = [0, 1, 2, 3, 4];
        function until(buffer, chunk) {
          return buffer.length === inputData.length - 1 ? 2 : -1;
        }
        const promise = readUntil(input, until);
        for (const inputDatum of inputData) {
          input.write(inputDatum);
        }
        const data = await promise;
        assert.deepStrictEqual(data, inputData.slice(0, 2));
      });

      it('stops reading and unshifts on 0', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return 0;
        }
        const promise = readUntil(input, until);
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, Buffer.alloc(0));
      });

      it('can not unshift once ended', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk, ended) {
          return ended ? 2 : -1;
        }
        const promise = readUntil(input, until);
        input.end(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData);
      });
    } else {
      it('stops reading if less than length', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return 2;
        }
        const promise = readUntil(input, until);
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData);
      });

      it('stops reading on 0', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return 0;
        }
        const promise = readUntil(input, until);
        input.write(inputData);
        const data = await promise;
        assert.deepStrictEqual(data, inputData);
      });
    }

    // This can be useful for data formats where length preceeds data
    it('reads to length greater than current buffer', async () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('test1'),
        Buffer.from('test2'),
      ];
      function until(buffer, chunk) {
        return inputData[0].length + inputData[1].length;
      }
      const promise = readUntil(input, until);
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, Buffer.concat(inputData));
    });

    if (PassThrough.prototype.read) {
      it('reads to exact length greater than current buffer', async () => {
        const input = new PassThrough();
        input.unshift = undefined;
        const inputData = [
          Buffer.from('test1'),
          Buffer.from('test2'),
        ];
        function until(buffer, chunk) {
          return (inputData[0].length + inputData[1].length) - 2;
        }
        const promise = readUntil(input, until);
        writeEachTo(input, inputData);
        const data = await promise;
        assert.deepStrictEqual(data, Buffer.concat(inputData).slice(0, -2));
      });
    }

    it('rejects with TypeError for non-numeric/non-boolean', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      function until(buffer, chunk) {
        return {};
      }
      const promise = readUntil(input, until);
      input.write(inputData);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
          return true;
        },
      );
    });

    if (PassThrough.prototype.unshift) {
      it('unshifts on TypeError due to non-numeric/non-boolean', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return {};
        }
        const promise = readUntil(input, until);
        input.write(inputData);
        await assert.rejects(
          promise,
          (err) => {
            assert.strictEqual(err.name, 'TypeError');
            assert.deepStrictEqual(input.read(), inputData);
            return true;
          },
        );
      });
    }

    it('calls the until function on each read', async () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n'),
      ];
      const spy = sinon.spy((buffer, chunk) => {
        assert(Buffer.isBuffer(buffer));
        assert(Buffer.isBuffer(chunk));
        // Note:  No Buffer.equals before Node v0.11.13
        return String(chunk) === String(inputData.at(-1));
      });
      const promise = readUntil(input, spy);
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, Buffer.concat(inputData));
      assert.strictEqual(spy.callCount, 3);
      spy.getCall(0).calledWithExactly(inputData[0], inputData[0]);
      spy.getCall(1).calledWithExactly(
        Buffer.concat(inputData.slice(0, 2)),
        inputData[1],
      );
      spy.getCall(2).calledWithExactly(
        Buffer.concat(inputData),
        inputData[2],
      );
    });

    // This is a test that the internals for buffer resizing aren't broken
    it('can handle unexpectedly large reads', async () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.alloc(512),
      ];
      const bigInputData = Buffer.allocUnsafe(4 * 1024);
      for (let i = 0; i < bigInputData.length; i += 1) {
        bigInputData[i] = i % 256;
      }
      inputData.push(bigInputData);
      // TODO:  Some way to test buffer is a slice of a much larger buffer?
      function isChunkBig(buffer, chunk) {
        return chunk.length === bigInputData.length;
      }
      const promise = readUntil(input, isChunkBig);
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, Buffer.concat(inputData));
    });

    it('treats Buffers as objects if options.objectMode', async () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n'),
      ];
      function until(buffer) {
        assert(Array.isArray(buffer));
        return buffer.length < 2 ? -1 : 2;
      }
      const promise = readUntil(input, until, { objectMode: true });
      writeEachTo(input, inputData);
      const data = await promise;
      assert.deepStrictEqual(data, inputData.slice(0, 2));
    });

    it('does not combine Arrays in objectMode', async () => {
      const input = new PassThrough({ objectMode: true });
      const inputData = [['a'], ['b'], []];
      function untilEmpty(arrays) {
        assert(arrays.every(Array.isArray));
        return arrays.at(-1).length === 0 ? arrays.length : -1;
      }
      const promise = readUntil(input, untilEmpty);
      for (const inputDatum of inputData) {
        input.write(inputDatum);
      }
      const data = await promise;
      assert.strictEqual(data.length, inputData.length);
      for (const [i, array] of data.entries()) {
        assert.strictEqual(array, inputData[i]);
      }
    });

    it('rejects with EOFError when no data is read', async () => {
      const input = new PassThrough();
      const promise = readUntil(input, untilNever);
      input.end();
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err.name, 'EOFError');
          return true;
        },
      );
    });

    it('sets previously read data as .read on EOFError', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = readUntil(input, untilNever);
      input.end(inputData);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err.name, 'EOFError');
          assert.deepStrictEqual(err.read, inputData);
          return true;
        },
      );
    });

    if (stream.Readable && new PassThrough() instanceof stream.Readable) {
      it('rejects with EOFError after end for stream.Readable', (done) => {
        // This only works for proper instances of stream.Readable and is not
        // guaranteed to work (due to use of Readable implementation details).
        const input = new PassThrough();
        input.once('end', () => {
          queueMicrotask(() => {
            // eslint-disable-next-line unicorn/prefer-await
            readUntil(input, untilNever).then(
              sinon.mock().never(),
              (err) => {
                assert.strictEqual(err.name, 'EOFError');
              },
            )
              // eslint-disable-next-line unicorn/prefer-await
              .then(done, done);
          });
        });
        input.end();
        // Note:  Must read after .end() for 'end' to be emitted
        input.read();
      });
    }

    it('rejects with an Error thrown by until', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const errTest = new Error('test');
      function untilExcept(buffer) {
        throw errTest;
      }
      const promise = readUntil(input, untilExcept);
      input.write(inputData);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err, errTest);
          return true;
        },
      );
    });

    it('rejects with a falsey value thrown by until', async () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const errTest = null;
      function untilExcept(buffer) {
        throw errTest;
      }
      const promise = readUntil(input, untilExcept);
      input.write(inputData);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err, errTest);
          return true;
        },
      );
    });

    if (PassThrough.prototype.read) {
      it('does not read after exception', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        const inputData2 = Buffer.from('test2');
        const errTest = new Error('test');
        function untilExcept(buffer) {
          throw errTest;
        }
        // eslint-disable-next-line unicorn/prefer-await
        readUntil(input, untilExcept).then(
          () => {
            done(new Error('then should not be called'));
          },
          (err) => {
            assert.strictEqual(err, errTest);
            // Discard inputData, if it was unshifted
            input.read();
            input.write(inputData2);
            setImmediate(() => {
              assert.deepStrictEqual(input.read(), inputData2);
              done();
            });
          },
        );
        input.write(inputData);
      });
    }

    it('without unshift, sets read data as .read on exception', async () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('test');
      const errTest = new Error('test');
      function untilExcept(buffer) {
        throw errTest;
      }
      const promise = readUntil(input, untilExcept);
      input.write(inputData);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err, errTest);
          assert.deepStrictEqual(err.read, inputData);
          return true;
        },
      );
    });

    if (PassThrough.prototype.unshift) {
      it('with unshift, unshifts read data on exception', async () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        const errTest = new Error('test');
        function untilExcept(buffer) {
          throw errTest;
        }
        const promise = readUntil(input, untilExcept);
        input.write(inputData);
        await assert.rejects(
          promise,
          (err) => {
            assert.strictEqual(err, errTest);
            assert.strictEqual(err.read, undefined);
            return true;
          },
        );
        assert.deepStrictEqual(input.read(), inputData);
      });
    }

    it('rejects with TypeError for non-function until', async () => {
      const input = new PassThrough();
      const promise = readUntil(input, true);
      await assert.rejects(
        promise,
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
          return true;
        },
      );
    });

    // This can be an issue with synchronous promises.
    it('does not cause unhandledRejection for non-function', (done) => {
      const input = new PassThrough();
      const immID = setImmediate(done);
      process.once('unhandledRejection', () => {
        clearImmediate(immID);
        done(new Error('unhandledRejection'));
      });
      // eslint-disable-next-line unicorn/prefer-await
      readUntil(input, true).then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
        },
      );
    });
  });
}

describe('promisedRead', () => {
  it('has proper sync/async when loaded after yaku', (done) => {
    fork('./test-bin/after-yaku-ok')
      .on('error', done)
      .on('exit', (code) => {
        assert.strictEqual(code, 0);
        done();
      });
  });

  it('has proper sync/async when loaded before yaku', (done) => {
    fork('./test-bin/before-yaku-ok')
      .on('error', done)
      .on('exit', (code) => {
        assert.strictEqual(code, 0);
        done();
      });
  });

  describe('with pre-0.10 streams', () => {
    describeWithStreamType(PassThroughEmitter);
  });

  if (stream.PassThrough) {
    describe('with 0.10 streams', () => {
      describeWithStreamType(stream.PassThrough);
    });
  }
});
