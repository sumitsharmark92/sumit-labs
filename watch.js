/* ============================================================
   WATCH.PARTY — Video Sync Client
   Uses SyncEngine for server-authoritative playback with
   NTP clock sync, scheduled starts, drift correction,
   and live chat.
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
    currentVideoId: null,
    isPlaying: false,
    theaterMode: false,
    username: `user_${Math.random().toString(36).slice(2, 6)}`,
  };

  // ========== DOM REFS ==========
  const els = {
    lobby: document.getElementById('watchLobby'),
    howItWorks: document.getElementById('watchHowItWorks'),
    room: document.getElementById('watchRoom'),
    createBtn: document.getElementById('createWatchBtn'),
    joinBtn: document.getElementById('joinWatchBtn'),
    joinCode: document.getElementById('joinWatchCode'),
    codeDisplay: document.getElementById('watchCodeDisplay'),
    roomCodeEl: document.getElementById('watchRoomCode'),
    urlInput: document.getElementById('watchUrlInput'),
    loadUrlBtn: document.getElementById('watchLoadUrl'),
    playPauseBtn: document.getElementById('watchPlayPause'),
    theaterBtn: document.getElementById('watchTheater'),
    nowPlaying: document.getElementById('watchNowPlaying'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    chatSend: document.getElementById('chatSend'),
    chatPanel: document.getElementById('chatPanel'),
    leaveBtn: document.getElementById('watchLeave'),
    // Sync UI
    connectionBanner: document.getElementById('watchConnectionBanner'),
    syncDot: document.getElementById('watchSyncDot'),
    syncLabel: document.getElementById('watchSyncLabel'),
    syncRtt: document.getElementById('watchSyncRtt'),
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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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

    const container = document.getElementById('watchPlayerContainer');
    container.innerHTML = '<div id="watchPlayer"></div>';

    return new Promise((resolve) => {
      state.player = new YT.Player('watchPlayer', {
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
            console.log('[watch] YouTube player ready');

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
        addSystemMessage('video ended');
        break;
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
      addSystemMessage('room created — share the code to invite friends');
      showToast(`room created: ${msg.code}`);
    });

    state.sync.on('room-joined', (msg) => {
      els.codeDisplay.textContent = msg.code;
      showRoom();
      updateConnectionBanner('connected', 'connected — syncing...');
      addSystemMessage(`you joined as ${state.username}`);
      showToast(`joined room: ${msg.code}`);

      // Handle late join — if video is already playing
      if (msg.playback && msg.playback.trackId && msg.playback.isPlaying) {
        state.currentVideoId = msg.playback.trackId;
        updateNowPlaying();

        if (state.playerReady) {
          const expectedPos = state.sync.getExpectedPosition();
          state.player.loadVideoById(msg.playback.trackId, expectedPos);
          state.isPlaying = true;
          els.playPauseBtn.textContent = '⏸ pause';
          state.sync.startDriftCorrection();
        }
      } else if (msg.playback && msg.playback.trackId && !msg.playback.isPlaying) {
        state.currentVideoId = msg.playback.trackId;
        updateNowPlaying();
        if (state.playerReady) {
          state.player.cueVideoById(msg.playback.trackId, msg.playback.positionAtOrigin);
        }
      }
    });

    // --- Playback Events ---
    state.sync.on('play', (msg) => {
      state.currentVideoId = msg.trackId;
      state.isPlaying = true;
      els.playPauseBtn.textContent = '⏸ pause';
      updateNowPlaying();

      if (state.playerReady && msg.trackId) {
        const currentId = getCurrentLoadedVideoId();
        if (currentId !== msg.trackId) {
          state.player.cueVideoById(msg.trackId, msg.positionAtOrigin);
        }
        // schedulePlayback is handled automatically by SyncEngine
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
      state.currentVideoId = msg.trackId;
      state.isPlaying = true;
      els.playPauseBtn.textContent = '⏸ pause';
      updateNowPlaying();
      addSystemMessage(`now playing: ${msg.title || msg.trackId}`);

      if (state.playerReady) {
        state.player.cueVideoById(msg.trackId, 0);

        if (msg.scheduledStart) {
          state.sync.schedulePlayback(msg.scheduledStart, 0, msg.trackId);
        }
      }
    });

    // --- Chat Events ---
    state.sync.on('chat', (msg) => {
      addChatMessage(msg.user, msg.text);
    });

    // --- Member Events ---
    state.sync.on('member-joined', (msg) => {
      addSystemMessage(`${msg.username} joined the party`);
      showToast(`${msg.username} joined`);
    });

    state.sync.on('member-left', (msg) => {
      addSystemMessage(`${msg.username} left the party`);
      showToast(`${msg.username} left`);
    });

    state.sync.on('host-changed', (msg) => {
      if (msg.isYou) {
        addSystemMessage('you are now the host');
        showToast('you are now the host');
      } else {
        addSystemMessage(`${msg.newHost} is now the host`);
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
      addSystemMessage('connection lost — reconnecting...');
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

  function getCurrentLoadedVideoId() {
    if (!state.player || !state.playerReady) return null;
    try {
      const url = state.player.getVideoUrl();
      return url ? extractVideoId(url) : null;
    } catch {
      return null;
    }
  }

  // ========== UI UPDATES ==========
  function updateConnectionBanner(type, text) {
    if (!els.connectionBanner) return;
    els.connectionBanner.className = `connection-banner visible ${type}`;
    els.connectionBanner.textContent = text;
    if (type === 'connected') {
      setTimeout(() => { els.connectionBanner.classList.remove('visible'); }, 3000);
    }
  }

  function updateSyncUI(quality) {
    if (els.syncDot) els.syncDot.className = `sync-dot ${quality.status}`;
    if (els.syncLabel) {
      const labels = { good: 'in sync', adjusting: 'adjusting', poor: 'poor connection', unknown: 'connecting...' };
      els.syncLabel.textContent = labels[quality.status] || quality.status;
    }
    if (els.syncRtt) {
      els.syncRtt.textContent = quality.rtt > 0 ? `RTT: ${quality.rtt}ms | jitter: ${quality.jitter}ms` : '';
    }
  }

  function updateNowPlaying() {
    if (els.nowPlaying) {
      els.nowPlaying.textContent = state.currentVideoId
        ? `YouTube: ${state.currentVideoId}`
        : 'no video loaded';
    }
  }

  // ========== CHAT ==========
  function addChatMessage(user, text) {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg';
    msgEl.innerHTML = `<span class="chat-user">${escapeHtml(user)}: </span><span class="chat-text">${escapeHtml(text)}</span>`;
    els.chatMessages.appendChild(msgEl);
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  function addSystemMessage(text) {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg system-msg';
    msgEl.innerHTML = `<span class="chat-text">${escapeHtml(text)}</span>`;
    els.chatMessages.appendChild(msgEl);
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }

  function sendChatMessage() {
    const text = els.chatInput.value.trim();
    if (!text || !state.sync) return;
    state.sync.sendChat(text);
    els.chatInput.value = '';
    // Note: server broadcasts to ALL including sender, so message will appear via 'chat' event
  }

  // ========== THEATER MODE ==========
  function toggleTheater() {
    state.theaterMode = !state.theaterMode;
    const watchLayout = document.querySelector('.watch-layout');

    if (state.theaterMode) {
      if (watchLayout) { watchLayout.style.gridTemplateColumns = '1fr'; }
      if (els.chatPanel) els.chatPanel.style.display = 'none';
      els.theaterBtn.textContent = '💬 chat';
      showToast('theater mode on');
    } else {
      if (watchLayout) { watchLayout.style.gridTemplateColumns = ''; }
      if (els.chatPanel) els.chatPanel.style.display = '';
      els.theaterBtn.textContent = '🖥 theater';
      showToast('chat mode on');
    }
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
      sync.createRoom('watch', state.username);
    } catch (e) {
      updateConnectionBanner('error', 'failed to connect — is the server running?');
      showToast('connection failed — start the server with: node server.js');
      console.error('[watch] connection error:', e);
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
      sync.joinRoom(code, state.username);
    } catch (e) {
      updateConnectionBanner('error', 'failed to connect — is the server running?');
      showToast('connection failed — start the server with: node server.js');
      console.error('[watch] connection error:', e);
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
    state.currentVideoId = null;
    state.isPlaying = false;

    // Reset chat
    if (els.chatMessages) {
      els.chatMessages.innerHTML = `
        <div class="chat-msg system-msg">
          <span class="chat-text">waiting for guests...</span>
        </div>`;
    }

    if (state.theaterMode) toggleTheater();

    showLobby();
    showToast('left the room');
  }

  // ========== PLAYBACK CONTROLS ==========
  function loadVideo(url) {
    const videoId = extractVideoId(url);
    if (!videoId) { showToast('invalid YouTube URL'); return; }
    if (!state.sync) return;

    state.sync.loadTrack(videoId, `YouTube: ${videoId}`);
    showToast('video loaded');
  }

  function togglePlayPause() {
    if (!state.sync || !state.playerReady) return;

    if (state.isPlaying) {
      state.sync.pause();
    } else {
      const pos = state.player.getCurrentTime();
      state.sync.play(state.currentVideoId, pos);
    }
  }

  // ========== EVENT BINDINGS ==========
  if (els.createBtn) els.createBtn.addEventListener('click', createRoom);

  if (els.joinBtn) els.joinBtn.addEventListener('click', () => joinRoom(els.joinCode.value));
  if (els.joinCode) els.joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(els.joinCode.value); });

  if (els.loadUrlBtn) els.loadUrlBtn.addEventListener('click', () => { loadVideo(els.urlInput.value); els.urlInput.value = ''; });
  if (els.urlInput) els.urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { loadVideo(els.urlInput.value); els.urlInput.value = ''; } });

  if (els.playPauseBtn) els.playPauseBtn.addEventListener('click', togglePlayPause);
  if (els.theaterBtn) els.theaterBtn.addEventListener('click', toggleTheater);
  if (els.leaveBtn) els.leaveBtn.addEventListener('click', leaveRoom);

  // Chat
  if (els.chatSend) els.chatSend.addEventListener('click', sendChatMessage);
  if (els.chatInput) els.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

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
