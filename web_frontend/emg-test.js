/**
 * 运动通道 EMG 测试 — OpenBCI norm 条形图 + 波峰/波谷触发摇杆。
 */
(function () {
    const MAX_PARTICLES = 160;
    const TICK_MS = 80;
    const CHANNEL_COLORS = [
        'rgba(59,130,246,0.85)',
        'rgba(239,68,68,0.85)',
        'rgba(34,197,94,0.85)',
        'rgba(234,179,8,0.85)',
        'rgba(168,85,247,0.85)',
        'rgba(249,115,22,0.85)',
        'rgba(6,182,212,0.85)',
        'rgba(236,72,153,0.85)'
    ];
    const OPENBCI_STROKE = 'rgba(31,69,110,0.75)';
    const NORM_GATE_STROKE = 'rgba(255,70,70,0.9)';

    let channelMetrics = {};
    let emgStates = {};
    let peakStates = {};
    let lastIngestUsedFiltered = false;
    let smoothX = 0;
    let smoothY = 0;
    let ballVx = 0;
    let ballVy = 0;
    let lastPhysicsMs = 0;
    let sustainedSince = null;
    const particles = [];
    let canvas = null;
    let ctx = null;
    let barsCanvas = null;
    let barsCtx = null;
    let deviceConnected = false;
    let hasStream = false;
    let sampleBatchCount = 0;
    let tickTimerId = null;
    let listenerAttached = false;
    let lastHttpPullMs = 0;
    let httpPullInFlight = false;
    let httpPullSuccessCount = 0;
    let httpPullFailCount = 0;
    let httpPullAttemptCount = 0;
    let wsDataPacketCount = 0;
    let lastHttpError = '';
    let lastRejectReason = '';
    let bufferConsumeIdx = 0;
    const MAP_STORAGE_KEY = 'ssvep_emg_test_xy_map_v1';
    const MAP_SELECT_IDS = ['map-x-neg', 'map-x-pos', 'map-y-pos', 'map-y-neg'];
    const MAP_KEYS = ['xNeg', 'xPos', 'yPos', 'yNeg'];
    const BAR_ROW_SLOT = 112;
    const BAR_HEIGHT_PX = 72;
    let barsLayoutCssW = 220;
    let barsLayoutCssH = 120;

    function getEmgProcessor() {
        return window.SSVEP_EMG_PROCESSOR || null;
    }

    function getPeakTrigger() {
        return window.SSVEP_EMG_PEAK_TRIGGER || null;
    }

    function emgOptsFromCfg(cfg) {
        return {
            windowSec: cfg.windowSec,
            uvLimit: cfg.uvLimit,
            creepIncreasing: cfg.creepIncreasing,
            creepDecreasing: cfg.creepDecreasing,
            minimumDeltaUv: cfg.minimumDeltaUv,
            lowerThresholdMinimum: cfg.lowerThresholdMinimum,
            upperThresholdInit: 25,
            lowerThresholdInit: 0,
            manualThresholdsEnabled: !!cfg.manualThresholds,
            manualUpperThresholdUv: cfg.manualUpperUv,
            manualLowerThresholdUv: cfg.manualLowerUv
        };
    }

    function peakOptsFromCfg(cfg) {
        return {
            windowSec: cfg.peakWindowSec,
            binSec: cfg.peakBinSec,
            thresholdUv: cfg.peakThresholdUv,
            maxUv: cfg.peakMaxUv,
            minBinFraction: cfg.minBinFraction
        };
    }

    function getApiBase() {
        return typeof window.ssvepGetDevicesApiBase === 'function'
            ? window.ssvepGetDevicesApiBase()
            : `${typeof window.ssvepResolveApiOrigin === 'function' ? window.ssvepResolveApiOrigin() : 'http://127.0.0.1:8000'}/api/devices`;
    }

    function getSr(message) {
        const fromMsg = message && Number(message.sampling_rate);
        if (Number.isFinite(fromMsg) && fromMsg > 0) return fromMsg;
        const gdm = window.globalDeviceManager;
        const sr = gdm && gdm.deviceInfo && Number(gdm.deviceInfo.sampling_rate);
        return Number.isFinite(sr) && sr > 0 ? sr : 250;
    }

    function getMotionChannelIndicesForTest() {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (CFG && typeof CFG.getPhysicalChannelsForRole === 'function') {
            return CFG.getPhysicalChannelsForRole('motor_imagery');
        }
        const gdm = window.globalDeviceManager;
        const roles = gdm && typeof gdm.getChannelRoles === 'function' ? gdm.getChannelRoles() : null;
        if (!Array.isArray(roles)) return [];
        const out = [];
        for (let i = 0; i < roles.length; i++) {
            if (roles[i] === 'motor_imagery') out.push(i);
        }
        return out;
    }

    function readCfg() {
        const peakWindowSec = parseFloat(document.getElementById('cfg-peak-window').value) || 1.0;
        const lbl = document.getElementById('lbl-peak-window');
        if (lbl) lbl.textContent = String(peakWindowSec);
        return {
            windowSec: parseFloat(document.getElementById('cfg-window').value) || 1.0,
            holdMs: parseInt(document.getElementById('cfg-hold-ms').value, 10) || 600,
            peakWindowSec,
            peakBinSec: 0.2,
            peakThresholdUv: parseFloat(document.getElementById('cfg-peak-threshold').value) || 50,
            peakMaxUv: parseFloat(document.getElementById('cfg-peak-max').value) || 200,
            minBinFraction: parseFloat(document.getElementById('cfg-min-bins').value) || 0.4,
            normGate: Math.max(0, Math.min(1, parseFloat(document.getElementById('cfg-norm-gate').value) || 0.8)),
            springK: parseFloat(document.getElementById('cfg-spring').value) || 10,
            damping: parseFloat(document.getElementById('cfg-damping').value) || 5,
            maxForce: parseFloat(document.getElementById('cfg-max-force').value) || 1.2,
            uvLimit: 200,
            minimumDeltaUv: 10,
            lowerThresholdMinimum: 6,
            creepIncreasing: 0.9,
            creepDecreasing: 0.99999,
            manualThresholds: !!document.getElementById('cfg-manual-thresholds')?.checked,
            manualUpperUv: parseFloat(document.getElementById('cfg-manual-upper')?.value) || 25,
            manualLowerUv: parseFloat(document.getElementById('cfg-manual-lower')?.value) || 6
        };
    }

    function toggleManualThresholdFields() {
        const on = !!document.getElementById('cfg-manual-thresholds')?.checked;
        const wrap = document.getElementById('manual-threshold-fields');
        if (wrap) wrap.style.display = on ? 'block' : 'none';
        const resetBtn = document.getElementById('btn-reset');
        if (resetBtn) resetBtn.disabled = on;
        if (resetBtn) resetBtn.title = on ? '固定阈模式下无需重置自适应' : '';
    }

    function ensureEmgState(ch) {
        const EMG = getEmgProcessor();
        if (!EMG || typeof EMG.createEmgChannelState !== 'function') return null;
        const opts = emgOptsFromCfg(readCfg());
        if (!emgStates[ch]) {
            emgStates[ch] = EMG.createEmgChannelState(opts);
            channelMetrics[ch] = emptyMetrics(ch);
        } else if (typeof EMG.syncEmgChannelParams === 'function') {
            EMG.syncEmgChannelParams(emgStates[ch], opts);
        }
        return emgStates[ch];
    }

    function ensurePeakState(ch) {
        const PEAK = getPeakTrigger();
        if (!PEAK || typeof PEAK.createPeakTriggerState !== 'function') return null;
        const opts = peakOptsFromCfg(readCfg());
        if (!peakStates[ch]) {
            peakStates[ch] = PEAK.createPeakTriggerState(opts);
        } else if (typeof PEAK.syncPeakTriggerParams === 'function') {
            PEAK.syncPeakTriggerParams(peakStates[ch], opts);
        } else {
            peakStates[ch].windowSec = opts.windowSec;
            peakStates[ch].binSec = opts.binSec;
            peakStates[ch].thresholdUv = opts.thresholdUv;
            peakStates[ch].maxUv = opts.maxUv;
            peakStates[ch].minBinFraction = opts.minBinFraction;
        }
        return peakStates[ch];
    }

    function syncPeakCfgLive() {
        const cfg = readCfg();
        for (const ch of Object.keys(peakStates)) {
            ensurePeakState(Number(ch));
        }
        if (hasStream || (window.globalDeviceManager && window.globalDeviceManager.dataDisplayBuffer?.length)) {
            refreshMetricsFromDisplayBuffer(cfg);
        }
        updateTriggerPreview(cfg);
    }

    function emptyMetrics(ch) {
        return {
            ch,
            signedUv: 0,
            instantUv: 0,
            averageUv: 0,
            windowMax: 0,
            windowMin: 0,
            norm: 0,
            upper: 25,
            lower: 0,
            ready: false,
            triggered: false,
            triggerStrength: 0,
            driveForce: 0,
            activity: 0,
            peak: 0,
            valley: 0,
            amplitude: 0,
            peak2peak: 0,
            binsOk: 0,
            binsRequired: 0,
            binsMinOk: 0,
            peakThresholdUv: 50
        };
    }

    function resetAllEmg() {
        const EMG = getEmgProcessor();
        const PEAK = getPeakTrigger();
        const cfg = readCfg();
        const emgOpts = emgOptsFromCfg(cfg);
        const peakOpts = peakOptsFromCfg(cfg);
        for (const ch of Object.keys(emgStates)) {
            if (EMG && typeof EMG.resetEmgChannelState === 'function') {
                EMG.resetEmgChannelState(emgStates[ch], emgOpts);
            }
        }
        for (const ch of Object.keys(peakStates)) {
            if (PEAK && typeof PEAK.resetPeakTriggerState === 'function') {
                PEAK.resetPeakTriggerState(peakStates[ch], peakOpts);
            }
        }
        emgStates = {};
        peakStates = {};
        channelMetrics = {};
        sustainedSince = null;
        particles.length = 0;
        bufferConsumeIdx = 0;
        for (const ch of getMotionChannelIndicesForTest()) {
            ensureEmgState(ch);
            ensurePeakState(ch);
        }
    }

    function normalizeRowsForEmg(message) {
        const plot =
            message && Array.isArray(message.data_display) && message.data_display.length
                ? message.data_display
                : null;
        if (!plot) {
            return { rows: [], filtered: false, reason: 'no-data-display' };
        }
        if (typeof window.normalizeDeviceStreamSamples === 'function') {
            const rows = window.normalizeDeviceStreamSamples({ ...message, data: plot });
            if (Array.isArray(rows) && rows.length) {
                return { rows, filtered: true };
            }
        }
        const rows = plot
            .map((row) => (Array.isArray(row) ? row.map((x) => Number(x) || 0) : []))
            .filter((r) => r.length);
        return { rows, filtered: rows.length > 0 };
    }

    /**
     * 从 GDM.dataDisplayBuffer 刷新指标（对齐 OpenBCI：EmgSettings 用整段滤波显示窗）。
     */
    function refreshMetricsFromDisplayBuffer(cfg) {
        const gdm = window.globalDeviceManager;
        const EMG = getEmgProcessor();
        const PEAK = getPeakTrigger();
        if (!gdm || !EMG || !PEAK) return false;

        const buf = gdm.dataDisplayBuffer;
        if (!Array.isArray(buf) || !buf.length) return false;

        const motionChs = getMotionChannelIndicesForTest();
        if (!motionChs.length) return false;

        const sr = getSr();
        const period = Math.max(1, Math.floor(sr * cfg.windowSec));
        const windowRows = buf.slice(-period);

        const peakPeriod = Math.max(1, Math.floor(sr * cfg.peakWindowSec));
        const peakWindowRows = buf.slice(-peakPeriod);

        let fed = false;
        for (const ch of motionChs) {
            if (!windowRows.length || ch >= windowRows[0].length) continue;
            const st = ensureEmgState(ch);
            const pst = ensurePeakState(ch);
            if (!st || !pst) continue;

            const signedWin = windowRows.map((r) => Number(r[ch]) || 0);
            const signedPeakWin = peakWindowRows.map((r) => Number(r[ch]) || 0);
            const absWin = signedWin.map((v) => Math.abs(v));

            const out =
                typeof EMG.processEmgFromWindow === 'function'
                    ? EMG.processEmgFromWindow(st, absWin, sr)
                    : EMG.feedEmgAbsSamples(st, absWin, sr);

            const peakOut =
                typeof PEAK.evaluatePeakFromWindow === 'function'
                    ? PEAK.evaluatePeakFromWindow(pst, signedPeakWin, sr)
                    : { triggered: false, strength: 0, activity: 0, lastPeak: 0, lastValley: 0, lastAmplitude: 0, lastPeak2peak: 0, binsOk: 0, binsRequired: 0 };

            const normDrive = out.ready && out.outputNormalized >= cfg.normGate ? out.outputNormalized : 0;
            const driveForce = Math.max(normDrive, peakOut.activity || 0);

            const lastSigned = signedWin.length ? signedWin[signedWin.length - 1] : 0;
            const winStats =
                typeof EMG.signedWindowStats === 'function'
                    ? EMG.signedWindowStats(signedWin)
                    : { instant: lastSigned, windowMax: lastSigned, windowMin: lastSigned };
            channelMetrics[ch] = {
                ch,
                signedUv: winStats.instant,
                instantUv: Math.abs(winStats.instant),
                averageUv: out.averageUv,
                windowMax: winStats.windowMax,
                windowMin: winStats.windowMin,
                norm: out.outputNormalized,
                upper: out.upperThreshold,
                lower: out.lowerThreshold,
                ready: out.ready,
                triggered: peakOut.triggered,
                triggerStrength: peakOut.strength,
                driveForce,
                activity: peakOut.activity,
                peak: peakOut.lastPeak,
                valley: peakOut.lastValley,
                amplitude: peakOut.lastAmplitude,
                peak2peak: peakOut.lastPeak2peak,
                binsOk: peakOut.binsOk,
                binsRequired: peakOut.binsRequired,
                binsMinOk: peakOut.binsMinOk,
                peakThresholdUv: peakOut.thresholdUv != null ? peakOut.thresholdUv : cfg.peakThresholdUv
            };
            fed = true;
        }

        return fed;
    }

    function ingestSampleRows(rows, message, meta) {
        if (!meta || !meta.filtered) {
            lastRejectReason = (meta && meta.reason) || 'no-data-display';
            return false;
        }

        const motionChs = getMotionChannelIndicesForTest();
        if (!motionChs.length) {
            lastRejectReason = 'motion-ch-empty';
            return false;
        }

        if (!getEmgProcessor() || !getPeakTrigger()) {
            lastRejectReason = !getEmgProcessor()
                ? 'missing-emg-processor.js'
                : 'missing-emg-peak-trigger.js';
            return false;
        }

        const cfg = readCfg();
        if (!refreshMetricsFromDisplayBuffer(cfg)) {
            lastRejectReason = 'display-buffer-empty';
            return false;
        }

        lastRejectReason = '';
        lastIngestUsedFiltered = true;
        hasStream = true;
        sampleBatchCount += 1;
        updateTriggerPreview(cfg);
        updateConnectionUi();
        return true;
    }

    function handleStreamData(message) {
        wsDataPacketCount += 1;
        const pack = normalizeRowsForEmg(message);
        if (!pack.rows.length) {
            lastRejectReason = pack.reason || 'ws-display-empty';
            return;
        }
        ingestSampleRows(pack.rows, message, pack);
        markBufferFullyConsumed();
    }

    function tickFromDeviceBuffer() {
        const cfg = readCfg();

        if (!isDeviceLive()) {
            updateConnectionUi();
            updateTriggerPreview(cfg);
            return;
        }

        const newRows = consumeNewBufferSamples();
        if (newRows.length) {
            ingestSampleRows(newRows, { sampling_rate: getSr() }, { filtered: true });
        } else {
            refreshMetricsFromDisplayBuffer(cfg);
        }

        if (!hasStream) void pullDataFromHttpFallback();

        updateTriggerPreview(cfg);
        updateConnectionUi();
    }

    function onStreamReady() {
        deviceConnected = true;
        const gdm = window.globalDeviceManager;
        if (gdm) {
            gdm.loadChannelConfig();
            if (!gdm.ws || gdm.ws.readyState !== WebSocket.OPEN) {
                gdm.connectWebSocket(true);
            }
            const pending = gdm.dataDisplayBuffer ? gdm.dataDisplayBuffer.slice(bufferConsumeIdx) : [];
            if (pending.length) {
                ingestSampleRows(pending, { sampling_rate: getSr() }, { filtered: true });
                bufferConsumeIdx = gdm.dataDisplayBuffer.length;
            }
        }
        fillMapSelects();
        tickFromDeviceBuffer();
        updateConnectionUi();
        updateTriggerPreview(readCfg());
    }

    function onStreamLost() {
        deviceConnected = false;
        hasStream = false;
        updateConnectionUi();
        updateTriggerPreview(readCfg());
    }

    function onGlobalDeviceEvent(event, data) {
        if (event === 'data') {
            handleStreamData(data);
        } else if (event === 'connected' || event === 'wsConnected') {
            onStreamReady();
            if (event === 'wsConnected' && !hasStream) void pullDataFromHttpFallback();
        } else if (event === 'disconnected' || event === 'statusChange') {
            const gdm = window.globalDeviceManager;
            if (gdm && !gdm.isConnected) onStreamLost();
            else if (event === 'statusChange' && data && data.connected) onStreamReady();
        }
    }

    function attachDeviceListener() {
        if (listenerAttached) return;
        const gdm = window.globalDeviceManager;
        if (!gdm) return;
        gdm.addEventListener(onGlobalDeviceEvent);
        listenerAttached = true;
    }

    async function syncDeviceFromBackend() {
        const gdm = window.globalDeviceManager;
        try {
            const resp = await fetch(`${getApiBase()}/status`);
            const json = await resp.json();
            if (json.success && json.status && json.status.connected) {
                deviceConnected = true;
                if (gdm) {
                    gdm.isConnected = true;
                    gdm.deviceInfo = json.status.device_info;
                    gdm.saveState();
                    gdm.loadChannelConfig();
                }
                if (gdm && (!gdm.ws || gdm.ws.readyState !== WebSocket.OPEN)) {
                    gdm.connectWebSocket(true);
                }
                return true;
            }
            if (gdm) {
                gdm.isConnected = false;
                gdm.deviceInfo = null;
                gdm.saveState();
            }
            deviceConnected = false;
        } catch (e) {
            console.warn('[EMG test] /status:', e);
            deviceConnected = false;
        }
        return deviceConnected;
    }

    async function pullDataFromHttpFallback() {
        if (httpPullInFlight) return;
        const now = Date.now();
        if (now - lastHttpPullMs < 350) return;
        if (!isDeviceLive() || hasStream) return;

        httpPullInFlight = true;
        lastHttpPullMs = now;
        httpPullAttemptCount += 1;
        const abortMs = 5000;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer =
            controller &&
            setTimeout(() => {
                try {
                    controller.abort();
                } catch (_e) {
                    /* ignore */
                }
            }, abortMs);
        try {
            const resp = await fetch(`${getApiBase()}/data?duration=0.12&for_display=true`, {
                signal: controller ? controller.signal : undefined
            });
            const json = await resp.json().catch(() => null);
            if (!resp.ok || !json || !json.success) {
                httpPullFailCount += 1;
                lastHttpError =
                    (json && (json.detail || json.message)) ||
                    `HTTP ${resp.status}` ||
                    'http-not-success';
                return;
            }
            if (!Array.isArray(json.data) || !json.data.length) {
                httpPullFailCount += 1;
                lastHttpError = `http-empty shape=${JSON.stringify(json.shape || null)}`;
                return;
            }
            const rows = json.data
                .map((row) => (Array.isArray(row) ? row.map((x) => Number(x) || 0) : []))
                .filter((r) => r.length);
            if (!rows.length) {
                httpPullFailCount += 1;
                lastHttpError = 'http-rows-empty-after-normalize';
                return;
            }
            const ok = ingestSampleRows(
                rows,
                { sampling_rate: Number(json.sampling_rate) || getSr() },
                { filtered: !!json.for_display }
            );
            if (ok) {
                httpPullSuccessCount += 1;
                lastHttpError = '';
            } else {
                httpPullFailCount += 1;
                lastHttpError = lastRejectReason || 'http-ingest-false';
            }
        } catch (e) {
            httpPullFailCount += 1;
            const msg = e && e.message ? e.message : String(e);
            lastHttpError =
                e && e.name === 'AbortError' ? `HTTP 超时（>${abortMs}ms）` : msg;
        } finally {
            if (timer) clearTimeout(timer);
            httpPullInFlight = false;
        }
    }

    function isDeviceLive() {
        const gdm = window.globalDeviceManager;
        return deviceConnected || !!(gdm && gdm.isConnected);
    }

    /** OpenBCI 风格：norm 与峰峰值活动度取较大值 */
    function channelDriveForce(ch) {
        const m = channelMetrics[ch];
        if (!m) return 0;
        return Math.max(0, Math.min(1, m.driveForce ?? 0));
    }

    /** OpenBCI 摇杆：X+ 力度 − X− 力度 */
    function axisForce(posCh, negCh) {
        const fp = posCh != null ? channelDriveForce(posCh) : 0;
        const fn = negCh != null ? channelDriveForce(negCh) : 0;
        return fp - fn;
    }

    function computeAxisForces(cfg) {
        return {
            fx: axisForce(parseMapChannel('map-x-pos'), parseMapChannel('map-x-neg')),
            fy: axisForce(parseMapChannel('map-y-pos'), parseMapChannel('map-y-neg'))
        };
    }

    function resetBallState() {
        smoothX = 0;
        smoothY = 0;
        ballVx = 0;
        ballVy = 0;
        lastPhysicsMs = 0;
    }

    /** 触发力 − 弹簧回中；默认静止在中心 */
    function updateBallPhysics(cfg) {
        const now = performance.now();
        if (!lastPhysicsMs) lastPhysicsMs = now;
        let dt = (now - lastPhysicsMs) / 1000;
        lastPhysicsMs = now;
        if (dt > 0.1) dt = 0.1;
        if (dt < 0.001) dt = 0.001;

        const { fx, fy } = computeAxisForces(cfg);
        const driveScale = cfg.maxForce;

        const ax = fx * driveScale - cfg.springK * smoothX - cfg.damping * ballVx;
        const ay = fy * driveScale - cfg.springK * smoothY - cfg.damping * ballVy;

        ballVx += ax * dt;
        ballVy += ay * dt;
        smoothX += ballVx * dt;
        smoothY += ballVy * dt;

        smoothX = Math.max(-1, Math.min(1, smoothX));
        smoothY = Math.max(-1, Math.min(1, smoothY));

        const el = document.getElementById('readout');
        if (el) {
            el.innerHTML =
                `X: <strong>${smoothX.toFixed(2)}</strong> · Y: <strong>${smoothY.toFixed(2)}</strong>` +
                ` <span style="color:#666">(力 ${fx.toFixed(2)}, ${fy.toFixed(2)})</span>`;
        }
    }

    function parseMapChannel(id) {
        const sel = document.getElementById(id);
        if (!sel || sel.value === '') return null;
        const ch = parseInt(sel.value, 10);
        return Number.isFinite(ch) ? ch : null;
    }

    function consumeNewBufferSamples() {
        const gdm = window.globalDeviceManager;
        if (!gdm || !Array.isArray(gdm.dataDisplayBuffer)) return [];
        const buf = gdm.dataDisplayBuffer;
        if (bufferConsumeIdx > buf.length) bufferConsumeIdx = 0;
        if (bufferConsumeIdx >= buf.length) return [];
        const slice = buf.slice(bufferConsumeIdx);
        bufferConsumeIdx = buf.length;
        return slice;
    }

    function markBufferFullyConsumed() {
        const gdm = window.globalDeviceManager;
        if (gdm && Array.isArray(gdm.dataDisplayBuffer)) {
            bufferConsumeIdx = gdm.dataDisplayBuffer.length;
        }
    }

    function gaussianRandom() {
        let u = 0;
        let v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    function spawnParticles(bx, by, count) {
        for (let i = 0; i < count; i++) {
            particles.push({
                x: bx + gaussianRandom() * 6,
                y: by + gaussianRandom() * 6,
                vx: gaussianRandom() * 0.35,
                vy: gaussianRandom() * 0.35,
                life: 1,
                decay: 0.012 + Math.random() * 0.022,
                size: 1.5 + Math.abs(gaussianRandom()) * 2.5
            });
        }
        while (particles.length > MAX_PARTICLES) particles.shift();
    }

    function getDefaultMapChannels(motionChs) {
        const none = { xNeg: null, xPos: null, yPos: null, yNeg: null };
        if (!motionChs.length) return none;
        if (motionChs.length === 1) {
            return { xNeg: null, xPos: motionChs[0], yPos: null, yNeg: null };
        }
        if (motionChs.length === 2) {
            const ch4 = motionChs.includes(3) ? 3 : motionChs[motionChs.length - 1];
            return { xNeg: null, xPos: ch4, yNeg: null, yPos: null };
        }
        if (motionChs.length === 3) {
            return { xNeg: motionChs[0], xPos: motionChs[1], yNeg: null, yPos: motionChs[2] };
        }
        return {
            xNeg: motionChs[0],
            xPos: motionChs[1],
            yPos: motionChs[2],
            yNeg: motionChs[3]
        };
    }

    function loadSavedXYMap() {
        try {
            const raw = localStorage.getItem(MAP_STORAGE_KEY);
            if (!raw) return null;
            const o = JSON.parse(raw);
            return o && typeof o === 'object' ? o : null;
        } catch (_e) {
            return null;
        }
    }

    function saveXYMapToStorage() {
        const payload = {
            xNeg: parseMapChannel('map-x-neg'),
            xPos: parseMapChannel('map-x-pos'),
            yPos: parseMapChannel('map-y-pos'),
            yNeg: parseMapChannel('map-y-neg'),
            savedAt: Date.now()
        };
        try {
            localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn('[EMG test] save XY map:', e);
        }
    }

    function resolveMapChannelValue(savedVal, motionChs, fallback) {
        if (savedVal === null || savedVal === '' || savedVal === undefined) {
            return fallback != null ? String(fallback) : '';
        }
        const ch = parseInt(savedVal, 10);
        if (Number.isFinite(ch) && motionChs.includes(ch)) return String(ch);
        return fallback != null ? String(fallback) : '';
    }

    function updateTriggerPreview(cfg) {
        const motionChs = getMotionChannelIndicesForTest();
        const preview = document.getElementById('trigger-preview');
        if (!preview) return;

        if (!motionChs.length) {
            preview.className = 'status-pill status-wait';
            preview.textContent = '请先在设备管理将通道标为「运动」';
            return;
        }
        if (!isDeviceLive()) {
            preview.className = 'status-pill status-wait';
            preview.textContent = '设备未连接';
            return;
        }
        if (!hasStream) {
            preview.className = 'status-pill status-wait';
            if (lastRejectReason === 'no-data-display') {
                preview.textContent = '等待滤波 data_display…';
            } else if (lastRejectReason === 'missing-emg-peak-trigger.js') {
                preview.textContent = '缺少 emg-peak-trigger.js';
            } else {
                preview.textContent = lastRejectReason ? `等待数据：${lastRejectReason}` : '等待设备数据流…';
            }
            return;
        }

        let maxStrength = 0;
        let maxCh = motionChs[0];
        let anyTriggered = false;
        for (const ch of motionChs) {
            const m = channelMetrics[ch];
            if (!m) continue;
            if (m.triggered) {
                anyTriggered = true;
                if (m.triggerStrength > maxStrength) {
                    maxStrength = m.triggerStrength;
                    maxCh = ch;
                }
            }
        }

        const m = channelMetrics[maxCh] || {};

        let maxDrive = 0;
        let driveCh = motionChs[0];
        for (const ch of motionChs) {
            const dm = channelMetrics[ch];
            if (dm && (dm.driveForce || 0) > maxDrive) {
                maxDrive = dm.driveForce;
                driveCh = ch;
            }
        }
        const dm = channelMetrics[driveCh] || m;

        if (anyTriggered) {
            preview.className = 'status-pill status-bad';
            preview.textContent = `峰谷触发 Ch${maxCh + 1} · 达标 ${m.binsOk}/${m.binsMinOk}（共${m.binsRequired}段）· 阈±${cfg.peakThresholdUv}`;
        } else if (maxDrive > cfg.normGate) {
            preview.className = 'status-pill status-wait';
            preview.textContent = `活动中 Ch${driveCh + 1} norm=${(dm.norm || 0).toFixed(2)} 驱动=${maxDrive.toFixed(2)} · 峰/谷 ${(dm.peak || 0).toFixed(0)}/${(dm.valley || 0).toFixed(0)}`;
        } else {
            preview.className = 'status-pill status-ok';
            preview.textContent = `静息 · Ch${driveCh + 1} 峰/谷 ${(m.peak || 0).toFixed(0)}/${(m.valley || 0).toFixed(0)} · 达标 ${m.binsOk}/${m.binsMinOk}（阈±${cfg.peakThresholdUv}）`;
        }
    }

    function resizeBarsCanvas() {
        if (!barsCanvas || !barsCtx) return;
        const motionChs = getMotionChannelIndicesForTest();
        const n = Math.max(1, motionChs.length);
        const panel = barsCanvas.parentElement;
        const cssW = panel ? Math.max(180, Math.min(280, panel.clientWidth - 8)) : 220;
        const cssH = n * BAR_ROW_SLOT + 8;
        barsLayoutCssW = cssW;
        barsLayoutCssH = cssH;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const pxW = Math.round(cssW * dpr);
        const pxH = Math.round(cssH * dpr);
        if (barsCanvas.width !== pxW || barsCanvas.height !== pxH) {
            barsCanvas.width = pxW;
            barsCanvas.height = pxH;
        }
        barsCanvas.style.width = `${cssW}px`;
        barsCanvas.style.height = `${cssH}px`;
        barsCanvas.style.flex = 'none';
        barsCanvas.style.minHeight = '0';
        barsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** OpenBCI W_EMG 风格 norm 竖条（仅绘制，数据在 tick 中刷新） */
    function drawEmgBars() {
        if (!barsCanvas || !barsCtx) return;
        resizeBarsCanvas();
        const cfg = readCfg();
        const motionChs = getMotionChannelIndicesForTest();
        const w = barsLayoutCssW;
        const h = barsLayoutCssH;
        const ctxB = barsCtx;

        ctxB.fillStyle = '#0c0c12';
        ctxB.fillRect(0, 0, w, h);

        if (!motionChs.length) {
            ctxB.fillStyle = '#555';
            ctxB.font = '11px Segoe UI, sans-serif';
            ctxB.fillText('请配置运动通道', 12, 24);
            return;
        }

        const rowH = BAR_ROW_SLOT;
        const barH = BAR_HEIGHT_PX;
        const normW = 52;
        const trigW = 24;

        motionChs.forEach((ch, idx) => {
            const m = channelMetrics[ch] || emptyMetrics(ch);
            const y0 = idx * rowH + 6;
            const color = CHANNEL_COLORS[ch % CHANNEL_COLORS.length];
            const normX = 42;
            const barTop = y0 + 14;
            const barBottom = barTop + barH;

            ctxB.fillStyle = '#1f456e';
            ctxB.font = 'bold 15px Segoe UI, sans-serif';
            ctxB.fillText(String(ch + 1), 10, barTop + barH * 0.45);

            ctxB.strokeStyle = OPENBCI_STROKE;
            ctxB.lineWidth = 1;
            ctxB.strokeRect(normX, barTop, normW, barH);

            const normFill = m.ready ? Math.max(0, Math.min(1, m.norm)) : 0;
            const normPx = normFill * barH;
            ctxB.fillStyle = color;
            ctxB.fillRect(normX, barBottom - normPx, normW, normPx);

            if (m.ready && m.upper > 0) {
                const upperY = barBottom - (Math.min(m.upper, cfg.uvLimit) / cfg.uvLimit) * barH;
                const lowerY = barBottom - (Math.min(m.lower, cfg.uvLimit) / cfg.uvLimit) * barH;
                ctxB.strokeStyle = OPENBCI_STROKE;
                ctxB.setLineDash([]);
                ctxB.beginPath();
                ctxB.moveTo(normX - 2, upperY);
                ctxB.lineTo(normX + normW + trigW + 10, upperY);
                ctxB.moveTo(normX - 2, lowerY);
                ctxB.lineTo(normX + normW + trigW + 10, lowerY);
                ctxB.stroke();
            }

            const gateY = barBottom - Math.max(0, Math.min(1, cfg.normGate)) * barH;
            ctxB.strokeStyle = NORM_GATE_STROKE;
            ctxB.setLineDash([4, 3]);
            ctxB.beginPath();
            ctxB.moveTo(normX - 2, gateY);
            ctxB.lineTo(normX + normW + 2, gateY);
            ctxB.stroke();
            ctxB.setLineDash([]);

            const trigX = normX + normW + 8;
            ctxB.strokeStyle = 'rgba(255,140,0,0.5)';
            ctxB.strokeRect(trigX, barTop, trigW, barH);
            const barLevel = Math.max(m.norm || 0, m.driveForce || 0, m.activity || 0);
            const trigPx = barLevel * barH;
            ctxB.fillStyle = barLevel > cfg.normGate ? 'rgba(255,140,0,0.9)' : 'rgba(255,140,0,0.12)';
            ctxB.fillRect(trigX, barBottom - trigPx, trigW, trigPx);

            const textX = trigX + trigW + 8;
            ctxB.fillStyle = '#888';
            ctxB.font = '11px Consolas, monospace';
            const normTxt = m.ready ? m.norm.toFixed(2) : '…';
            const thr = m.peakThresholdUv != null ? m.peakThresholdUv : cfg.peakThresholdUv;
            const pkTxt = `${(m.peak || 0).toFixed(0)}/${(m.valley || 0).toFixed(0)}`;
            const minOk = m.binsMinOk != null ? m.binsMinOk : '?';
            ctxB.fillText(`norm ${normTxt}`, textX, barTop + 12);
            ctxB.fillText(`峰/谷 ${pkTxt} (±${thr})`, textX, barTop + 24);
            ctxB.fillText(`avg|µV| ${m.ready ? (m.averageUv || 0).toFixed(0) : '…'}`, textX, barTop + 36);
            ctxB.fillText(
                `bin ${m.binsOk}/${minOk}需/${m.binsRequired}段${m.triggered ? ' 触发' : ''}`,
                textX,
                barTop + 48
            );
            if (barLevel > cfg.normGate) {
                ctxB.fillStyle = '#ffb300';
                ctxB.fillText(
                    `驱动 ${(m.driveForce || 0).toFixed(2)} Δ${(m.peak2peak || 0).toFixed(0)}`,
                    textX,
                    barTop + 60
                );
            }
        });
    }

    function updateConnectionUi() {
        const pill = document.getElementById('conn-status');
        const detail = document.getElementById('conn-detail');
        const srLabel = document.getElementById('sr-label');
        if (!pill) return;

        const gdm = window.globalDeviceManager;
        const bufLen = gdm && gdm.dataDisplayBuffer ? gdm.dataDisplayBuffer.length : 0;
        const motionChs = getMotionChannelIndicesForTest();
        const wsOpen = gdm && gdm.ws && gdm.ws.readyState === WebSocket.OPEN;

        if (!isDeviceLive()) {
            pill.className = 'status-pill status-bad';
            pill.textContent = '未连接';
            detail.textContent = '请先在设备管理连接 EEG（或看右下角状态）';
        } else {
            pill.className = 'status-pill status-ok';
            pill.textContent = '已连接';
            const chLabel = motionChs.length ? `Ch${motionChs.map((i) => i + 1).join('、')}` : '未配置';
            if (hasStream) {
                const src = lastIngestUsedFiltered ? '滤波' : '原始?';
                detail.textContent = `数据流正常 · 运动 ${chLabel} · ${src}缓冲 ${bufLen} · 批 ${sampleBatchCount}`;
            } else if (!motionChs.length) {
                detail.textContent = '未配置运动通道';
            } else {
                detail.textContent = `已连接 · 运动 ${chLabel} · WS ${wsOpen ? '开' : '关'}${lastRejectReason ? ' · ' + lastRejectReason : ''}`;
            }
        }
        if (srLabel) srLabel.textContent = `采样率 ${getSr()} Hz`;
    }

    function fillMapSelects() {
        const motionChs = getMotionChannelIndicesForTest();
        const def = getDefaultMapChannels(motionChs);
        const defaults = [def.xNeg, def.xPos, def.yPos, def.yNeg];
        const saved = loadSavedXYMap();
        const optionHtml = motionChs.length
            ? '<option value="">—</option>' +
              motionChs.map((ch) => `<option value="${ch}">Ch${ch + 1}</option>`).join('')
            : '<option value="">—</option>';
        for (let i = 0; i < MAP_SELECT_IDS.length; i++) {
            const sel = document.getElementById(MAP_SELECT_IDS[i]);
            if (!sel) continue;
            sel.innerHTML = optionHtml;
            const savedVal = saved ? saved[MAP_KEYS[i]] : undefined;
            sel.value = resolveMapChannelValue(savedVal, motionChs, defaults[i]);
        }
    }

    function drawPlot() {
        if (!canvas || !ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const r = Math.min(w, h) / 2 - 36;

        ctx.fillStyle = '#080810';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#1e2438';
        ctx.lineWidth = 1;
        const gridStep = r / 4;
        for (let i = -4; i <= 4; i++) {
            ctx.beginPath();
            ctx.moveTo(cx + i * gridStep, cy - r);
            ctx.lineTo(cx + i * gridStep, cy + r);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx - r, cy + i * gridStep);
            ctx.lineTo(cx + r, cy + i * gridStep);
            ctx.stroke();
        }

        ctx.strokeStyle = '#3a4560';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy);
        ctx.lineTo(cx + r, cy);
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx, cy + r);
        ctx.stroke();

        const bx = cx + smoothX * r;
        const by = cy - smoothY * r;
        spawnParticles(bx, by, 3 + Math.round(Math.hypot(smoothX, smoothY) * 8));

        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx + (bx - p.x) * 0.02;
            p.y += p.vy + (by - p.y) * 0.02;
            p.life -= p.decay;
            if (p.life <= 0) {
                particles.splice(i, 1);
                continue;
            }
            const alpha = p.life * 0.55;
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
            grad.addColorStop(0, `rgba(255, 179, 0, ${alpha})`);
            grad.addColorStop(0.5, `rgba(255, 120, 50, ${alpha * 0.4})`);
            grad.addColorStop(1, 'rgba(255, 80, 80, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
            ctx.fill();
        }

        const coreGrad = ctx.createRadialGradient(bx, by, 0, bx, by, 14);
        coreGrad.addColorStop(0, '#fff8e0');
        coreGrad.addColorStop(0.35, '#ffb300');
        coreGrad.addColorStop(1, 'rgba(255, 80, 50, 0)');
        ctx.fillStyle = coreGrad;
        ctx.beginPath();
        ctx.arc(bx, by, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe082';
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    function renderLoop() {
        const cfg = readCfg();
        if (isDeviceLive() && hasStream) {
            updateBallPhysics(cfg);
        } else {
            const dt = 0.016;
            const ax = -cfg.springK * smoothX - cfg.damping * ballVx;
            const ay = -cfg.springK * smoothY - cfg.damping * ballVy;
            ballVx += ax * dt;
            ballVy += ay * dt;
            smoothX += ballVx * dt;
            smoothY += ballVy * dt;
            if (Math.abs(smoothX) < 0.002 && Math.abs(ballVx) < 0.002) {
                smoothX = 0;
                ballVx = 0;
            }
            if (Math.abs(smoothY) < 0.002 && Math.abs(ballVy) < 0.002) {
                smoothY = 0;
                ballVy = 0;
            }
        }
        drawPlot();
        drawEmgBars();
        requestAnimationFrame(renderLoop);
    }

    function resetPeakStatesOnly() {
        const PEAK = getPeakTrigger();
        const peakOpts = peakOptsFromCfg(readCfg());
        for (const ch of Object.keys(peakStates)) {
            if (PEAK && typeof PEAK.resetPeakTriggerState === 'function') {
                PEAK.resetPeakTriggerState(peakStates[ch], peakOpts);
            }
        }
        sustainedSince = null;
    }

    function bindUi() {
        document.getElementById('btn-reset').addEventListener('click', () => {
            resetAllEmg();
            resetBallState();
        });
        ['cfg-window'].forEach((id) => {
            document.getElementById(id).addEventListener('change', () => {
                resetAllEmg();
                syncPeakCfgLive();
            });
        });
        const liveCfgIds = [
            'cfg-peak-window',
            'cfg-peak-threshold',
            'cfg-peak-max',
            'cfg-min-bins',
            'cfg-norm-gate',
            'cfg-manual-thresholds',
            'cfg-manual-upper',
            'cfg-manual-lower',
            'cfg-hold-ms',
            'cfg-spring',
            'cfg-damping',
            'cfg-max-force'
        ];
        liveCfgIds.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const onLive = () => {
                if (id === 'cfg-manual-thresholds') toggleManualThresholdFields();
                syncPeakCfgLive();
            };
            el.addEventListener('input', onLive);
            el.addEventListener('change', onLive);
        });
        MAP_SELECT_IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => saveXYMapToStorage());
            }
        });
    }

    function startTick() {
        if (tickTimerId != null) return;
        tickTimerId = setInterval(tickFromDeviceBuffer, TICK_MS);
    }

    function stopTick() {
        if (tickTimerId != null) {
            clearInterval(tickTimerId);
            tickTimerId = null;
        }
    }

    async function boot() {
        attachDeviceListener();
        const gdm = window.globalDeviceManager;
        if (gdm) {
            const st = gdm.getStatus();
            if (st.isConnected) deviceConnected = true;
            gdm.loadChannelConfig();
        }
        const ok = await syncDeviceFromBackend();
        if (ok || (gdm && gdm.isConnected)) {
            onStreamReady();
            if (!hasStream) void pullDataFromHttpFallback();
        } else {
            onStreamLost();
        }
        startTick();
    }

    attachDeviceListener();

    document.addEventListener('DOMContentLoaded', () => {
        canvas = document.getElementById('motion-canvas');
        ctx = canvas ? canvas.getContext('2d') : null;
        barsCanvas = document.getElementById('emg-bars-canvas');
        barsCtx = barsCanvas ? barsCanvas.getContext('2d') : null;

        if (!getEmgProcessor()) {
            const detail = document.getElementById('conn-detail');
            if (detail) detail.textContent = '缺少 js/emg-processor.js';
        }
        if (!getPeakTrigger()) {
            const detail = document.getElementById('conn-detail');
            if (detail) detail.textContent = '缺少 js/emg-peak-trigger.js';
        }

        fillMapSelects();
        resetAllEmg();
        bindUi();
        toggleManualThresholdFields();
        renderLoop();
        boot();

        window.addEventListener('focus', () => {
            syncDeviceFromBackend().then((ok) => {
                if (ok) onStreamReady();
                else onStreamLost();
            });
        });
        window.addEventListener('resize', resizeBarsCanvas);
        initEmgExperimentSyncUi();
    });

    function initEmgExperimentSyncUi() {
        const E = window.SEEKBCI_EXPERIMENT;
        if (!E) return;
        E.populateProjectSelect('exp-sync-project');
        const saved = E.loadExperimentConfig();
        const hint = document.getElementById('exp-sync-hint');
        if (saved && saved.emgTest) {
            E.applyEmgTestToDom(saved.emgTest);
            if (hint && saved.updatedAt) {
                hint.textContent = `已加载上次保存的实验参数（${new Date(saved.updatedAt).toLocaleString('zh-CN')}）`;
            }
            toggleManualThresholdFields();
            return;
        }
        try {
            const cur = JSON.parse(localStorage.getItem('ssvep_project') || 'null');
            const emg = cur && cur.settings && cur.settings.experimentEmg;
            if (emg) {
                E.applyEmgTestToDom(emg);
                if (hint) {
                    hint.textContent = `已从当前项目「${cur.name || cur.id}」加载 EMG 实验参数`;
                }
                toggleManualThresholdFields();
            }
        } catch (_) {
            /* ignore */
        }
    }

    window.saveEmgExperimentOnly = function saveEmgExperimentOnly() {
        const E = window.SEEKBCI_EXPERIMENT;
        if (!E) {
            alert('实验配置模块未加载');
            return;
        }
        const saved = E.saveCurrentEmgExperiment();
        const hint = document.getElementById('exp-sync-hint');
        if (hint) {
            hint.textContent = `已保存实验参数（${new Date(saved.updatedAt).toLocaleString('zh-CN')}）`;
        }
        alert('EMG 实验参数已保存到本机，可在下方选择项目后同步。');
    };

    window.syncEmgToProjectUi = function syncEmgToProjectUi() {
        const E = window.SEEKBCI_EXPERIMENT;
        if (!E) {
            alert('实验配置模块未加载');
            return;
        }
        const projectId = document.getElementById('exp-sync-project')?.value;
        if (!projectId) {
            alert('请选择要同步到的项目');
            return;
        }
        try {
            const { project } = E.syncEmgToProject(projectId);
            const hint = document.getElementById('exp-sync-hint');
            if (hint) {
                hint.textContent = `已同步到「${project.name}」的 settings.experimentEmg`;
            }
            alert(`已将 EMG 实验参数写入「${project.name}」。\n\n可在编辑器或后续多模态编排中参考这些设置。`);
        } catch (err) {
            alert('同步失败：' + (err.message || err));
        }
    };

    window.addEventListener('beforeunload', stopTick);
})();
