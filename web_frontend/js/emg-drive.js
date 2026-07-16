/**
 * EMG 驱动力计算（与 emg-test 页一致）：OpenBCI norm + 峰峰值活动度 → drive ∈ [0,1]。
 */
(function (global) {
    const DEFAULTS = {
        windowSec: 1.0,
        peakWindowSec: 0.6,
        peakBinSec: 0.2,
        peakThresholdUv: 50,
        peakMaxUv: 200,
        minBinFraction: 0.4,
        normGate: 0.8,
        driveTriggerLevel: 0.85,
        uvLimit: 200,
        minimumDeltaUv: 10,
        lowerThresholdMinimum: 6,
        creepIncreasing: 0.9,
        creepDecreasing: 0.99999,
        manualThresholdsEnabled: false,
        manualUpperThresholdUv: 25,
        manualLowerThresholdUv: 6
    };

    function emgOpts(cfg) {
        return {
            windowSec: cfg.windowSec,
            uvLimit: cfg.uvLimit,
            creepIncreasing: cfg.creepIncreasing,
            creepDecreasing: cfg.creepDecreasing,
            minimumDeltaUv: cfg.minimumDeltaUv,
            lowerThresholdMinimum: cfg.lowerThresholdMinimum,
            manualThresholdsEnabled: !!cfg.manualThresholdsEnabled,
            manualUpperThresholdUv: cfg.manualUpperThresholdUv,
            manualLowerThresholdUv: cfg.manualLowerThresholdUv
        };
    }

    function peakOpts(cfg) {
        return {
            windowSec: cfg.peakWindowSec,
            binSec: cfg.peakBinSec,
            thresholdUv: cfg.peakThresholdUv,
            maxUv: cfg.peakMaxUv,
            minBinFraction: cfg.minBinFraction
        };
    }

    function paramsFromBlock(block) {
        const o = { ...DEFAULTS };
        if (!block || typeof block !== 'object') return o;

        const win =
            block.emgWindowSec != null
                ? Number(block.emgWindowSec)
                : block.motionWindowSec != null
                  ? Number(block.motionWindowSec)
                  : o.windowSec;
        o.windowSec = Math.max(0.1, win);

        if (block.peakWindowSec != null) o.peakWindowSec = Math.max(0.2, Number(block.peakWindowSec));
        if (block.peakThresholdUv != null) o.peakThresholdUv = Math.max(10, Number(block.peakThresholdUv));
        if (block.peakMaxUv != null) o.peakMaxUv = Math.max(80, Number(block.peakMaxUv));
        if (block.minBinFraction != null) o.minBinFraction = Math.max(0.2, Math.min(1, Number(block.minBinFraction)));
        if (block.normGate != null) o.normGate = Math.max(0, Math.min(1, Number(block.normGate)));
        if (block.driveTriggerLevel != null) {
            o.driveTriggerLevel = Math.max(0.5, Math.min(1, Number(block.driveTriggerLevel)));
        } else {
            o.driveTriggerLevel = 0.85;
        }
        if (block.manualNormThresholds != null) {
            o.manualThresholdsEnabled = !!block.manualNormThresholds;
        }
        if (block.manualUpperThresholdUv != null) {
            o.manualUpperThresholdUv = Math.max(2, Number(block.manualUpperThresholdUv));
        }
        if (block.manualLowerThresholdUv != null) {
            o.manualLowerThresholdUv = Math.max(0, Number(block.manualLowerThresholdUv));
        }
        return o;
    }

    function createDriveChannelState(cfg) {
        const EMG = global.SSVEP_EMG_PROCESSOR;
        const PEAK = global.SSVEP_EMG_PEAK_TRIGGER;
        const c = paramsFromBlock(cfg);
        return {
            cfg: c,
            emgState:
                EMG && typeof EMG.createEmgChannelState === 'function'
                    ? EMG.createEmgChannelState(emgOpts(c))
                    : null,
            peakState:
                PEAK && typeof PEAK.createPeakTriggerState === 'function'
                    ? PEAK.createPeakTriggerState(peakOpts(c))
                    : null,
            lastDrive: 0,
            lastNorm: 0,
            lastActivity: 0,
            lastTriggered: false
        };
    }

    function resetDriveChannelState(chState, blockOrCfg) {
        const c = blockOrCfg && blockOrCfg.emgState ? blockOrCfg.cfg : paramsFromBlock(blockOrCfg);
        chState.cfg = c;
        const EMG = global.SSVEP_EMG_PROCESSOR;
        const PEAK = global.SSVEP_EMG_PEAK_TRIGGER;
        if (chState.emgState && EMG && typeof EMG.syncEmgChannelParams === 'function') {
            EMG.syncEmgChannelParams(chState.emgState, emgOpts(c));
        } else if (chState.emgState && EMG && typeof EMG.resetEmgChannelState === 'function') {
            EMG.resetEmgChannelState(chState.emgState, emgOpts(c));
        }
        if (chState.peakState && PEAK && typeof PEAK.resetPeakTriggerState === 'function') {
            PEAK.resetPeakTriggerState(chState.peakState, peakOpts(c));
        }
        chState.lastDrive = 0;
        chState.lastNorm = 0;
        chState.lastActivity = 0;
        chState.lastTriggered = false;
    }

    function syncCfgOnState(chState, blockOrCfg) {
        const c = paramsFromBlock(blockOrCfg);
        chState.cfg = c;
        const EMG = global.SSVEP_EMG_PROCESSOR;
        const PEAK = global.SSVEP_EMG_PEAK_TRIGGER;
        if (chState.emgState && EMG && typeof EMG.syncEmgChannelParams === 'function') {
            EMG.syncEmgChannelParams(chState.emgState, emgOpts(c));
        }
        if (chState.peakState && PEAK) {
            const peakO = peakOpts(c);
            if (typeof PEAK.syncPeakTriggerParams === 'function') {
                PEAK.syncPeakTriggerParams(chState.peakState, peakO);
            } else {
                chState.peakState.windowSec = peakO.windowSec;
                chState.peakState.binSec = peakO.binSec;
                chState.peakState.thresholdUv = peakO.thresholdUv;
                chState.peakState.maxUv = peakO.maxUv;
                chState.peakState.minBinFraction = peakO.minBinFraction;
            }
        }
    }

    /**
     * @param {object} chState createDriveChannelState 返回值
     * @param {number[]} signedNormWin norm 窗（有符号 µV）
     * @param {number[]} signedPeakWin 峰谷窗
     * @param {number} samplingRateHz
     */
    function computeDriveFromWindows(chState, signedNormWin, signedPeakWin, samplingRateHz) {
        const EMG = global.SSVEP_EMG_PROCESSOR;
        const PEAK = global.SSVEP_EMG_PEAK_TRIGGER;
        const cfg = chState.cfg;
        const sr = Number.isFinite(samplingRateHz) && samplingRateHz > 0 ? samplingRateHz : 250;

        if (!EMG || !PEAK || !chState.emgState || !chState.peakState) {
            return {
                drive: 0,
                norm: 0,
                activity: 0,
                triggered: false,
                ready: false
            };
        }

        const absWin = (signedNormWin || []).map((v) => Math.abs(Number(v) || 0));
        const EMG_PROC = global.SSVEP_EMG_PROCESSOR;
        const winStats =
            EMG_PROC && typeof EMG_PROC.signedWindowStats === 'function'
                ? EMG_PROC.signedWindowStats(signedNormWin || [])
                : { instant: 0, windowMax: 0, windowMin: 0 };
        const out =
            typeof EMG.processEmgFromWindow === 'function'
                ? EMG.processEmgFromWindow(chState.emgState, absWin, sr)
                : { outputNormalized: 0, ready: false };

        const peakOut =
            typeof PEAK.evaluatePeakFromWindow === 'function'
                ? PEAK.evaluatePeakFromWindow(chState.peakState, signedPeakWin || signedNormWin, sr)
                : { triggered: false, strength: 0, activity: 0 };

        const normDrive = out.ready && out.outputNormalized >= cfg.normGate ? out.outputNormalized : 0;
        const drive = Math.max(0, Math.min(1, Math.max(normDrive, peakOut.activity || 0)));

        chState.lastDrive = drive;
        chState.lastNorm = out.outputNormalized || 0;
        chState.lastActivity = peakOut.activity || 0;
        chState.lastTriggered = !!peakOut.triggered;

        return {
            drive,
            norm: out.outputNormalized || 0,
            activity: peakOut.activity || 0,
            triggered: !!peakOut.triggered,
            ready: !!out.ready,
            peak2peak: peakOut.lastPeak2peak,
            peak: peakOut.lastPeak,
            valley: peakOut.lastValley,
            instantUv: winStats.instant,
            averageUv: out.averageUv || 0,
            windowMax: winStats.windowMax,
            windowMin: winStats.windowMin,
            upper: out.upperThreshold,
            lower: out.lowerThreshold,
            binsOk: peakOut.binsOk,
            binsRequired: peakOut.binsRequired,
            binsMinOk: peakOut.binsMinOk,
            peakThresholdUv: peakOut.thresholdUv != null ? peakOut.thresholdUv : cfg.peakThresholdUv
        };
    }

    function isDriveTriggered(drive, cfg) {
        const thr = cfg && cfg.driveTriggerLevel != null ? cfg.driveTriggerLevel : DEFAULTS.driveTriggerLevel;
        return drive >= thr - 1e-6;
    }

    global.SSVEP_EMG_DRIVE = {
        DEFAULTS,
        paramsFromBlock,
        createDriveChannelState,
        resetDriveChannelState,
        syncCfgOnState,
        computeDriveFromWindows,
        isDriveTriggered
    };
})(typeof window !== 'undefined' ? window : globalThis);
