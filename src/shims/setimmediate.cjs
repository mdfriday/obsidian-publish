/**
 * DOM-free setimmediate shim for Obsidian / Electron.
 * Replaces YuzuJS setimmediate (which may createElement('script') as a legacy fallback).
 * Side-effect module: polyfills globalThis.setImmediate like the real package.
 */
(function (global) {
	'use strict';
	if (typeof global.setImmediate === 'function') {
		return;
	}

	function schedule(fn, args) {
		if (typeof global.queueMicrotask === 'function') {
			global.queueMicrotask(function () {
				fn.apply(null, args);
			});
			return;
		}
		if (typeof global.MessageChannel === 'function') {
			var ch = new global.MessageChannel();
			ch.port1.onmessage = function () {
				fn.apply(null, args);
			};
			ch.port2.postMessage(0);
			return;
		}
		global.setTimeout(function () {
			fn.apply(null, args);
		}, 0);
	}

	var nextHandle = 1;
	var tasks = Object.create(null);

	global.setImmediate = function (callback) {
		var args = Array.prototype.slice.call(arguments, 1);
		var handle = nextHandle++;
		tasks[handle] = true;
		schedule(function () {
			if (!tasks[handle]) return;
			delete tasks[handle];
			if (typeof callback === 'function') {
				callback.apply(null, args);
			}
		}, []);
		return handle;
	};

	global.clearImmediate = function (handle) {
		delete tasks[handle];
	};
})(
	typeof globalThis !== 'undefined'
		? globalThis
		: typeof window !== 'undefined'
			? window
			: typeof self !== 'undefined'
				? self
				: this
);

module.exports = {};
