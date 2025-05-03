// Keep the extension alive with a service worker
chrome.runtime.onInstalled.addListener(() => {
    console.log('YouTube Music Discord Rich Presence extension installed');
  });
  
  // For debugging
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message:', message);
    sendResponse({ status: 'received' });
  });