/**
 * @copyright Copyright 2016-2017 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const BBPromise = require('bluebird');
// Use safe-buffer as Buffer until support for Node < 4 is dropped
// eslint-disable-next-line no-shadow
const {Buffer} = require('safe-buffer');
const assert = require('assert');
const {fork} = require('child_process');
const promisedRead = require('..');
const sinon = require('sinon');
const stream = require('stream');
const PassThroughEmitter = require('../test-lib/pass-through-emitter');

const {
  read,
  readTo,
  readToEnd,
  readToMatch,
  readUntil
} = promisedRead;

// eslint-disable-next-line no-shadow
const setImmediate = global.setImmediate || setTimeout;

BBPromise.config({cancellation: true});

function untilNever() { return false; }

function writeEachTo(writable, inputData, cb) {
  let written = 0;
  function writeOne() {
    writable.write(inputData[written]);
    written += 1;
    if (written < inputData.length) {
      process.nextTick(writeOne);
    } else if (cb) {
      cb();
    }
  }
  writeOne();
}

/** Describes the promisedRead behavior for a given stream type. */
function describeWithStreamType(PassThrough) {
  describe('.read()', () => {
    it('returns a Promise with read data', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      process.nextTick(() => {
        input.write(inputData);
      });
      return read(input).then((data) => {
        assert.deepEqual(data, inputData);
      });
    });

    it('returns a Promise with read object', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = {};
      input.write(inputData);
      return read(input).then((data) => {
        assert.deepEqual(data, inputData);
      });
    });

    if (PassThrough.prototype.read) {
      it('returns a Promise with available data', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        input.write(inputData);

        process.nextTick(() => {
          read(input).then(
            (data) => {
              assert.deepEqual(data, inputData);
              done();
            },
            done
          );
        });
      });
    }

    it('can read a chunk larger than writes', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = read(input, 8).then((data) => {
        assert.deepEqual(data, Buffer.concat([inputData, inputData]));
      });
      input.write(inputData);
      process.nextTick(() => {
        input.write(inputData);
      });
      return promise;
    });

    if (PassThrough.prototype.read) {
      it('can read a chunk smaller than writes', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        const promise = read(input, 2).then((data) => {
          assert.deepEqual(data, inputData.slice(0, 2));
        });
        input.write(inputData);
        return promise;
      });
    } else {
      it('can\'t read a chunk smaller than writes', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        const promise = read(input, 2).then((data) => {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('can read a chunk smaller than writes w/ .unshift()', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        input.unshift = function(chunk) {
          assert.deepEqual(chunk, inputData.slice(2));
        };
        const promise = read(input, 2).then((data) => {
          assert.deepEqual(data, inputData.slice(0, 2));
        });
        input.write(inputData);
        return promise;
      });

      it('reads a larger chunk if unshift emits error', () => {
        const input = new PassThrough();
        input.unshift = function(chunk) {
          this.emit('error', new Error('test'));
        };
        const inputData = Buffer.from('test');
        const promise = read(input, 2).then((data) => {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('reads a larger chunk if unshift throws error', () => {
        const input = new PassThrough();
        input.unshift = function(chunk) {
          throw new Error('test');
        };
        const inputData = Buffer.from('test');
        const promise = read(input, 2).then((data) => {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
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
        read(input, 2).then(
          (data) => {
            assert.deepEqual(data, inputData);
            done();
          },
          done
        );
        input.write(inputData);
      });
    }

    it('can short-read due to end', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = read(input, 8).then((data) => {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      process.nextTick(() => {
        input.end();
      });
      return promise;
    });

    it('can read an empty Array in objectMode', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = [];
      const promise = read(input).then((data) => {
        assert.strictEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    // Just like stream.Readable.prototype.read when in objectMode
    it('reads at most one non-Buffer/string', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = [1, 2, 3];
      const promise = read(input, 2).then((data) => {
        assert.strictEqual(data, inputData[0]);
      });
      inputData.forEach((data) => {
        input.write(data);
      });
      return promise;
    });

    it('reads at most one Buffer/string if options.objectMode', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = [Buffer.from('Larry'), Buffer.from('Curly')];
      const promise = read(input, 2, {objectMode: true}).then((data) => {
        assert.strictEqual(data, inputData[0]);
      });
      inputData.forEach((data) => {
        input.write(data);
      });
      return promise;
    });

    it('resolves with null when no data is read', () => {
      const input = new PassThrough();
      const promise = read(input).then((data) => {
        assert.strictEqual(data, null);
      });
      input.end();
      return promise;
    });

    if (!PassThrough.prototype.read) {
      // Note:  I would be open to adding an option to allow this, if needed.
      it('does not resolve with null for null \'data\' event', () => {
        const input = new PassThrough({objectMode: true});
        const inputData = Buffer.from('test');
        const promise = read(input).then((data) => {
          assert.strictEqual(data, inputData);
        });
        input.write(null);
        input.write(inputData);
        return promise;
      });
    }

    if (stream.Readable && new PassThrough() instanceof stream.Readable) {
      it('resolves with null after end for stream.Readable', (done) => {
        // This only works for proper instances of stream.Readable and is not
        // guaranteed to work (due to use of Readable implementation details).
        const input = new PassThrough();
        input.once('end', () => {
          process.nextTick(() => {
            read(input).then((data) => {
              assert.strictEqual(data, null);
            }).then(done, done);
          });
        });
        input.end();
        // Note:  Must read after .end() for 'end' to be emitted
        input.read();
      });
    }

    it('rejects with stream error', () => {
      const input = new PassThrough();
      const errTest = new Error('test');
      const promise = read(input).then(
        sinon.mock().never(),
        (err) => { assert.strictEqual(err, errTest); }
      );
      input.emit('error', errTest);
      return promise;
    });

    if (PassThrough.prototype.read) {
      it('does not read after error', () => {
        const input = new PassThrough();
        const errTest = new Error('test');
        const promise = read(input).then(
          sinon.mock().never(),
          (err) => {
            assert.strictEqual(err, errTest);
            assert.notEqual(input.read(), null);
          }
        );
        input.emit('error', errTest);
        input.write('data');
        return promise;
      });
    }

    if (!PassThrough.prototype.read) {
      // Note:  For 0.10 streams, read returns null until size is satisfied.
      // So this only applies to pre-0.10 streams.
      it('sets previously read data as .read on error', () => {
        const input = new PassThrough();
        const errTest = new Error('test');
        const inputData = Buffer.from('test');
        const promise = read(input, 8).then(
          sinon.mock().never(),
          (err) => {
            assert.strictEqual(err, errTest);
            assert.deepEqual(err.read, inputData);
          }
        );
        input.write(inputData, () => {
          input.emit('error', errTest);
        });
        return promise;
      });
    }

    function readWithArg(readArg, readsData) {
      let desc = `read(${readArg})`;
      if (PassThrough.prototype.read) { desc += ' calls .read and'; }
      desc += ' resolves to ';
      desc += readsData ? 'data' : 'null';
      it(desc, () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        const spy = input.read && sinon.spy(input, 'read');
        const promise = read(input, readArg).then((data) => {
          if (readsData) {
            assert.notEqual(data, null);
          } else {
            assert.strictEqual(data, null);
          }
          if (spy) {
            assert(spy.firstCall.calledWithExactly(readArg));
          }
        });
        input.write(inputData);
        return promise;
      });
    }
    [0, -1, false].forEach((readArg) => {
      readWithArg(readArg, false);
    });
    [undefined, null, true].forEach((readArg) => {
      readWithArg(readArg, true);
    });

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

    it('does not lose sequential writes', () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n')
      ];
      const readData = [];
      function readAll(readable) {
        return read(input, 2).then((data) => {
          if (data) {
            readData.push(data);
            return readAll(readable);
          }
          return Buffer.concat(readData);
        });
      }
      const promise = readAll(input).then((result) => {
        assert.deepEqual(result, Buffer.concat(inputData));
      });
      inputData.forEach((data) => {
        input.write(data);
      });
      input.end();
      return promise;
    });

    if (!PassThrough.prototype.read) {
      it('does not lose consecutive synchronous writes', () => {
        const input = new PassThrough();
        const inputData = [
          Buffer.from('Larry\n'),
          Buffer.from('Curly\n'),
          Buffer.from('Moe\n')
        ];
        const readData = [];
        function readAll(readable) {
          return read(input, 2).then((data) => {
            if (data) {
              readData.push(data);
              return readAll(readable);
            }
            return Buffer.concat(readData);
          });
        }
        const promise = readAll(input).then((result) => {
          assert.deepEqual(result, Buffer.concat(inputData));
        });
        inputData.forEach((data) => {
          input.emit('data', data);
        });
        input.emit('end');
        return promise;
      });
    }

    it('returns an instance of options.Promise', () => {
      const input = new PassThrough();
      const promise = read(input, {Promise: BBPromise});
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
        const promise = read(input, {cancellable: true});
        assert.strictEqual(typeof promise.abortRead, 'function');
        assert.strictEqual(typeof promise.cancelRead, 'function');
      });

      it('supports .cancelable as an alias', () => {
        const input = new PassThrough();
        const promise = read(input, {cancelable: true});
        assert.strictEqual(typeof promise.abortRead, 'function');
        assert.strictEqual(typeof promise.cancelRead, 'function');
      });

      it('rejects with AbortError on .abortRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = read(input, {cancellable: true});
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
          }
        );
        promise.abortRead();

        input.write(inputData);

        // Delay long enough to ensure data is not read
        setImmediate(() => {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });

      it('does not resolve, reject, or read after .cancelRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = read(input, {cancellable: true});
        promise.then(
          () => {
            done(new Error('then should not be called'));
          },
          () => {
            done(new Error('catch should not be called'));
          }
        );
        promise.cancelRead();

        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(() => {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });

      it('does nothing on .abortRead after .cancelRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = read(input, {cancellable: true});
        promise.then(
          () => {
            done(new Error('then should not be called'));
          },
          () => {
            done(new Error('catch should not be called'));
          }
        );
        promise.cancelRead();
        promise.abortRead();

        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(() => {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });

      it('does nothing on .cancelRead after .abortRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = read(input, {cancellable: true});
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
          }
        );
        promise.abortRead();
        promise.cancelRead();

        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(() => {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });
    });

    it('supports bluebird 3.x cancellation', (done) => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');

      const promise = read(input, {Promise: BBPromise}).then(
        () => {
          done(new Error('then should not be called'));
        },
        () => {
          done(new Error('catch should not be called'));
        }
      );
      promise.cancel();

      // Delay so that onCancel is called before write
      // See https://github.com/petkaantonov/bluebird/issues/1041
      setImmediate(() => {
        input.write(inputData);

        // Delay long enough to ensure mocks are not called
        setImmediate(() => {
          if (input.read) {
            assert.deepEqual(input.read(), inputData);
          }
          done();
        });
      });
    });

    describe('with options.timeout', () => {
      it('rejects with TimeoutError after timeout ms', () => {
        const input = new PassThrough();
        return read(input, {timeout: 1}).then(
          sinon.mock().never(),
          (err) => {
            assert.strictEqual(err.name, 'TimeoutError');
          }
        );
      });

      it('passes options.timeout of 0 to setTimeout', () => {
        const input = new PassThrough();
        const spy = sinon.spy(global, 'setTimeout');
        const promise = read(input, {timeout: 0}).then(
          sinon.mock().never(),
          (err) => {
            assert.strictEqual(err.name, 'TimeoutError');
          }
        );
        setTimeout.restore();
        assert.strictEqual(spy.callCount, 1);
        assert.strictEqual(spy.firstCall.args[1], 0);
        return promise;
      });

      if (PassThrough.prototype.read) {
        it('does not read after timeout', (done) => {
          const input = new PassThrough();
          const inputData = Buffer.from('test');
          read(input, {timeout: 1}).then(
            () => {
              done(new Error('then should not be called'));
            },
            (err) => {
              assert.strictEqual(err.name, 'TimeoutError');
              input.write(inputData);
              setImmediate(() => {
                assert.deepEqual(input.read(), inputData);
                done();
              });
            }
          );
        });
      }

      it('resolves if read completes before timeout ms', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        read(input, {timeout: 1}).then((data) => {
          assert.deepEqual(data, inputData);
          // Wait until after timeout to catch unhandled error
          setTimeout(done, 2);
        }, done);
        input.write(inputData);
      });
    });

    it('supports bluebird timeout with cancellation', (done) => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');

      read(input, {Promise: BBPromise})
        .timeout(2)
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
                  assert.deepEqual(input.read(), inputData);
                  done();
                });
              });
            } else {
              done();
            }
          }
        );
    });
  });

  describe('.readTo()', () => {
    it('reads up to (and including) the marker', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('Larry\n');
      const promise = readTo(input, Buffer.from('\n')).then((data) => {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) the marker with encoding', () => {
      const input = new PassThrough({encoding: 'utf8'});
      const inputData = 'Larry\n';
      const promise = readTo(input, '\n').then((data) => {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) the marker in objectMode', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = 3;
      const promise = readTo(input, 3).then((data) => {
        // Note:  readTo result is always an Array in objectMode
        assert.deepEqual(data, [inputData]);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to the marker across writes', () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('La'),
        Buffer.from('rry\n')
      ];
      const promise = readTo(input, Buffer.from('\n')).then((data) => {
        assert.deepEqual(data, Buffer.concat(inputData));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('reads up to the marker across writes with encoding', () => {
      const input = new PassThrough({encoding: 'utf8'});
      const inputData = [
        'La',
        'rry\n'
      ];
      const promise = readTo(input, '\n').then((data) => {
        assert.deepEqual(data, inputData.join(''));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('reads up to the marker across writes in objectMode', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = [1, 2, 3];
      const promise = readTo(input, 3).then((data) => {
        assert.deepEqual(data, inputData);
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('does strict equality checks for marker in objectMode', () => {
      const input = new PassThrough({objectMode: true});
      // Note:  null and undefined are not supported by stream.PassThrough
      const inputData = [true, 0, '', false];
      const promise = readTo(input, false).then((data) => {
        assert.deepEqual(data, inputData);
      });
      inputData.forEach((data) => {
        input.write(data);
      });
      return promise;
    });

    it('reads up to the marker split across writes with encoding', () => {
      const input = new PassThrough({encoding: 'utf8'});
      const inputData = [
        'Larry\n',
        'Cur',
        'ly\n',
        'Moe\n'
      ];
      const promise = readTo(input, 'Curly\n').then((data) => {
        assert.deepEqual(data, inputData.slice(0, 3).join(''));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    describe('uses result indexOf conversions', () => {
      it('string marker in Buffer', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\n');
        const promise = readTo(input, '\n').then((data) => {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('character code marker in Buffer', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\n');
        const promise = readTo(input, '\n'.charCodeAt(0)).then((data) => {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('Buffer marker in string', () => {
        const input = new PassThrough({encoding: 'utf8'});
        const inputData = 'Larry\n';
        const promise = readTo(input, Buffer.from('\n')).then((data) => {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('rejects with TypeError on type mismatch', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\n');
        const promise = readTo(input, true).then(
          sinon.mock().never(),
          (err) => {
            assert.strictEqual(err.name, 'TypeError');
          }
        );
        input.write(inputData);
        return promise;
      });
    });

    it('may return data after the marker w/o .unshift', () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('Larry\nCurly');
      const promise = readTo(input, '\n').then((data) => {
        assert.deepEqual(data, inputData.slice(0, data.length));
      });
      input.write(inputData);
      return promise;
    });

    if (PassThrough.prototype.unshift) {
      it('does not read past the marker w/ .unshift', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\nCurly');
        const promise = readTo(input, '\n').then((data) => {
          const afterMarker = String(inputData).indexOf('\n') + 1;
          assert.deepEqual(data, inputData.slice(0, afterMarker));
          assert.deepEqual(input.read(), inputData.slice(afterMarker));
        });
        input.write(inputData);
        return promise;
      });
    }

    it('does not read past the marker in objectMode', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = [1, 2, 3, 4, 5];
      const promise = readTo(input, 3).then((data) => {
        const afterMarker = inputData.indexOf(3) + 1;
        assert.deepEqual(data, inputData.slice(0, afterMarker));
        if (input.read) {
          const expectData = inputData.slice(afterMarker);
          while (expectData.length > 0) {
            assert.deepEqual(input.read(), expectData.shift());
          }
        }
      });
      inputData.forEach((data) => {
        input.write(data);
      });
      return promise;
    });

    it('stops reading after first write for 0-length marker', () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n')
      ];
      const promise = readTo(input, '').then((data) => {
        assert.deepEqual(data, Buffer.concat(inputData).slice(0, data.length));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    if (PassThrough.prototype.unshift) {
      it('returns empty Buffer for 0-length marker w/ unshift', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('Larry\n');
        const promise = readTo(input, Buffer.alloc(0)).then((data) => {
          assert.deepEqual(data, Buffer.alloc(0));
          assert.deepEqual(input.read(), inputData);
        });
        input.write(inputData);
        return promise;
      });
    }

    it('treats strings as objects if options.objectMode', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = ['Larry', 'Curly', 'Moe'];
      const promise = readTo(input, 'Moe', {objectMode: true})
        .then((data) => {
          assert.deepEqual(data, inputData);
        });
      inputData.forEach((data) => {
        input.write(data);
      });
      return promise;
    });

    it('can recognize objectMode late', () => {
      // readTo expects a stream of Buffer objects until it reads a string
      // at which point it realizes the stream is in objectMode and must
      // recover gracefully.
      const input = new PassThrough({objectMode: true});
      const inputData = [Buffer.from('test1'), 'test2'];
      const promise = readTo(input, inputData[1]).then((data) => {
        assert.deepEqual(data, inputData);
      });
      inputData.forEach((data) => {
        input.write(data);
      });
      return promise;
    });

    if (!PassThrough.prototype.read) {
      // Note:  I would be open to adding an option to allow this, if needed.
      it('can read null from \'data\' events', () => {
        const input = new PassThrough({objectMode: true});
        const promise = readTo(input, null).then((data) => {
          assert(Array.isArray(data));
          assert.strictEqual(data.length, 1);
          assert.strictEqual(data[0], null);
        });
        input.write(null);
        return promise;
      });
    }

    it('sets previously read data as .read on error', () => {
      const input = new PassThrough();
      const errTest = new Error('test');
      const inputData = Buffer.from('test');
      const promise = readTo(input, '\n').then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err, errTest);
          assert.deepEqual(err.read, inputData);
        }
      );
      input.write(inputData, () => {
        input.emit('error', errTest);
      });
      return promise;
    });

    it('rejects with EOFError when no data is read', () => {
      const input = new PassThrough();
      const promise = readTo(input, '\n').then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'EOFError');
        }
      );
      input.end();
      return promise;
    });

    it('sets previously read data as .read on EOFError', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = readTo(input, '\n').then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'EOFError');
          assert.deepEqual(err.read, inputData);
        }
      );
      input.end(inputData);
      return promise;
    });

    it('resolves with null when no data if options.endOK', () => {
      const input = new PassThrough();
      const promise = readTo(input, '\n', {endOK: true}).then((data) => {
        assert.strictEqual(data, null);
      });
      input.end();
      return promise;
    });

    it('resolves with data previously read data if options.endOK', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = readTo(input, '\n', {endOK: true}).then((data) => {
        assert.deepEqual(data, inputData);
      });
      input.end(inputData);
      return promise;
    });

    it('without unshift, sets read data as .read on .abortRead', () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('test');

      const promise = readTo(input, '\n', {cancellable: true});
      input.write(inputData);
      process.nextTick(() => {
        promise.abortRead();
      });
      return promise.then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'AbortError');
          assert.deepEqual(err.read, inputData);
        }
      );
    });

    it('without unshift, returns read data from .cancelRead', (done) => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('test');

      const promise = readTo(input, '\n', {cancellable: true});
      input.write(inputData);
      process.nextTick(() => {
        assert.deepEqual(promise.cancelRead(), inputData);
        done();
      });
    });

    it('without unshift, sets read data as .read on timeout', () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('test');

      const promise = readTo(input, '\n', {timeout: 1});
      input.write(inputData);
      return promise.then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'TimeoutError');
          assert.deepEqual(err.read, inputData);
        }
      );
    });

    if (PassThrough.prototype.unshift) {
      it('with unshift, unshifts read data on .abortRead', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = readTo(input, '\n', {cancellable: true});
        input.write(inputData);
        process.nextTick(() => {
          promise.abortRead();
        });
        return promise.then(
          sinon.mock().never(),
          (err) => {
            assert.strictEqual(err.name, 'AbortError');
            assert.strictEqual(err.read, undefined);
            assert.deepEqual(input.read(), inputData);
          }
        );
      });

      it('with unshift, unshifts read data on .cancelRead', (done) => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = readTo(input, '\n', {cancellable: true});
        input.write(inputData);
        // Wait until data has been read
        process.nextTick(() => {
          promise.cancelRead();
          assert.deepEqual(input.read(), inputData);
          done();
        });
      });

      it('with unshift, unshifts read data on timeout', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');

        const promise = readTo(input, '\n', {timeout: 1});
        input.write(inputData);
        return promise.then(
          sinon.mock().never(),
          (err) => {
            assert.strictEqual(err.name, 'TimeoutError');
            assert.strictEqual(err.read, undefined);
            assert.deepEqual(input.read(), inputData);
          }
        );
      });
    }
  });

  describe('.readToEnd()', () => {
    it('reads to stream end', () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n')
      ];
      const promise = readToEnd(input).then((data) => {
        assert.deepEqual(data, Buffer.concat(inputData));
      });
      writeEachTo(input, inputData, input.end.bind(input));
      return promise;
    });

    it('reads to stream end (encoded)', () => {
      const input = new PassThrough({encoding: 'utf8'});
      const inputData = [
        'Larry\n',
        'Curly\n',
        'Moe\n'
      ];
      const promise = readToEnd(input).then((data) => {
        assert.deepEqual(data, inputData.join(''));
      });
      writeEachTo(input, inputData, input.end.bind(input));
      return promise;
    });

    it('reads to stream end (objectMode)', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = [0, 1, 2, 3, 4];
      const promise = readToEnd(input).then((data) => {
        assert.deepEqual(data, inputData);
      });
      writeEachTo(input, inputData, input.end.bind(input));
      return promise;
    });

    it('resolves with null when no data', () => {
      const input = new PassThrough();
      const promise = readToEnd(input).then((data) => {
        assert.strictEqual(data, null);
      });
      input.end();
      return promise;
    });

    it('rejects with stream error', () => {
      const input = new PassThrough();
      const errTest = new Error('test');
      const promise = readToEnd(input).then(
        sinon.mock().never(),
        (err) => { assert.strictEqual(err, errTest); }
      );
      input.emit('error', errTest);
      return promise;
    });
  });

  describe('.readToMatch()', () => {
    it('reads up to (and including) a RegExp', () => {
      const input = new PassThrough({encoding: 'utf8'});
      const inputData = 'Larry\n';
      const promise = readToMatch(input, /\n/g).then((data) => {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) a non-global RegExp', () => {
      const input = new PassThrough({encoding: 'utf8'});
      const inputData = 'Larry\n';
      const promise = readToMatch(input, /\n/).then((data) => {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) a string expression', () => {
      const input = new PassThrough({encoding: 'utf8'});
      const inputData = 'Larry\n';
      const promise = readToMatch(input, '\n').then((data) => {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('reads up to (and including) a match split across writes', () => {
      const input = new PassThrough({encoding: 'utf8'});
      const inputData = [
        'Larry\n',
        'Cur',
        'ly\n',
        'Moe\n'
      ];
      const promise = readToMatch(input, /Curly\n/g).then((data) => {
        assert.deepEqual(data, inputData.slice(0, 3).join(''));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('optimizes search from options.maxMatchLen', () => {
      const input = new PassThrough({encoding: 'utf8'});
      const inputData = [
        'Larry\n',
        'Cur',
        'ly\n',
        'Moe\n'
      ];
      const regexp = /Curly\n/g;
      const options = {maxMatchLen: 6};
      // Note:  We could spy on writes to .lastIndex of regexp, but this would
      // rely too much on implementation details (of readToMatch and RegExp).
      // Instead, this tests it doesn't hurt and coverage shows the codepath.
      const promise = readToMatch(input, regexp, options).then((data) => {
        assert.deepEqual(data, inputData.slice(0, 3).join(''));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('rejects with SyntaxError for invalid string expressions', () => {
      const input = new PassThrough({encoding: 'utf8'});
      return readToMatch(input, '*').then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'SyntaxError');
        }
      );
    });

    it('rejects with TypeError for non-string streams', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('Larry\n');
      const promise = readToMatch(input, /\n/g).then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
        }
      );
      input.write(inputData);
      return promise;
    });

    it('resolves with null when no data if options.endOK', () => {
      const input = new PassThrough();
      const promise = readToMatch(input, /\n/g, {endOK: true})
        .then((data) => {
          assert.strictEqual(data, null);
        });
      input.end();
      return promise;
    });
  });

  describe('.readUntil()', () => {
    it('continues reading when negative or non-numeric falsey', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = [0, 1, 2, 3, 4];
      let callNum = 0;
      const returnValues = [undefined, null, false, -5, true];
      function until(buffer, chunk) {
        assert(Array.isArray(buffer));
        assert(typeof chunk === 'number');
        callNum += 1;
        return returnValues[callNum - 1];
      }
      const promise = readUntil(input, until).then((data) => {
        assert.deepEqual(data, inputData);
      });
      inputData.forEach((data) => {
        input.write(data);
      });
      return promise;
    });

    it('stops reading on true', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      function until(buffer, chunk) {
        return true;
      }
      const promise = readUntil(input, until).then((data) => {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    it('stops reading if matches length', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      function until(buffer, chunk) {
        return buffer.length;
      }
      const promise = readUntil(input, until).then((data) => {
        assert.deepEqual(data, inputData);
      });
      input.write(inputData);
      return promise;
    });

    if (PassThrough.prototype.unshift) {
      it('stops reading and unshifts if less than length', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return 2;
        }
        const promise = readUntil(input, until).then((data) => {
          assert.deepEqual(data, inputData.slice(0, 2));
        });
        input.write(inputData);
        return promise;
      });

      it('stops reading and unshifts for objectMode stream', () => {
        const input = new PassThrough({objectMode: true});
        const inputData = [0, 1, 2, 3, 4];
        function until(buffer, chunk) {
          return buffer.length === inputData.length - 1 ? 2 : -1;
        }
        const promise = readUntil(input, until).then((data) => {
          assert.deepEqual(data, inputData.slice(0, 2));
        });
        inputData.forEach((data) => {
          input.write(data);
        });
        return promise;
      });

      it('stops reading and unshifts on 0', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return 0;
        }
        const promise = readUntil(input, until).then((data) => {
          assert.deepEqual(data, Buffer.alloc(0));
        });
        input.write(inputData);
        return promise;
      });

      it('can not unshift once ended', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk, ended) {
          return ended ? 2 : -1;
        }
        const promise = readUntil(input, until).then((data) => {
          assert.deepEqual(data, inputData);
        });
        input.end(inputData);
        return promise;
      });
    } else {
      it('stops reading if less than length', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return 2;
        }
        const promise = readUntil(input, until).then((data) => {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });

      it('stops reading on 0', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return 0;
        }
        const promise = readUntil(input, until).then((data) => {
          assert.deepEqual(data, inputData);
        });
        input.write(inputData);
        return promise;
      });
    }

    // This can be useful for data formats where length preceeds data
    it('reads to length greater than current buffer', () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('test1'),
        Buffer.from('test2')
      ];
      function until(buffer, chunk) {
        return inputData[0].length + inputData[1].length;
      }
      const promise = readUntil(input, until).then((data) => {
        assert.deepEqual(data, Buffer.concat(inputData));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    if (PassThrough.prototype.read) {
      it('reads to exact length greater than current buffer', () => {
        const input = new PassThrough();
        input.unshift = undefined;
        const inputData = [
          Buffer.from('test1'),
          Buffer.from('test2')
        ];
        function until(buffer, chunk) {
          return (inputData[0].length + inputData[1].length) - 2;
        }
        const promise = readUntil(input, until).then((data) => {
          assert.deepEqual(data, Buffer.concat(inputData).slice(0, -2));
        });
        writeEachTo(input, inputData);
        return promise;
      });
    }

    it('rejects with TypeError for non-numeric/non-boolean', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      function until(buffer, chunk) {
        return {};
      }
      const promise = readUntil(input, until).then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
        }
      );
      input.write(inputData);
      return promise;
    });

    if (PassThrough.prototype.unshift) {
      it('unshifts on TypeError due to non-numeric/non-boolean', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        function until(buffer, chunk) {
          return {};
        }
        const promise = readUntil(input, until).then(
          sinon.mock().never(),
          (err) => {
            assert.strictEqual(err.name, 'TypeError');
            assert.deepEqual(input.read(), inputData);
          }
        );
        input.write(inputData);
        return promise;
      });
    }

    it('calls the until function on each read', () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n')
      ];
      const spy = sinon.spy((buffer, chunk) => {
        assert(Buffer.isBuffer(buffer));
        assert(Buffer.isBuffer(chunk));
        // Note:  No Buffer.equals before Node v0.11.13
        return String(chunk) === String(inputData[inputData.length - 1]);
      });
      const promise = readUntil(input, spy).then((data) => {
        assert.deepEqual(data, Buffer.concat(inputData));
        assert.strictEqual(spy.callCount, 3);
        spy.getCall(0).calledWithExactly(inputData[0], inputData[0]);
        spy.getCall(1).calledWithExactly(
          Buffer.concat(inputData.slice(0, 2)),
          inputData[1]
        );
        spy.getCall(2).calledWithExactly(
          Buffer.concat(inputData),
          inputData[2]
        );
      });
      writeEachTo(input, inputData);
      return promise;
    });

    // This is a test that the internals for buffer resizing aren't broken
    it('can handle unexpectedly large reads', () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.alloc(512)
      ];
      const bigInputData = Buffer.allocUnsafe(4 * 1024);
      for (let i = 0; i < bigInputData.length; i += 1) {
        bigInputData[i] = i % 256;
      }
      inputData.push(bigInputData);
      // TODO:  Some way to test buffer is a slice of a much larger buffer?
      function untilBig(buffer, chunk) {
        return chunk.length === bigInputData.length;
      }
      const promise = readUntil(input, untilBig).then((data) => {
        assert.deepEqual(data, Buffer.concat(inputData));
      });
      writeEachTo(input, inputData);
      return promise;
    });

    it('treats Buffers as objects if options.objectMode', () => {
      const input = new PassThrough();
      const inputData = [
        Buffer.from('Larry\n'),
        Buffer.from('Curly\n'),
        Buffer.from('Moe\n')
      ];
      function until(buffer) {
        assert(Array.isArray(buffer));
        return buffer.length < 2 ? -1 : 2;
      }
      const promise = readUntil(input, until, {objectMode: true})
        .then((data) => {
          assert.deepEqual(data, inputData.slice(0, 2));
        });
      writeEachTo(input, inputData);
      return promise;
    });

    it('does not combine Arrays in objectMode', () => {
      const input = new PassThrough({objectMode: true});
      const inputData = [['a'], ['b'], []];
      function untilEmpty(arrays) {
        assert(arrays.every(Array.isArray));
        return arrays[arrays.length - 1].length === 0 ? arrays.length : -1;
      }
      const promise = readUntil(input, untilEmpty).then((data) => {
        assert.strictEqual(data.length, inputData.length);
        data.forEach((array, i) => {
          assert.strictEqual(array, inputData[i]);
        });
      });
      inputData.forEach((data) => {
        input.write(data);
      });
      return promise;
    });

    it('rejects with EOFError when no data is read', () => {
      const input = new PassThrough();
      const promise = readUntil(input, untilNever).then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'EOFError');
        }
      );
      input.end();
      return promise;
    });

    it('sets previously read data as .read on EOFError', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const promise = readUntil(input, untilNever).then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'EOFError');
          assert.deepEqual(err.read, inputData);
        }
      );
      input.end(inputData);
      return promise;
    });

    if (stream.Readable && new PassThrough() instanceof stream.Readable) {
      it('rejects with EOFError after end for stream.Readable', (done) => {
        // This only works for proper instances of stream.Readable and is not
        // guaranteed to work (due to use of Readable implementation details).
        const input = new PassThrough();
        input.once('end', () => {
          process.nextTick(() => {
            readUntil(input, untilNever).then(
              sinon.mock().never(),
              (err) => {
                assert.strictEqual(err.name, 'EOFError');
              }
            ).then(done, done);
          });
        });
        input.end();
        // Note:  Must read after .end() for 'end' to be emitted
        input.read();
      });
    }

    it('rejects with an Error thrown by until', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const errTest = new Error('test');
      function untilExcept(buffer) {
        throw errTest;
      }
      const promise = readUntil(input, untilExcept).then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err, errTest);
        }
      );
      input.write(inputData);
      return promise;
    });

    it('rejects with a falsey value thrown by until', () => {
      const input = new PassThrough();
      const inputData = Buffer.from('test');
      const errTest = null;
      function untilExcept(buffer) {
        throw errTest;
      }
      const promise = readUntil(input, untilExcept).then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err, errTest);
        }
      );
      input.write(inputData);
      return promise;
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
              assert.deepEqual(input.read(), inputData2);
              done();
            });
          }
        );
        input.write(inputData);
      });
    }

    it('without unshift, sets read data as .read on exception', () => {
      const input = new PassThrough();
      input.unshift = undefined;
      const inputData = Buffer.from('test');
      const errTest = new Error('test');
      function untilExcept(buffer) {
        throw errTest;
      }
      const promise = readUntil(input, untilExcept);
      input.write(inputData);
      return promise.then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err, errTest);
          assert.deepEqual(err.read, inputData);
        }
      );
    });

    if (PassThrough.prototype.unshift) {
      it('with unshift, unshifts read data on exception', () => {
        const input = new PassThrough();
        const inputData = Buffer.from('test');
        const errTest = new Error('test');
        function untilExcept(buffer) {
          throw errTest;
        }
        const promise = readUntil(input, untilExcept);
        input.write(inputData);
        return promise.then(
          sinon.mock().never(),
          (err) => {
            assert.strictEqual(err, errTest);
            assert.strictEqual(err.read, undefined);
            assert.deepEqual(input.read(), inputData);
          }
        );
      });
    }

    it('rejects with TypeError for non-function until', () => {
      const input = new PassThrough();
      const promise = readUntil(input, true).then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
        }
      );
      return promise;
    });

    // This can be an issue with synchronous promises.
    it('does not cause unhandledRejection for non-function', (done) => {
      const input = new PassThrough();
      const immID = setImmediate(done);
      process.once('unhandledRejection', () => {
        clearImmediate(immID);
        done(new Error('unhandledRejection'));
      });
      readUntil(input, true).then(
        sinon.mock().never(),
        (err) => {
          assert.strictEqual(err.name, 'TypeError');
        }
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
