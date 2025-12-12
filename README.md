# YouTubePlus - Browser Extension

A browser extension that finds open YouTube video tabs and saves them to a custom "My Watch Later" playlist, then automatically closes the tabs.

## Features

- 🔍 **Detect YouTube Tabs** - Automatically finds all open YouTube video tabs
- 💾 **Save to Playlist** - Adds videos to your personal "My Watch Later" playlist via YouTube API
- 🚪 **Auto-close Tabs** - Closes tabs after successfully saving videos
- 🌐 **Cross-browser** - Works on Chrome, Edge, and Firefox

## Installation

### Chrome / Edge (Load Unpacked)
1. Download or clone this repository
2. Open `chrome://extensions` (or `edge://extensions`)
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `SourceCode` folder

### Firefox
1. Open `about:debugging`
2. Click "This Firefox" → "Load Temporary Add-on"
3. Select any file in the `SourceCode` folder

## Setup

### 1. Create Google Cloud OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **YouTube Data API v3**
4. Create OAuth 2.0 credentials:
   - **For Chrome**: Type = "Chrome Extension", Application ID = your extension ID
   - **For Firefox**: Type = "Web Application", add redirect URI from extension popup

### 2. Configure the Extension

1. Copy `config.example.json` to `config.json`
2. Replace `YOUR_CLIENT_ID_HERE` with your OAuth Client ID

## Usage

1. Open multiple YouTube video tabs
2. Click the YouTubePlus extension icon
3. Click "Save All to Watch Later"
4. Videos will be saved to "My Watch Later" playlist and tabs will close

## Privacy

This extension:
- Only accesses YouTube tabs you have open
- Uses YouTube API to save videos to your playlist
- Does not collect or store any personal data
- Does not track or share any information

## License

MIT License
