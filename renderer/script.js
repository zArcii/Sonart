/**
 * Sonart — Renderer Script
 * Full YTMusic API integration + local & private playlist support
 */
document.addEventListener('DOMContentLoaded', () => {
  const startTime = Date.now();

  // Helper for DOM access (defined early to prevent TDZ errors)
  const $ = id => document.getElementById(id);

  // ── Constants ──────────────────────────────────────────────────
  const BACKEND_URL = 'http://127.0.0.1:18492';

  // ── State ──────────────────────────────────────────────────────
  let currentTrack = null;
  let playlist = [];
  let playlistIdx = -1;
  let isPlaying = false;
  let isShuffle = false;
  let repeatMode = 0; // 0=off, 1=all, 2=one
  let likedTracks = JSON.parse(localStorage.getItem('sonart-liked') || '[]');
  let recentlyPlayed = JSON.parse(localStorage.getItem('sonart-history') || '[]');
  let localPlaylists = JSON.parse(localStorage.getItem('sonart-playlists') || '[]');
  let syncedPlaylists = JSON.parse(localStorage.getItem('sonart-synced-playlists') || '[]');
  let syncedLikedTracks = JSON.parse(localStorage.getItem('sonart-synced-liked-tracks') || '[]');
  let currentPage = 'home';
  let currentLibView = 'playlists'; // 'playlists' or 'liked'
  let searchDebounce = null;
  let selectedTrackForPlaylist = null; // temporary store for add-to-playlist action
  let homePageNum = 0;   // infinite scroll page counter
  let homeHasMore = true; // more pages from /home?
  let homeLoading = false; // prevent duplicate scroll fetches
  let prefetchTimeout = null; // pre-fetch next track timer
  let currentPlaylistTracks = [];
  let originalPlaylistTracks = [];
  let lastChosenPlaylist = [];
  let lastClickedTrack = null;
  let currentOpenPlaylistId = null;
  let vibeMode = false;
  let syncedLyricsLines = []; // Array of { time: float, text: string, element: HTMLDivElement }
  let activeLyricIndex = -1;  // Index of the currently highlighted line


  // ── Theme Manager ────────────────────────────────────────────────
  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 255, 255';
  }
  function getContrastColor(hex) {
    if (!hex || hex === '#FFFFFF') return '#000000';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
  }
  function isDarkColor(hex) {
    if (!hex) return true;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return yiq < 128;
  }

  function applyTheme(design, mode, accent, primary) {
    document.body.classList.remove('theme-light', 'theme-material3', 'theme-appleglass');

    if (mode === 'light') {
      document.body.classList.add('theme-light');
    }

    if (design === 'material3') {
      document.body.classList.add('theme-material3');
    } else if (design === 'appleglass') {
      document.body.classList.add('theme-appleglass');
    }

    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-rgb', hexToRgb(accent));
    document.documentElement.style.setProperty('--accent-text', getContrastColor(accent));

    if (mode === 'dark') {
      document.documentElement.style.setProperty('--bg', primary);
    } else {
      if (!isDarkColor(primary)) {
        document.documentElement.style.setProperty('--bg', primary);
      } else {
        document.documentElement.style.removeProperty('--bg');
      }
    }
  }

  function applyAnimatedBackground(bgName) {
    const bgContainer = $('app-background');
    if (!bgContainer) return;
    
    // If a YouTube background is active, don't override it with animated background classes
    const savedYt = localStorage.getItem('sonart-theme-yt-bg') || '';
    if (savedYt && getYoutubeVideoId(savedYt)) {
      bgContainer.className = '';
      bgContainer.classList.add('bg-youtube');
      return;
    }
    
    bgContainer.className = '';
    bgContainer.classList.add(`bg-${bgName}`);
  }

  function loadYoutubeBackground(url) {
    const container = $('yt-bg-container');
    const bgContainer = $('app-background');
    if (!container || !bgContainer) return;

    if (!url) {
      container.innerHTML = '';
      const activeBg = localStorage.getItem('sonart-theme-bg-animated') || 'space';
      localStorage.removeItem('sonart-theme-yt-bg');
      applyAnimatedBackground(activeBg);
      return;
    }

    const videoId = getYoutubeVideoId(url);
    if (!videoId) {
      container.innerHTML = '';
      const activeBg = localStorage.getItem('sonart-theme-bg-animated') || 'space';
      localStorage.removeItem('sonart-theme-yt-bg');
      applyAnimatedBackground(activeBg);
      return;
    }

    container.innerHTML = `
      <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&showinfo=0&rel=0&modestbranding=1&iv_load_policy=3" 
              frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
    `;
    
    bgContainer.className = '';
    bgContainer.classList.add('bg-youtube');
  }

  function getYoutubeVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  }

  const savedDesign = localStorage.getItem('sonart-theme-design') || 'default';
  const savedMode = localStorage.getItem('sonart-theme-mode') || 'dark';
  const savedAccent = localStorage.getItem('sonart-theme-accent') || '#FFFFFF';
  const savedPrimary = localStorage.getItem('sonart-theme-primary') || '#000000';
  let savedBgAnim = localStorage.getItem('sonart-theme-bg-animated') || 'space';
  if (savedBgAnim !== 'none' && savedBgAnim !== 'space') {
    savedBgAnim = 'space';
    localStorage.setItem('sonart-theme-bg-animated', 'space');
  }
  const savedYtBg = localStorage.getItem('sonart-theme-yt-bg') || '';

  applyTheme(savedDesign, savedMode, savedAccent, savedPrimary);
  if (savedYtBg && getYoutubeVideoId(savedYtBg)) {
    loadYoutubeBackground(savedYtBg);
  } else {
    applyAnimatedBackground(savedBgAnim);
  }

  function initCustomizationUI() {
    const design = localStorage.getItem('sonart-theme-design') || 'default';
    const mode = localStorage.getItem('sonart-theme-mode') || 'dark';
    const accent = localStorage.getItem('sonart-theme-accent') || '#FFFFFF';
    const primary = localStorage.getItem('sonart-theme-primary') || '#000000';
    let bgAnim = localStorage.getItem('sonart-theme-bg-animated') || 'space';
    if (bgAnim !== 'none' && bgAnim !== 'space') {
      bgAnim = 'space';
      localStorage.setItem('sonart-theme-bg-animated', 'space');
    }
    const ytBg = localStorage.getItem('sonart-theme-yt-bg') || '';

    const designRadio = document.querySelector(`input[name="theme-design"][value="${design}"]`);
    if (designRadio) designRadio.checked = true;

    const modeRadio = document.querySelector(`input[name="theme-mode"][value="${mode}"]`);
    if (modeRadio) modeRadio.checked = true;

    const bgRadio = document.querySelector(`input[name="bg-animated"][value="${bgAnim}"]`);
    if (bgRadio) bgRadio.checked = true;

    const ytInput = $('yt-bg-url');
    if (ytInput) ytInput.value = ytBg;

    if (ytBg && getYoutubeVideoId(ytBg)) {
      loadYoutubeBackground(ytBg);
    } else {
      applyAnimatedBackground(bgAnim);
    }

    const pickerAccent = $('picker-accent-color');
    if (pickerAccent) pickerAccent.value = accent;
    document.querySelectorAll('#accent-presets .color-preset-circle').forEach(c => {
      c.classList.toggle('active', c.dataset.color.toLowerCase() === accent.toLowerCase());
    });

    const pickerPrimary = $('picker-primary-color');
    if (pickerPrimary) pickerPrimary.value = primary;
    document.querySelectorAll('#primary-presets .color-preset-circle').forEach(c => {
      c.classList.toggle('active', c.dataset.color.toLowerCase() === primary.toLowerCase());
    });
  }

  function bindCustomizationListeners() {
    document.querySelectorAll('input[name="theme-design"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const design = e.target.value;
        localStorage.setItem('sonart-theme-design', design);
        const mode = document.querySelector('input[name="theme-mode"]:checked')?.value || 'dark';
        const accent = localStorage.getItem('sonart-theme-accent') || '#FFFFFF';
        const primary = localStorage.getItem('sonart-theme-primary') || '#000000';
        applyTheme(design, mode, accent, primary);
      });
    });

    document.querySelectorAll('input[name="theme-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const mode = e.target.value;
        localStorage.setItem('sonart-theme-mode', mode);
        const design = document.querySelector('input[name="theme-design"]:checked')?.value || 'default';
        const accent = localStorage.getItem('sonart-theme-accent') || '#FFFFFF';
        const primary = localStorage.getItem('sonart-theme-primary') || '#000000';
        applyTheme(design, mode, accent, primary);
      });
    });

    document.querySelectorAll('input[name="bg-animated"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const bgAnim = e.target.value;
        localStorage.setItem('sonart-theme-bg-animated', bgAnim);
        applyAnimatedBackground(bgAnim);
      });
    });

    const btnNextYt = $('btn-next-yt-bg');
    const btnResetYt = $('btn-reset-yt-bg');
    const ytInput = $('yt-bg-url');

    if (ytInput) {
      ytInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (btnNextYt) btnNextYt.click();
        }
      });
    }

    if (btnNextYt && ytInput) {
      btnNextYt.addEventListener('click', () => {
        const url = ytInput.value.trim();
        if (url) {
          localStorage.setItem('sonart-theme-yt-bg', url);
          loadYoutubeBackground(url);
        }
      });
    }

    if (btnResetYt && ytInput) {
      btnResetYt.addEventListener('click', () => {
        ytInput.value = '';
        localStorage.removeItem('sonart-theme-yt-bg');
        localStorage.setItem('sonart-theme-bg-animated', 'none');
        
        const noneRadio = document.querySelector('input[name="bg-animated"][value="none"]');
        if (noneRadio) noneRadio.checked = true;

        const container = $('yt-bg-container');
        if (container) container.innerHTML = '';

        applyAnimatedBackground('none');
      });
    }

    document.querySelectorAll('#accent-presets .color-preset-circle').forEach(circle => {
      circle.addEventListener('click', (e) => {
        document.querySelectorAll('#accent-presets .color-preset-circle').forEach(c => c.classList.remove('active'));
        circle.classList.add('active');
        const color = circle.dataset.color;
        localStorage.setItem('sonart-theme-accent', color);
        const pickerAccent = $('picker-accent-color');
        if (pickerAccent) pickerAccent.value = color;
        const design = document.querySelector('input[name="theme-design"]:checked')?.value || 'default';
        const mode = document.querySelector('input[name="theme-mode"]:checked')?.value || 'dark';
        const primary = localStorage.getItem('sonart-theme-primary') || '#000000';
        applyTheme(design, mode, color, primary);
      });
    });

    document.querySelectorAll('#primary-presets .color-preset-circle').forEach(circle => {
      circle.addEventListener('click', (e) => {
        document.querySelectorAll('#primary-presets .color-preset-circle').forEach(c => c.classList.remove('active'));
        circle.classList.add('active');
        const color = circle.dataset.color;
        localStorage.setItem('sonart-theme-primary', color);
        const pickerPrimary = $('picker-primary-color');
        if (pickerPrimary) pickerPrimary.value = color;
        const design = document.querySelector('input[name="theme-design"]:checked')?.value || 'default';
        const mode = document.querySelector('input[name="theme-mode"]:checked')?.value || 'dark';
        const accent = localStorage.getItem('sonart-theme-accent') || '#FFFFFF';
        applyTheme(design, mode, accent, color);
      });
    });

    const pickerAccent = $('picker-accent-color');
    if (pickerAccent) {
      pickerAccent.addEventListener('input', (e) => {
        const color = e.target.value;
        localStorage.setItem('sonart-theme-accent', color);
        document.querySelectorAll('#accent-presets .color-preset-circle').forEach(c => {
          c.classList.toggle('active', c.dataset.color.toLowerCase() === color.toLowerCase());
        });
        const design = document.querySelector('input[name="theme-design"]:checked')?.value || 'default';
        const mode = document.querySelector('input[name="theme-mode"]:checked')?.value || 'dark';
        const primary = localStorage.getItem('sonart-theme-primary') || '#000000';
        applyTheme(design, mode, color, primary);
      });
    }

    const pickerPrimary = $('picker-primary-color');
    if (pickerPrimary) {
      pickerPrimary.addEventListener('input', (e) => {
        const color = e.target.value;
        localStorage.setItem('sonart-theme-primary', color);
        document.querySelectorAll('#primary-presets .color-preset-circle').forEach(c => {
          c.classList.toggle('active', c.dataset.color.toLowerCase() === color.toLowerCase());
        });
        const design = document.querySelector('input[name="theme-design"]:checked')?.value || 'default';
        const mode = document.querySelector('input[name="theme-mode"]:checked')?.value || 'dark';
        const accent = localStorage.getItem('sonart-theme-accent') || '#FFFFFF';
        applyTheme(design, mode, accent, color);
      });
    }

    const selectPlaylistSort = $('select-playlist-sort');
    if (selectPlaylistSort) {
      selectPlaylistSort.addEventListener('change', () => {
        const sortBy = selectPlaylistSort.value;
        if (sortBy === 'popularity') {
          currentPlaylistTracks.sort((a, b) => (b.views_count || 0) - (a.views_count || 0));
        } else if (sortBy === 'alphabetical') {
          currentPlaylistTracks.sort((a, b) => a.title.localeCompare(b.title));
        } else {
          currentPlaylistTracks = [...originalPlaylistTracks];
        }
        const isLocal = localPlaylists.some(p => p.id === currentOpenPlaylistId) || currentOpenPlaylistId?.toString().startsWith('local_');
        const isSynced = syncedPlaylists.some(p => p.id === currentOpenPlaylistId);
        renderTrackList(playlistTracksList, currentPlaylistTracks, currentPlaylistTracks, isLocal || isSynced, currentOpenPlaylistId, isSynced);

        const playBtn = $('btn-playlist-play');
        const newPlayBtn = playBtn.cloneNode(true);
        playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
        newPlayBtn.addEventListener('click', () => {
          lastChosenPlaylist = currentPlaylistTracks;
          lastClickedTrack = currentPlaylistTracks[0];
          buildQueueForTrack(currentPlaylistTracks[0], currentPlaylistTracks);
        });
      });
    }
  }


  // ── Audio ──────────────────────────────────────────────────────
  const audio = new Audio();
  audio.volume = 0.8;
  audio.preload = 'auto';

  // ── DOM References ─────────────────────────────────────────────
  const content = $('content');
  const loadingScreen = $('loading-screen');
  const searchInput = $('search-input');
  const searchClear = $('search-clear');
  const homeFeedSections = $('home-feed-sections');
  const likedList = $('liked-list');
  const searchGrid = $('search-grid');
  const searchEmpty = $('search-empty');
  const likedEmpty = $('liked-empty');
  const searchTitle = $('search-title');
  const searchCount = $('search-count');
  const likedCount = $('liked-count');
  const greetingEl = $('greeting');
  const playerBar = $('player-bar');
  const playerArt = $('player-artwork');
  const playerTitle = $('player-title');
  const playerArtist = $('player-artist');
  const playerLike = $('player-like');
  const btnPlay = $('btn-play');
  const btnPrev = $('btn-prev');
  const btnNext = $('btn-next');
  const btnShuffle = $('btn-shuffle');
  const btnRepeat = $('btn-repeat');
  const btnVolume = $('btn-volume');
  const iconPlay = $('icon-play');
  const iconPause = $('icon-pause');
  const iconVolOn = $('icon-vol-on');
  const iconVolMute = $('icon-vol-mute');
  const progressTrack = $('progress-track');
  const progressFill = $('progress-fill');
  const timeCurrent = $('time-current');
  const timeTotal = $('time-total');
  const volumeTrack = $('volume-track');
  const volumeFill = $('volume-fill');
  const volumeHandle = $('volume-handle');
  const tabHome = $('tab-home');
  const tabLibrary = $('tab-library');
  const tabSettings = $('tab-settings');
  const indicator = $('tab-indicator');

  // Lyrics DOM
  const btnLyrics = $('btn-lyrics');
  const modalLyrics = $('modal-lyrics');
  const btnCloseLyrics = $('btn-close-lyrics');
  const lyricsText = $('lyrics-text');
  const lyricsTitle = $('lyrics-title');
  const lyricsSubtitle = $('lyrics-subtitle');
  const lyricsSource = $('lyrics-source');

  // Modals DOM
  const modalCreatePlaylist = $('modal-create-playlist');
  const modalImportPlaylist = $('modal-import-playlist');
  const modalSettings = $('modal-settings');
  const modalAddToPlaylist = $('modal-add-to-playlist');
  const playlistNameInput = $('playlist-name-input');
  const playlistUrlInput = $('playlist-url-input');
  const authHeadersInput = $('auth-headers-input');
  const authUnlinkedState = $('auth-unlinked-state');
  const authLinkedState = $('auth-linked-state');
  const playlistsGrid = $('playlists-grid');
  const addToPlaylistsContainer = $('add-to-playlists-list');

  // Playlist Page DOM
  const pagePlaylist = $('page-playlist');
  const playlistArt = $('playlist-art');
  const playlistArtPlaceholder = $('playlist-art-placeholder');
  const playlistTitleEl = $('playlist-title');
  const playlistDescEl = $('playlist-desc');
  const playlistTracksList = $('playlist-tracks-list');
  const btnPlaylistPlay = $('btn-playlist-play');
  const btnPlaylistDelete = $('btn-playlist-delete');
  const playlistEmptyState = $('playlist-empty');
  const playlistTypeBadge = $('playlist-type-badge');

  // ── Greeting ───────────────────────────────────────────────────
  function setGreeting() {
    const h = new Date().getHours();
    if (h < 5) greetingEl.textContent = 'Good night';
    else if (h < 12) greetingEl.textContent = 'Good morning';
    else if (h < 17) greetingEl.textContent = 'Good afternoon';
    else if (h < 21) greetingEl.textContent = 'Good evening';
    else greetingEl.textContent = 'Good night';
  }
  setGreeting();

  initCustomizationUI();
  bindCustomizationListeners();

  // ═══════════════════════════════════════════════════════════════
  //  API CALLS
  // ═══════════════════════════════════════════════════════════════

  async function apiGet(path) {
    const res = await fetch(`${BACKEND_URL}${path}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const json = await res.json();
    return json.data || json;
  }

  async function apiPost(path, data) {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  }

  async function getTrending(genre = '') {
    if (genre) {
      return apiGet(`/search?q=${encodeURIComponent(genre + " songs")}`);
    }
    const res = await apiGet('/trending');
    return res;
  }

  async function searchTracks(query) {
    return apiGet(`/search?q=${encodeURIComponent(query)}`);
  }

  function getStreamUrl(trackId) {
    return `${BACKEND_URL}/stream?id=${trackId}`;
  }

  function getArtwork(track, size = '480x480') {
    if (track.artwork && track.artwork[size]) {
      return track.artwork[size];
    }
    if (track.artwork && track.artwork['150x150']) {
      return track.artwork['150x150'];
    }
    if (track && track.id) {
      return `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
    }
    return '';
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDERING & UI BUILDERS
  // ═══════════════════════════════════════════════════════════════

  function renderTrackCard(track, idx, targetPlaylist) {
    const art = getArtwork(track);
    const card = document.createElement('div');
    card.className = 'track-card';
    if (currentTrack && currentTrack.id === track.id) card.classList.add('playing');
    card.dataset.trackId = track.id;

    card.innerHTML = `
      <div class="track-artwork">
        ${art ? `<img src="${art}" alt="${escapeHtml(track.title)}" loading="lazy"/>` :
        `<div style="width:100%;height:100%;background:linear-gradient(135deg,#111,#020202);display:flex;align-items:center;justify-content:center;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.5" fill="rgba(255,255,255,0.15)"/></svg>
          </div>`}
        <div class="track-play-overlay">
          <svg viewBox="0 0 24 24" fill="#FFFFFF"><polygon points="8 5 19 12 8 19"/></svg>
        </div>
      </div>
      <div class="track-info">
        <span class="track-title">${escapeHtml(track.title)}</span>
        <span class="track-artist artist-link" data-artist="${escapeHtml(track.user?.name || '')}">${escapeHtml(track.user?.name || 'Unknown')}</span>
      </div>
    `;

    const artistLink = card.querySelector('.artist-link');
    if (artistLink && track.user?.name) {
      artistLink.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlaylistDetails('artist_' + track.user.name, track.user.name, true, getArtwork(track, '480x480'));
      });
    }

    card.addEventListener('click', () => {
      lastChosenPlaylist = targetPlaylist;
      lastClickedTrack = track;
      buildQueueForTrack(track, targetPlaylist);
    });

    return card;
  }

  function renderPlaylistCard(pl) {
    const card = document.createElement('div');
    card.className = 'playlist-card';

    let art = pl.artwork || '';
    if (!art && pl.tracks && pl.tracks.length > 0) {
      art = getArtwork(pl.tracks[0], '480x480');
    }

    card.innerHTML = `
      <div class="playlist-card-art">
        ${art ? `<img src="${art}" alt="${escapeHtml(pl.title)}" loading="lazy"/>` : `
          <div class="playlist-card-placeholder">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </div>
        `}
      </div>
      <div class="playlist-card-details">
        <div class="playlist-card-title">${escapeHtml(pl.title)}</div>
        <div class="playlist-card-count">${pl.description ? escapeHtml(pl.description) : 'PLAYLIST'}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      openPlaylistDetails(pl.id);
    });

    return card;
  }

  function renderGrid(container, tracks, targetPlaylist) {
    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    tracks.forEach((track, i) => {
      fragment.appendChild(renderTrackCard(track, i, targetPlaylist));
    });
    container.appendChild(fragment);
  }

  function renderSkeletons(container, count = 12) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const skel = document.createElement('div');
      skel.className = 'skeleton-card';
      skel.innerHTML = `<div class="skeleton-art"></div><div class="skeleton-text"></div><div class="skeleton-text short"></div>`;
      container.appendChild(skel);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function updatePlayingStates() {
    document.querySelectorAll('.track-card').forEach(c => {
      c.classList.toggle('playing', currentTrack && c.dataset.trackId === currentTrack.id);
    });
    document.querySelectorAll('.track-row').forEach(r => {
      r.classList.toggle('playing', currentTrack && r.dataset.trackId === currentTrack.id);
    });
    document.querySelectorAll('.feed-track-row').forEach(r => {
      r.classList.toggle('playing', currentTrack && r.dataset.trackId === currentTrack.id);
    });
  }

  // Render a single feed track as a horizontal row card (distinct from playlist cards)
  function renderFeedTrackRow(track, idx, targetPlaylist) {
    const art = getArtwork(track, '150x150');
    const row = document.createElement('div');
    row.className = 'feed-track-row';
    if (currentTrack && currentTrack.id === track.id) row.classList.add('playing');
    row.dataset.trackId = track.id;

    row.innerHTML = `
      <div class="feed-track-art-wrap">
        ${art ? `<img src="${art}" alt="" loading="lazy" onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${track.id}/hqdefault.jpg';"/>` :
        `<div style="width:100%;height:100%;background:#111;display:flex;align-items:center;justify-content:center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
          </div>`}
        <div class="feed-track-play-overlay">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#FFFFFF"><polygon points="8 5 19 12 8 19"/></svg>
        </div>
      </div>
      <div class="feed-track-details">
        <span class="feed-track-title">${escapeHtml(track.title)}</span>
        <span class="feed-track-artist artist-link" data-artist="${escapeHtml(track.user?.name || '')}">${escapeHtml(track.user?.name || 'Unknown')}</span>
      </div>
      <div class="feed-track-actions">
        <button class="feed-track-btn add-queue-btn" title="Add to Queue" style="margin-right: 6px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </button>
        <button class="feed-track-btn like-btn ${isLiked(track.id) ? 'liked' : ''}" title="Like" style="margin-right: 6px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${isLiked(track.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
        </button>
        <button class="feed-track-btn add-playlist-btn" title="Add to Playlist">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
    `;

    const artistLink = row.querySelector('.artist-link');
    if (artistLink && track.user?.name) {
      artistLink.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlaylistDetails('artist_' + track.user.name, track.user.name, true, getArtwork(track, '480x480'));
      });
    }

    // Click row to play
    row.addEventListener('click', (e) => {
      if (e.target.closest('.feed-track-btn')) return;
      lastChosenPlaylist = targetPlaylist;
      lastClickedTrack = track;
      buildQueueForTrack(track, targetPlaylist);
    });

    // Add to Queue button
    row.querySelector('.add-queue-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      addToQueue(track);
    });

    // Like button
    row.querySelector('.like-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleLike(track);
      const btn = e.currentTarget;
      const liked = isLiked(track.id);
      btn.classList.toggle('liked', liked);
      btn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
    });

    // Add to Playlist button
    row.querySelector('.add-playlist-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      selectedTrackForPlaylist = track;
      openModal(modalAddToPlaylist);
      renderAddToPlaylistSelection();
    });

    return row;
  }

  // Render a playlist card for the home feed (with sleeve effects)
  function renderFeedPlaylistCard(pl) {
    const card = document.createElement('div');
    card.className = 'playlist-card';
    if (pl.isArtist) card.classList.add('artist-card');

    let art = pl.artwork || '';

    card.innerHTML = `
      <div class="playlist-card-art">
        ${art ? `<img src="${art}" alt="${escapeHtml(pl.title)}" loading="lazy"/>` : `
          <div class="playlist-card-placeholder">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </div>
        `}
      </div>
      <div class="playlist-card-details">
        <div class="playlist-card-title">${escapeHtml(pl.title)}</div>
        <div class="playlist-card-count">${pl.isArtist ? escapeHtml(pl.description || 'Artist') : (pl.description ? escapeHtml(pl.description) : 'PLAYLIST')}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      if (pl.id) {
        if (pl.isArtist || pl.id.toString().startsWith('UC')) {
          openPlaylistDetails(pl.id, pl.title, true, pl.artwork);
        } else {
          openPlaylistDetails(pl.id);
        }
      }
    });

    return card;
  }

  // Render List View (For Liked Songs, Playlists Details)
  function renderTrackList(container, tracks, targetPlaylist, allowRemoval = false, playlistId = null, isSyncedPlaylist = false) {
    container.innerHTML = '';
    if (!tracks || tracks.length === 0) return;

    const fragment = document.createDocumentFragment();

    tracks.forEach((track, idx) => {
      const art = getArtwork(track, '150x150');
      const row = document.createElement('div');
      row.className = 'track-row';
      if (currentTrack && currentTrack.id === track.id) row.classList.add('playing');
      row.dataset.trackId = track.id;

      row.innerHTML = `
        <div class="row-num">${idx + 1}</div>
        <div class="row-title-wrap">
          <div class="row-art">
            ${art ? `<img src="${art}" alt="" loading="lazy" onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${track.id}/hqdefault.jpg';"/>` :
          `<div style="width:100%;height:100%;background:#111;display:flex;align-items:center;justify-content:center;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg>
              </div>`}
          </div>
          <div class="row-text">
            <div class="row-title">${escapeHtml(track.title)}</div>
            <div class="row-artist-inline artist-link" data-artist="${escapeHtml(track.user?.name || '')}">${escapeHtml(track.user?.name || 'Unknown')}</div>
          </div>
        </div>
        <div class="row-album artist-link" data-artist="${escapeHtml(track.user?.name || '')}">${escapeHtml(track.user?.name || 'Unknown')}</div>
        <div class="row-actions">
          <button class="row-btn add-queue-btn" title="Add to Queue">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
          <button class="row-btn like-item-btn ${isLiked(track.id) ? 'liked' : ''}" title="Like">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${isLiked(track.id) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
            </svg>
          </button>
          <button class="row-btn add-playlist-btn" title="Add to Playlist">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          ${allowRemoval ? `
            <button class="row-btn remove-playlist-btn" title="Remove from Playlist">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          ` : ''}
        </div>
      `;

      row.querySelectorAll('.artist-link').forEach(link => {
        if (track.user?.name) {
          link.addEventListener('click', (e) => {
            e.stopPropagation();
            openPlaylistDetails('artist_' + track.user.name, track.user.name, true, getArtwork(track, '480x480'));
          });
        }
      });

      // Click to Play
      row.addEventListener('click', (e) => {
        if (e.target.closest('.row-btn') || e.target.closest('.artist-link')) return; // ignore buttons and artist links
        lastChosenPlaylist = targetPlaylist;
        lastClickedTrack = track;
        buildQueueForTrack(track, targetPlaylist);
      });

      // Like Button Event
      row.querySelector('.like-item-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLike(track);
        const btn = e.currentTarget;
        const liked = isLiked(track.id);
        btn.classList.toggle('liked', liked);
        btn.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
      });

      // Add to Queue Event
      row.querySelector('.add-queue-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        addToQueue(track);
      });

      // Add to playlist Event
      row.querySelector('.add-playlist-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        selectedTrackForPlaylist = track;
        openModal(modalAddToPlaylist);
        renderAddToPlaylistSelection();
      });

      // Remove from playlist Event (if allowed)
      if (allowRemoval) {
        row.querySelector('.remove-playlist-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (isSyncedPlaylist) {
            showQueueNotification(`Removing track from YouTube Music...`);
            try {
              const res = await apiPost(`/playlist/${playlistId}/remove`, {
                video_id: track.id,
                set_video_id: track.setVideoId || ''
              });
              if (res.success) {
                showQueueNotification(`Successfully removed from YouTube Music!`);
                // Re-fetch the playlist tracks to update the UI & local cache!
                const updatedPl = await apiGet(`/playlist/${playlistId}`);
                // Update in syncedPlaylists local array and save to localStorage
                const idx = syncedPlaylists.findIndex(p => p.id === playlistId);
                if (idx !== -1) {
                  syncedPlaylists[idx].tracks = updatedPl.tracks;
                  syncedPlaylists[idx].artwork = updatedPl.artwork;
                  localStorage.setItem('sonart-synced-playlists', JSON.stringify(syncedPlaylists));
                }
                // Refresh the display!
                openPlaylistDetails(playlistId);
              }
            } catch (err) {
              console.error('[Sonart] Failed to remove track from remote playlist:', err);
              showQueueNotification(`Failed to remove track from YTM: ${err.message}`);
            }
          } else {
            removeFromLocalPlaylist(playlistId, track.id);
          }
        });
      }

      fragment.appendChild(row);
    });

    container.appendChild(fragment);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PLAYBACK & DYNAMIC RADIO (AUTOGRAB RECOMMENDED NEXT)
  // ═══════════════════════════════════════════════════════════════

  function triggerRPCUpdate(isPlayingStatus = isPlaying) {
    if (currentTrack && window.sonart && window.sonart.updateActivity) {
      window.sonart.updateActivity({
        title: currentTrack.title,
        artist: currentTrack.user?.name || 'Unknown Artist',
        artwork: getArtwork(currentTrack, '150x150'),
        isPlaying: isPlayingStatus,
        currentTime: audio.currentTime,
        duration: audio.duration
      });
    }
  }

  async function playTrack(track, skipRadioFetch = false) {
    currentTrack = track;
    const url = getStreamUrl(track.id);
    audio.src = url;
    audio.play().catch(err => console.warn('[Sonart] Play failed:', err));
    isPlaying = true;
    updatePlayerUI();
    updatePlayingStates();
    showPlayer();

    // Send Discord RPC Update
    triggerRPCUpdate(true);

    // Add track to listening history
    try {
      recentlyPlayed = recentlyPlayed.filter(t => t.id !== track.id);
      recentlyPlayed.unshift(track);
      recentlyPlayed = recentlyPlayed.slice(0, 10); // Keep last 10 tracks
      localStorage.setItem('sonart-history', JSON.stringify(recentlyPlayed));
    } catch (historyErr) {
      console.warn('[Sonart] Failed to save track to history:', historyErr);
    }

    // If skipRadioFetch is false and queue length is 1 or empty (e.g. user clicked a single track card on home or search),
    // automatically retrieve recommendations (radio playlist) seeded from this song to build an endless queue!
    if (!skipRadioFetch && playlist.length <= 1) {
      try {
        console.log(`[Sonart] Auto-fetching related songs for endless radio seeded by: ${track.title}`);
        const data = await apiGet(`/radio?id=${track.id}`);
        if (data.tracks && data.tracks.length > 0) {
          playlist = [track, ...data.tracks];
          playlistIdx = 0;
          console.log(`[Sonart] Endless radio queue populated with ${playlist.length} tracks.`);
        }
      } catch (err) {
        console.warn('[Sonart] Radio generation failed:', err);
      }
    }

    // Pre-fetch next 5 track stream URLs after 6 seconds of playback
    clearTimeout(prefetchTimeout);
    prefetchTimeout = setTimeout(() => {
      for (let i = 1; i <= 5; i++) {
        const nextIdx = (playlistIdx + i) % playlist.length;
        const targetTrack = playlist[nextIdx];
        if (targetTrack && targetTrack.id !== track.id) {
          console.log(`[Sonart] Pre-fetching next track ${i}: ${targetTrack.title}`);
          fetch(`${BACKEND_URL}/stream?id=${targetTrack.id}`, { method: 'HEAD' }).catch(() => { });
        }
      }
    }, 6000);

    renderQueue();
  }

  function togglePlay() {
    if (!currentTrack) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => { });
    }
    isPlaying = !isPlaying;
    updatePlayPauseIcon();
  }

  function playNext() {
    if (playlist.length === 0) return;
    if (isShuffle) {
      playlistIdx = Math.floor(Math.random() * playlist.length);
    } else {
      playlistIdx = (playlistIdx + 1) % playlist.length;
    }
    playTrack(playlist[playlistIdx], true); // don't override constructed endless radio queue
  }

  function playPrev() {
    if (playlist.length === 0) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (isShuffle) {
      playlistIdx = Math.floor(Math.random() * playlist.length);
    } else {
      playlistIdx = (playlistIdx - 1 + playlist.length) % playlist.length;
    }
    playTrack(playlist[playlistIdx], true);
  }

  function showPlayer() {
    playerBar.classList.remove('player-hidden');
    content.classList.add('player-visible');
  }

  function updatePlayerUI() {
    if (!currentTrack) return;
    const art = getArtwork(currentTrack, '150x150');
    if (art) {
      playerArt.src = art;
      playerArt.classList.add('has-src');
    } else {
      playerArt.classList.remove('has-src');
    }
    playerTitle.textContent = currentTrack.title;
    playerArtist.textContent = currentTrack.user?.name || '';

    // Click player artist to go to their artist page
    if (currentTrack.user?.name) {
      playerArtist.classList.add('artist-link');
      playerArtist.onclick = (e) => {
        e.stopPropagation();
        openPlaylistDetails('artist_' + currentTrack.user.name, currentTrack.user.name, true, getArtwork(currentTrack, '480x480'));
      };
    } else {
      playerArtist.classList.remove('artist-link');
      playerArtist.onclick = null;
    }

    updatePlayPauseIcon();
    updateLikeButton();

    // Sync vibe mode if active
    if (vibeMode && modalLyrics.classList.contains('vibe-mode-active')) {
      const vibeT = $('vibe-title');
      const vibeA = $('vibe-artist');
      if (vibeT) vibeT.textContent = currentTrack.title || 'Unknown';
      if (vibeA) vibeA.textContent = currentTrack.user?.name || 'Unknown Artist';
      const artUrl = getArtwork(currentTrack, '480x480');
      const b1 = document.querySelector('#lyrics-vibe-bg .blob-1');
      const b2 = document.querySelector('#lyrics-vibe-bg .blob-2');
      if (artUrl && b1 && b2) {
        b1.style.backgroundImage = `url("${artUrl}")`;
        b2.style.backgroundImage = `url("${artUrl}")`;
      }
      // Also reload lyrics for the new track
      loadActiveTrackLyrics();
    } else if (modalLyrics && modalLyrics.classList.contains('active')) {
      // Reload lyrics in standard modal if active
      loadActiveTrackLyrics();
    }
  }

  function updatePlayPauseIcon() {
    iconPlay.style.display = isPlaying ? 'none' : 'block';
    iconPause.style.display = isPlaying ? 'block' : 'none';
    btnPlay.title = isPlaying ? 'Pause' : 'Play';

    const qPlay = $('icon-queue-play');
    const qPause = $('icon-queue-pause');
    if (qPlay && qPause) {
      qPlay.style.display = isPlaying ? 'none' : 'block';
      qPause.style.display = isPlaying ? 'block' : 'none';
    }
  }

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function syncLyricsTime() {
    if (!syncedLyricsLines || syncedLyricsLines.length === 0) return;

    const time = audio.currentTime;

    // Find the current active line.
    let activeIdx = -1;
    for (let i = 0; i < syncedLyricsLines.length; i++) {
      if (syncedLyricsLines[i].time <= time) {
        activeIdx = i;
      } else {
        break; // sorted array, safe to stop
      }
    }

    // Only update if the active line index has changed
    if (activeIdx !== activeLyricIndex) {
      // Remove focus from previous line
      if (activeLyricIndex >= 0 && activeLyricIndex < syncedLyricsLines.length) {
        syncedLyricsLines[activeLyricIndex].element.classList.remove('vibe-focused');
      }

      activeLyricIndex = activeIdx;

      if (activeLyricIndex >= 0 && activeLyricIndex < syncedLyricsLines.length) {
        const activeLine = syncedLyricsLines[activeLyricIndex];
        activeLine.element.classList.add('vibe-focused');

        // Smooth-scroll active line to center of lyrics-body
        activeLine.element.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
  }

  // ── Audio Events ───────────────────────────────────────────────
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width = pct + '%';
    timeCurrent.textContent = formatTime(audio.currentTime);
    syncLyricsTime();
  });

  audio.addEventListener('loadedmetadata', () => {
    timeTotal.textContent = formatTime(audio.duration);
  });

  audio.addEventListener('ended', () => {
    if (repeatMode === 2) {
      audio.currentTime = 0;
      audio.play();
    } else if (repeatMode === 1 || playlistIdx < playlist.length - 1 || isShuffle) {
      playNext();
    } else {
      isPlaying = false;
      updatePlayPauseIcon();
    }
  });

  audio.addEventListener('play', () => {
    isPlaying = true;
    updatePlayPauseIcon();
    triggerRPCUpdate(true);
  });

  audio.addEventListener('pause', () => {
    isPlaying = false;
    updatePlayPauseIcon();
    triggerRPCUpdate(false);
  });

  // ── Progress Seek ──────────────────────────────────────────────
  let seekingProgress = false;
  progressTrack.addEventListener('mousedown', (e) => {
    seekingProgress = true;
    seekProgress(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (seekingProgress) seekProgress(e);
  });
  document.addEventListener('mouseup', () => {
    if (seekingProgress) {
      seekingProgress = false;
      triggerRPCUpdate();
    }
  });

  function seekProgress(e) {
    const rect = progressTrack.getBoundingClientRect();
    let pct = (e.clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    if (audio.duration) audio.currentTime = pct * audio.duration;
    progressFill.style.width = (pct * 100) + '%';
  }

  // ── Volume ─────────────────────────────────────────────────────
  let seekingVolume = false;
  volumeTrack.addEventListener('mousedown', (e) => {
    seekingVolume = true;
    seekVolume(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (seekingVolume) seekVolume(e);
  });
  document.addEventListener('mouseup', () => { seekingVolume = false; });

  function seekVolume(e) {
    const rect = volumeTrack.getBoundingClientRect();
    let pct = (e.clientX - rect.left) / rect.width;
    pct = Math.max(0, Math.min(1, pct));
    audio.volume = pct;
    volumeFill.style.width = (pct * 100) + '%';
    volumeHandle.style.left = (pct * 100) + '%';
    updateVolumeIcon();
  }

  function updateVolumeIcon() {
    const muted = audio.volume === 0;
    iconVolOn.style.display = muted ? 'none' : 'block';
    iconVolMute.style.display = muted ? 'block' : 'none';
  }

  btnVolume.addEventListener('click', () => {
    if (audio.volume > 0) {
      audio._prevVol = audio.volume;
      audio.volume = 0;
    } else {
      audio.volume = audio._prevVol || 0.8;
    }
    volumeFill.style.width = (audio.volume * 100) + '%';
    volumeHandle.style.left = (audio.volume * 100) + '%';
    updateVolumeIcon();
  });

  // ═══════════════════════════════════════════════════════════════
  //  LIKES & PLAYLIST STORAGE
  // ═══════════════════════════════════════════════════════════════

  function getMergedLikedTracks() {
    const merged = [...likedTracks];
    syncedLikedTracks.forEach(st => {
      if (!merged.some(t => t.id === st.id)) {
        merged.push(st);
      }
    });
    return merged;
  }

  function isLiked(trackId) {
    return getMergedLikedTracks().some(t => t.id === trackId);
  }

  function toggleLike(track) {
    if (isLiked(track.id)) {
      likedTracks = likedTracks.filter(t => t.id !== track.id);
    } else {
      likedTracks.unshift(track);
    }
    localStorage.setItem('sonart-liked', JSON.stringify(likedTracks));
    updateLikeButton();
    if (currentPage === 'library') renderLibrary();
  }

  function updateLikeButton() {
    if (!currentTrack) return;
    playerLike.classList.toggle('liked', isLiked(currentTrack.id));
  }

  playerLike.addEventListener('click', () => {
    if (currentTrack) toggleLike(currentTrack);
  });

  const playerAddPlaylist = $('player-add-playlist');
  if (playerAddPlaylist) {
    playerAddPlaylist.addEventListener('click', () => {
      if (currentTrack) {
        selectedTrackForPlaylist = currentTrack;
        openModal(modalAddToPlaylist);
        renderAddToPlaylistSelection();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  PLAYLIST CREATION & ACTIONS
  // ═══════════════════════════════════════════════════════════════

  function createLocalPlaylist(name) {
    if (!name) return;
    const newP = {
      id: 'local_' + Date.now(),
      title: name,
      description: 'Custom local playlist',
      tracks: []
    };
    localPlaylists.push(newP);
    localStorage.setItem('sonart-playlists', JSON.stringify(localPlaylists));
    renderLibrary();
  }

  function deleteLocalPlaylist(playlistId) {
    localPlaylists = localPlaylists.filter(p => p.id !== playlistId);
    localStorage.setItem('sonart-playlists', JSON.stringify(localPlaylists));
    showPage('library');
  }

  function deleteSyncedPlaylist(playlistId) {
    syncedPlaylists = syncedPlaylists.filter(p => p.id !== playlistId);
    localStorage.setItem('sonart-synced-playlists', JSON.stringify(syncedPlaylists));
    renderLibrary();
    showPage('library');
  }

  function addTrackToLocalPlaylist(playlistId, track) {
    const pl = localPlaylists.find(p => p.id === playlistId);
    if (!pl) return;

    if (pl.tracks.some(t => t.id === track.id)) {
      alert(`"${track.title}" is already in this playlist.`);
      return;
    }

    pl.tracks.push(track);
    localStorage.setItem('sonart-playlists', JSON.stringify(localPlaylists));
  }

  function removeFromLocalPlaylist(playlistId, trackId) {
    const pl = localPlaylists.find(p => p.id === playlistId);
    if (!pl) return;

    pl.tracks = pl.tracks.filter(t => t.id !== trackId);
    localStorage.setItem('sonart-playlists', JSON.stringify(localPlaylists));
    openPlaylistDetails(pl.id, true);
  }

  // ═══════════════════════════════════════════════════════════════
  //  MODALS & AUTO-LOGIN DETECTOR
  // ═══════════════════════════════════════════════════════════════

  function openModal(modal) {
    if (modal) modal.classList.add('active');
  }
  function closeModal(modal) {
    if (modal) modal.classList.remove('active');
  }

  function customConfirm(title, message, okText = 'Delete') {
    return new Promise((resolve) => {
      const modal = $('modal-confirm-delete');
      const titleEl = $('confirm-delete-title');
      const messageEl = $('confirm-delete-message');
      const cancelBtn = $('btn-confirm-delete-cancel');
      const okBtn = $('btn-confirm-delete-ok');

      if (!modal || !titleEl || !messageEl || !cancelBtn || !okBtn) {
        resolve(confirm(message));
        return;
      }

      titleEl.textContent = title;
      messageEl.textContent = message;
      okBtn.textContent = okText;

      openModal(modal);

      const handleCancel = () => {
        closeModal(modal);
        cleanup();
        resolve(false);
      };

      const handleOk = () => {
        closeModal(modal);
        cleanup();
        resolve(true);
      };

      const cleanup = () => {
        cancelBtn.removeEventListener('click', handleCancel);
        okBtn.removeEventListener('click', handleOk);
      };

      cancelBtn.addEventListener('click', handleCancel);
      okBtn.addEventListener('click', handleOk);
    });
  }

  $('btn-create-playlist').addEventListener('click', () => {
    playlistNameInput.value = '';
    openModal(modalCreatePlaylist);
  });
  $('btn-close-create-playlist').addEventListener('click', () => closeModal(modalCreatePlaylist));
  $('btn-submit-create-playlist').addEventListener('click', () => {
    const name = playlistNameInput.value.trim();
    if (name) {
      createLocalPlaylist(name);
      closeModal(modalCreatePlaylist);
    }
  });

  $('btn-import-playlist').addEventListener('click', () => {
    playlistUrlInput.value = '';
    openModal(modalImportPlaylist);
  });
  $('btn-close-import-playlist').addEventListener('click', () => closeModal(modalImportPlaylist));
  $('btn-submit-import-playlist').addEventListener('click', async () => {
    const val = playlistUrlInput.value.trim();
    if (!val) return;
    closeModal(modalImportPlaylist);

    showPage('playlist');
    playlistTitleEl.textContent = 'Importing playlist...';
    playlistDescEl.textContent = 'Fetching playlist details and tracks from YouTube Music backend.';
    playlistArt.style.display = 'none';
    playlistArtPlaceholder.style.display = 'flex';
    playlistTracksList.innerHTML = '';
    playlistEmptyState.style.display = 'none';
    btnPlaylistPlay.style.display = 'none';
    btnPlaylistDelete.style.display = 'none';

    try {
      const playlistData = await apiGet(`/playlist/import?url_or_id=${encodeURIComponent(val)}`);

      const isDuplicate = localPlaylists.some(p => p.id === playlistData.id);
      if (!isDuplicate) {
        const newP = {
          id: playlistData.id,
          title: playlistData.title || 'Imported Playlist',
          description: playlistData.description || 'Imported YouTube Music Playlist',
          artwork: playlistData.artwork || '',
          tracks: playlistData.tracks || []
        };
        localPlaylists.push(newP);
        localStorage.setItem('sonart-playlists', JSON.stringify(localPlaylists));
      }

      openPlaylistDetails(playlistData.id);
    } catch (err) {
      console.error('[Sonart] Failed to import playlist:', err);
      playlistTitleEl.textContent = 'Failed to Import';
      playlistDescEl.textContent = 'Ensure the playlist is public and the URL is correct.';
    }
  });

  // Settings
  function updateSettingsStats() {
    const statLikes = $('stat-likes-count');
    const statPlaylists = $('stat-playlists-count');
    if (statLikes) statLikes.textContent = likedTracks.length;
    if (statPlaylists) statPlaylists.textContent = localPlaylists.length;
  }

  // Lyrics Events
  // Vibe Mode DOM
  const btnVibeToggle = $('btn-vibe-toggle');
  const btnVibeExit = $('btn-vibe-exit');
  const vibeTitle = $('vibe-title');
  const vibeArtist = $('vibe-artist');
  const vibeCtrlPlay = $('vibe-ctrl-play');
  const vibeCtrlPrev = $('vibe-ctrl-prev');
  const vibeCtrlNext = $('vibe-ctrl-next');
  const vibeIconPlay = $('vibe-icon-play');
  const vibeIconPause = $('vibe-icon-pause');
  const vibeProgressTrack = $('vibe-progress-track');
  const vibeProgressFill = $('vibe-progress-fill');
  const vibeTimeCurrent = $('vibe-time-current');
  const vibeTimeTotal = $('vibe-time-total');
  const vibeBgBlob1 = document.querySelector('#lyrics-vibe-bg .blob-1');
  const vibeBgBlob2 = document.querySelector('#lyrics-vibe-bg .blob-2');

  if (btnLyrics) {
    btnLyrics.addEventListener('click', () => {
      if (!currentTrack) {
        showQueueNotification('No track currently playing');
        return;
      }
      openModal(modalLyrics);
      loadActiveTrackLyrics();
    });
  }

  if (btnCloseLyrics) {
    btnCloseLyrics.addEventListener('click', () => {
      if (vibeMode) exitVibeMode();
      closeModal(modalLyrics);
    });
  }

  if (modalLyrics) {
    modalLyrics.addEventListener('click', (e) => {
      // Only close if clicking the raw overlay, not when in vibe mode
      if (e.target === modalLyrics && !vibeMode) closeModal(modalLyrics);
    });
  }

  // ── Vibe Mode Toggle ──────────────────────────────────────────
  function enterVibeMode() {
    vibeMode = true;
    modalLyrics.classList.add('vibe-mode-active');

    // Sync track info to vibe header
    if (currentTrack) {
      vibeTitle.textContent = currentTrack.title || 'Unknown';
      vibeArtist.textContent = currentTrack.user?.name || 'Unknown Artist';

      // Load artwork into ambient blobs
      const artUrl = getArtwork(currentTrack, '480x480');
      if (artUrl && vibeBgBlob1 && vibeBgBlob2) {
        vibeBgBlob1.style.backgroundImage = `url("${artUrl}")`;
        vibeBgBlob2.style.backgroundImage = `url("${artUrl}")`;
      }
    }

    // Sync vibe play/pause state
    syncVibePlayState();
    syncVibeProgress();
  }

  function exitVibeMode() {
    vibeMode = false;
    modalLyrics.classList.remove('vibe-mode-active');
  }

  if (btnVibeToggle) {
    btnVibeToggle.addEventListener('click', () => enterVibeMode());
  }
  if (btnVibeExit) {
    btnVibeExit.addEventListener('click', () => exitVibeMode());
  }

  // ── Keyboard: Escape exits Vibe Mode first ────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && vibeMode) {
      e.preventDefault();
      e.stopPropagation();
      exitVibeMode();
    }
  });

  // ── Vibe Floating Controls: Bridge to main player ─────────────
  if (vibeCtrlPlay) {
    vibeCtrlPlay.addEventListener('click', () => togglePlay());
  }
  if (vibeCtrlPrev) {
    vibeCtrlPrev.addEventListener('click', () => playPrev());
  }
  if (vibeCtrlNext) {
    vibeCtrlNext.addEventListener('click', () => playNext());
  }

  // Sync vibe play/pause icon with player state
  function syncVibePlayState() {
    if (!vibeIconPlay || !vibeIconPause) return;
    vibeIconPlay.style.display = isPlaying ? 'none' : 'block';
    vibeIconPause.style.display = isPlaying ? 'block' : 'none';
  }

  // Sync vibe progress bar & time
  function syncVibeProgress() {
    if (!vibeMode) return;
    if (audio.duration && vibeProgressFill) {
      const pct = (audio.currentTime / audio.duration) * 100;
      vibeProgressFill.style.width = pct + '%';
    }
    if (vibeTimeCurrent) vibeTimeCurrent.textContent = formatTime(audio.currentTime);
    if (vibeTimeTotal) vibeTimeTotal.textContent = formatTime(audio.duration);
  }

  // Hook into existing timeupdate for vibe sync
  audio.addEventListener('timeupdate', () => {
    if (vibeMode) syncVibeProgress();
  });
  audio.addEventListener('loadedmetadata', () => {
    if (vibeMode && vibeTimeTotal) vibeTimeTotal.textContent = formatTime(audio.duration);
  });
  audio.addEventListener('play', () => { syncVibePlayState(); });
  audio.addEventListener('pause', () => { syncVibePlayState(); });

  // Vibe progress track seeking
  if (vibeProgressTrack) {
    let seekingVibe = false;
    vibeProgressTrack.addEventListener('mousedown', (e) => {
      seekingVibe = true;
      seekVibeProgress(e);
    });
    document.addEventListener('mousemove', (e) => {
      if (seekingVibe) seekVibeProgress(e);
    });
    document.addEventListener('mouseup', () => {
      if (seekingVibe) {
        seekingVibe = false;
        triggerRPCUpdate();
      }
    });

    function seekVibeProgress(e) {
      const rect = vibeProgressTrack.getBoundingClientRect();
      let pct = (e.clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      if (audio.duration) audio.currentTime = pct * audio.duration;
      if (vibeProgressFill) vibeProgressFill.style.width = (pct * 100) + '%';
    }
  }

  // ── Load Lyrics Function ──────────────────────────────────────
  async function loadActiveTrackLyrics() {
    if (!currentTrack) return;

    lyricsTitle.textContent = currentTrack.title;
    lyricsSubtitle.textContent = currentTrack.user?.name || 'Unknown Artist';
    lyricsText.innerHTML = '<div style="opacity: 0.6; padding: 40px 0;">Searching for lyrics...</div>';
    lyricsSource.textContent = '';

    // Reset synced lyrics state
    syncedLyricsLines = [];
    activeLyricIndex = -1;

    try {
      const title = encodeURIComponent(currentTrack.title);
      const artist = encodeURIComponent(currentTrack.user?.name || '');
      const duration = audio.duration ? Math.round(audio.duration) : 0;
      
      const data = await apiGet(`/lyrics?id=${currentTrack.id}&title=${title}&artist=${artist}&duration=${duration}`);
      
      if (data && data.synced && data.lines && data.lines.length > 0) {
        lyricsText.innerHTML = '';
        data.lines.forEach((line, idx) => {
          const div = document.createElement('div');
          div.textContent = line.text || ' ';
          div.style.setProperty('--line-delay', `${idx * 30}ms`);
          
          // Let clicking on a lyric line seek the audio player!
          div.addEventListener('click', () => {
            if (audio.duration) {
              audio.currentTime = line.time;
              // Play if paused
              if (audio.paused) {
                audio.play().catch(err => console.warn('[Sonart] Play failed on click:', err));
              }
            }
          });
          
          lyricsText.appendChild(div);
          
          syncedLyricsLines.push({
            time: line.time,
            text: line.text,
            element: div
          });
        });

        if (data.source) {
          lyricsSource.textContent = `Source: ${data.source}`;
        } else {
          lyricsSource.textContent = '';
        }
      } else if (data && data.lyrics) {
        // Fallback to plain text lyrics
        const lines = data.lyrics.split('\n');
        lyricsText.innerHTML = '';
        lines.forEach((line, idx) => {
          const div = document.createElement('div');
          div.textContent = line.trim() || ' ';
          div.style.setProperty('--line-delay', `${idx * 30}ms`);
          lyricsText.appendChild(div);
        });

        if (data.source) {
          lyricsSource.textContent = `Source: ${data.source}`;
        } else {
          lyricsSource.textContent = '';
        }
      } else {
        lyricsText.innerHTML = '<div style="opacity: 0.5; padding: 40px 0;">Lyrics not found for this track.</div>';
        lyricsSource.textContent = '';
      }
    } catch (err) {
      console.error('[Sonart] Failed to load lyrics:', err);
      lyricsText.innerHTML = '<div style="opacity: 0.5; padding: 40px 0; color: #ff4d4d;">Failed to load lyrics. Please try again.</div>';
      lyricsSource.textContent = '';
    }
  }

  // Settings Tab Switching
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const targetPanel = $(`settings-panel-${btn.dataset.settingsTab}`);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // Manual Setup Toggle
  const toggleManualBtn = $('btn-toggle-manual');
  if (toggleManualBtn) {
    toggleManualBtn.addEventListener('click', () => {
      const container = $('manual-setup-container');
      if (container) {
        const isHidden = container.style.display === 'none';
        container.style.display = isHidden ? 'block' : 'none';
        toggleManualBtn.textContent = isHidden ? 'Hide Manual Setup' : 'Show Manual Setup (Advanced)';
      }
    });
  }

  // Clear Cache Button
  const btnClearCache = $('btn-clear-cache');
  if (btnClearCache) {
    btnClearCache.addEventListener('click', async () => {
      btnClearCache.textContent = 'Clearing...';
      btnClearCache.disabled = true;
      try {
        await apiPost('/auth/clear-cache', {});
        homePageNum = 0;
        homeHasMore = true;
        await loadHomeFeed();
        closeModal(modalSettings);
      } catch (err) {
        console.error('[Sonart] Failed to clear cache:', err);
      } finally {
        btnClearCache.textContent = 'Clear Application Cache';
        btnClearCache.disabled = false;
      }
    });
  }
  $('btn-close-add-to-playlist').addEventListener('click', () => closeModal(modalAddToPlaylist));

  // Trigger Automatic Login Window
  $('btn-login-window').addEventListener('click', () => {
    window.sonart.startLoginFlow();
  });

  // Handle Login Window Success Event
  window.sonart.onLoginSuccess(async () => {
    console.log('[Sonart] Login window authentication succeeded! Refreshing feeds...');
    closeModal(modalSettings);
    await refreshAuthStatus();
    await syncPrivatePlaylists();
    await loadHomeFeed();
  });

  async function refreshAuthStatus() {
    try {
      const status = await apiGet('/auth/status');
      if (status.authenticated) {
        authUnlinkedState.style.display = 'none';
        authLinkedState.style.display = 'block';
      } else {
        authUnlinkedState.style.display = 'block';
        authLinkedState.style.display = 'none';
      }
    } catch (e) {
      console.error('[Sonart] Auth check failed:', e);
    }
  }

  $('btn-submit-auth').addEventListener('click', async () => {
    const rawHeaders = authHeadersInput.value.trim();
    if (!rawHeaders) return;

    try {
      const res = await apiPost('/auth/setup', { headers: rawHeaders });
      if (res.success) {
        authHeadersInput.value = '';
        await refreshAuthStatus();
        await syncPrivatePlaylists();
        await loadHomeFeed();
        closeModal(modalSettings);
      }
    } catch (err) {
      alert('Authentication failed: ' + err.message);
    }
  });

  $('btn-logout').addEventListener('click', async () => {
    try {
      const res = await apiPost('/auth/logout');
      if (res.success) {
        syncedPlaylists = [];
        syncedLikedTracks = [];
        localStorage.removeItem('sonart-synced-playlists');
        localStorage.removeItem('sonart-synced-liked-tracks');
        await refreshAuthStatus();
        renderLibrary();
        await loadHomeFeed();
      }
    } catch (err) {
      console.error('[Sonart] Logout failed:', err);
    }
  });

  $('btn-sync-playlists').addEventListener('click', async () => {
    await syncPrivatePlaylists();
  });

  async function syncPrivatePlaylists() {
    const btn = $('btn-sync-playlists');
    btn.textContent = 'Syncing...';
    btn.disabled = true;
    try {
      const [resPlaylists, resLiked] = await Promise.all([
        apiGet('/library/playlists').catch(err => { console.warn('Playlists fetch error:', err); return { playlists: [] }; }),
        apiGet('/library/liked').catch(err => { console.warn('Liked tracks fetch error:', err); return { tracks: [] }; })
      ]);
      syncedPlaylists = resPlaylists.playlists || [];
      syncedLikedTracks = resLiked.tracks || [];
      localStorage.setItem('sonart-synced-playlists', JSON.stringify(syncedPlaylists));
      localStorage.setItem('sonart-synced-liked-tracks', JSON.stringify(syncedLikedTracks));
      renderLibrary();
      closeModal(modalSettings);
      showPage('library');
      showQueueNotification('Synced playlists and liked tracks successfully!');
    } catch (e) {
      alert('Failed to sync: ' + e.message);
    } finally {
      btn.textContent = 'Sync Now';
      btn.disabled = false;
    }
  }

  function renderAddToPlaylistSelection() {
    addToPlaylistsContainer.innerHTML = '';

    const allPlaylists = [
      ...localPlaylists.map(p => ({ ...p, isLocal: true })),
      ...syncedPlaylists.map(p => ({ ...p, isLocal: false }))
    ];

    if (allPlaylists.length === 0) {
      addToPlaylistsContainer.innerHTML = '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:12px;">No playlists available. Create one in Library first.</p>';
      return;
    }

    allPlaylists.forEach(pl => {
      const item = document.createElement('button');
      item.className = 'add-to-playlist-item';

      let art = pl.artwork || '';
      if (!art && pl.tracks && pl.tracks.length > 0) {
        art = getArtwork(pl.tracks[0], '150x150');
      }

      item.innerHTML = `
        <div class="add-to-playlist-art">
          ${art ? `<img src="${art}" style="width:100%;height:100%;object-fit:cover;"/>` :
          `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}
        </div>
        <div style="display: flex; flex-direction: column; text-align: left; margin-left: 10px;">
          <span class="add-to-playlist-title" style="font-size: 13px; font-weight: 500; color: var(--text);">${escapeHtml(pl.title)}</span>
          <span class="add-to-playlist-type" style="font-size: 10px; color: var(--text-3); margin-top: 2px;">${pl.isLocal ? 'LOCAL PLAYLIST' : 'YTMUSIC PLAYLIST'}</span>
        </div>
      `;

      item.addEventListener('click', async () => {
        if (selectedTrackForPlaylist) {
          const trackToInsert = selectedTrackForPlaylist;
          closeModal(modalAddToPlaylist);
          selectedTrackForPlaylist = null;

          if (pl.isLocal) {
            addTrackToLocalPlaylist(pl.id, trackToInsert);
            showQueueNotification(`Added "${trackToInsert.title}" to local playlist "${pl.title}"`);
          } else {
            // Synced YouTube Music playlist
            showQueueNotification(`Adding "${trackToInsert.title}" to YouTube Music...`);
            try {
              const res = await apiPost(`/playlist/${pl.id}/add`, { video_id: trackToInsert.id });
              if (res.success) {
                showQueueNotification(`Successfully added to YouTube Music playlist "${pl.title}"!`);
                // Re-fetch the playlist tracks to update the UI & local cache!
                const updatedPl = await apiGet(`/playlist/${pl.id}`);
                // Update in syncedPlaylists local array and save to localStorage
                const idx = syncedPlaylists.findIndex(p => p.id === pl.id);
                if (idx !== -1) {
                  syncedPlaylists[idx].tracks = updatedPl.tracks;
                  syncedPlaylists[idx].artwork = updatedPl.artwork;
                  localStorage.setItem('sonart-synced-playlists', JSON.stringify(syncedPlaylists));
                }
                // If the user is currently viewing this playlist details page, refresh the display!
                if (currentPage === 'playlist' && pagePlaylist.classList.contains('active') && playlistTitleEl.textContent === pl.title) {
                  openPlaylistDetails(pl.id);
                }
              }
            } catch (err) {
              console.error('[Sonart] Failed to add track to remote playlist:', err);
              showQueueNotification(`Failed to add track to YTM: ${err.message}`);
            }
          }
        }
      });

      addToPlaylistsContainer.appendChild(item);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  LIBRARY VIEW SWITCHERS
  // ═══════════════════════════════════════════════════════════════

  document.querySelectorAll('.lib-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');

      currentLibView = e.currentTarget.dataset.libView;
      showLibraryView(currentLibView);
    });
  });

  function showLibraryView(view) {
    if (view === 'playlists') {
      $('lib-view-playlists').style.display = 'block';
      $('lib-view-liked').style.display = 'none';
    } else {
      $('lib-view-playlists').style.display = 'none';
      $('lib-view-liked').style.display = 'block';
    }
  }

  function renderPlaylistsGrid() {
    playlistsGrid.innerHTML = '';
    const allPlaylists = [...localPlaylists, ...syncedPlaylists];

    if (allPlaylists.length === 0) {
      playlistsGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <p>No playlists found</p>
          <p class="empty-sub">Create a new local playlist or sync with YouTube Music</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();
    allPlaylists.forEach(pl => {
      const card = document.createElement('div');
      card.className = 'playlist-card';

      let art = pl.artwork || '';
      if (!art && pl.tracks && pl.tracks.length > 0) {
        art = getArtwork(pl.tracks[0], '480x480');
      }

      const isLocal = localPlaylists.some(p => p.id === pl.id) || pl.id.toString().startsWith('local_');

      card.innerHTML = `
        <div class="playlist-card-art">
          ${art ? `<img src="${art}" alt="${escapeHtml(pl.title)}" loading="lazy"/>` : `
            <div class="playlist-card-placeholder">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </div>
          `}
        </div>
        <div class="playlist-card-details">
          <div class="playlist-card-title">${escapeHtml(pl.title)}</div>
          <div class="playlist-card-count">${isLocal ? 'LOCAL' : 'YTMUSIC'} • ${pl.tracks ? pl.tracks.length : pl.trackCount || 0} TRACKS</div>
        </div>
      `;

      card.addEventListener('click', () => {
        openPlaylistDetails(pl.id);
      });

      fragment.appendChild(card);
    });
    playlistsGrid.appendChild(fragment);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PLAYLIST DETAILS LOADING PAGE
  // ═══════════════════════════════════════════════════════════════

  async function openPlaylistDetails(playlistId, playlistTitle = '', isArtist = false, artistArt = '') {
    if (!playlistId) return;
    currentOpenPlaylistId = playlistId;

    // If it's a song ID (standard 11 character YouTube video ID), don't open playlist details, play it directly!
    const idStr = playlistId.toString();
    if (idStr.length === 11 &&
      !idStr.startsWith('PL') &&
      !idStr.startsWith('VL') &&
      !idStr.startsWith('RD') &&
      !idStr.startsWith('UC') &&
      !idStr.startsWith('artist_') &&
      !idStr.startsWith('local_')) {
      console.log(`[Sonart] Detected song ID ${playlistId}. Playing song instead of opening playlist menu.`);
      playTrack({ id: idStr, title: playlistTitle || 'Track', user: { name: 'Unknown' } });
      return;
    }

    showPage('playlist');
    btnPlaylistPlay.style.display = 'none';
    btnPlaylistDelete.style.display = 'none';
    playlistArt.style.display = 'none';
    playlistArtPlaceholder.style.display = 'flex';
    playlistTracksList.innerHTML = '';
    playlistEmptyState.style.display = 'none';

    if (playlistId && playlistId.toString().startsWith('artist_')) {
      isArtist = true;
      if (!playlistTitle) {
        playlistTitle = playlistId.toString().substring(7);
      }
    }

    const isLocal = localPlaylists.some(p => p.id === playlistId) || playlistId.toString().startsWith('local_');
    const isSynced = syncedPlaylists.some(p => p.id === playlistId);
    const isArt = isArtist || playlistId.toString().startsWith('UC') || playlistId.toString().startsWith('artist_');


    if (isLocal) {
      const pl = localPlaylists.find(p => p.id === playlistId);
      if (!pl) return;

      playlistTypeBadge.textContent = 'LOCAL PLAYLIST';
      playlistTitleEl.textContent = pl.title;
      playlistDescEl.textContent = pl.description || 'Custom playlist on Sonart';

      let firstArt = pl.tracks && pl.tracks.length > 0 ? getArtwork(pl.tracks[0], '480x480') : '';
      if (firstArt) {
        playlistArt.src = firstArt;
        playlistArt.style.display = 'block';
        playlistArtPlaceholder.style.display = 'none';
      }

      btnPlaylistDelete.style.display = 'block';

      const deleteBtn = $('btn-playlist-delete');
      const newDeleteBtn = deleteBtn.cloneNode(true);
      deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
      newDeleteBtn.addEventListener('click', async () => {
        if (await customConfirm('Delete Playlist', `Are you sure you want to delete "${pl.title}"? This action cannot be undone.`)) {
          deleteLocalPlaylist(pl.id);
        }
      });

      // Hide sort container
      $('playlist-sort-container').style.display = 'none';

      originalPlaylistTracks = pl.tracks ? [...pl.tracks] : [];
      currentPlaylistTracks = pl.tracks ? [...pl.tracks] : [];

      if (currentPlaylistTracks.length > 0) {
        btnPlaylistPlay.style.display = 'block';
        renderTrackList(playlistTracksList, currentPlaylistTracks, currentPlaylistTracks, true, pl.id);

        const playBtn = $('btn-playlist-play');
        const newPlayBtn = playBtn.cloneNode(true);
        playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
        newPlayBtn.addEventListener('click', () => {
          lastChosenPlaylist = currentPlaylistTracks;
          lastClickedTrack = currentPlaylistTracks[0];
          buildQueueForTrack(currentPlaylistTracks[0], currentPlaylistTracks);
        });
      } else {
        playlistEmptyState.style.display = 'flex';
      }
    }
    else if (isArt) {
      playlistTypeBadge.textContent = 'ARTIST';
      playlistTitleEl.textContent = playlistTitle || 'Artist';
      playlistDescEl.textContent = 'Top Songs';

      let art = artistArt || '';
      if (art) {
        playlistArt.src = art;
        playlistArt.style.display = 'block';
        playlistArtPlaceholder.style.display = 'none';
      }

      try {
        const queryTitle = playlistTitle || 'Artist';
        const searchResults = await apiGet(`/search?q=${encodeURIComponent(queryTitle)} songs`);
        const tracks = Array.isArray(searchResults) ? searchResults : (searchResults.data || searchResults.tracks || []);

        if (!art && tracks.length > 0) {
          art = getArtwork(tracks[0], '480x480');
          if (art) {
            playlistArt.src = art;
            playlistArt.style.display = 'block';
            playlistArtPlaceholder.style.display = 'none';
          }
        }

        originalPlaylistTracks = [...tracks];
        currentPlaylistTracks = [...tracks];

        // Sort descending by views count (popularity) on initial load
        currentPlaylistTracks.sort((a, b) => (b.views_count || 0) - (a.views_count || 0));

        // Show sorting container and set default to popularity
        $('playlist-sort-container').style.display = 'flex';
        $('select-playlist-sort').value = 'popularity';

        if (currentPlaylistTracks.length > 0) {
          btnPlaylistPlay.style.display = 'block';
          renderTrackList(playlistTracksList, currentPlaylistTracks, currentPlaylistTracks, false);

          const playBtn = $('btn-playlist-play');
          const newPlayBtn = playBtn.cloneNode(true);
          playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
          newPlayBtn.addEventListener('click', () => {
            lastChosenPlaylist = currentPlaylistTracks;
            lastClickedTrack = currentPlaylistTracks[0];
            buildQueueForTrack(currentPlaylistTracks[0], currentPlaylistTracks);
          });
        } else {
          playlistEmptyState.style.display = 'flex';
        }
      } catch (err) {
        console.error('[Sonart] Failed to load remote artist songs:', err);
        playlistTitleEl.textContent = 'Failed to load';
        playlistDescEl.textContent = 'Make sure the server is online and you have internet access.';
      }
    }
    else {
      playlistTypeBadge.textContent = 'YOUTUBE MUSIC PLAYLIST';
      playlistTitleEl.textContent = 'Loading Playlist...';
      playlistDescEl.textContent = '';

      // Hide sort container
      $('playlist-sort-container').style.display = 'none';

      try {
        const pl = await apiGet(`/playlist/${playlistId}`);
        playlistTitleEl.textContent = pl.title;
        playlistDescEl.textContent = pl.description || 'Synced YouTube Music playlist';

        if (isSynced) {
          const deleteBtnEl = $('btn-playlist-delete');
          if (deleteBtnEl) {
            deleteBtnEl.style.display = 'block';
            const newDeleteBtn = deleteBtnEl.cloneNode(true);
            deleteBtnEl.parentNode.replaceChild(newDeleteBtn, deleteBtnEl);
            newDeleteBtn.addEventListener('click', async () => {
              if (await customConfirm('Remove Playlist', `Are you sure you want to remove "${pl.title}" from your Sonart library?`, 'Remove')) {
                deleteSyncedPlaylist(playlistId);
              }
            });
          }
        }

        let art = pl.artwork || (pl.tracks && pl.tracks.length > 0 ? getArtwork(pl.tracks[0], '480x480') : '');
        if (art) {
          playlistArt.src = art;
          playlistArt.style.display = 'block';
          playlistArtPlaceholder.style.display = 'none';
        }

        originalPlaylistTracks = pl.tracks ? [...pl.tracks] : [];
        currentPlaylistTracks = pl.tracks ? [...pl.tracks] : [];

        if (currentPlaylistTracks.length > 0) {
          btnPlaylistPlay.style.display = 'block';
          renderTrackList(playlistTracksList, currentPlaylistTracks, currentPlaylistTracks, isSynced, playlistId, isSynced);

          const playBtn = $('btn-playlist-play');
          const newPlayBtn = playBtn.cloneNode(true);
          playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
          newPlayBtn.addEventListener('click', () => {
            lastChosenPlaylist = currentPlaylistTracks;
            lastClickedTrack = currentPlaylistTracks[0];
            buildQueueForTrack(currentPlaylistTracks[0], currentPlaylistTracks);
          });
        } else {
          playlistEmptyState.style.display = 'flex';
        }
      } catch (err) {
        console.error('[Sonart] Failed to load remote playlist:', err);
        playlistTitleEl.textContent = 'Failed to load';
        playlistDescEl.textContent = 'Make sure the server is online and you have internet access.';
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DYNAMIC HOME FEED LOADER (RECOMMENDATIONS & CHANNELS)
  // ═══════════════════════════════════════════════════════════════

  function getHomeSeed() {
    if (recentlyPlayed.length > 0) {
      return recentlyPlayed[0].id;
    }
    if (likedTracks.length > 0) {
      const recentLikes = likedTracks.slice(0, 5);
      const rand = recentLikes[Math.floor(Math.random() * recentLikes.length)];
      return rand.id;
    }
    return '';
  }

  function getHomeSeedTitle() {
    if (recentlyPlayed.length > 0) {
      const track = recentlyPlayed[0];
      const artist = track.user?.name || '';
      return artist ? `${track.title} ${artist}` : track.title;
    }
    if (likedTracks.length > 0) {
      const track = likedTracks[0];
      const artist = track.user?.name || '';
      return artist ? `${track.title} ${artist}` : track.title;
    }
    return '';
  }

  async function loadHomeFeed() {
    homePageNum = 0;
    homeHasMore = true;
    homeFeedSections.innerHTML = '';

    // Render skeleton placeholders
    for (let i = 0; i < 3; i++) {
      const skelWrap = document.createElement('div');
      skelWrap.className = 'home-section';
      skelWrap.innerHTML = `
        <div class="skeleton-text" style="width:200px;height:24px;margin-bottom:18px;"></div>
        <div class="tracks-grid"></div>
      `;
      renderSkeletons(skelWrap.querySelector('.tracks-grid'), 6);
      homeFeedSections.appendChild(skelWrap);
    }

    try {
      const seed = getHomeSeed();
      const seedTitle = getHomeSeedTitle();
      const feed = await apiGet(`/home?page=0&seed=${seed}&seed_title=${encodeURIComponent(seedTitle)}`);
      homeFeedSections.innerHTML = '';

      homeHasMore = feed.has_more !== false;

      if (!feed.sections || feed.sections.length === 0) {
        homeFeedSections.innerHTML = '<p style="color:var(--text-3);padding:24px;">No feed content available right now.</p>';
        return;
      }

      if (feed.sections && feed.sections.length > 0) {
        appendHomeSections(feed.sections);
      }

    } catch (err) {
      console.error('[Sonart] Failed to load home feed:', err);
      homeFeedSections.innerHTML = '<p style="color:var(--text-3);padding:24px;">Could not load recommended home feed sections.</p>';
    }
  }

  function appendHomeSections(sections) {
    const mainFragment = document.createDocumentFragment();
    sections.forEach(sec => {
      const secEl = document.createElement('div');
      secEl.className = 'home-section';
      secEl.style.animation = 'fadeUp 400ms var(--ease-out)';

      const titleEl = document.createElement('h2');
      titleEl.className = 'home-section-title';
      titleEl.textContent = sec.title;

      if (sec.title === 'Playlists for You') {
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'btn-refresh-playlists';
        refreshBtn.title = 'Refresh recommendations';
        refreshBtn.innerHTML = `
          <svg class="refresh-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6"></path>
            <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
          </svg>
        `;
        refreshBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (refreshBtn.classList.contains('spinning')) return;
          refreshBtn.classList.add('spinning');
          try {
            await refreshHomePlaylists();
          } catch(err) {
            console.error('Failed to refresh playlists:', err);
          } finally {
            refreshBtn.classList.remove('spinning');
          }
        });
        titleEl.appendChild(refreshBtn);
      }

      secEl.appendChild(titleEl);

      const gridEl = document.createElement('div');

      if (sec.type === 'artists') {
        gridEl.className = 'playlists-grid';
        const frag = document.createDocumentFragment();
        sec.items.forEach(pl => {
          frag.appendChild(renderFeedPlaylistCard({ ...pl, isArtist: true }));
        });
        gridEl.appendChild(frag);
      } else if (sec.type === 'playlists') {
        gridEl.className = 'playlists-grid';
        const frag = document.createDocumentFragment();
        sec.items.forEach(pl => {
          frag.appendChild(renderFeedPlaylistCard(pl));
        });
        gridEl.appendChild(frag);
      } else {
        // Tracks: render as distinct horizontal feed rows
        gridEl.className = 'feed-tracks-grid';
        const frag = document.createDocumentFragment();
        sec.items.forEach((track, i) => {
          frag.appendChild(renderFeedTrackRow(track, i, sec.items));
        });
        gridEl.appendChild(frag);
      }

      secEl.appendChild(gridEl);
      mainFragment.appendChild(secEl);
    });
    homeFeedSections.appendChild(mainFragment);
  }

  async function refreshHomePlaylists() {
    try {
      const seed = getHomeSeed();
      const seedTitle = getHomeSeedTitle();
      const feed = await apiGet(`/home?page=0&seed=${seed}&seed_title=${encodeURIComponent(seedTitle)}&refresh=true`);
      
      homeFeedSections.innerHTML = '';
      homeHasMore = feed.has_more !== false;

      if (!feed.sections || feed.sections.length === 0) {
        homeFeedSections.innerHTML = '<p style="color:var(--text-3);padding:24px;">No feed content available right now.</p>';
        return;
      }

      if (feed.sections && feed.sections.length > 0) {
        appendHomeSections(feed.sections);
      }
    } catch (err) {
      console.error('[Sonart] Failed to refresh home feed:', err);
    }
  }

  async function loadMoreHomeContent() {
    if (homeLoading || !homeHasMore) return;
    homeLoading = true;
    homePageNum++;

    // Add loading skeleton at bottom
    const loadingEl = document.createElement('div');
    loadingEl.className = 'home-section home-loading-more';
    loadingEl.innerHTML = `
      <div class="skeleton-text" style="width:180px;height:20px;margin-bottom:16px;"></div>
      <div class="playlists-grid"></div>
    `;
    renderSkeletons(loadingEl.querySelector('.playlists-grid'), 4);
    homeFeedSections.appendChild(loadingEl);

    try {
      const feed = await apiGet(`/home?page=${homePageNum}`);
      // Remove skeleton
      const loaders = homeFeedSections.querySelectorAll('.home-loading-more');
      loaders.forEach(el => el.remove());

      homeHasMore = feed.has_more !== false;

      if (feed.sections && feed.sections.length > 0) {
        appendHomeSections(feed.sections);
      } else {
        homeHasMore = false;
      }
    } catch (err) {
      console.error('[Sonart] Failed to load more content:', err);
      const loaders = homeFeedSections.querySelectorAll('.home-loading-more');
      loaders.forEach(el => el.remove());
    } finally {
      homeLoading = false;
    }
  }

  // Infinite Scroll listener
  content.addEventListener('scroll', () => {
    if (currentPage !== 'home') return;
    const scrollHeight = content.scrollHeight;
    const scrollTop = content.scrollTop;
    const clientHeight = content.clientHeight;
    // Trigger load when within 400px of bottom
    if (scrollHeight - scrollTop - clientHeight < 400) {
      loadMoreHomeContent();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════════════════════════════════════

  function showPage(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = $(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');

    // Reset tab active statuses
    tabHome.classList.remove('active');
    tabLibrary.classList.remove('active');
    tabSettings.classList.remove('active');

    // Remove positional classes from indicator
    indicator.classList.remove('at-library');
    indicator.classList.remove('at-settings');

    if (page === 'home') {
      tabHome.classList.add('active');
    } else if (page === 'library') {
      indicator.classList.add('at-library');
      tabLibrary.classList.add('active');
      renderLibrary();
    } else if (page === 'settings') {
      indicator.classList.add('at-settings');
      tabSettings.classList.add('active');
      refreshAuthStatus();
      updateSettingsStats();
    }

    content.scrollTop = 0;
  }

  function renderLibrary() {
    const allLiked = getMergedLikedTracks();
    likedCount.textContent = allLiked.length;
    renderPlaylistsGrid();
    renderTrackList(likedList, allLiked, allLiked, false);
    if (allLiked.length === 0) {
      likedEmpty.style.display = 'flex';
      likedList.style.display = 'none';
    } else {
      likedEmpty.style.display = 'none';
      likedList.style.display = 'block';
    }
  }

  tabHome.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    showPage('home');
  });
  tabLibrary.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    showPage('library');
  });
  tabSettings.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    showPage('settings');
  });

  // ═══════════════════════════════════════════════════════════════
  //  SEARCH
  // ═══════════════════════════════════════════════════════════════

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    searchClear.style.display = q ? 'flex' : 'none';

    clearTimeout(searchDebounce);
    if (q.length >= 2) {
      searchDebounce = setTimeout(() => performSearch(q), 400);
    } else if (q.length === 0) {
      showPage(currentPage === 'search' ? 'home' : currentPage);
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchDebounce);
      const q = searchInput.value.trim();
      if (q) performSearch(q);
    }
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    if (currentPage === 'search') showPage('home');
    searchInput.focus();
  });

  async function performSearch(query) {
    showPage('search');
    searchTitle.textContent = `"${query}"`;
    searchCount.textContent = 'Searching...';
    renderSkeletons(searchGrid, 8);
    searchEmpty.style.display = 'none';

    try {
      const results = await searchTracks(query);
      if (results && results.length > 0) {
        searchCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
        renderGrid(searchGrid, results, results);
        searchEmpty.style.display = 'none';
      } else {
        searchGrid.innerHTML = '';
        searchCount.textContent = '';
        searchEmpty.style.display = 'flex';
      }
    } catch (err) {
      console.error('[Sonart] Search failed:', err);
      searchGrid.innerHTML = '';
      searchCount.textContent = 'Search failed';
      searchEmpty.style.display = 'flex';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CONTROLS
  // ═══════════════════════════════════════════════════════════════

  btnPlay.addEventListener('click', togglePlay);
  btnNext.addEventListener('click', playNext);
  btnPrev.addEventListener('click', playPrev);

  btnShuffle.addEventListener('click', () => {
    isShuffle = !isShuffle;
    btnShuffle.classList.toggle('active', isShuffle);
  });

  btnRepeat.addEventListener('click', () => {
    repeatMode = (repeatMode + 1) % 3;
    btnRepeat.classList.toggle('active', repeatMode > 0);
    btnRepeat.title = ['Repeat Off', 'Repeat All', 'Repeat One'][repeatMode];

    // Update repeat-one badge visibility
    const badge = $('repeat-badge');
    if (badge) {
      badge.style.display = (repeatMode === 2) ? 'flex' : 'none';
    }

    if (currentTrack) {
      rebuildQueueOnRepeatToggle();
    }
  });

  // ── Queue Drawer & Actions ─────────────────────────────────────
  const btnQueue = $('btn-queue');
  const queueDrawer = $('queue-drawer');
  const btnCloseQueue = $('btn-close-queue');
  const btnClearQueue = $('btn-clear-queue');

  const btnQueuePrev = $('btn-queue-prev');
  const btnQueuePlay = $('btn-queue-play');
  const btnQueueNext = $('btn-queue-next');

  if (btnQueuePrev) btnQueuePrev.addEventListener('click', playPrev);
  if (btnQueuePlay) btnQueuePlay.addEventListener('click', togglePlay);
  if (btnQueueNext) btnQueueNext.addEventListener('click', playNext);

  if (btnQueue && queueDrawer) {
    btnQueue.addEventListener('click', () => {
      queueDrawer.classList.toggle('active');
      btnQueue.classList.toggle('active', queueDrawer.classList.contains('active'));
      if (queueDrawer.classList.contains('active')) {
        renderQueue();
      }
    });
  }

  if (btnCloseQueue && queueDrawer) {
    btnCloseQueue.addEventListener('click', () => {
      queueDrawer.classList.remove('active');
      if (btnQueue) btnQueue.classList.remove('active');
    });
  }

  if (btnClearQueue) {
    btnClearQueue.addEventListener('click', () => {
      if (playlist.length > 0) {
        playlist = playlist.slice(0, playlistIdx + 1);
        renderQueue();
        showQueueNotification('Cleared upcoming queue tracks');
      }
    });
  }

  function renderQueue() {
    const nowPlayingContainer = $('queue-now-playing');
    const nextUpContainer = $('queue-next-up');
    if (!nowPlayingContainer || !nextUpContainer) return;

    nowPlayingContainer.innerHTML = '';
    nextUpContainer.innerHTML = '';

    if (currentTrack) {
      const art = getArtwork(currentTrack, '150x150');
      const item = document.createElement('div');
      item.className = 'queue-item playing';
      item.dataset.trackId = currentTrack.id;
      item.innerHTML = `
        <div class="queue-item-art">
          ${art ? `<img src="${art}" alt="" onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${currentTrack.id}/hqdefault.jpg';"/>` : `<div style="width:100%;height:100%;background:#111;"></div>`}
        </div>
        <div class="queue-item-info">
          <div class="queue-item-title">${escapeHtml(currentTrack.title)}</div>
          <div class="queue-item-artist">${escapeHtml(currentTrack.user?.name || 'Unknown')}</div>
        </div>
      `;
      nowPlayingContainer.appendChild(item);
    } else {
      nowPlayingContainer.innerHTML = '<p style="color:var(--text-3);font-size:12px;padding:8px;">Nothing playing</p>';
    }

    const nextTracks = playlist.slice(playlistIdx + 1);
    if (nextTracks.length === 0) {
      nextUpContainer.innerHTML = '<p style="color:var(--text-3);font-size:12px;padding:8px;">No upcoming tracks</p>';
    } else {
      const fragment = document.createDocumentFragment();
      nextTracks.forEach((track, index) => {
        const actualIdx = playlistIdx + 1 + index;
        const art = getArtwork(track, '150x150');
        const item = document.createElement('div');
        item.className = 'queue-item';
        item.dataset.trackId = track.id;
        item.innerHTML = `
          <div class="queue-item-art">
            ${art ? `<img src="${art}" alt="" onerror="this.onerror=null; this.src='https://i.ytimg.com/vi/${track.id}/hqdefault.jpg';"/>` : `<div style="width:100%;height:100%;background:#111;"></div>`}
          </div>
          <div class="queue-item-info">
            <div class="queue-item-title">${escapeHtml(track.title)}</div>
            <div class="queue-item-artist">${escapeHtml(track.user?.name || 'Unknown')}</div>
          </div>
          <button class="queue-item-remove" title="Remove from Queue">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        `;

        item.addEventListener('click', (e) => {
          if (e.target.closest('.queue-item-remove')) return;
          playlistIdx = actualIdx;
          playTrack(track, true);
        });

        item.querySelector('.queue-item-remove').addEventListener('click', (e) => {
          e.stopPropagation();
          playlist.splice(actualIdx, 1);
          renderQueue();
        });

        fragment.appendChild(item);
      });
      nextUpContainer.appendChild(fragment);
    }
  }

  window.addToQueue = function (track) {
    if (!playlist.some(t => t.id === track.id)) {
      playlist.push(track);
      if (playlistIdx === -1) {
        playlistIdx = 0;
      }
      renderQueue();
      showQueueNotification(`Added to queue: "${track.title}"`);
    } else {
      showQueueNotification(`Already in queue: "${track.title}"`);
    }
  };

  function addToQueue(track) {
    window.addToQueue(track);
  }

  function buildQueueForTrack(track, chosenPlaylist) {
    currentTrack = track;
    const isRepeatOn = repeatMode > 0;
    const isPlaylistValid = chosenPlaylist && chosenPlaylist.length > 1;

    if (isRepeatOn && isPlaylistValid) {
      playlist = [...chosenPlaylist];
      playlistIdx = playlist.findIndex(t => t.id === track.id);
      if (playlistIdx === -1) {
        playlist.unshift(track);
        playlistIdx = 0;
      }
      console.log(`[Sonart Queue] Repeat ON. Loaded playlist with ${playlist.length} tracks.`);
      playTrack(track, true);
    } else {
      // Repeat OFF or no playlist detected -> Seed 10 similar songs asynchronously!
      playlist = [track];
      playlistIdx = 0;
      playTrack(track, true);

      console.log(`[Sonart Queue] Repeat OFF. Fetching 10 similar songs for: ${track.title}`);
      apiGet(`/radio?id=${track.id}`).then(data => {
        if (data.tracks && data.tracks.length > 0) {
          const similar = data.tracks.filter(t => t.id !== track.id);
          playlist = [track, ...similar.slice(0, 10)];
          renderQueue();
          console.log(`[Sonart Queue] Loaded ${playlist.length - 1} similar songs successfully.`);
        } else {
          loadLikedSongsFallback(track);
        }
      }).catch(err => {
        console.warn('[Sonart Queue] Failed to fetch similar songs, falling back to liked tracks:', err);
        loadLikedSongsFallback(track);
      });
    }
  }

  function loadLikedSongsFallback(track) {
    const liked = getMergedLikedTracks();
    let randomTracks = [];
    if (liked.length > 0) {
      const candidates = liked.filter(t => t.id !== track.id);
      const shuffled = candidates.sort(() => 0.5 - Math.random());
      randomTracks = shuffled.slice(0, 10);
    }
    playlist = [track, ...randomTracks];
    renderQueue();
  }

  function rebuildQueueOnRepeatToggle() {
    if (!currentTrack) return;
    const isRepeatOn = repeatMode > 0;
    const isPlaylistValid = lastChosenPlaylist && lastChosenPlaylist.length > 1;

    if (isRepeatOn && isPlaylistValid) {
      console.log("[Sonart Queue] Repeat toggled ON. Rebuilding queue with full chosen playlist.");
      playlist = [...lastChosenPlaylist];
      playlistIdx = playlist.findIndex(t => t.id === currentTrack.id);
      if (playlistIdx === -1) {
        playlist.unshift(currentTrack);
        playlistIdx = 0;
      }
      renderQueue();
    } else if (!isRepeatOn) {
      console.log("[Sonart Queue] Repeat toggled OFF. Rebuilding queue with 10 similar songs.");
      playlist = [currentTrack];
      playlistIdx = 0;

      apiGet(`/radio?id=${currentTrack.id}`).then(data => {
        if (data.tracks && data.tracks.length > 0) {
          const similar = data.tracks.filter(t => t.id !== currentTrack.id);
          playlist = [currentTrack, ...similar.slice(0, 10)];
          renderQueue();
        } else {
          loadLikedSongsFallback(currentTrack);
        }
      }).catch(() => {
        loadLikedSongsFallback(currentTrack);
      });
    } else {
      console.log("[Sonart Queue] Repeat toggled ON but no playlist detected. Keeping current queue.");
    }
  }


  function showQueueNotification(text) {
    let container = $('queue-notification-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'queue-notification-container';
      container.style.position = 'fixed';
      container.style.bottom = '100px';
      container.style.left = '50%';
      container.style.transform = 'translateX(-50%)';
      container.style.zIndex = '999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '8px';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.background = 'rgba(18, 18, 18, 0.95)';
    toast.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    toast.style.backdropFilter = 'blur(10px)';
    toast.style.color = '#fff';
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '30px';
    toast.style.fontSize = '12px';
    toast.style.fontWeight = '500';
    toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    toast.style.animation = 'fadeUp 300ms cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.pointerEvents = 'none';
    toast.textContent = text;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'fadeIn 300ms reverse ease';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ── Custom Right-Click Context Menu ─────────────────────────────
  let contextTrack = null;
  const contextMenu = $('context-menu');

  document.addEventListener('contextmenu', (e) => {
    const trackEl = e.target.closest('.track-card, .track-row, .feed-track-row, .queue-item');
    if (!trackEl) {
      contextMenu.style.display = 'none';
      return;
    }

    e.preventDefault();

    const trackId = trackEl.dataset.trackId || trackEl.querySelector('[data-track-id]')?.dataset?.trackId;
    if (!trackId) return;

    let track = findTrackById(trackId);
    if (!track) {
      const title = trackEl.querySelector('.track-title, .feed-track-title, .row-title, .queue-item-title')?.textContent || 'Song';
      const artist = trackEl.querySelector('.track-artist, .feed-track-artist, .row-artist, .queue-item-artist, .row-artist-inline')?.textContent || 'Unknown';
      track = { id: trackId, title, user: { name: artist } };
    }

    contextTrack = track;

    const ctxLike = $('ctx-like');
    if (ctxLike) {
      ctxLike.textContent = isLiked(track.id) ? 'Unlike Song' : 'Like Song';
    }

    const menuWidth = 170;
    const menuHeight = 160;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.display = 'block';
  });

  document.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
  });

  function findTrackById(id) {
    const lists = [playlist, likedTracks, syncedLikedTracks, recentlyPlayed, currentPlaylistTracks];
    for (const list of lists) {
      if (!list) continue;
      const found = list.find(t => t.id === id);
      if (found) return found;
    }
    return null;
  }

  $('ctx-play').addEventListener('click', () => {
    if (contextTrack) {
      buildQueueForTrack(contextTrack, lastChosenPlaylist);
    }
  });

  $('ctx-queue').addEventListener('click', () => {
    if (contextTrack) {
      addToQueue(contextTrack);
    }
  });

  $('ctx-playlist').addEventListener('click', () => {
    if (contextTrack) {
      selectedTrackForPlaylist = contextTrack;
      openModal(modalAddToPlaylist);
      renderAddToPlaylistSelection();
    }
  });

  $('ctx-like').addEventListener('click', () => {
    if (contextTrack) {
      toggleLike(contextTrack);
    }
  });

  $('ctx-artist').addEventListener('click', () => {
    if (contextTrack && contextTrack.user?.name) {
      openPlaylistDetails('artist_' + contextTrack.user.name, contextTrack.user.name, true, getArtwork(contextTrack, '480x480'));
    }
  });

  // ── Window Controls ────────────────────────────────────────────
  $('btn-minimize').addEventListener('click', () => window.sonart.minimize());
  $('btn-maximize').addEventListener('click', () => window.sonart.maximize());
  $('btn-close').addEventListener('click', () => window.sonart.close());

  if (window.sonart.onMaximizeChange) {
    window.sonart.onMaximizeChange((max) => {
      const btn = $('btn-maximize');
      btn.title = max ? 'Restore' : 'Maximize';
      btn.innerHTML = max
        ? '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="2" y="0.5" width="7.5" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1"/><rect x="0.5" y="2" width="7.5" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>'
        : '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
    });
  }

  // ── Keyboard Shortcuts ─────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target === searchInput || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if (e.key === 'ArrowRight' && e.ctrlKey) playNext();
    if (e.key === 'ArrowLeft' && e.ctrlKey) playPrev();
    if (e.key === 'F11') { e.preventDefault(); window.sonart.maximize(); }
    if (e.key === '/' || (e.key === 'f' && e.ctrlKey)) {
      e.preventDefault(); searchInput.focus();
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════════

  async function waitForServer(retries = 35, delay = 200) {
    console.log('[Sonart] Waiting for local Flask server to start...');
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`${BACKEND_URL}/auth/status`);
        if (res.ok) {
          console.log(`[Sonart] Backend server connected successfully after ${i + 1} attempts.`);
          return true;
        }
      } catch (e) {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error("Backend server not responding.");
  }

  async function init() {
    try {
      // Wait for backend Flask server to bind to port and respond
      await waitForServer();

      // 1. Initial authentication status check
      await refreshAuthStatus();

      // 2. Fetch authenticated library playlists and liked tracks in parallel
      const authStatus = await apiGet('/auth/status');
      if (authStatus.authenticated) {
        const [resPlaylists, resLiked] = await Promise.all([
          apiGet('/library/playlists').catch(() => ({ playlists: [] })),
          apiGet('/library/liked').catch(() => ({ tracks: [] }))
        ]);
        syncedPlaylists = resPlaylists.playlists || [];
        syncedLikedTracks = resLiked.tracks || [];
        localStorage.setItem('sonart-synced-playlists', JSON.stringify(syncedPlaylists));
        localStorage.setItem('sonart-synced-liked-tracks', JSON.stringify(syncedLikedTracks));
      }

      // Render library list and playlists grid in memory so they are ready
      renderLibrary();

      // 3. Render home dynamic sections (with caching)
      await loadHomeFeed();

    } catch (err) {
      console.error('[Sonart] Init failed:', err);
      // In case server fails to respond, hide loading screen anyway to show UI
      homeFeedSections.innerHTML = '<p style="color:var(--text-3);padding:24px;text-align:center;">Could not connect to Sonart local server. Please restart the application.</p>';
    }

    // Dismiss loading screen after at least 3 seconds from startup
    const elapsed = Date.now() - startTime;
    const remainingTime = Math.max(0, 3000 - elapsed);
    setTimeout(() => loadingScreen.classList.add('hidden'), remainingTime);
  }

  init();
});
