document.addEventListener('DOMContentLoaded', async () => {
    const tabList = document.getElementById('tab-list');
    const addAllBtn = document.getElementById('add-all-btn');

    let detectedVideos = [];
    let cachedToken = null;
    let myWatchLaterPlaylistId = null;
    const PLAYLIST_NAME = 'My Watch Later';

    // Cross-browser API compatibility
    const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

    // Detect browser type
    const isFirefox = typeof browser !== 'undefined' && navigator.userAgent.includes('Firefox');
    const isChrome = !isFirefox;

    // Load config for Firefox
    let config = null;
    try {
        const response = await fetch(browserAPI.runtime.getURL('config.json'));
        config = await response.json();
    } catch (e) {
        console.log('Config load skipped (Chrome uses manifest)');
    }

    // Show redirect URL for Firefox
    if (isFirefox && typeof browser !== 'undefined' && browser.identity) {
        const debugInfo = document.getElementById('debug-info');
        const redirectUrl = browser.identity.getRedirectURL();
        debugInfo.innerHTML = `
      <strong>📋 Redirect URL:</strong><br>
      <code style="word-break:break-all;user-select:all;">${redirectUrl}</code>
    `;
    }

    // Load token from storage on startup
    browserAPI.storage.local.get(['oauth_token'], (result) => {
        if (result.oauth_token) {
            cachedToken = result.oauth_token;
        }
    });

    // Function to extract video ID from URL
    function getVideoId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    // Find Open YouTube Tabs
    browserAPI.tabs.query({ url: "*://*.youtube.com/watch*" }, (tabs) => {
        tabList.innerHTML = '';
        detectedVideos = [];

        if (tabs.length === 0) {
            tabList.innerHTML = '<div class="loading">No YouTube videos found.</div>';
            return;
        }

        tabs.forEach(tab => {
            const videoId = getVideoId(tab.url);
            if (videoId) {
                detectedVideos.push({
                    id: videoId,
                    title: tab.title.replace(' - YouTube', ''),
                    tabId: tab.id
                });
            }
        });

        renderVideos();
        updateButtons();
    });

    function renderVideos() {
        detectedVideos.forEach(video => {
            const card = document.createElement('div');
            card.className = 'video-card';
            card.dataset.tabId = video.tabId;
            // Use i.ytimg.com and default.jpg for maximum compatibility
            card.innerHTML = `
        // Use hqdefault which is generally available and better quality
        <img class="video-thumb" src="https://i.ytimg.com/vi/${video.id}/hqdefault.jpg" alt="Thumbnail">
        <div class="video-info">
          <div class="video-title" title="${video.title}">${video.title}</div>
          <div class="video-channel">Detected</div>
        </div>
        <button class="add-btn" data-id="${video.id}" data-tab-id="${video.tabId}" title="Save & Close">+</button>
      `;
            tabList.appendChild(card);

            // CSP-compliant error handler with multiple fallbacks
            const img = card.querySelector('.video-thumb');
            img.addEventListener('error', (e) => {
                // Try hqdefault if mqdefault fails, then fallback to icon
                if (e.target.src.includes('mqdefault.jpg')) {
                    e.target.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
                } else if (e.target.src.includes('hqdefault.jpg')) {
                    e.target.src = '../assets/icon48.png';
                } else {
                    e.target.src = '../assets/icon48.png';
                }
            });

            card.querySelector('.add-btn').addEventListener('click', async (e) => {
                const result = await addToMyWatchLater(video.id, e.target);
                if (result) {
                    browserAPI.tabs.remove(video.tabId);
                    card.remove();
                    detectedVideos = detectedVideos.filter(v => v.tabId !== video.tabId);
                    updateButtons();
                }
            });
        });
    }

    function updateButtons() {
        if (detectedVideos.length > 0) {
            addAllBtn.removeAttribute('disabled');
            addAllBtn.classList.add('active');
        } else {
            addAllBtn.setAttribute('disabled', 'true');
            addAllBtn.classList.remove('active');
        }
    }

    // =====================
    // OAuth & API Functions
    // =====================

    function getAuthTokenChrome(interactive) {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: interactive }, (token) => {
                if (chrome.runtime.lastError || !token) {
                    reject(chrome.runtime.lastError || new Error('No token'));
                } else {
                    cachedToken = token;
                    resolve(token);
                }
            });
        });
    }

    function getAuthTokenFirefox(interactive) {
        return new Promise((resolve, reject) => {
            // Always use cached if available and not forcing interactive
            if (cachedToken && !interactive) {
                resolve(cachedToken);
                return;
            }

            const clientId = config?.client_id;
            if (!clientId || clientId.includes('YOUR_CLIENT_ID')) {
                reject(new Error('Configure client_id in config.json'));
                return;
            }

            // Use native API
            const redirectUrl = browser.identity.getRedirectURL();
            const scopes = 'https://www.googleapis.com/auth/youtube.force-ssl';

            console.log('Firefox OAuth Debug:');
            console.log('- Client ID:', clientId);
            console.log('- Redirect URL:', redirectUrl);

            const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
                `?client_id=${encodeURIComponent(clientId)}` +
                `&response_type=token` +
                `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
                `&scope=${encodeURIComponent(scopes)}`;

            console.log('- Launching Auth URL:', authUrl);

            browser.identity.launchWebAuthFlow({
                url: authUrl,
                interactive: interactive
            }).then(responseUrl => {
                const url = new URL(responseUrl);
                const params = new URLSearchParams(url.hash.substring(1));
                const token = params.get('access_token');
                if (token) {
                    cachedToken = token;
                    // Persist token
                    browserAPI.storage.local.set({ oauth_token: token });
                    resolve(token);
                } else {
                    reject(new Error('No token in response'));
                }
            }).catch(err => {
                // Only log error if it was an interactive attempt or if it's a different kind of error
                if (interactive) {
                    console.error('Firefox OAuth error:', err);
                } else {
                    console.log('Silent auth failed, fallback to interactive needed.');
                }
                reject(err);
            });
        });
    }

    function getAuthToken(interactive) {
        return isChrome ? getAuthTokenChrome(interactive) : getAuthTokenFirefox(interactive);
    }

    // Get or create "My Watch Later" playlist
    async function getOrCreatePlaylist(token) {
        if (myWatchLaterPlaylistId) return myWatchLaterPlaylistId;

        // First, try to find existing playlist
        const listResponse = await fetch(
            'https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50',
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (listResponse.ok) {
            const data = await listResponse.json();
            const existing = data.items?.find(p => p.snippet.title === PLAYLIST_NAME);
            if (existing) {
                myWatchLaterPlaylistId = existing.id;
                return myWatchLaterPlaylistId;
            }
        }

        // Create new playlist
        const createResponse = await fetch(
            'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    snippet: {
                        title: PLAYLIST_NAME,
                        description: 'Videos saved by YouTubePlus extension'
                    },
                    status: {
                        privacyStatus: 'private'
                    }
                })
            }
        );

        if (createResponse.ok) {
            const data = await createResponse.json();
            myWatchLaterPlaylistId = data.id;
            return myWatchLaterPlaylistId;
        }

        throw new Error('Failed to create playlist');
    }

    // Add video to playlist
    async function addToMyWatchLater(videoId, btnElement) {
        try {
            btnElement.textContent = '...';
            console.log(`Adding video ${videoId} to playlist...`);

            let token;

            // OPTIMIZATION: Check if we already have a token in memory
            // If we don't, go STRAIGHT to interactive mode to preserve the User Gesture (click).
            // Attempting silent auth first (which involves a network call) can expire the user gesture
            // causing Firefox to block the subsequent interactive popup.
            if (cachedToken) {
                try {
                    console.log('Using cached token:', cachedToken);
                    token = cachedToken;
                    // Validate it quickly or assume valid? 
                    // Let's try to use it. If 401, we'll handle it.
                } catch (e) {
                    token = await getAuthToken(true);
                }
            } else {
                console.log('No cached token, forcing interactive auth to preserve user gesture');
                token = await getAuthToken(true);
                console.log('Token obtained (interactive)');
            }

            const playlistId = await getOrCreatePlaylist(token);
            console.log('Target Playlist ID:', playlistId);

            const payload = {
                snippet: {
                    playlistId: playlistId,
                    resourceId: {
                        kind: 'youtube#video',
                        videoId: videoId
                    }
                }
            };
            console.log('Sending payload:', JSON.stringify(payload));

            const response = await fetch(
                'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                }
            );

            console.log('API Response Status:', response.status);

            if (response.ok) {
                const data = await response.json();
                console.log('Success:', data);
                btnElement.textContent = '✓';
                btnElement.style.color = '#00ff00';
                btnElement.disabled = true;
                return true;
            } else {
                const error = await response.json();
                console.error('API Error Details:', error);
                console.error('Error Message:', error.error?.message);

                // If token invalid, clear cache
                if (response.status === 401) {
                    console.log('Token expired/invalid (401). Clearing cache.');
                    cachedToken = null;
                    browserAPI.storage.local.remove('oauth_token');
                    if (isChrome) chrome.identity.removeCachedAuthToken({ token });

                    // Optional: could retry once here, but maybe too complex for now
                }

                btnElement.textContent = '!';
                btnElement.title = error.error?.message || 'Error ' + response.status;
                return false;
            }
        } catch (err) {
            console.error('Exception in addToMyWatchLater:', err);
            btnElement.textContent = '!';
            btnElement.title = err.message;
            return false;
        }
    }

    // Save All button handler
    addAllBtn.addEventListener('click', async () => {
        addAllBtn.textContent = 'Saving...';
        let successCount = 0;
        let failCount = 0;

        const videosToProcess = [...detectedVideos];

        for (const video of videosToProcess) {
            const btn = document.querySelector(`button[data-tab-id="${video.tabId}"]`);
            const card = document.querySelector(`.video-card[data-tab-id="${video.tabId}"]`);

            if (btn && !btn.disabled) {
                const success = await addToMyWatchLater(video.id, btn);
                if (success) {
                    successCount++;
                    browserAPI.tabs.remove(video.tabId);
                    if (card) card.remove();
                    detectedVideos = detectedVideos.filter(v => v.tabId !== video.tabId);
                } else {
                    failCount++;
                }
                addAllBtn.textContent = `Saving... (${successCount}/${videosToProcess.length})`;
            }
        }

        if (failCount > 0) {
            addAllBtn.textContent = `Done: ${successCount} saved, ${failCount} failed`;
        } else {
            addAllBtn.textContent = `Done: ${successCount} saved & closed`;
        }

        setTimeout(() => {
            if (detectedVideos.length > 0) {
                addAllBtn.textContent = 'Save All to Watch Later';
            } else {
                addAllBtn.textContent = 'All done!';
                addAllBtn.disabled = true;
                addAllBtn.classList.remove('active');
            }
        }, 2000);
    });
});
