// src/background/telemetry.js

import { log } from '../utils/log.js';
import { getOrCreateUserId } from '../utils/user.js';
import { TELEMETRY_ENDPOINT } from '../utils/constants.js';

export const EventNames = {
  EmBatchView: 'em_batch_view',
  StartClick: 'em_start_click',
  StartSuccess: 'em_start_success',
};

const TELEMETRY_STORAGE_KEY = 'em_telemetry_buffer';
const MAX_BUFFERED_EVENTS = 40;

/**
 * Creates a compact view of the sender to help debug event origins.
 * @param {chrome.runtime.MessageSender} sender
 * @returns {{tabId?: number, frameId?: number, url?: string, serviceWorker?: boolean}|null}
 */
function buildSenderContext(sender) {
  if (!sender) {
    return null;
  }
  const context = {};
  if (typeof sender.tab?.id === 'number') {
    context.tabId = sender.tab.id;
  }
  if (typeof sender.frameId === 'number') {
    context.frameId = sender.frameId;
  }
  if (sender.url) {
    context.url = sender.url;
  }
  if (sender.id && sender.id === chrome.runtime.id && !sender.tab) {
    context.serviceWorker = true;
  }
  return Object.keys(context).length ? context : null;
}

/**
 * Persists a bounded queue of recent telemetry events for offline review.
 */
async function persistEvent(event) {
  try {
    const existing = await chrome.storage.local.get([TELEMETRY_STORAGE_KEY]);
    const buffer = Array.isArray(existing?.[TELEMETRY_STORAGE_KEY])
      ? existing[TELEMETRY_STORAGE_KEY]
      : [];
    buffer.push(event);
    while (buffer.length > MAX_BUFFERED_EVENTS) {
      buffer.shift();
    }
    await chrome.storage.local.set({ [TELEMETRY_STORAGE_KEY]: buffer });
  } catch (error) {
    log('Failed to persist telemetry event buffer:', error);
  }
}

/**
 * Sends the event to an optional remote endpoint for aggregation.
 * The endpoint is configurable; by default events are only buffered locally.
 */
async function dispatchToEndpoint(event) {
  if (!TELEMETRY_ENDPOINT) {
    return false;
  }

  try {
    const response = await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
      keepalive: true,
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return true;
  } catch (error) {
    log('Failed to dispatch telemetry event to remote endpoint:', error);
    return false;
  }
}

/**
 * Records a telemetry event with the shared user id.
 * @param {string} name
 * @param {Record<string, any>} [payload]
 * @param {{ sender?: chrome.runtime.MessageSender, context?: Record<string, any> }} [options]
 */
export async function recordTelemetryEvent(name, payload = {}, options = {}) {
  if (!name) {
    return;
  }
  try {
    const emUserId = await getOrCreateUserId();
    const eventPayload = {
      ...(payload || {}),
    };

    if (emUserId && eventPayload.em_user_id == null) {
      eventPayload.em_user_id = emUserId;
    }

    const event = {
      name,
      em_user_id: emUserId,
      timestamp: new Date().toISOString(),
      payload: eventPayload,
      context: options.context || buildSenderContext(options.sender) || null,
    };

    await persistEvent(event);
    const dispatched = await dispatchToEndpoint(event);
    log('Telemetry event recorded.', {
      name,
      dispatched,
      payloadKeys: Object.keys(payload || {}),
    });
  } catch (error) {
    log('Failed to record telemetry event:', error);
  }
}

/**
 * Ensures a persistent user identifier exists for telemetry usage.
 */
export function ensureTelemetryUserId() {
  return getOrCreateUserId();
}

export function setupTelemetryListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'trackTelemetryEvent' && message.event?.name) {
      (async () => {
        await recordTelemetryEvent(message.event.name, message.event.payload || {}, {
          sender,
          context: message.event.context,
        });
        sendResponse({ success: true });
      })();
      return true;
    }

    if (message?.action === 'getTelemetryUserId') {
      (async () => {
        const emUserId = await getOrCreateUserId();
        sendResponse({ success: true, em_user_id: emUserId });
      })();
      return true;
    }

    return undefined;
  });
}
