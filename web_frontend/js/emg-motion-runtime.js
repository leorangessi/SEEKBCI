/**
 * 运动通道 EMG 运行时 — 与 emg-test 页同源：GDM.dataDisplayBuffer + SSVEP_EMG_DRIVE。
 */
(function (global) {
    /** @type {Map<string, object>} */
    const channelStates = new Map();

    function getGdm() {
        return global.globalDeviceManager || null;
    }

    function getApiBase() {
        return typeof global.ssvepGetDevicesApiBase === 'function'
            ? global.ssvepGetDevicesApiBase()
            : `${typeof global.ssvepResolveApiOrigin === 'function' ? global.ssvepResolveApiOrigin() : 'http://127.0.0.1:8000'}/api/devices`;
    }

    function getSamplingRateHz() {
        const gdm = getGdm();
        const sr = gdm && gdm.deviceInfo && Number(gdm.deviceInfo.sampling_rate);
        return Number.isFinite(sr) && sr > 0 ? sr : 250;
    }

    function getDisplayBuffer(message) {
        const gdm = getGdm();
        if (gdm && Array.isArray(gdm.dataDisplayBuffer) && gdm.dataDisplayBuffer.length) {
            return gdm.dataDisplayBuffer;
        }
        const plot = message && message.data_display;
        if (!Array.isArray(plot) || !plot.length) return [];
        return plot
            .map((row) => (Array.isArray(row) ? row.map((x) => Number(x) || 0) : []))
            .filter((r) => r.length);
    }

    function stateKey(physicalCh, cfg) {
        const ch = cfg && cfg.channel ? cfg.channel : 'ch';
        return `${ch}:${physicalCh}`;
    }

    function ensureChannelState(physicalCh, cfg) {
        const DRIVE = global.SSVEP_EMG_DRIVE;
        if (!DRIVE || typeof DRIVE.createDriveChannelState !== 'function') return null;
        const key = stateKey(physicalCh, cfg);
        if (!channelStates.has(key)) {
            channelStates.set(key, DRIVE.createDriveChannelState(cfg));
        }
        return channelStates.get(key);
    }

    function resetAll() {
        channelStates.clear();
    }

    /**
     * @param {number} physicalCh 0-based 物理通道
     * @param {object} cfg 编辑器/运行 cfg（含 peakThresholdUv、driveTriggerLevel 等）
     * @param {object} [message] 可选 WS 消息（缓冲为空时用 data_display）
     */
    function refreshChannelDrive(physicalCh, cfg, message) {
        const DRIVE = global.SSVEP_EMG_DRIVE;
        const empty = {
            drive: 0,
            norm: 0,
            activity: 0,
            triggered: false,
            ready: false,
            peak2peak: 0,
            binsOk: 0,
            binsRequired: 0
        };
        if (!DRIVE || physicalCh == null || physicalCh < 0) return empty;

        const buf = getDisplayBuffer(message);
        if (!buf.length || physicalCh >= buf[0].length) return empty;

        const chState = ensureChannelState(physicalCh, cfg);
        if (!chState) return empty;

        DRIVE.syncCfgOnState(chState, cfg);
        const params = chState.cfg;
        const sr = getSamplingRateHz();
        const normPeriod = Math.max(1, Math.floor(sr * (params.windowSec || 1)));
        const peakPeriod = Math.max(1, Math.floor(sr * (params.peakWindowSec || 0.6)));
        const signedNormWin = buf.slice(-normPeriod).map((r) => Number(r[physicalCh]) || 0);
        const signedPeakWin = buf.slice(-peakPeriod).map((r) => Number(r[physicalCh]) || 0);
        const out = DRIVE.computeDriveFromWindows(chState, signedNormWin, signedPeakWin, sr);
        return { ...out, cfg: params };
    }

    let bootstrapInFlight = false;
    let lastBootstrapMs = 0;
    let httpPullInFlight = false;
    let lastHttpPullMs = 0;

    function ingestStreamMessage(message) {
        const gdm = getGdm();
        if (!gdm || !message) return 0;
        const plot = message.data_display;
        if (!Array.isArray(plot) || !plot.length) return 0;
        let n = 0;
        for (const row of plot) {
            if (!Array.isArray(row) || !row.length) continue;
            gdm.addToDisplayBuffer([row.map((x) => Number(x) || 0)]);
            n += 1;
        }
        return n;
    }

    function displayBufferLength() {
        return getDisplayBuffer(null).length;
    }

    function maintainStreamSync(_message) {
        const gdm = getGdm();
        if (!gdm) return;
        if (gdm.isConnected && (!gdm.ws || gdm.ws.readyState !== WebSocket.OPEN)) {
            gdm.connectWebSocket(true);
        }
    }

    async function pullDisplayHttpIfNeeded() {
        const gdm = getGdm();
        if (!gdm || !gdm.isConnected || httpPullInFlight) return false;
        const sr = getSamplingRateHz();
        const need = Math.max(50, Math.floor(sr * 0.5));
        if (displayBufferLength() >= need) return true;
        const now = Date.now();
        if (now - lastHttpPullMs < 280) return false;

        httpPullInFlight = true;
        lastHttpPullMs = now;
        try {
            const resp = await fetch(`${getApiBase()}/data?duration=0.25&for_display=true`);
            const json = await resp.json();
            if (!json || !json.success || !Array.isArray(json.data) || !json.data.length) return false;
            for (const row of json.data) {
                if (!Array.isArray(row)) continue;
                gdm.addToDisplayBuffer([row.map((x) => Number(x) || 0)]);
            }
            return displayBufferLength() >= need;
        } catch (e) {
            console.warn('[EMG motion runtime] HTTP display pull:', e);
            return false;
        } finally {
            httpPullInFlight = false;
        }
    }

    async function maintainStreamAsync() {
        await ensureDeviceStream();
        await pullDisplayHttpIfNeeded();
        if (displayBufferLength() < Math.max(50, Math.floor(getSamplingRateHz() * 0.5))) {
            await bootstrapDisplayBufferIfNeeded();
        }
    }

    function getStreamHealth() {
        const gdm = getGdm();
        const buf = displayBufferLength();
        const wsOk = !!(gdm && gdm.ws && gdm.ws.readyState === WebSocket.OPEN);
        const connected = !!(gdm && gdm.isConnected);
        let state = 'offline';
        if (!connected) state = 'offline';
        else if (!wsOk && buf < 20) state = 'connecting';
        else if (buf < 20) state = 'buffering';
        else state = 'live';
        return { connected, wsOk, buf, state };
    }

    async function bootstrapDisplayBufferIfNeeded() {
        const gdm = getGdm();
        if (!gdm || bootstrapInFlight) return false;
        const buf = getDisplayBuffer(null);
        const sr = getSamplingRateHz();
        const need = Math.max(50, Math.floor(sr * 0.8));
        if (buf.length >= need) return true;
        const now = Date.now();
        if (now - lastBootstrapMs < 800) return false;
        bootstrapInFlight = true;
        lastBootstrapMs = now;
        try {
            const resp = await fetch(`${getApiBase()}/data?duration=1.0&for_display=true`);
            const json = await resp.json();
            if (!json || !json.success || !Array.isArray(json.data) || !json.data.length) return false;
            for (const row of json.data) {
                if (!Array.isArray(row)) continue;
                gdm.addToDisplayBuffer([row.map((x) => Number(x) || 0)]);
            }
            return gdm.dataDisplayBuffer.length >= need;
        } catch (e) {
            console.warn('[EMG motion runtime] bootstrap buffer:', e);
            return false;
        } finally {
            bootstrapInFlight = false;
        }
    }

    async function ensureDeviceStream() {
        const gdm = getGdm();
        if (!gdm) return false;
        try {
            const resp = await fetch(`${getApiBase()}/status`);
            const json = await resp.json();
            if (json.success && json.status && json.status.connected) {
                gdm.isConnected = true;
                gdm.deviceInfo = json.status.device_info;
                gdm.saveState();
                gdm.loadChannelConfig();
            }
        } catch (e) {
            console.warn('[EMG motion runtime] /status:', e);
        }
        if (gdm.isConnected && (!gdm.ws || gdm.ws.readyState !== WebSocket.OPEN)) {
            gdm.connectWebSocket(true);
        }
        const ok = !!(gdm.isConnected && gdm.ws && gdm.ws.readyState === WebSocket.OPEN);
        if (ok) await bootstrapDisplayBufferIfNeeded();
        return ok;
    }

    global.SSVEP_EMG_MOTION_RUNTIME = {
        getDisplayBuffer,
        refreshChannelDrive,
        resetAll,
        ingestStreamMessage,
        maintainStreamSync,
        maintainStreamAsync,
        pullDisplayHttpIfNeeded,
        ensureDeviceStream,
        bootstrapDisplayBufferIfNeeded,
        getStreamHealth,
        getSamplingRateHz,
        displayBufferLength
    };
})(typeof window !== 'undefined' ? window : globalThis);
