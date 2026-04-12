// background.js — EtchSpy Service Worker (Manifest V3)
'use strict';

// ─── Replace with your actual Gumroad product URL ───────────────────────────
const GUMROAD_URL = 'https://medbadria.gumroad.com/l/fkmhmq';
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case 'OPEN_GUMROAD':
      chrome.tabs.create({ url: GUMROAD_URL });
      sendResponse({ success: true });
      break;

    // Generic safe URL opener (https only) used by content scripts
    case 'OPEN_URL':
      if (message.url && message.url.startsWith('https://')) {
        chrome.tabs.create({ url: message.url });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Invalid URL' });
      }
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }

  // Return true to keep the message channel open for async sendResponse calls
  return true;
});

// Track the most recently fully-loaded Etsy tab so the popup knows where to
// send GET_PAGE_RESULTS messages without having to query tabs itself.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (/etsy\.com(\/[a-z]{2}(-[a-z]{2,4})?)?\/(?:search|listing)/i.test(tab.url)) {
      chrome.storage.local.set({
        last_etsy_tab_id: tabId,
        last_etsy_tab_url: tab.url,
      });
    }
  }
});
