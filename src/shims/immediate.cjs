/**
 * DOM-free immediate shim for lie / JSZip.
 * Replaces immediate@3 (which may createElement('script') as a legacy fallback).
 */
'use strict';

function schedule(fn) {
	if (typeof queueMicrotask === 'function') {
		queueMicrotask(fn);
		return;
	}
	if (typeof MessageChannel === 'function') {
		var ch = new MessageChannel();
		ch.port1.onmessage = fn;
		ch.port2.postMessage(0);
		return;
	}
	setTimeout(fn, 0);
}

var draining = false;
var queue = [];

function drainQueue() {
	draining = true;
	var i, task;
	while (queue.length) {
		task = queue;
		queue = [];
		for (i = 0; i < task.length; i++) {
			task[i]();
		}
	}
	draining = false;
}

module.exports = function immediate(task) {
	if (queue.push(task) === 1 && !draining) {
		schedule(drainQueue);
	}
};
