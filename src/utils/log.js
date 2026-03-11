// src/utils/log.js

const PREFIX = '[EchoBat]';

/**
 * Emits debug-level logs only when the global __ECHO_BAT_DEBUG__ flag is truthy.
 * In production this is a no-op so the console stays clean.
 * @param {...any} args - The messages to log.
 */
export function log(...args) {
  const debugEnabled = Boolean(globalThis.__ECHO_BAT_DEBUG__);
  if (!debugEnabled) {
    return;
  }
  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug(PREFIX, ...args);
  }
}
