/* ============================================================
   JAM.SYNC — Music Sync Client
   Uses SyncEngine for server-authoritative playback with
   NTP clock sync, scheduled starts, and drift correction.
   ============================================================ */

(function () {
  'use strict';

  // ========== CONFIG ==========
  const WS_URL = 'ws://localhost:3000';

  // ========== STATE ==========
  const state = {
    sync: null,           // SyncEngine instance
    player: null,         // YouTube IFrame player
    playerReady: false,
    queue: [],
    currentTrackId: null,
    isPlaying: false,
    username: `user_${Math.random().toString(36).slice(2, 6)}`,
  };

  // ========== DOM REFS ==========
  const els = {
    lobby: document.getElementById('jamLobby'),
    howItWorks: document.getElementById('jamHowItWorks'),
    room: document.getElementById('jamRoom'),
    createBtn: document.getElementById('createJamBtn'),
    joinBtn: document.getElementById('joinJamBtn'),
    joinCode: document.getElementById('joinJamCode'),
    codeDisplay: document.getElementById('jamCodeDisplay'),
    roomCodeEl: document.getElementById('jamRoomCode'),
    urlInput: document.getElementById('jamUrlInput'),
    addUrlBtn: document.getElementById('jamAddUrl'),
    playPauseBtn: document.getElementById('jamPlayPause'),
    skipBtn: document.getElementById('jamSkip'),
    nowPlaying: document.getElementById('jamNowPlaying'),
    queueList: document.getElementById('jamQueue'),
    leaveBtn: document.getElementById('jamLeave'),
    visualizer: document.getElementById('jamVisualizer'),
    // Sync UI
    connectionBanner: document.getElementById('jamConnectionBanner'),
    syncDot: document.getElementById('jamSyncDot'),
    syncLabel: document.getElementById('jamSyncLabel'),
    syncRtt: document.getElementById('jamSyncRtt'),
  };

  // ========== UTILITIES ==========
  function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  function showToast(msg) {
    if (window.showToast) window.showToast(msg);
  }

  // ========== YOUTUBE IFRAME API ==========
  function loadYouTubeAPI() {
    return new Promise((resolve) => {
      if (window.YT && window.YT.Player) { resolve(); return; }
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = resolve;
    });
  }

  async function initPlayer() {
    await loadYouTubeAPI();

    const container = document.getElementById('jamPlayerContainer');
    container.innerHTML = '<div id="jamPlayer"></div>';

    return new Promise((resolve) => {
      state.player = new YT.Player('jamPlayer', {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          fs: 1,
        },
        events: {
          onReady: () => {
            state.playerReady = true;
            console.log('[jam] YouTube player ready');

            // Create YouTube adapter for SyncEngine
            const adapter = {
              getCurrentTime: () => state.player.getCurrentTime(),
              seekTo: (s) => state.player.seekTo(s, true),
              play: () => state.player.playVideo(),
              pause: () => state.player.pauseVideo(),
              setPlaybackRate: (r) => state.player.setPlaybackRate(r),
              getPlaybackRate: () => state.player.getPlaybackRate(),
            };
            state.sync.setMediaAdapter(adapter);

            resolve();
          },
          onStateChange: (event) => {
            handlePlayerState(event.data);
          },
        },
      });
    });
  }

  function handlePlayerState(playerState) {
    switch (playerState) {
      case YT.PlayerState.PLAYING:
        state.isPlaying = true;
        els.playPauseBtn.textContent = '⏸ pause';
        break;
      case YT.PlayerState.PAUSED:
        state.isPlaying = false;
        els.playPauseBtn.textContent = '▶ play';
        break;
      case YT.PlayerState.ENDED:
        state.isPlaying = false;
        els.playPauseBtn.textContent = '▶ play';
        // Auto-skip to next track
        handleAutoSkip();
        break;
    }
  }

  function handleAutoSkip() {
    if (!state.sync) return;
    const currentIdx = state.queue.findIndex(t => t.videoId === state.currentTrackId);
    if (currentIdx >= 0 && currentIdx < state.queue.length - 1) {
      state.sync.skip();
    }
  }

  // ========== SYNC ENGINE SETUP ==========
  function createSyncEngine() {
    state.sync = new SyncEngine(WS_URL);

    // --- Room Events ---
    state.sync.on('room-created', (msg) => {
      els.codeDisplay.textContent = msg.code;
      showRoom();
      updateConnectionBanner('connected', 'connected — you are the host');
      showToast(`room created: ${msg.code}`);
    });

    state.sync.on('room-joined', (msg) => {
      els.codeDisplay.textContent = msg.code;
      showRoom();
      updateConnectionBanner('connected', 'connected — syncing...');
      showToast(`joined room: ${msg.code}`);

      // Restore queue from server state
      if (msg.queue && msg.queue.length > 0) {
        state.queue = msg.queue;
        updateQueueUI();
      }

      // Handle late join — if track is already playing
      if (msg.playback && msg.playback.trackId && msg.playback.isPlaying) {
        state.currentTrackId = msg.playback.trackId;
        updateNowPlaying();

        // Load video and let drift correction bring us to the right position
        if (state.playerReady) {
          const expectedPos = state.sync.getExpectedPosition();
          state.player.loadVideoById(msg.playback.trackId, expectedPos);
          state.isPlaying = true;
          els.playPauseBtn.textContent = '⏸ pause';
          state.sync.startDriftCorrection();
        }
      } else if (msg.playback && msg.playback.trackId && !msg.playback.isPlaying) {
        state.currentTrackId = msg.playback.trackId;
        updateNowPlaying();
        if (state.playerReady) {
          state.player.cueVideoById(msg.playback.trackId, msg.playback.positionAtOrigin);
        }
      }
    });

    // --- Playback Events ---
    state.sync.on('play', (msg) => {
      state.currentTrackId = msg.trackId;
      state.isPlaying = true;
      els.playPauseBtn.textContent = '⏸ pause';
      updateNowPlaying();
      updateQueueUI();

      // Load video if different
      if (state.playerReady && msg.trackId) {
        const currentVideoUrl = state.player.getVideoUrl && state.player.getVideoUrl();
        const currentId = currentVideoUrl ? extractVideoId(currentVideoUrl) : null;

        if (currentId !== msg.trackId) {
          // New track — load it, then scheduled start will seek+play
          state.player.cueVideoById(msg.trackId, msg.positionAtOrigin);
        }
        // schedulePlayback is called automatically by SyncEngine
      }
    });

    state.sync.on('pause', (msg) => {
      state.isPlaying = false;
      els.playPauseBtn.textContent = '▶ play';
      // SyncEngine already calls adapter.pause()
    });

    state.sync.on('seek', (msg) => {
      // SyncEngine already calls adapter.seekTo()
      updateNowPlaying();
    });

    state.sync.on('load-track', (msg) => {
      state.currentTrackId = msg.trackId;
      state.isPlaying = true;
      els.playPauseBtn.textContent = '⏸ pause';
      updateNowPlaying();
      updateQueueUI();

      // Load the new video
      if (state.playerReady) {
        state.player.cueVideoById(msg.trackId, 0);

        // Schedule playback at the precise server-synced time
        if (msg.scheduledStart) {
          state.sync.schedulePlayback(msg.scheduledStart, 0, msg.trackId);
        }
      }
    });

    // --- Queue Events ---
    state.sync.on('queue-update', (msg) => {
      state.queue = msg.queue || [];
      updateQueueUI();

      // If first track added and nothing playing, auto-play
      if (state.queue.length === 1 && !state.currentTrackId) {
        state.sync.loadTrack(state.queue[0].videoId, state.queue[0].title);
      }
    });

    state.sync.on('queue-ended', () => {
      showToast('queue finished');
    });

    // --- Member Events ---
    state.sync.on('member-joined', (msg) => {
      showToast(`${msg.username} joined`);
    });

    state.sync.on('member-left', (msg) => {
      showToast(`${msg.username} left`);
    });

    state.sync.on('host-changed', (msg) => {
      if (msg.isYou) {
        showToast('you are now the host');
      } else {
        showToast(`${msg.newHost} is now the host`);
      }
    });

    // --- Sync Quality ---
    state.sync.on('sync-quality', (quality) => {
      updateSyncUI(quality);
    });

    // --- Error / Disconnect ---
    state.sync.on('error', (msg) => {
      showToast(`error: ${msg.message}`);
    });

    state.sync.on('disconnected', () => {
      updateConnectionBanner('error', 'disconnected — trying to reconnect...');
      // Auto-reconnect after 3s
      setTimeout(() => {
        if (state.sync && state.sync.roomCode) {
          reconnect();
        }
      }, 3000);
    });

    return state.sync;
  }

  async function reconnect() {
    try {
      await state.sync.connect();
      if (state.sync.roomCode) {
        state.sync.joinRoom(state.sync.roomCode, state.username);
      }
    } catch {
      updateConnectionBanner('error', 'reconnection failed');
    }
  }

  // ========== UI UPDATES ==========
  function updateConnectionBanner(type, text) {
    if (!els.connectionBanner) return;
    els.connectionBanner.className = `connection-banner visible ${type}`;
    els.connectionBanner.textContent = text;

    // Auto-hide connected banner after 3s
    if (type === 'connected') {
      setTimeout(() => {
        els.connectionBanner.classList.remove('visible');
      }, 3000);
    }
  }

  function updateSyncUI(quality) {
    if (els.syncDot) {
      els.syncDot.className = `sync-dot ${quality.status}`;
    }
    if (els.syncLabel) {
      const labels = { good: 'in sync', adjusting: 'adjusting', poor: 'poor connection', unknown: 'connecting...' };
      els.syncLabel.textContent = labels[quality.status] || quality.status;
    }
    if (els.syncRtt) {
      els.syncRtt.textContent = quality.rtt > 0 ? `RTT: ${quality.rtt}ms | jitter: ${quality.jitter}ms` : '';
    }
  }

  function updateNowPlaying() {
    if (!els.nowPlaying) return;
    if (state.currentTrackId) {
      const track = state.queue.find(t => t.videoId === state.currentTrackId);
      els.nowPlaying.textContent = track ? track.title : `YouTube: ${state.currentTrackId}`;
    } else {
      els.nowPlaying.textContent = 'nothing queued';
    }
  }

  function updateQueueUI() {
    if (!els.queueList) return;

    if (state.queue.length === 0) {
      els.queueList.innerHTML = `
        <li class="queue-item" style="color:var(--text-muted);font-style:italic;">
          no tracks yet — add a YouTube URL above
        </li>`;
      return;
    }

    els.queueList.innerHTML = state.queue.map((track, idx) => `
      <li class="queue-item ${track.videoId === state.currentTrackId ? 'active-track' : ''}" data-index="${idx}">
        <span>${track.videoId === state.currentTrackId ? '▶ ' : ''}${track.title}</span>
        <button class="queue-remove" data-video-id="${track.videoId}" title="Remove">✕</button>
      </li>
    `).join('');

    // Bind remove buttons
    els.queueList.querySelectorAll('.queue-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.sync.removeFromQueue(btn.dataset.videoId);
      });
    });

    // Bind track click to play
    els.queueList.querySelectorAll('.queue-item[data-index]').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index);
        const track = state.queue[idx];
        if (track) {
          state.sync.loadTrack(track.videoId, track.title);
        }
      });
    });
  }

  // ========== VISUALIZER ==========
  function initVisualizer() {
    if (!els.visualizer) return;
    const barCount = 32;
    els.visualizer.innerHTML = '';
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'viz-bar';
      bar.style.height = '4px';
      els.visualizer.appendChild(bar);
    }

    function animateBars() {
      const bars = els.visualizer.querySelectorAll('.viz-bar');
      bars.forEach((bar) => {
        if (state.isPlaying) {
          const height = Math.random() * 50 + 4;
          bar.style.height = `${height}px`;
          bar.style.opacity = 0.5 + Math.random() * 0.5;
        } else {
          bar.style.height = '4px';
          bar.style.opacity = 0.3;
        }
      });
      requestAnimationFrame(animateBars);
    }
    animateBars();
  }

  // ========== ROOM MANAGEMENT ==========
  function showRoom() {
    if (els.lobby) els.lobby.style.display = 'none';
    if (els.howItWorks) els.howItWorks.style.display = 'none';
    if (els.room) els.room.classList.add('active');
  }

  function showLobby() {
    if (els.lobby) els.lobby.style.display = '';
    if (els.howItWorks) els.howItWorks.style.display = '';
    if (els.room) els.room.classList.remove('active');
  }

  async function createRoom() {
    try {
      updateConnectionBanner('connecting', 'connecting to sync server...');
      const sync = createSyncEngine();
      await sync.connect();
      await initPlayer();
      initVisualizer();
      sync.createRoom('jam', state.username);
    } catch (e) {
      updateConnectionBanner('error', 'failed to connect — is the server running?');
      showToast('connection failed — start the server with: node server.js');
      console.error('[jam] connection error:', e);
    }
  }

  async function joinRoom(code) {
    if (!code || code.length < 4) {
      showToast('enter a valid room code');
      return;
    }
    try {
      updateConnectionBanner('connecting', 'connecting to sync server...');
      const sync = createSyncEngine();
      await sync.connect();
      await initPlayer();
      initVisualizer();
      sync.joinRoom(code, state.username);
    } catch (e) {
      updateConnectionBanner('error', 'failed to connect — is the server running?');
      showToast('connection failed — start the server with: node server.js');
      console.error('[jam] connection error:', e);
    }
  }

  function leaveRoom() {
    if (state.sync) {
      state.sync.leaveRoom();
      state.sync.disconnect();
      state.sync = null;
    }
    if (state.player && state.playerReady) {
      state.player.destroy();
      state.player = null;
      state.playerReady = false;
    }
    state.queue = [];
    state.currentTrackId = null;
    state.isPlaying = false;

    showLobby();
    showToast('left the room');
  }

  // ========== PLAYBACK CONTROLS ==========
  function addToQueue(url) {
    const videoId = extractVideoId(url);
    if (!videoId) { showToast('invalid YouTube URL'); return; }
    if (state.queue.find(t => t.videoId === videoId)) { showToast('track already in queue'); return; }

    state.sync.addToQueue({
      videoId,
      title: `YouTube: ${videoId}`,
    });
    showToast('track added');
  }

  function togglePlayPause() {
    if (!state.sync || !state.playerReady) return;

    if (state.isPlaying) {
      state.sync.pause();
    } else {
      // If nothing playing, play first track
      if (!state.currentTrackId && state.queue.length > 0) {
        state.sync.loadTrack(state.queue[0].videoId, state.queue[0].title);
        return;
      }
      // Resume — tell server current position
      const pos = state.player.getCurrentTime();
      state.sync.play(state.currentTrackId, pos);
    }
  }

  function skipTrack() {
    if (!state.sync) return;
    state.sync.skip();
  }

  // ========== EVENT BINDINGS ==========
  if (els.createBtn) els.createBtn.addEventListener('click', createRoom);

  if (els.joinBtn) els.joinBtn.addEventListener('click', () => joinRoom(els.joinCode.value));
  if (els.joinCode) els.joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(els.joinCode.value); });

  if (els.addUrlBtn) els.addUrlBtn.addEventListener('click', () => { addToQueue(els.urlInput.value); els.urlInput.value = ''; });
  if (els.urlInput) els.urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { addToQueue(els.urlInput.value); els.urlInput.value = ''; } });

  if (els.playPauseBtn) els.playPauseBtn.addEventListener('click', togglePlayPause);
  if (els.skipBtn) els.skipBtn.addEventListener('click', skipTrack);
  if (els.leaveBtn) els.leaveBtn.addEventListener('click', leaveRoom);

  // Copy room code
  if (els.roomCodeEl) {
    els.roomCodeEl.addEventListener('click', () => {
      const code = state.sync && state.sync.roomCode;
      if (code) {
        navigator.clipboard.writeText(code).then(() => showToast('room code copied!')).catch(() => showToast(`room code: ${code}`));
      }
    });
  }

  // URL hash auto-join
  const hash = window.location.hash.slice(1);
  if (hash && hash.length >= 4) {
    setTimeout(() => joinRoom(hash), 500);
  }

})();
