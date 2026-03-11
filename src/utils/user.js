// src/utils/user.js

import { v4 } from './uuid.js';
import { log } from './log.js';

const USER_ID_KEY = 'em_user_id';
const USER_ID_PREFIX = 'em_';

let cachedUserId = null;
let initializationPromise = null;

/**
 * Attempts to load the stored user id from the provided storage area.
 * @param {'sync'|'local'} area
 * @returns {Promise<string|null>}
 */
async function loadFromArea(area) {
  try {
    const storageArea = chrome.storage?.[area];
    if (!storageArea || typeof storageArea.get !== 'function') {
      return null;
    }
    const result = await storageArea.get([USER_ID_KEY]);
    const stored = result?.[USER_ID_KEY];
    if (stored && typeof stored === 'string') {
      return stored;
    }
  } catch (error) {
    log(`Failed to read user id from chrome.storage.${area}:`, error);
  }
  return null;
}

/**
 * Persists the user id in the provided storage area.
 * @param {'sync'|'local'} area
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function saveToArea(area, userId) {
  try {
    const storageArea = chrome.storage?.[area];
    if (!storageArea || typeof storageArea.set !== 'function') {
      return false;
    }
    await storageArea.set({ [USER_ID_KEY]: userId });
    return true;
  } catch (error) {
    log(`Failed to persist user id to chrome.storage.${area}:`, error);
    return false;
  }
}

/**
 * Generates a new stable user identifier for telemetry.
 * @returns {string}
 */
function createUserId() {
  // Remove dashes to keep the identifier compact while remaining unique.
  const rawUuid = v4().replace(/-/g, '');
  return `${USER_ID_PREFIX}${rawUuid}`;
}

async function resolveUserId() {
  // Prefer chrome.storage.sync so the identifier follows the browser profile.
  const syncId = await loadFromArea('sync');
  if (syncId) {
    cachedUserId = syncId;
    return syncId;
  }

  const localId = await loadFromArea('local');
  if (localId) {
    cachedUserId = localId;
    // Attempt to backfill sync storage when available.
    await saveToArea('sync', localId);
    return localId;
  }

  const generated = createUserId();
  // Best effort persistence: try sync first, then fall back to local.
  const savedToSync = await saveToArea('sync', generated);
  if (!savedToSync) {
    await saveToArea('local', generated);
  }
  cachedUserId = generated;
  return generated;
}

/**
 * Returns the cached user id or creates one if none exists.
 * @returns {Promise<string>}
 */
export async function getOrCreateUserId() {
  if (cachedUserId) {
    return cachedUserId;
  }
  if (!initializationPromise) {
    initializationPromise = resolveUserId().catch(error => {
      log('Failed to initialize telemetry user id:', error);
      cachedUserId = createUserId();
      return cachedUserId;
    });
  }
  return initializationPromise;
}

/**
 * Exposes the cached user id without triggering creation.
 * @returns {string|null}
 */
export function getCachedUserId() {
  return cachedUserId;
}
