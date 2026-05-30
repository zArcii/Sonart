# 🎵 Sonart Desktop

A state-of-the-art, premium desktop music player designed for modern audiophiles. Sonart combines modern **Glassmorphism**, smooth interactive transitions, and robust integrations like **YouTube Music account sync**, **interactive synced lyrics**, and live **Discord Rich Presence**.

---

## ✨ Features

- **💎 Sleek Glassmorphic Interface**: Built with high-end, responsive Vanilla CSS visual styling, subtle micro-animations, and dynamic hover states that look and feel premium.
- **🧭 Seamless Page Navigation**: Slide dynamically through pages with the customized bottom floating bar (Home, Library, and native Settings page) featuring a smooth spring tab indicator.
- **🔄 Smart Recommendations & Refresh**: Home dashboard recommends exactly 6 curated playlists, equipped with a spinning **Refresh** recommendation engine that shuffles new suggestions instantly.
- **🎤 Advanced Immersive Synced Lyrics**:
  - Enjoy a fullscreen **Vibe Mode** featuring smooth ambient aura gradients matching the track's mood.
  - Interactive lyrics track the active line in real-time, allowing you to click on any lyric line to instantly seek the audio player to that exact time!
- **🎮 Discord Rich Presence (RPC)**: Automatically broadcast what you're listening to, displaying current track titles, artists, duration, and play/pause status in real-time to your friends on Discord.
- **🔒 Secure YouTube Music Sync**: Log in securely to automatically import and synchronize all your private playlists, liked songs, and customized recommended home feeds.

---

## 🛠️ Technology Stack

- **Frontend**: Electron.js, HTML5, Vanilla CSS, ES6 JavaScript.
- **Backend Service**: Flask (Python 3), `ytmusicapi` for private account API operations, and `yt-dlp` for lightning-fast stream extraction.
- **Presence Core**: Node.js `discord-rpc` package.

---

## 🚀 Getting Started

### Prerequisites

1. **Python 3.8+** must be installed and added to your system path.
2. **Node.js** (v16+) and **npm** package manager.
3. (Optional) **Discord Desktop App** running locally to enable Discord Rich Presence.

### Installation

1. Clone or extract the repository files:
   ```bash
   git clone https://github.com/zArcii/Sonart.git
   cd Sonart
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

3. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

---

## ⚙️ Running Locally

To start Sonart in development mode, run:

```bash
npm start
```

This command will:
1. Fire up the Flask backend server (`server.py`) in the background on port `18420`.
2. Launch the Electron frontend wrapper, loading `index.html` as a glassmorphic desktop application window.
3. Automatically attempt to bind the Discord RPC channel.

---

## 📦 Packaging

To compile and package the production bundle for Windows, run:

```bash
npm run package
```

This generates a standalone, distributable `.exe` file under the `/out` directory.

---

## 👤 Author

Created with 🤍 by [zArcii](https://github.com/zArcii). Enjoy the vibe!
