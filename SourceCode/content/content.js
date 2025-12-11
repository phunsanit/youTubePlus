// Content script that runs on YouTube video pages
// Handles saving video to Watch Later by simulating user clicks

(function () {
    'use strict';

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'saveToWatchLater') {
            saveToWatchLater()
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // Keep message channel open for async response
        }
    });

    async function saveToWatchLater() {
        try {
            console.log('[YouTubePlus] Starting save to Watch Later...');

            // Step 1: Find and click the Save/Menu button
            const menuButton = await findMenuButton();
            if (!menuButton) {
                throw new Error('Save button not found');
            }

            console.log('[YouTubePlus] Found menu button, clicking...');
            menuButton.click();
            await wait(800);

            // Step 2: Find and click "Save to playlist" option
            const saveOption = await findSaveToPlaylistOption();
            if (!saveOption) {
                // Try clicking directly on Watch Later if it's visible
                const watchLater = await findWatchLaterCheckbox();
                if (watchLater) {
                    watchLater.click();
                    await wait(300);
                    // Close the menu
                    document.body.click();
                    return { success: true };
                }
                throw new Error('Save to playlist option not found');
            }

            console.log('[YouTubePlus] Found save option, clicking...');
            saveOption.click();
            await wait(800);

            // Step 3: Find and click "Watch Later" checkbox
            const watchLaterCheckbox = await findWatchLaterCheckbox();
            if (!watchLaterCheckbox) {
                throw new Error('Watch Later checkbox not found');
            }

            console.log('[YouTubePlus] Found Watch Later, clicking...');
            watchLaterCheckbox.click();
            await wait(500);

            // Close the dialog by clicking outside or pressing escape
            const closeButton = document.querySelector('yt-button-shape button[aria-label="Close"]');
            if (closeButton) {
                closeButton.click();
            } else {
                // Press Escape to close
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }

            console.log('[YouTubePlus] Successfully saved to Watch Later!');
            return { success: true };
        } catch (error) {
            console.error('[YouTubePlus] Error:', error);
            return { success: false, error: error.message };
        }
    }

    async function findMenuButton() {
        // Wait for page to fully load
        await wait(500);

        // Try various selectors for the menu/save button
        const selectors = [
            // Save button (bookmark icon) - modern YouTube
            '#actions button[aria-label*="Save"]',
            '#top-row button[aria-label*="Save"]',
            'ytd-menu-renderer button[aria-label*="Save"]',

            // 3-dot menu button
            '#actions #button-shape button[aria-label="More actions"]',
            '#menu button[aria-label="More actions"]',
            'ytd-menu-renderer #button-shape button',
            'ytd-menu-renderer yt-button-shape button',

            // Flexible selectors
            '#actions ytd-button-renderer button',
            '#actions yt-button-shape button',

            // Try by icon
            '#actions button:has(path[d*="M22"])',
        ];

        for (const selector of selectors) {
            try {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    const label = el.getAttribute('aria-label') || el.innerText || '';
                    console.log(`[YouTubePlus] Checking: ${selector} - label: "${label}"`);
                    if (label.toLowerCase().includes('save') || label.toLowerCase().includes('more')) {
                        return el;
                    }
                }
            } catch (e) {
                // Selector not supported
            }
        }

        // Fallback: search all buttons for Save-related text
        const allButtons = document.querySelectorAll('button, yt-button-shape button');
        for (const btn of allButtons) {
            const label = btn.getAttribute('aria-label') || '';
            const title = btn.getAttribute('title') || '';
            if (label.toLowerCase().includes('save') || title.toLowerCase().includes('save')) {
                console.log(`[YouTubePlus] Found via fallback: ${label || title}`);
                return btn;
            }
        }

        // Try finding by aria-label content
        const saveBtn = document.querySelector('[aria-label*="Save to playlist"]');
        if (saveBtn) return saveBtn;

        console.log('[YouTubePlus] Button not found, logging available elements...');
        const actions = document.querySelector('#actions');
        if (actions) {
            console.log('[YouTubePlus] Actions container HTML:', actions.innerHTML.substring(0, 500));
        }

        return null;
    }

    async function findSaveToPlaylistOption() {
        await wait(300);

        // Look for "Save to playlist" in the dropdown menu
        const menuItems = document.querySelectorAll(
            'ytd-menu-service-item-renderer, tp-yt-paper-item, yt-list-item-view-model'
        );

        for (const item of menuItems) {
            const text = (item.innerText || item.textContent || '').toLowerCase();
            console.log(`[YouTubePlus] Menu item: "${text}"`);
            if (text.includes('save') || text.includes('playlist')) {
                return item;
            }
        }

        return null;
    }

    async function findWatchLaterCheckbox() {
        await wait(300);

        // Look for Watch Later option in the playlist dialog
        const selectors = [
            // Playlist checkbox items
            'ytd-playlist-add-to-option-renderer',
            'tp-yt-paper-checkbox',
            '#playlists ytd-playlist-add-to-option-renderer',
            '[aria-label*="Watch later"]',
            '[aria-label*="Watch Later"]',
        ];

        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
                console.log(`[YouTubePlus] Playlist option: "${text}"`);
                if (text.includes('watch later') || text.includes('ดูภายหลัง')) {
                    return el;
                }
            }
        }

        return null;
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
})();
