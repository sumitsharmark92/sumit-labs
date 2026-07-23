/* ============================================================
   SYNC ENGINE — Client-Side Sync Module
   NTP-style clock sync, origin-point playback derivation,
   scheduled-start, playbackRate drift correction, and
   per-client network quality tracking.

   Shared by both jam.sync and watch.party.
   ============================================================ */

class SyncEngine {
  /**
   * @param {string} [wsUrl] — Optional WebSocket server URL. Auto-detects protocol if omitted.
   */
  constructor(wsUrl = null) {
    // Auto-detect production vs local WebSocket URL
    if (!wsUrl) {
      const isHttps = window.location.protocol === 'https:';
      const host = window.location.hostname || 'localhost';
      const port = window.location.port ? `:${window.location.port}` : '';
      
      if (host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:') {
        this.wsUrl = 'ws://localhost:3000';
      } else {
        const wsProto = isHttps ? 'wss:' : 'ws:';
        this.wsUrl = `${wsProto}//${host}${port}`;
      }
    } else {
      this.wsUrl = wsUrl;
    }

    this.ws = null;
    this.useFallback = false;
    this.fallbackChannel = null;

    // Clock sync state
    this.clockOffset = 0;           // ms to add to performance.now() to get server time
    this.rttSamples = [];
    this._syncInterval = null;
    this._pendingPings = new Map();

    // Playback state (origin-point formula)
    this.playback = null;
    this.roomCode = null;
    this.isHost = false;

    // Drift correction state
    this._driftInterval = null;
    this._rateResetTimeout = null;
    this._mediaAdapter = null;      // { getCurrentTime, seekTo, play, pause, setPlaybackRate }
    this._scheduledTimeout = null;

    // Network quality
    this.syncQuality = { status: 'unknown', rtt: 0, jitter: 0 };

    // Event listeners
    this._listeners = {};
  }

