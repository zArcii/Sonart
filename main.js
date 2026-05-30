const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const DiscordRPC = require('discord-rpc');


// Set custom user data directory to prevent cache conflicts
app.setPath('userData', path.join(app.getPath('appData'), 'Sonart'));

let mainWindow;
let pythonProcess = null;

app.on('ready', () => {
  // Override User-Agent to match yt-dlp Chrome desktop agent for youtube CDN compatibility
  session.defaultSession.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Start python backend server
  const scriptPath = path.join(__dirname, 'server.py');
  pythonProcess = spawn('python', [scriptPath], {
    stdio: 'inherit',
    shell: true
  });

  pythonProcess.on('error', (err) => {
    console.error('[Sonart Main] Failed to start Python server:', err);
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    title: 'Sonart',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.webContents.closeDevTools();
  });

  // ── IPC: Window Controls ───────────────────────────────────────
  ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on('window-close', () => mainWindow && mainWindow.close());

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('maximize-change', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('maximize-change', false);
  });

  // ── AUTO LOGIN WINDOW FLOW ─────────────────────────────────────
  let loginWindow = null;

  ipcMain.on('start-login-flow', () => {
    if (loginWindow) {
      loginWindow.focus();
      return;
    }

    const { session } = require('electron');
    const loginSession = session.fromPartition('persist:ytmusic-login');

    loginWindow = new BrowserWindow({
      width: 650,
      height: 750,
      parent: mainWindow,
      modal: true,
      title: 'Sign in to YouTube Music',
      autoHideMenuBar: true,
      backgroundColor: '#0F0F0F',
      webPreferences: {
        session: loginSession,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    loginWindow.loadURL('https://music.youtube.com/');

    const filter = {
      urls: [
        'https://music.youtube.com/youtubei/v1/browse*',
        'https://music.youtube.com/youtubei/v1/search*',
        'https://music.youtube.com/youtubei/v1/next*'
      ]
    };

    let captured = false;

    const checkAndCaptureCookies = async () => {
      if (captured) return;
      try {
        const cookies = await loginSession.cookies.get({ url: 'https://music.youtube.com' });
        const cookieMap = {};
        cookies.forEach(c => {
          cookieMap[c.name] = c.value;
        });

        if (cookieMap['SID'] && cookieMap['HSID'] && (cookieMap['__Secure-3PAPISID'] || cookieMap['SAPISID']) && !captured) {

          captured = true;
          const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

          const authHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/json',
            'X-Goog-AuthUser': '0',
            'x-origin': 'https://music.youtube.com',
            'Cookie': cookieString
          };

          console.log('[Sonart Main] Captured Google Auth Cookies successfully via direct jar extraction.');

          try {
            const response = await fetch('http://127.0.0.1:18492/auth/setup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ headers: JSON.stringify(authHeaders) })
            });
            const res = await response.json();
            if (res.success) {
              console.log('[Sonart Main] Logged in and saved headers_auth.json successfully.');
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('login-success');
              }
              if (loginWindow && !loginWindow.isDestroyed()) {
                loginWindow.close();
              }
            }
          } catch (err) {
            console.error('[Sonart Main] Error setting up authenticated YTMusic API:', err);
            captured = false;
          }
        }
      } catch (e) {
        console.error('[Sonart Main] Cookies extraction error:', e);
      }
    };

    loginSession.cookies.on('changed', checkAndCaptureCookies);

    loginWindow.webContents.on('did-navigate', (event, url) => {
      if (url.includes('music.youtube.com')) {
        checkAndCaptureCookies();
      }
    });

    loginWindow.webContents.on('did-frame-navigate', (event, url) => {
      if (url.includes('music.youtube.com')) {
        checkAndCaptureCookies();
      }
    });

    // Fallback: request header filter
    loginSession.webRequest.onBeforeSendHeaders(filter, async (details, callback) => {
      const headers = details.requestHeaders;
      const cookie = headers['Cookie'] || headers['cookie'];

      if (cookie && cookie.includes('SID=') && cookie.includes('HSID=') && (cookie.includes('__Secure-3PAPISID=') || cookie.includes('SAPISID=')) && !captured) {

        captured = true;

        const authHeaders = {
          'User-Agent': headers['User-Agent'] || headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': headers['Accept'] || headers['accept'] || '*/*',
          'Accept-Language': headers['Accept-Language'] || headers['accept-language'] || 'en-US,en;q=0.5',
          'Content-Type': 'application/json',
          'X-Goog-AuthUser': headers['X-Goog-AuthUser'] || headers['x-goog-authuser'] || '0',
          'x-origin': 'https://music.youtube.com',
          'Cookie': cookie
        };

        console.log('[Sonart Main] Captured Google Auth Cookies & Headers successfully via fallback filter.');

        try {
          const response = await fetch('http://127.0.0.1:18492/auth/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ headers: JSON.stringify(authHeaders) })
          });
          const res = await response.json();
          if (res.success) {
            console.log('[Sonart Main] Logged in and saved headers_auth.json successfully (fallback).');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('login-success');
            }
            if (loginWindow && !loginWindow.isDestroyed()) {
              loginWindow.close();
            }
          }
        } catch (err) {
          console.error('[Sonart Main] Error setting up authenticated YTMusic API in fallback:', err);
          captured = false;
        }
      }
      callback({ cancel: false });
    });

    loginWindow.on('closed', () => {
      loginWindow = null;
    });
  });

  // ── Discord RPC Management ─────────────────────────────────────
  const clientId = '1196161474950332467';
  let rpc = null;
  let isRpcReady = false;

  function initRPC() {
    if (rpc) return;
    try {
      rpc = new DiscordRPC.Client({ transport: 'ipc' });
      
      rpc.on('ready', () => {
        console.log('[Sonart RPC] Connected successfully to Discord.');
        isRpcReady = true;
      });

      rpc.on('error', (err) => {
        console.warn('[Sonart RPC] Connection/Communication error:', err.message);
        isRpcReady = false;
        rpc = null; // Clean up on error to allow clean re-init
      });

      rpc.on('disconnected', () => {
        console.log('[Sonart RPC] Disconnected from Discord.');
        isRpcReady = false;
        rpc = null;
      });

      rpc.login({ clientId }).catch((err) => {
        console.warn('[Sonart RPC] Login failed:', err.message);
        isRpcReady = false;
        rpc = null;
      });
    } catch (e) {
      console.warn('[Sonart RPC] Initialization error:', e.message);
      isRpcReady = false;
      rpc = null;
    }
  }

  // ── IPC: Update Activity ───────────────────────────────────────
  ipcMain.on('update-activity', (event, data) => {
    if (!rpc || !isRpcReady) {
      initRPC();
    }
    
    if (rpc && isRpcReady) {
      try {
        const activity = {
          details: data.title || 'Unknown Title',
          state: `by ${data.artist || 'Unknown Artist'}`,
          largeImageKey: data.artwork && data.artwork.startsWith('http') ? data.artwork : 'youtube_music',
          largeImageText: 'Sonart',
          instance: false,
        };

        if (data.isPlaying) {
          // If playing, add start and end timestamps for Discord's live countdown progress bar
          if (typeof data.currentTime === 'number' && typeof data.duration === 'number' && data.duration > 0) {
            const start = Date.now() - Math.floor(data.currentTime * 1000);
            activity.startTimestamp = start;
            activity.endTimestamp = start + Math.floor(data.duration * 1000);
          } else {
            activity.startTimestamp = Date.now();
          }
          activity.smallImageKey = 'play';
          activity.smallImageText = 'Playing';
        } else {
          activity.smallImageKey = 'pause';
          activity.smallImageText = 'Paused';
        }

        rpc.setActivity(activity).catch((err) => {
          console.warn('[Sonart RPC] Failed to set activity:', err.message);
        });
      } catch (err) {
        console.warn('[Sonart RPC] Failed to update activity payload:', err.message);
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill('SIGINT');
  }
});


