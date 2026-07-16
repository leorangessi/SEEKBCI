/**
 * OpenBCI GUI EmgSettingsValues.process 的单通道 JS 移植。
 * 对 |µV| 滑动平均 + 自适应或固定上下阈 → outputNormalized ∈ [0, 1]。
 * @see OpenBCI_GUI/EmgSettingsValues.pde
 */
(function (global) {
    const DEFAULTS = {
        windowSec: 1.0,
        uvLimit: 200,
        creepIncreasing: 0.9,
        creepDecreasing: 0.99999,
        minimumDeltaUv: 10,
        lowerThresholdMinimum: 6,
        upperThresholdInit: 25,
        lowerThresholdInit: 0,
        manualThresholdsEnabled: false,
        manualUpperThresholdUv: 25,
        manualLowerThresholdUv: 6
    };

    function optsFromInput(opts) {
        return { ...DEFAULTS, ...(opts || {}) };
    }

    function computeAverageUv(st, values, averagePeriod) {
        let averageUv = 0;
        const start = values.length - averagePeriod;
        for (let j = start; j < values.length; j++) {
            const v = Math.abs(Number(values[j]) || 0);
            averageUv += v <= st.uvLimit ? v : st.uvLimit;
        }
        return averageUv / averagePeriod;
    }

    function applyFixedThresholds(st) {
        let upper = Math.max(1, Number(st.manualUpperThresholdUv) || DEFAULTS.manualUpperThresholdUv);
        let lower = Math.max(0, Number(st.manualLowerThresholdUv) || 0);
        const minDelta = Math.max(1, Number(st.minimumDeltaUv) || DEFAULTS.minimumDeltaUv);
        if (upper <= lower + minDelta) upper = lower + minDelta;
        if (upper > st.uvLimit) upper = st.uvLimit;
        st.upperThreshold = upper;
        st.lowerThreshold = lower;
    }

    function applyAdaptiveThresholds(st, averageUv) {
        if (averageUv >= st.upperThreshold && averageUv <= st.uvLimit) {
            st.upperThreshold = averageUv;
        }
        if (averageUv <= st.lowerThreshold) {
            st.lowerThreshold = averageUv;
        }
        if (st.upperThreshold >= averageUv + st.minimumDeltaUv) {
            st.upperThreshold *= st.creepIncreasing;
        }
        if (st.lowerThreshold <= 1) {
            st.lowerThreshold = 1;
        }
        if (st.lowerThreshold <= averageUv) {
            st.lowerThreshold *= 1 / st.creepDecreasing;
        }
        if (st.lowerThreshold < st.lowerThresholdMinimum) {
            st.lowerThreshold = st.lowerThresholdMinimum;
        }
        if (st.upperThreshold <= st.lowerThreshold + st.minimumDeltaUv) {
            st.upperThreshold = st.lowerThreshold + st.minimumDeltaUv;
        }
    }

    function mapToNorm(st, averageUv) {
        const range = st.upperThreshold - st.lowerThreshold;
        let outputNormalized = range > 0 ? (averageUv - st.lowerThreshold) / range : 0;
        if (outputNormalized < 0) outputNormalized = 0;
        if (outputNormalized > 1) outputNormalized = 1;
        return outputNormalized;
    }

    function notReadyResult(st) {
        return {
            outputNormalized: 0,
            averageUv: 0,
            ready: false,
            upperThreshold: st.upperThreshold,
            lowerThreshold: st.lowerThreshold,
            manualThresholds: !!st.manualThresholdsEnabled
        };
    }

    function readyResult(st, averageUv, outputNormalized) {
        st.lastAverageUv = averageUv;
        st.lastOutputNormalized = outputNormalized;
        st.ready = true;
        return {
            outputNormalized,
            averageUv,
            ready: true,
            upperThreshold: st.upperThreshold,
            lowerThreshold: st.lowerThreshold,
            manualThresholds: !!st.manualThresholdsEnabled
        };
    }

    /**
     * @param {object} [opts]
     */
    function createEmgChannelState(opts) {
        const o = optsFromInput(opts);
        const st = {
            windowSec: o.windowSec,
            uvLimit: o.uvLimit,
            creepIncreasing: o.creepIncreasing,
            creepDecreasing: o.creepDecreasing,
            minimumDeltaUv: o.minimumDeltaUv,
            lowerThresholdMinimum: o.lowerThresholdMinimum,
            upperThresholdInit: o.upperThresholdInit,
            lowerThresholdInit: o.lowerThresholdInit,
            manualThresholdsEnabled: !!o.manualThresholdsEnabled,
            manualUpperThresholdUv: o.manualUpperThresholdUv,
            manualLowerThresholdUv: o.manualLowerThresholdUv,
            upperThreshold: o.upperThresholdInit,
            lowerThreshold: o.lowerThresholdInit,
            absBuffer: [],
            lastAverageUv: 0,
            lastOutputNormalized: 0,
            ready: false
        };
        if (st.manualThresholdsEnabled) applyFixedThresholds(st);
        return st;
    }

    function syncEmgChannelParams(st, opts) {
        if (!st) return;
        const o = optsFromInput(opts);
        st.windowSec = o.windowSec;
        st.uvLimit = o.uvLimit;
        st.creepIncreasing = o.creepIncreasing;
        st.creepDecreasing = o.creepDecreasing;
        st.minimumDeltaUv = o.minimumDeltaUv;
        st.lowerThresholdMinimum = o.lowerThresholdMinimum;
        st.upperThresholdInit = o.upperThresholdInit;
        st.lowerThresholdInit = o.lowerThresholdInit;
        st.manualThresholdsEnabled = !!o.manualThresholdsEnabled;
        st.manualUpperThresholdUv = o.manualUpperThresholdUv;
        st.manualLowerThresholdUv = o.manualLowerThresholdUv;
        if (st.manualThresholdsEnabled) {
            applyFixedThresholds(st);
        }
    }

    function trimBuffer(st, maxLen) {
        if (st.absBuffer.length > maxLen) {
            st.absBuffer = st.absBuffer.slice(-maxLen);
        }
    }

    function feedEmgAbsSamples(st, absUvSamples, samplingRateHz) {
        const sr = Number.isFinite(samplingRateHz) && samplingRateHz > 0 ? samplingRateHz : 250;
        for (const raw of absUvSamples || []) {
            const v = Math.abs(Number(raw) || 0);
            st.absBuffer.push(v);
        }

        const averagePeriod = Math.max(1, Math.floor(sr * st.windowSec));
        trimBuffer(st, averagePeriod * 2);

        if (st.absBuffer.length < averagePeriod) {
            st.ready = false;
            st.lastOutputNormalized = 0;
            return notReadyResult(st);
        }

        const averageUv = computeAverageUv(st, st.absBuffer, averagePeriod);
        if (st.manualThresholdsEnabled) {
            applyFixedThresholds(st);
        } else {
            applyAdaptiveThresholds(st, averageUv);
        }
        return readyResult(st, averageUv, mapToNorm(st, averageUv));
    }

    /**
     * 用滤波显示窗内 |µV| 一次性计算（不写入 absBuffer）。
     */
    function processEmgFromWindow(st, absUvWindow, samplingRateHz) {
        const sr = Number.isFinite(samplingRateHz) && samplingRateHz > 0 ? samplingRateHz : 250;
        const win = absUvWindow || [];
        const averagePeriod = Math.max(1, Math.floor(sr * st.windowSec));

        if (win.length < averagePeriod) {
            st.ready = false;
            st.lastOutputNormalized = 0;
            return notReadyResult(st);
        }

        const averageUv = computeAverageUv(st, win, averagePeriod);
        if (st.manualThresholdsEnabled) {
            applyFixedThresholds(st);
        } else {
            applyAdaptiveThresholds(st, averageUv);
        }
        return readyResult(st, averageUv, mapToNorm(st, averageUv));
    }

    function resetEmgChannelState(st, opts) {
        const o = optsFromInput(opts);
        st.windowSec = o.windowSec;
        st.uvLimit = o.uvLimit;
        st.creepIncreasing = o.creepIncreasing;
        st.creepDecreasing = o.creepDecreasing;
        st.minimumDeltaUv = o.minimumDeltaUv;
        st.lowerThresholdMinimum = o.lowerThresholdMinimum;
        st.upperThresholdInit = o.upperThresholdInit;
        st.lowerThresholdInit = o.lowerThresholdInit;
        st.manualThresholdsEnabled = !!o.manualThresholdsEnabled;
        st.manualUpperThresholdUv = o.manualUpperThresholdUv;
        st.manualLowerThresholdUv = o.manualLowerThresholdUv;
        st.absBuffer = [];
        st.lastAverageUv = 0;
        st.lastOutputNormalized = 0;
        st.ready = false;
        if (st.manualThresholdsEnabled) {
            applyFixedThresholds(st);
        } else {
            st.upperThreshold = o.upperThresholdInit;
            st.lowerThreshold = o.lowerThresholdInit;
        }
    }

    function signedWindowStats(signedWin) {
        const win = signedWin || [];
        if (!win.length) {
            return { instant: 0, windowMax: 0, windowMin: 0 };
        }
        let windowMax = -Infinity;
        let windowMin = Infinity;
        for (const raw of win) {
            const v = Number(raw) || 0;
            if (v > windowMax) windowMax = v;
            if (v < windowMin) windowMin = v;
        }
        return {
            instant: Number(win[win.length - 1]) || 0,
            windowMax: windowMax === -Infinity ? 0 : windowMax,
            windowMin: windowMin === Infinity ? 0 : windowMin
        };
    }

    global.SSVEP_EMG_PROCESSOR = {
        DEFAULTS,
        createEmgChannelState,
        syncEmgChannelParams,
        feedEmgAbsSamples,
        processEmgFromWindow,
        resetEmgChannelState,
        signedWindowStats
    };
})(typeof window !== 'undefined' ? window : globalThis);
