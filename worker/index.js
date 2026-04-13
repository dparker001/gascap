// Merge OneSignal's service worker so it shares the root scope
// with next-pwa's Workbox SW. OneSignal handles push event rendering.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
