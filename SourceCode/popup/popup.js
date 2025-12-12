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

    // Show redirect URL for Firefox - REMOVED for production
    if (isFirefox && typeof browser !== 'undefined' && browser.identity) {
        /* Debug info hidden for production
        const debugInfo = document.getElementById('debug-info');
        if (debugInfo) debugInfo.style.display = 'none';
        */
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
                    // Remove tab and card
                    try {
                        await browserAPI.tabs.remove(video.tabId);
                    } catch (e) {
                        console.log('Tab already closed:', video.tabId);
                    }
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

            // Delegate to background script
            if (interactive) {
                // Fire and forget - NO callback to prevent "Actor 'Conduits' destroyed" error
                browserAPI.runtime.sendMessage({
                    action: 'login',
                    interactive: true
                });
                reject(new Error('Authentication started. Please sign in via the new window, then click "+" again.'));
            } else {
                // Silent check - wait for callback
                browserAPI.runtime.sendMessage({
                    action: 'login',
                    interactive: false
                }, (response) => {
                    if (browserAPI.runtime.lastError) {
                        reject(new Error(browserAPI.runtime.lastError.message));
                        return;
                    }
                    if (response && response.success) {
                        cachedToken = response.token;
                        resolve(response.token);
                    } else {
                        reject(new Error(response?.error || 'Silent auth failed'));
                    }
                });
            }
        });
    }

    function getAuthToken(interactive) {
        return isChrome ? getAuthTokenChrome(interactive) : getAuthTokenFirefox(interactive);
    }

    // Get the latest "My Watch Later" playlist (supporting N+1)
    async function getLatestPlaylist(token) {
        if (myWatchLaterPlaylistId) return myWatchLaterPlaylistId;

        // Fetch ALL playlists to find the latest "My Watch Later X"
        // ADDED: contentDetails to check itemCount
        let allPlaylists = [];
        let nextPageToken = '';

        try {
            do {
                const listUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50&pageToken=${nextPageToken}`;
                const response = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${token}` } });

                if (response.ok) {
                    const data = await response.json();
                    if (data.items) allPlaylists.push(...data.items);
                    nextPageToken = data.nextPageToken || '';
                } else {
                    break;
                }
            } while (nextPageToken);
        } catch (e) {
            console.error('Error fetching playlists:', e);
        }

        // Filter for our playlists
        const ourPlaylists = allPlaylists.filter(p => p.snippet.title.startsWith(PLAYLIST_NAME));

        if (ourPlaylists.length > 0) {
            // Sort by numerical suffix: "My Watch Later", "My Watch Later 2", ...
            ourPlaylists.sort((a, b) => {
                const numA = parseInt(a.snippet.title.replace(PLAYLIST_NAME, '').trim()) || 1;
                const numB = parseInt(b.snippet.title.replace(PLAYLIST_NAME, '').trim()) || 1;
                return numB - numA; // Descending
            });

            const latest = ourPlaylists[0];

            // CHECK ITEM COUNT >= 200
            if (latest.contentDetails.itemCount >= 200) {
                console.log(`Playlist "${latest.snippet.title}" is full (${latest.contentDetails.itemCount} items). Creating next...`);

                const currentNum = parseInt(latest.snippet.title.replace(PLAYLIST_NAME, '').trim()) || 1;
                const nextName = `${PLAYLIST_NAME} ${currentNum + 1}`;

                // Recursively check if next one exists (unlikely in this logic, but safe to create)
                // Actually if sorted descending, latest is the highest. So nextName surely doesn't exist or is empty?
                // Just create it.
                return await createNewPlaylist(token, nextName);
            }

            myWatchLaterPlaylistId = latest.id;
            console.log(`Found existing playlist: ${latest.snippet.title} (${latest.contentDetails.itemCount} items)`);
            return myWatchLaterPlaylistId;
        }

        // Create new (first) playlist
        return await createNewPlaylist(token, PLAYLIST_NAME);
    }

    // Create a NEW playlist with a specific name
    async function createNewPlaylist(token, name) {
        const createResponse = await fetch(
            'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    snippet: { title: name, description: 'Videos saved by YouTubePlus extension' },
                    status: { privacyStatus: 'private' }
                })
            }
        );

        if (createResponse.ok) {
            const data = await createResponse.json();
            myWatchLaterPlaylistId = data.id;
            console.log(`Created new playlist: ${name}`);
            return data.id;
        } else {
            const err = await createResponse.json();
            console.error('Failed to create playlist:', err);
            throw new Error(err.error?.message || 'Failed to create playlist');
        }
    }

    // Handle "Playlist Full" -> Create N+1
    async function rotateToNextPlaylist(token) {
        // Reset ID to force refresh/create
        myWatchLaterPlaylistId = null;

        // Find current max index
        // We re-fetch logic similar to getLatest, but this time we specifically want to create the NEXT one.
        // Simplified: Just re-fetch latest list to be sure, then increment.

        let allPlaylists = [];
        let nextPageToken = '';
        try {
            do {
                const listUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50&pageToken=${nextPageToken}`;
                const response = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${token}` } });
                if (response.ok) {
                    const data = await response.json();
                    if (data.items) allPlaylists.push(...data.items);
                    nextPageToken = data.nextPageToken || '';
                } else break;
            } while (nextPageToken);
        } catch (e) { }

        const ourPlaylists = allPlaylists.filter(p => p.snippet.title.startsWith(PLAYLIST_NAME));
        let maxIndex = 1;

        ourPlaylists.forEach(p => {
            const num = parseInt(p.snippet.title.replace(PLAYLIST_NAME, '').trim()) || 1;
            if (num > maxIndex) maxIndex = num;
        });

        const nextName = `${PLAYLIST_NAME} ${maxIndex + 1}`;
        console.log(`Playlist full. Rotating to: ${nextName}`);

        return await createNewPlaylist(token, nextName);
    }

    // Add video to playlist
    async function addToMyWatchLater(videoId, btnElement, isRetry = false) {
        try {
            if (!isRetry) {
                btnElement.textContent = '...';
                console.log(`Adding video ${videoId} to playlist...`);
            }

            let token;

            // OPTIMIZATION: Check if we already have a token in memory
            // If we don't, go STRAIGHT to interactive mode to preserve the User Gesture (click).
            // Attempting silent auth first (which involves a network call) can expire the user gesture
            // causing Firefox to block the subsequent interactive popup.
            if (cachedToken) {
                token = cachedToken;
            } else {
                console.log('No cached token, forcing interactive auth to preserve user gesture');
                token = await getAuthToken(true);
                console.log('Token obtained (interactive)');
            }

            // Use getLatestPlaylist instead of simple getOrCreate
            const playlistId = await getLatestPlaylist(token);
            console.log('Target Playlist ID:', playlistId);

            // CHECK IF ALREADY IN PLAYLIST
            // If already present, return TRUE so the tab gets closed (per user request)
            try {
                const checkResponse = await fetch(
                    `https://www.googleapis.com/youtube/v3/playlistItems?part=id&playlistId=${playlistId}&videoId=${videoId}`,
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );

                if (checkResponse.ok) {
                    const checkData = await checkResponse.json();
                    if (checkData.items && checkData.items.length > 0) {
                        console.log(`Video ${videoId} already in playlist. Skipping add.`);
                        btnElement.textContent = '✓';
                        btnElement.style.color = '#00ff00';
                        btnElement.disabled = true;
                        // Return true => Close Tab
                        return true;
                    }
                }
            } catch (checkErr) {
                console.warn('Failed to check duplicate:', checkErr);
                // Continue to try adding if check fails
            }

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

                const errorMsg = error.error?.message || 'Error ' + response.status;
                const errorReason = error.error?.errors?.[0]?.reason || '';

                // SPECIFIC CHECK FOR DAILY QUOTA EXCEEDED
                if (errorReason === 'quotaExceeded' || errorMsg.includes('quota')) {
                    // Stop everything - Global Flag (even though we can't stop Promise.all mid-flight, this prevents retries)
                    if (!window.isQuotaExceeded) {
                        window.isQuotaExceeded = true;

                        const quotaMsg = 'Daily Limit Reached (quotaExceeded). Stopped.';
                        console.error(quotaMsg);

                        const errContainer = document.getElementById('error-container');
                        if (errContainer) {
                            errContainer.innerHTML = `
                                <span>${quotaMsg}</span>
                                <a href="https://developers.google.com/youtube/v3/getting-started#quota" target="_blank">Help</a>
                            `;
                            errContainer.classList.remove('hidden');
                        }

                        // Disable the main button immediately
                        const mainBtn = document.getElementById('add-all-btn');
                        if (mainBtn) {
                            mainBtn.textContent = 'Stopped (Quota Limit)';
                            mainBtn.disabled = true;
                        }
                    }

                    btnElement.textContent = '!';
                    btnElement.title = 'Quota Exceeded';
                    return false;
                }

                // DETECT PLAYLIST FULL (Item count limit)
                // "playlistContainsMaximumNumberOfVideos", etc.
                if (!isRetry && (
                    response.status === 409 ||
                    (response.status === 403 && errorReason === 'playlistContainsMaximumNumberOfVideos') ||
                    errorMsg.includes('maximum number of videos')
                )) {
                    console.warn('Playlist limit reached? Rotating to next...');
                    try {
                        await rotateToNextPlaylist(token); // Create "My Watch Later N+1"
                        return await addToMyWatchLater(videoId, btnElement, true); // Retry recursive
                    } catch (e) {
                        console.error('Rotation failed:', e);
                        btnElement.textContent = '!';
                        btnElement.title = 'Failed to rotate playlist';
                        return false;
                    }
                }

                // If token invalid, clear cache
                if (response.status === 401) {
                    console.log('Token expired/invalid (401). Clearing cache.');
                    cachedToken = null;
                    browserAPI.storage.local.remove('oauth_token');
                    if (isChrome) chrome.identity.removeCachedAuthToken({ token });
                }

                console.error('Error Message:', errorMsg);
                btnElement.textContent = '!';
                btnElement.title = errorMsg;
                return false;
            }
        } catch (err) {
            console.error('Exception in addToMyWatchLater:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
            // Also try logging it normally as it might be an Error object
            console.error(err);
            btnElement.textContent = '!';
            btnElement.title = err.message || 'Error occurred';
            return false;
        }
    }

    // Save All button handler
    // Save All button handler
    addAllBtn.addEventListener('click', async () => {
        addAllBtn.textContent = 'Authenticating...';

        // 1. Ensure Auth First (Single Serial Call) to prevent race conditions
        try {
            if (!cachedToken) {
                await getAuthToken(true);
            }
        } catch (e) {
            console.error("Auth failed before batch", e);
            addAllBtn.textContent = 'Auth Failed';
            setTimeout(() => updateButtons(), 2000);
            return;
        }

        addAllBtn.textContent = 'Saving...';
        let successCount = 0;
        let failCount = 0;
        const videosToProcess = [...detectedVideos];
        const successfulTabIds = new Set();

        // 2. Parallel Execution
        const promises = videosToProcess.map(async (video) => {
            const btn = document.querySelector(`button[data-tab-id="${video.tabId}"]`);
            const card = document.querySelector(`.video-card[data-tab-id="${video.tabId}"]`);

            if (btn && !btn.disabled) {
                // Pass the token we definitely have now? 
                // addToMyWatchLater will use cachedToken automatically.
                const success = await addToMyWatchLater(video.id, btn);

                if (success) {
                    successCount++;
                    successfulTabIds.add(video.tabId);
                    try {
                        await browserAPI.tabs.remove(video.tabId);
                    } catch (e) {
                        console.log('Tab already closed or invalid:', video.tabId);
                    }
                    if (card) card.remove();
                } else {
                    failCount++;
                }

                // Update UI progress (atomic update)
                addAllBtn.textContent = `Saving... (${successCount + failCount}/${videosToProcess.length})`;
            }
        });

        // Wait for all requests to finish
        await Promise.all(promises);

        // 3. Cleanup Global State
        detectedVideos = detectedVideos.filter(v => !successfulTabIds.has(v.tabId));

        if (failCount > 0) {
            addAllBtn.textContent = `Done: ${successCount} saved, ${failCount} failed`;
        } else {
            addAllBtn.textContent = `Done: ${successCount} saved & closed`;
        }

        setTimeout(() => {
            if (detectedVideos.length > 0) {
                updateButtons();
                addAllBtn.textContent = 'Save All to Watch Later';
            } else {
                addAllBtn.textContent = 'All done!';
                addAllBtn.disabled = true;
                addAllBtn.classList.remove('active');
            }
        }, 2000);
    });
});
