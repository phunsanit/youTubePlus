// Background service worker
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

chrome.runtime.onInstalled.addListener(() => {
  console.log('YouTubePlus Extension Installed');
});

// Configure OAuth for Firefox
async function getFirefoxAuthToken(interactive) {
  try {
    const response = await fetch(browserAPI.runtime.getURL('config.json'));
    const config = await response.json();
    const clientId = config?.client_id;

    if (!clientId) throw new Error('Client ID missing');

    const redirectUrl = browserAPI.identity.getRedirectURL();
    const scopes = 'https://www.googleapis.com/auth/youtube.force-ssl';

    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&scope=${encodeURIComponent(scopes)}`;

    const responseUrl = await browserAPI.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: interactive
    });

    const url = new URL(responseUrl);
    const params = new URLSearchParams(url.hash.substring(1));
    const token = params.get('access_token');

    if (token) {
      await browserAPI.storage.local.set({ oauth_token: token });
      return token;
    } else {
      throw new Error('No token found');
    }
  } catch (e) {
    console.error('Background Auth Error:', e);
    throw e;
  }
}

// Message handler
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'login') {
    getFirefoxAuthToken(request.interactive)
      .then(token => sendResponse({ success: true, token: token }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
});
