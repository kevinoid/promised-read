/**
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

// Import a synchronous version of Yaku which can be used for flowing streams
// (to avoid missing events, as discussed in README.md) without converting all
// instances of yaku to synchronous (in case other modules are using it).
const yakuPath = require.resolve('yaku');
const yakuCached = require.cache[yakuPath];
delete require.cache[yakuPath];

const yakuSync = require('yaku');

yakuSync.nextTick = function thisTick(fn) { fn(); };

if (yakuCached) {
  require.cache[yakuPath] = yakuCached;
} else {
  delete require.cache[yakuPath];
}

module.exports = yakuSync;
