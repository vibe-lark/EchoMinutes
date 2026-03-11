// src/content/analytics.js

(function () {
  const APP_ID = 583138;
  const CHANNEL = 'cn';
  const TEA_MODULE_PATH = 'vendor/byted-tea-sdk/index.min.js';
  const DEBUG_ENABLED = Boolean(globalThis.__ECHO_BAT_DEBUG__);

  let teaModule = null;
  let initPromise = null;
  let teaReady = false;
  let currentUserId = null;
  const pendingEvents = [];

  const debugLog = (...args) => {
    if (!DEBUG_ENABLED || typeof console === 'undefined' || typeof console.debug !== 'function') {
      return;
    }
    console.debug('[EchoBat Analytics]', ...args);
  };

  function flushPendingEvents() {
    if (!teaReady || !teaModule) {
      return;
    }
    while (pendingEvents.length) {
      const { name, payload } = pendingEvents.shift();
      dispatchEventToTea(name, payload);
    }
  }

  function dispatchEventToTea(name, payload = {}) {
    if (!teaReady || !teaModule) {
      pendingEvents.push({ name, payload });
      return;
    }
    if (!name) {
      return;
    }
    const finalPayload = { ...(payload || {}) };
    if (currentUserId && finalPayload.em_user_id == null) {
      finalPayload.em_user_id = currentUserId;
    }
    try {
      teaModule.event(name, finalPayload);
      debugLog('Tea event sent:', name, finalPayload);
    } catch (error) {
      debugLog('Failed to send Tea event:', error);
    }
  }

  function ensureEchoBatAnalyticsStub() {
    const analytics = window.EchoBatAnalytics || {};
    analytics.trackEvent = (name, payload = {}) => {
      if (!name) {
        return;
      }
      dispatchEventToTea(name, payload);
      ensureInitialized();
    };
    analytics.getUserId = () => currentUserId;
    window.EchoBatAnalytics = analytics;
  }

  function requestUserId() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'getTelemetryUserId' }, (response) => {
          if (chrome.runtime.lastError) {
            debugLog('getTelemetryUserId failed:', chrome.runtime.lastError);
            resolve(null);
            return;
          }
          if (response && response.success && response.em_user_id) {
            resolve(response.em_user_id);
          } else {
            resolve(null);
          }
        });
      } catch (error) {
        debugLog('getTelemetryUserId threw:', error);
        resolve(null);
      }
    });
  }

  async function loadTeaModule() {
    if (teaModule) {
      return teaModule;
    }
    const moduleUrl = chrome.runtime.getURL(TEA_MODULE_PATH);
    const module = await import(moduleUrl);
    teaModule = module?.default || module;
    return teaModule;
  }

  async function ensureInitialized() {
    if (teaReady) {
      return true;
    }
    if (initPromise) {
      return initPromise;
    }
    initPromise = (async () => {
      try {
        const Tea = await loadTeaModule();
        const userId = await requestUserId();
        currentUserId = userId || null;
        Tea.init({
          app_id: APP_ID,
          channel: CHANNEL,
          log: DEBUG_ENABLED,
          autotrack: false,
          enable_stay_duration: false,
          enable_tracer: false,
          enable_ab_test: false,
          enable_multilink: false,
          enable_ab_visual: false,
          enable_spa: false,
          disable_route_report: true,
          disable_auto_pv: true,
          disable_track_event: false,
          enable_debug: DEBUG_ENABLED,
        });
        if (currentUserId) {
          Tea.config({
            user_unique_id: currentUserId,
            em_user_id: currentUserId,
          });
        }
        Tea.start();
        teaModule = Tea;
        teaReady = true;
        debugLog('Tea SDK initialized.');
        flushPendingEvents();
        window.dispatchEvent(new CustomEvent('EchoBatAnalyticsReady'));
        return true;
      } catch (error) {
        debugLog('Tea SDK initialization failed:', error);
        teaReady = false;
        throw error;
      } finally {
        initPromise = null;
      }
    })();
    return initPromise;
  }

  ensureEchoBatAnalyticsStub();
  ensureInitialized();

})();