  // ============================
  // EVENT SYSTEM
  // ============================

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
    return this; // chainable
  }

  off(event, cb) {
    if (!this._listeners[event]) return this;
    this._listeners[event] = this._listeners[event].filter(fn => fn !== cb);
    return this;
  }

  _emit(event, data) {
    const fns = this._listeners[event];
    if (fns) fns.forEach(fn => { try { fn(data); } catch (e) { console.error(`[sync] event ${event} error:`, e); } });
  }

  // ============================
  // CONNECTION
  // ============================

  connect() {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (e) {
        this._activateFallback();
        resolve();
        return;
      }

      const connectionTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          console.warn('[sync] WebSocket connection timeout — activating BroadcastChannel fallback');
          this.ws.close();
          this._activateFallback();
          resolve();
        }
      }, 2500);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this.useFallback = false;
        console.log('[sync] connected to WebSocket server at', this.wsUrl);
        resolve();
      };

      this.ws.onerror = () => {
        clearTimeout(connectionTimeout);
        console.warn('[sync] WebSocket unavailable — activating BroadcastChannel fallback');
        this._activateFallback();
        resolve();
      };

      this.ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log('[sync] disconnected', event.code);
        this._stopClockSync();
        this.stopDriftCorrection();
        this._emit('disconnected', { code: event.code });
      };

      this.ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        this._handleMessage(msg);
      };
    });
  }

  _activateFallback() {
    this.useFallback = true;
    this.clockOffset = 0;
    this.syncQuality = { status: 'good', rtt: 1, jitter: 0 };
    console.log('[sync] ⚡ BroadcastChannel fallback active (same-device zero delay)');
  }

  disconnect() {
    this._stopClockSync();
    this.stopDriftCorrection();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.fallbackChannel) {
      this.fallbackChannel.close();
      this.fallbackChannel = null;
    }
    this.playback = null;
    this.roomCode = null;
    this.isHost = false;
  }

  _send(msg) {
    if (this.useFallback && this.fallbackChannel) {
      this.fallbackChannel.postMessage(msg);
      // Process locally for self
      setTimeout(() => this._handleFallbackSelf(msg), 0);
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _handleFallbackSelf(msg) {
    // Simulate server responses when using BroadcastChannel fallback
    if (msg.type === 'create-room') {
      const code = Math.random().toString(36).slice(2, 8);
      this.roomCode = code;
      this.isHost = true;
      this._initFallbackChannel(code);
      this._handleMessage({ type: 'room-created', code, isHost: true });
    } else if (msg.type === 'join-room') {
      this.roomCode = msg.code;
      this.isHost = false;
      this._initFallbackChannel(msg.code);
      this._handleMessage({ type: 'room-joined', code: msg.code, isHost: false, queue: [] });
    }
  }

  _initFallbackChannel(code) {
    if (this.fallbackChannel) this.fallbackChannel.close();
    this.fallbackChannel = new BroadcastChannel(`sync-fallback-${code}`);
    this.fallbackChannel.onmessage = (e) => {
      this._handleMessage(e.data);
    };
  }

  // ============================
  // CLOCK SYNC (NTP-style)
  // ============================

  /**
   * Returns estimated server time right now (ms).
   * After clock sync, this is accurate to within a few ms.
   */
  getServerTime() {
    return performance.now() + this.clockOffset;
  }

  /**
   * Perform a full clock sync handshake.
   * @param {number} sampleCount — number of ping/pong exchanges
   */
  async performClockSync(sampleCount = 8) {
    const rtts = [];
    const offsets = [];

    for (let i = 0; i < sampleCount; i++) {
      try {
        const result = await this._singlePing();
        rtts.push(result.rtt);
        offsets.push(result.offset);
      } catch {
        // Ping timed out, skip
      }
      // Small gap between pings to avoid server spam
      await new Promise(r => setTimeout(r, 40));
    }

    if (rtts.length === 0) {
      console.warn('[sync] clock sync failed — no successful pings');
      return;
    }

    // Reject outliers: RTT > 1.5× median
    const sorted = [...rtts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const threshold = median * 1.5;

    const goodOffsets = [];
    const goodRtts = [];
    for (let i = 0; i < rtts.length; i++) {
      if (rtts[i] <= threshold) {
        goodOffsets.push(offsets[i]);
        goodRtts.push(rtts[i]);
      }
    }

    // Use good samples, or all if filtering removed everything
    const finalOffsets = goodOffsets.length > 0 ? goodOffsets : offsets;
    const finalRtts = goodRtts.length > 0 ? goodRtts : rtts;

    this.clockOffset = finalOffsets.reduce((a, b) => a + b, 0) / finalOffsets.length;
    this.rttSamples = finalRtts;

    this._updateSyncQuality();

    const avgRtt = finalRtts.reduce((a, b) => a + b, 0) / finalRtts.length;
    console.log(
      `[sync] clock synced — offset: ${this.clockOffset.toFixed(1)}ms, ` +
      `avg RTT: ${avgRtt.toFixed(1)}ms, samples: ${finalRtts.length}/${sampleCount}`
    );
  }

  /**
   * Single ping/pong exchange. Returns { rtt, offset }.
   */
  _singlePing() {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const pingId = Math.random().toString(36).slice(2, 10);

      this._pendingPings.set(pingId, { t0, resolve });
      this._send({ type: 'ping', pingId });

      // Timeout after 2 seconds
      setTimeout(() => {
        if (this._pendingPings.has(pingId)) {
          this._pendingPings.delete(pingId);
          reject(new Error('Ping timeout'));
        }
      }, 2000);
    });
  }

  /**
   * Handle pong response from server.
   */
  _handlePong(msg) {
    const pending = this._pendingPings.get(msg.pingId);
    if (!pending) return;

    this._pendingPings.delete(msg.pingId);

    const t1 = performance.now();
    const rtt = t1 - pending.t0;
    const estimatedLatency = rtt / 2;
    const offset = msg.serverTime + estimatedLatency - t1;

    pending.resolve({ rtt, offset });
  }

  /**
   * Start periodic clock re-sync in the background.
   */
  _startClockSync() {
    // Initial full sync
    this.performClockSync(8);

    // Re-sync every 20 seconds with fewer samples
    this._syncInterval = setInterval(() => {
      this.performClockSync(3);
    }, 20000);
  }

  _stopClockSync() {
    if (this._syncInterval) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }
    this._pendingPings.clear();
  }

  // ============================
  // NETWORK QUALITY
  // ============================

  _updateSyncQuality() {
    if (this.rttSamples.length === 0) {
      this.syncQuality = { status: 'unknown', rtt: 0, jitter: 0 };
      this._emit('sync-quality', this.syncQuality);
      return;
    }

    const avg = this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length;
    const variance = this.rttSamples.reduce(
      (sum, r) => sum + Math.pow(r - avg, 2), 0
    ) / this.rttSamples.length;
    const jitter = Math.sqrt(variance);

    let status = 'good';         // 🟢
    if (avg > 300 || jitter > 100) {
      status = 'poor';           // 🔴
    } else if (avg > 100 || jitter > 50) {
      status = 'adjusting';      // 🟡
    }

    this.syncQuality = {
      status,
      rtt: Math.round(avg),
      jitter: Math.round(jitter),
    };

    this._emit('sync-quality', this.syncQuality);
  }

  /**
   * Adaptive buffer for scheduled start, based on connection quality.
   */
  _getAdaptiveBuffer() {
    if (this.syncQuality.status === 'poor') return 500;
    if (this.syncQuality.status === 'adjusting') return 400;
    return 250;
  }

  // ============================
  // PLAYBACK POSITION (Step 2)
  // ============================

  /**
   * Compute the expected playback position RIGHT NOW using the
   * origin-point formula. Never returns a stale number.
   */
  getExpectedPosition() {
    if (!this.playback) return 0;

    if (this.playback.isPlaying) {
      const serverNow = this.getServerTime();
      const elapsed = (serverNow - this.playback.originServerTime) / 1000;
      return this.playback.positionAtOrigin + elapsed;
    }
    return this.playback.positionAtOrigin;
  }

  // ============================
  // MEDIA ADAPTER (YouTube-compatible)
  // ============================

  /**
   * Bind a media adapter for drift correction.
   * @param {Object} adapter — { getCurrentTime(), seekTo(s), play(), pause(), setPlaybackRate(r) }
   */
  setMediaAdapter(adapter) {
    this._mediaAdapter = adapter;
  }

  // ============================
  // SCHEDULED START (Step 3)
  // ============================

  /**
   * Schedule playback to begin at an exact server timestamp.
   * Converts server time → local time, then uses setTimeout.
   * @param {number} scheduledStart — server time (ms) when playback should begin
   * @param {number} position — seconds into the track at scheduledStart
   * @param {string} [trackId] — optional new track to load
   */
  schedulePlayback(scheduledStart, position, trackId) {
    if (!this._mediaAdapter) {
      console.warn('[sync] no media adapter set — cannot schedule playback');
      return;
    }

    // Cancel any pending scheduled start
    if (this._scheduledTimeout) {
      clearTimeout(this._scheduledTimeout);
      this._scheduledTimeout = null;
    }

    // Convert server time to local time
    const localStartTime = scheduledStart - this.clockOffset;
    const delay = localStartTime - performance.now();

    console.log(
      `[sync] scheduling playback — delay: ${delay.toFixed(0)}ms, ` +
      `position: ${position.toFixed(2)}s, track: ${trackId || '(same)'}`
    );

    // Preload: seek to position now so audio is buffered
    try {
      this._mediaAdapter.seekTo(position);
    } catch (e) { /* ignore if player not ready yet */ }

    if (delay > 0) {
      this._scheduledTimeout = setTimeout(() => {
        this._executePlayback(position);
      }, delay);
    } else {
      // Already past scheduled time — start immediately at corrected position
      const elapsed = Math.abs(delay) / 1000;
      this._executePlayback(position + elapsed);
    }
  }

  _executePlayback(position) {
    if (!this._mediaAdapter) return;

    try {
      this._mediaAdapter.seekTo(position);
      this._mediaAdapter.play();
      this._mediaAdapter.setPlaybackRate(1.0);
    } catch (e) {
      console.error('[sync] playback execution error:', e);
    }

    this.startDriftCorrection();
  }

  // ============================
  // DRIFT CORRECTION (Step 4)
  // ============================

  /**
   * Start continuous drift correction (every 3 seconds).
   * Uses playbackRate micro-adjustments for small drift,
   * hard seek for large drift.
   */
  startDriftCorrection() {
    this.stopDriftCorrection();

    this._driftInterval = setInterval(() => {
      if (!this._mediaAdapter || !this.playback || !this.playback.isPlaying) return;

      const expected = this.getExpectedPosition();
      let actual;
      try {
        actual = this._mediaAdapter.getCurrentTime();
      } catch {
        return; // Player not ready
      }

      const drift = expected - actual; // positive = client behind, negative = client ahead
      const absDrift = Math.abs(drift);

      if (absDrift < 0.05) {
        // < 50ms — imperceptible. Ensure rate is normal.
        try {
          if (this._mediaAdapter.getPlaybackRate && this._mediaAdapter.getPlaybackRate() !== 1.0) {
            this._mediaAdapter.setPlaybackRate(1.0);
          }
        } catch { /* ignore */ }
        return;
      }

      if (absDrift <= 0.3) {
        // 50–300ms — nudge playbackRate (inaudible)
        const nudge = drift > 0 ? 1.02 : 0.98;
        try {
          this._mediaAdapter.setPlaybackRate(nudge);
        } catch { /* ignore */ }

        // Reset rate after ~2 seconds
        if (this._rateResetTimeout) clearTimeout(this._rateResetTimeout);
        this._rateResetTimeout = setTimeout(() => {
          try {
            if (this._mediaAdapter) this._mediaAdapter.setPlaybackRate(1.0);
          } catch { /* ignore */ }
        }, 2000);

        console.log(`[sync] drift ${(drift * 1000).toFixed(0)}ms → rate ${nudge}`);
      } else {
        // > 300ms — hard seek (small glitch, but better than staying out of sync)
        console.log(`[sync] drift ${(drift * 1000).toFixed(0)}ms → HARD SEEK to ${expected.toFixed(2)}s`);
        try {
          this._mediaAdapter.seekTo(expected);
          this._mediaAdapter.setPlaybackRate(1.0);
        } catch { /* ignore */ }
      }
    }, 3000);
  }

  stopDriftCorrection() {
    if (this._driftInterval) {
      clearInterval(this._driftInterval);
      this._driftInterval = null;
    }
    if (this._rateResetTimeout) {
      clearTimeout(this._rateResetTimeout);
      this._rateResetTimeout = null;
    }
    if (this._scheduledTimeout) {
      clearTimeout(this._scheduledTimeout);
      this._scheduledTimeout = null;
    }
  }

  // ============================
  // ROOM MANAGEMENT
  // ============================

  createRoom(type = 'jam', username = '') {
    this._send({ type: 'create-room', roomType: type, username });
  }

  joinRoom(code, username = '') {
    this._send({ type: 'join-room', code: code.toLowerCase().trim(), username });
  }

  leaveRoom() {
    this._send({ type: 'leave-room' });
    this.stopDriftCorrection();
    this.playback = null;
    this.roomCode = null;
    this.isHost = false;
  }

  // ============================
  // PLAYBACK CONTROLS
  // ============================

  /** Tell server to start playback. */
  play(trackId, position = 0) {
    this._send({ type: 'play', trackId, position });
  }

  /** Tell server to pause. */
  pause() {
    this._send({ type: 'pause' });
  }

  /** Tell server to seek. */
  seek(position) {
    this._send({ type: 'seek', position });
  }

  /** Tell server to load a new track and auto-play. */
  loadTrack(trackId, title = '') {
    this._send({ type: 'load-track', trackId, title });
  }

  // ============================
  // QUEUE MANAGEMENT
  // ============================

  addToQueue(track) {
    this._send({ type: 'queue-add', track });
  }

  removeFromQueue(videoId) {
    this._send({ type: 'queue-remove', videoId });
  }

  skip() {
    this._send({ type: 'skip' });
  }

  // ============================
  // CHAT
  // ============================

  sendChat(text) {
    this._send({ type: 'chat', text });
  }

  // ============================
  // MESSAGE HANDLER
  // ============================

  _handleMessage(msg) {
    switch (msg.type) {

      case 'pong':
        this._handlePong(msg);
        break;

      case 'room-created':
        this.roomCode = msg.code;
        this.isHost = true;
        this._startClockSync();
        this._emit('room-created', msg);
        break;

      case 'room-joined':
        this.roomCode = msg.code;
        this.isHost = msg.isHost;
        this.playback = msg.playback;
        this._startClockSync();
        this._emit('room-joined', msg);
        break;

      case 'play':
        this.playback = {
          trackId: msg.trackId,
          isPlaying: true,
          positionAtOrigin: msg.positionAtOrigin,
          originServerTime: msg.originServerTime,
        };
        // Use scheduled start if provided
        if (msg.scheduledStart) {
          this.schedulePlayback(msg.scheduledStart, msg.positionAtOrigin, msg.trackId);
        }
        this._emit('play', msg);
        break;

      case 'pause':
        if (this.playback) {
          this.playback.isPlaying = false;
          this.playback.positionAtOrigin = msg.positionAtOrigin;
          this.playback.originServerTime = msg.originServerTime;
        }
        this.stopDriftCorrection();
        if (this._mediaAdapter) {
          try { this._mediaAdapter.pause(); } catch { /* ignore */ }
        }
        this._emit('pause', msg);
        break;

      case 'seek':
        if (this.playback) {
          this.playback.positionAtOrigin = msg.positionAtOrigin;
          this.playback.originServerTime = msg.originServerTime;
          this.playback.isPlaying = msg.isPlaying !== undefined ? msg.isPlaying : this.playback.isPlaying;
        }
        if (this._mediaAdapter) {
          try { this._mediaAdapter.seekTo(msg.positionAtOrigin); } catch { /* ignore */ }
        }
        this._emit('seek', msg);
        break;

      case 'load-track':
        this.playback = {
          trackId: msg.trackId,
          isPlaying: true,
          positionAtOrigin: msg.positionAtOrigin || 0,
          originServerTime: msg.originServerTime,
        };
        this._emit('load-track', msg);
        break;

      case 'queue-update':
        this._emit('queue-update', msg);
        break;

      case 'queue-ended':
        this._emit('queue-ended', msg);
        break;

      case 'chat':
        this._emit('chat', msg);
        break;

      case 'member-joined':
        this._emit('member-joined', msg);
        break;

      case 'member-left':
        this._emit('member-left', msg);
        break;

      case 'host-changed':
        if (msg.isYou) this.isHost = true;
        this._emit('host-changed', msg);
        break;

      case 'full-state':
        this.playback = msg.playback;
        this._emit('full-state', msg);
        break;

      case 'error':
        this._emit('error', msg);
        break;
    }
  }
}

// Export for use in jam.js and watch.js
window.SyncEngine = SyncEngine;
