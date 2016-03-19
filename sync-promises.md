Synchronous Promise Libraries
=============================

In order to avoid missing `'data'` events from flowing streams, the
`onFulfilled` (i.e. `.then` function) must be called immediately, so that the
next read (or another `'data'` listener) can be added before the next `'data'`
event, which may occur immediately after the event which resolved the promise
finishes emitting.

Unfortunately, this conflicts with [Promises/A+](https://promisesaplus.com/)
spec (although not the original
[Promises/A](http://wiki.commonjs.org/wiki/Promises/A) for which [async was
encouraged](https://github.com/domenic/promise-tests#always-async) but not
mandatory).

For this reason, finding Promise libraries which support synchronous operation
is difficult.  This document lists suitable libraries with information for
choosing which one to use as a default:

## [broody-promises](https://github.com/gobwas/broody-promises)

[![NPM](https://nodei.co/npm/broody-promises.png?downloads=true&downloadRank=true&stars=true)](https://www.npmjs.com/package/broody-promises/)

* Can only be used synchronously inside `Promise.sync` function (or after
  calling the undocumented `Promise.enter`).

## [D.js](https://github.com/malko/D.js)

[![NPM](https://nodei.co/npm/d.js.png?downloads=true&downloadRank=true&stars=true)](https://www.npmjs.com/package/d.js/)

* Can operate synchronously if
  [`D.alwaysAsync = false`](https://github.com/malko/D.js#dalwaysasync--true)
  (or deferred is created by `defer(false)`).
* Doesn't follow ES6 spec (No `Promise.race`, `Promise.rejected` instead of
  `Promise.reject`, `Promise.resolved` instead of `Promise.resolve`, promises
  are not instances of `Promise` class).

## [sync-promise](https://github.com/paldepind/sync-promise)

[![NPM](https://nodei.co/npm/sync-promise.png?downloads=true&downloadRank=true&stars=true)](https://www.npmjs.com/package/sync-promise/)

* Doesn't allow chaining from synchronously-resolved promises
* Throws if promise doesn't have any onRejected callbacks when rejected.
* Has a non-conformant `.then` method, which doesn't accept a second argument.
* Doesn't support `Promise.race`, `Promise.resolve`, or `Promise.reject`.

## [Yaku](https://github.com/ysmood/yaku)

[![NPM](https://nodei.co/npm/yaku.png?downloads=true&downloadRank=true&stars=true)](https://www.npmjs.com/package/yaku/)

* Operates synchronously if
  [`Yaku.nextTick`](https://github.com/ysmood/yaku#user-content-yakunexttick)
  is set to a synchronous function.
