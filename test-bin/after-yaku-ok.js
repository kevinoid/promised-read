#!/usr/bin/env node
/** Checks that loading promised-read after yaku has proper sync/async.
 *
 * @copyright Copyright 2016 Kevin Locke <kevin@kevinlocke.name>
 * @license MIT
 */

'use strict';

var EventEmitter = require('events').EventEmitter;
var yaku = require('yaku');
var read = require('..').read;

/* eslint-disable no-console */

var exitCode = 0;
if (yaku.nextTick !== process.nextTick) {
  console.error('yaku.nextTick !== process.nextTick');
  exitCode = 1;
}
if (read(new EventEmitter()).constructor.nextTick.name !== 'thisTick') {
  console.error('read().constructor.nextTick.name !== \'thisTick\'');
  exitCode = 1;
}
// eslint-disable-next-line no-process-exit
process.exit(exitCode);
