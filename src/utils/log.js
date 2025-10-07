// src/utils/log.js

/**
 * Logs messages to the console with a consistent prefix.
 * @param {...any} args - The messages to log.
 */
export function log(...args) {
  console.log('[EchoBat]', ...args);
}