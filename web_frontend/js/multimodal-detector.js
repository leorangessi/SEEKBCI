/**
 * 多模态在线检测：
 * - 运动/肌电：SSVEP_EMG_MOTION_RUNTIME（与 emg-test 同源 data_display + 驱动力）
 * - 眼电：SSVEP 参考去基线 + 突变/持续
 */
(function (global) {
    const EOG_DEFAULTS = {
        holdThresholdUv: 30,
        holdDurationMs: 600,
        edgeJumpUv: 50,
        edgeWindowMs: 80,
        edgePolarity: 'rise',
        baselineTauSec: 1.5,
        refractoryMs: 280
    };

    const DRIVE = global.SSVEP_EMG_DRIVE;
    const RUN = global.SSVEP_EMG_MOTION_RUNTIME;
    const MOTION_DEFAULTS = DRIVE
        ? { ...DRIVE.DEFAULTS, holdDurationMs: 600, holdRepeatMs: 0, driveReleaseRatio: 0.88, refractoryMs: 280 }
        : { holdDurationMs: 600, holdRepeatMs: 0, driveTriggerLevel: 0.85 };

    /** @type {Map<string, object>} */
    const states = new Map();

    function slotKey(cfg) {
        return `${cfg.channel}:${cfg.physicalChannel != null ? cfg.physicalChannel : 'auto'}`;
    }

    function emaAlpha(dtSec, tauSec) {
        if (!Number.isFinite(tauSec) || tauSec <= 0) return 1;
        return 1 - Math.exp(-dtSec / tauSec);
    }

    function getMeta(channelId) {
        return global.SSVEP_MULTIMODAL_BY_ID && global.SSVEP_MULTIMODAL_BY_ID[channelId]
            ? global.SSVEP_MULTIMODAL_BY_ID[channelId]
            : null;
    }

    function isMotorRole(role) {
        return role === 'motor_imagery';
    }

    function getSsvepReferenceIndices(excludeIndex) {
        const gdm = global.globalDeviceManager;
        let indices = gdm && typeof gdm.getSsvepChannelIndices === 'function' ? gdm.getSsvepChannelIndices() : null;
        if (!Array.isArray(indices) || !indices.length) {
            const CFG = global.SSVEP_DEVICE_CHANNEL_CONFIG;
            if (CFG && typeof CFG.getPhysicalChannelsForRole === 'function') {
                indices = CFG.getPhysicalChannelsForRole('ssvep');
            }
        }
        if (!Array.isArray(indices)) indices = [];
        const out = [];
        for (const idx of indices) {
            const i = Number(idx);
            if (!Number.isFinite(i) || i < 0) continue;
            if (excludeIndex != null && i === excludeIndex) continue;
            out.push(i);
        }
        return out;
    }

    function meanSsvepReference(row, excludeIndex) {
        if (!Array.isArray(row) || !row.length) return 0;
        const indices = getSsvepReferenceIndices(excludeIndex);
        if (!indices.length) {
            for (let i = 0; i < row.length; i++) {
                if (excludeIndex != null && i === excludeIndex) continue;
                return Number(row[i]) || 0;
            }
            return Number(row[0]) || 0;
        }
        let sum = 0;
        let n = 0;
        for (const i of indices) {
            if (i < row.length) {
                sum += Number(row[i]) || 0;
                n++;
            }
        }
        return n ? sum / n : 0;
    }

    function pickRawSample(channelId, physicalChannel, message, row) {
        if (message && message.multimodal && typeof message.multimodal[channelId] === 'number') {
            return Number(message.multimodal[channelId]);
        }
        let idx = -1;
        if (physicalChannel != null && physicalChannel >= 0) idx = physicalChannel;
        else {
            const CFG = global.SSVEP_DEVICE_CHANNEL_CONFIG;
            if (CFG && typeof CFG.getMultimodalPhysicalIndex === 'function') {
                const phys = CFG.getMultimodalPhysicalIndex(channelId);
                if (phys != null && phys >= 0) idx = phys;
            }
        }
        if (idx < 0) {
            const meta = getMeta(channelId);
            idx = meta ? meta.fallbackIndex : -1;
        }
        if (idx >= 0 && Array.isArray(row) && row.length > idx) return Number(row[idx]) || 0;
        return null;
    }

    function migrateBlockParams(block, role) {
        if (isMotorRole(role)) {
            if (DRIVE && typeof DRIVE.paramsFromBlock === 'function') {
                const p = DRIVE.paramsFromBlock(block);
                return {
                    ...p,
                    holdDurationMs:
                        block && block.holdDurationMs != null && Number.isFinite(Number(block.holdDurationMs))
                            ? Math.max(50, Number(block.holdDurationMs))
                            : 600,
                    holdRepeatMs:
                        block && block.holdRepeatMs != null && Number.isFinite(Number(block.holdRepeatMs))
                            ? Math.max(0, Number(block.holdRepeatMs))
                            : 0,
                    driveReleaseRatio: 0.88,
                    refractoryMs: 280
                };
            }
            return { ...MOTION_DEFAULTS };
        }
        const out = { ...EOG_DEFAULTS };
        if (!block || typeof block !== 'object') return out;
        if (block.holdThresholdUv != null) out.holdThresholdUv = Math.max(1, Number(block.holdThresholdUv));
        if (block.holdDurationMs != null) out.holdDurationMs = Math.max(50, Number(block.holdDurationMs));
        if (block.edgeJumpUv != null) out.edgeJumpUv = Math.max(1, Number(block.edgeJumpUv));
        if (block.edgeWindowMs != null) out.edgeWindowMs = Math.max(20, Number(block.edgeWindowMs));
        if (block.edgePolarity === 'fall' || block.edgePolarity === 'both' || block.edgePolarity === 'rise') {
            out.edgePolarity = block.edgePolarity;
        } else if (role === 'eog') {
            out.edgePolarity = 'rise';
        }
        return out;
    }

    function createState(cfg) {
        const meta = getMeta(cfg.channel);
        const role = meta ? meta.role : null;
        const params = migrateBlockParams(cfg, role);
        params.holdRepeatMs = typeof cfg.holdRepeatMs === 'number' ? Math.max(0, cfg.holdRepeatMs) : params.holdRepeatMs;

        return {
            key: slotKey(cfg),
            channel: cfg.channel,
            role,
            physicalChannel: cfg.physicalChannel,
            triggerType: isMotorRole(role) ? 'hold' : cfg.triggerType === 'hold' ? 'hold' : 'edge',
            params,
            emaDiff: null,
            metricHistory: [],
            sustainedAboveSince: null,
            holdActive: false,
            prevHoldActive: false,
            lastEdgeFire: 0,
            lastHoldFire: 0,
            lastMetric: null,
            lastWindowMetric: 0,
            lastDrive: 0
        };
    }

    function resetStatesFromConfigs(configs) {
        states.clear();
        if (RUN && typeof RUN.resetAll === 'function') RUN.resetAll();

        const sr = RUN && typeof RUN.getSamplingRateHz === 'function' ? RUN.getSamplingRateHz() : 250;
        let maxWindowSec = MOTION_DEFAULTS.windowSec || 1;
        for (const cfg of configs || []) {
            const meta = getMeta(cfg.channel);
            if (isMotorRole(meta && meta.role)) {
                const p = migrateBlockParams(cfg, meta.role);
                maxWindowSec = Math.max(maxWindowSec, p.windowSec || 1, p.peakWindowSec || 0.6);
            }
        }
        const warmupMs = Math.max(600, Math.ceil(maxWindowSec * 1000) + 300);
        const warmupUntil = performance.now() + warmupMs;
        for (const cfg of configs || []) {
            const st = createState(cfg);
            st.warmupUntilMs = warmupUntil;
            states.set(slotKey(cfg), st);
        }
    }

    function trimHistory(st, nowMs, keepMs) {
        const cutoff = nowMs - keepMs;
        while (st.metricHistory.length && st.metricHistory[0].t < cutoff) st.metricHistory.shift();
    }

    function metricAtOrBefore(st, targetMs) {
        for (let i = st.metricHistory.length - 1; i >= 0; i--) {
            if (st.metricHistory[i].t <= targetMs) return st.metricHistory[i].v;
        }
        return null;
    }

    function evaluateDriveHoldState(st, drive, tMs, params) {
        const thr = params.driveTriggerLevel != null ? params.driveTriggerLevel : 0.85;
        const release = params.driveReleaseRatio != null ? thr * params.driveReleaseRatio : thr * 0.88;
        st.prevHoldActive = st.holdActive;
        if (drive >= thr) {
            if (st.sustainedAboveSince == null) st.sustainedAboveSince = tMs;
            st.holdActive = tMs - st.sustainedAboveSince >= params.holdDurationMs;
        } else if (drive <= release) {
            st.sustainedAboveSince = null;
            st.holdActive = false;
        }
    }

    function evaluateHoldState(st, level, tMs, params) {
        const thr = params.holdThresholdUv != null ? params.holdThresholdUv : 30;
        const release = params.holdReleaseRatio != null ? thr * params.holdReleaseRatio : thr * 0.65;
        st.prevHoldActive = st.holdActive;
        if (level >= thr) {
            if (st.sustainedAboveSince == null) st.sustainedAboveSince = tMs;
            st.holdActive = tMs - st.sustainedAboveSince >= params.holdDurationMs;
        } else if (level <= release) {
            st.sustainedAboveSince = null;
            st.holdActive = false;
        }
    }

    /** 运动：首次达标触发一次；holdRepeatMs>0 时才重复 */
    function maybeMotionHoldFire(st, tMs, params) {
        if (!st.holdActive) return false;
        const justBecame = st.holdActive && !st.prevHoldActive;
        if (justBecame) {
            st.lastHoldFire = tMs;
            return true;
        }
        const repeatMs = params.holdRepeatMs;
        if (repeatMs > 0 && tMs - st.lastHoldFire >= repeatMs) {
            st.lastHoldFire = tMs;
            return true;
        }
        return false;
    }

    function maybeHoldFire(st, tMs, params) {
        if (st.triggerType !== 'hold' || !st.holdActive) return false;
        const justBecame = st.holdActive && !st.prevHoldActive;
        const repeatDue = tMs - st.lastHoldFire >= (params.holdRepeatMs || 400);
        if (justBecame || repeatDue) {
            st.lastHoldFire = tMs;
            return true;
        }
        return false;
    }

    function resolvePhysicalIndex(cfg, st) {
        if (cfg.physicalChannel != null && cfg.physicalChannel >= 0) return cfg.physicalChannel;
        if (st.physicalChannel != null && st.physicalChannel >= 0) return st.physicalChannel;
        const CFG = global.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (CFG && typeof CFG.getMultimodalPhysicalIndex === 'function') {
            const phys = CFG.getMultimodalPhysicalIndex(cfg.channel);
            if (phys != null && phys >= 0) return phys;
        }
        const meta = getMeta(cfg.channel);
        return meta ? meta.fallbackIndex : -1;
    }

    function processMotorConfig(st, cfg, message, tMs) {
        const params = st.params;
        const idx = resolvePhysicalIndex(cfg, st);
        const noFire = {
            edgeFire: false,
            holdActive: false,
            holdFireRepeat: false,
            metric: st.lastDrive,
            windowMetric: st.lastDrive,
            drive: st.lastDrive
        };

        if (idx < 0 || !RUN || typeof RUN.refreshChannelDrive !== 'function') return noFire;

        const out = RUN.refreshChannelDrive(idx, cfg, message);
        st.lastDrive = out.drive;
        st.lastMetric = out.drive;
        st.lastWindowMetric = out.drive;

        if (st.warmupUntilMs && tMs < st.warmupUntilMs) {
            return { ...noFire, metric: out.drive, windowMetric: out.drive, drive: out.drive, norm: out.norm, activity: out.activity, ready: out.ready };
        }

        const thr = params.driveTriggerLevel != null ? params.driveTriggerLevel : 0.85;
        const inWarmup = !!(st.warmupUntilMs && tMs < st.warmupUntilMs);

        if (!inWarmup) {
            evaluateDriveHoldState(st, out.drive, tMs, params);
        } else {
            st.prevHoldActive = st.holdActive;
            st.holdActive = false;
        }
        const holdFireRepeat = inWarmup ? false : maybeMotionHoldFire(st, tMs, params);
        const sustainMs = st.sustainedAboveSince != null ? Math.max(0, tMs - st.sustainedAboveSince) : 0;

        return {
            edgeFire: false,
            holdActive: st.holdActive,
            holdFireRepeat,
            metric: out.drive,
            windowMetric: out.drive,
            drive: out.drive,
            norm: out.norm,
            activity: out.activity,
            ready: out.ready,
            inWarmup,
            warmupRemainMs: inWarmup ? Math.max(0, st.warmupUntilMs - tMs) : 0,
            aboveThreshold: out.drive >= thr,
            driveTriggerLevel: thr,
            sustainMs,
            needMs: params.holdDurationMs != null ? params.holdDurationMs : 600
        };
    }

    function feedEogSample(st, rawCh, row, tMs, dtSec) {
        const params = st.params;
        const alpha = emaAlpha(dtSec, params.baselineTauSec);
        const chIdx = st.physicalChannel != null && st.physicalChannel >= 0 ? st.physicalChannel : null;
        const ref = meanSsvepReference(row, chIdx);
        const pairDiff = rawCh - ref;

        if (st.emaDiff == null || !Number.isFinite(st.emaDiff)) st.emaDiff = pairDiff;
        else st.emaDiff = st.emaDiff + alpha * (pairDiff - st.emaDiff);

        const metric = pairDiff - st.emaDiff;
        st.lastMetric = metric;
        st.metricHistory.push({ t: tMs, v: metric });
        trimHistory(st, tMs, Math.max(500, params.holdDurationMs * 2));

        if (st.warmupUntilMs && tMs < st.warmupUntilMs) {
            return { edgeFire: false, holdActive: false, holdFireRepeat: false, metric, windowMetric: null };
        }

        const absMetric = Math.abs(metric);
        if (st.triggerType === 'hold') {
            evaluateHoldState(st, absMetric, tMs, {
                holdThresholdUv: params.holdThresholdUv,
                holdDurationMs: params.holdDurationMs,
                holdReleaseRatio: 0.65,
                holdRepeatMs: params.holdRepeatMs
            });
            return { edgeFire: false, holdActive: st.holdActive, holdFireRepeat: maybeHoldFire(st, tMs, params), metric, windowMetric: null };
        }

        let edgeFire = false;
        const refT = tMs - params.edgeWindowMs;
        const prev = metricAtOrBefore(st, refT);
        if (prev != null && Number.isFinite(prev)) {
            const delta = metric - prev;
            const jump = params.edgeJumpUv;
            const pol = params.edgePolarity || 'rise';
            const meets =
                pol === 'fall'
                    ? delta <= -jump
                    : pol === 'both'
                      ? Math.abs(delta) >= jump
                      : delta >= jump;
            if (meets && tMs - st.lastEdgeFire >= params.refractoryMs) {
                edgeFire = true;
                st.lastEdgeFire = tMs;
            }
        }
        return { edgeFire, holdActive: false, holdFireRepeat: false, metric, windowMetric: null };
    }

    function processConfig(cfg, message, tMs) {
        const key = slotKey(cfg);
        let st = states.get(key);
        if (!st) {
            st = createState(cfg);
            states.set(key, st);
        }

        if (isMotorRole(st.role)) return processMotorConfig(st, cfg, message, tMs);

        const rows = message && message.data;
        if (!Array.isArray(rows) || !rows.length) {
            return { edgeFire: false, holdFireRepeat: false, metric: st.lastMetric, windowMetric: st.lastWindowMetric };
        }

        const sr = RUN && typeof RUN.getSamplingRateHz === 'function' ? RUN.getSamplingRateHz() : 250;
        const dtSec = 1 / sr;
        let edgeFire = false;
        let holdFireRepeat = false;
        let metric = st.lastMetric;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const raw = pickRawSample(cfg.channel, cfg.physicalChannel, message, row);
            if (raw == null || !Number.isFinite(raw)) continue;
            const sampleT = tMs - (rows.length - 1 - i) * dtSec * 1000;
            const out = feedEogSample(st, raw, row, sampleT, dtSec);
            metric = out.metric;
            if (out.edgeFire) edgeFire = true;
            if (out.holdFireRepeat) holdFireRepeat = true;
        }

        return { edgeFire, holdFireRepeat, metric, windowMetric: null };
    }

    function normalizeMultimodalDetectionFields(block) {
        if (!block || typeof block !== 'object') return block;
        const meta = getMeta(block.channel);
        const role = meta ? meta.role : null;

        if (isMotorRole(role)) {
            const p = migrateBlockParams(block, role);
            if (block.emgWindowSec == null && block.motionWindowSec != null) block.emgWindowSec = p.windowSec;
            if (block.emgWindowSec == null) block.emgWindowSec = p.windowSec;
            if (block.motionWindowSec == null) block.motionWindowSec = p.windowSec;
            if (block.peakWindowSec == null) block.peakWindowSec = p.peakWindowSec;
            if (block.peakThresholdUv == null) block.peakThresholdUv = p.peakThresholdUv;
            if (block.peakMaxUv == null) block.peakMaxUv = p.peakMaxUv;
            if (block.minBinFraction == null) block.minBinFraction = p.minBinFraction;
            if (block.normGate == null) block.normGate = p.normGate;
            if (block.manualNormThresholds == null) block.manualNormThresholds = !!p.manualThresholdsEnabled;
            if (block.manualUpperThresholdUv == null) block.manualUpperThresholdUv = p.manualUpperThresholdUv;
            if (block.manualLowerThresholdUv == null) block.manualLowerThresholdUv = p.manualLowerThresholdUv;
            if (block.driveTriggerLevel == null) block.driveTriggerLevel = p.driveTriggerLevel;
            if (block.driveTriggerLevel === 1 || block.driveTriggerLevel === 1.0) block.driveTriggerLevel = 0.85;
            if (block.holdDurationMs == null) block.holdDurationMs = p.holdDurationMs;
            if (typeof block.holdRepeatMs !== 'number') block.holdRepeatMs = p.holdRepeatMs;
            block.triggerType = 'hold';
            delete block.motionMetric;
            delete block.holdThresholdUv;
        } else {
            const p = migrateBlockParams(block, role);
            if (block.holdThresholdUv == null) block.holdThresholdUv = p.holdThresholdUv;
            if (block.holdDurationMs == null) block.holdDurationMs = p.holdDurationMs;
            if (block.edgeJumpUv == null) block.edgeJumpUv = p.edgeJumpUv;
            if (block.edgeWindowMs == null) block.edgeWindowMs = p.edgeWindowMs;
            if (block.edgePolarity !== 'rise' && block.edgePolarity !== 'fall' && block.edgePolarity !== 'both') {
                block.edgePolarity = p.edgePolarity || 'rise';
            }
            if (block.triggerType !== 'hold') block.triggerType = 'edge';
            if (typeof block.holdRepeatMs !== 'number') block.holdRepeatMs = 400;
        }
        delete block.threshold;
        return block;
    }

    function isMotorConfig(cfg) {
        const meta = getMeta(cfg && cfg.channel);
        return isMotorRole(meta && meta.role);
    }

    global.SSVEP_MULTIMODAL_DETECTOR = {
        EOG_DEFAULTS,
        MOTION_DEFAULTS,
        EMG_DEFAULTS: MOTION_DEFAULTS,
        resetStatesFromConfigs,
        processConfig,
        migrateBlockParams,
        normalizeMultimodalDetectionFields,
        pickRawSample,
        meanSsvepReference,
        isMotorConfig
    };

    global.ssvepNormalizeMultimodalDetectionFields = normalizeMultimodalDetectionFields;
})();