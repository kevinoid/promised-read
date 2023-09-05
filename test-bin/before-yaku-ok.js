/** Checks that loading promised-read before yaku has proper sync/async.
 *
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

const { EventEmitter } = require('node:events');
const yaku = require('yaku');

// https://github.com/import-js/eslint-plugin-import/issues/2844
// eslint-disable-next-line import/extensions
const { read } = require('..');

/* eslint-disable no-console */

// eslint-disable-next-line no-restricted-properties
if (yaku.nextTick !== process.nextTick) {
  console.error('yaku.nextTick !== process.nextTick');
  process.exitCode = 1;
}
if (read(new EventEmitter()).constructor.nextTick.name !== 'thisTick') {
  console.error('read().constructor.nextTick.name !== \'thisTick\'');
  process.exitCode = 1;
}
