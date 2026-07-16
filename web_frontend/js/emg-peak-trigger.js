/**
 * EMG 触发：检测窗按 binSec 切段，统计达标 bin 数 → 橙条/驱动。
 * 与 OpenBCI norm（蓝柱）独立；波峰/波谷阈只影响本模块。
 */
(function (global) {
    const DEFAULTS = {
        windowSec: 1.0,
        binSec: 0.2,
        thresholdUv: 60,
        maxUv: 200,
        minBinFraction: 0.4
    };

    function createPeakTriggerState(opts) {
        const o = { ...DEFAULTS, ...(opts || {}) };
        return {
            windowSec: o.windowSec,
            binSec: o.binSec,
            thresholdUv: o.thresholdUv,
            maxUv: o.maxUv,
            minBinFraction: o.minBinFraction,
            triggered: false,
            strength: 0,
            activity: 0,
            lastPeak: 0,
            lastValley: 0,
            lastAmplitude: 0,
            lastPeak2peak: 0,
            binsOk: 0,
            binsRequired: 0,
            binsMinOk: 0
        };
    }

    function resetPeakTriggerState(st, opts) {
        const o = { ...DEFAULTS, ...(opts || {}) };
        st.windowSec = o.windowSec;
        st.binSec = o.binSec;
        st.thresholdUv = o.thresholdUv;
        st.maxUv = o.maxUv;
        st.minBinFraction = o.minBinFraction;
        st.triggered = false;
        st.strength = 0;
        st.activity = 0;
        st.lastPeak = 0;
        st.lastValley = 0;
        st.lastAmplitude = 0;
        st.lastPeak2peak = 0;
        st.binsOk = 0;
        st.binsRequired = 0;
        st.binsMinOk = 0;
    }

    function syncPeakTriggerParams(st, opts) {
        const o = { ...DEFAULTS, ...(opts || {}) };
        st.windowSec = o.windowSec;
        st.binSec = o.binSec;
        st.thresholdUv = o.thresholdUv;
        st.maxUv = o.maxUv;
        st.minBinFraction = o.minBinFraction;
    }

    function binPasses(st, max, min) {
        const pp = max - min;
        return pp >= 2 * st.thresholdUv || (max > st.thresholdUv && min < -st.thresholdUv);
    }

    function strengthFromAmplitude(st, amp) {
        const span = Math.max(1, st.maxUv - st.thresholdUv);
        return Math.max(0, Math.min(1, (amp - st.thresholdUv) / span));
    }

    function minOkCount(st, required, binCount) {
        const req = Math.max(1, required);
        const frac = Math.max(0.2, Math.min(1, st.minBinFraction));
        return Math.max(1, Math.min(binCount || req, Math.ceil(req * frac)));
    }

    function evaluatePeakFromWindow(st, signedUvWindow, samplingRateHz) {
        const sr = Number.isFinite(samplingRateHz) && samplingRateHz > 0 ? samplingRateHz : 250;
        const win = signedUvWindow || [];
        const samplesPerBin = Math.max(1, Math.floor(sr * st.binSec));
        const required = Math.max(1, Math.ceil(st.windowSec / st.binSec));
        const needSamples = samplesPerBin * required;
        const slice = win.length > needSamples ? win.slice(-needSamples) : win;

        st.binsRequired = required;

        const bins = [];
        for (let i = 0; i + samplesPerBin <= slice.length; i += samplesPerBin) {
            let max = -Infinity;
            let min = Infinity;
            for (let j = i; j < i + samplesPerBin; j++) {
                const v = Number(slice[j]) || 0;
                if (v > max) max = v;
                if (v < min) min = v;
            }
            if (max === -Infinity) max = 0;
            if (min === Infinity) min = 0;
            bins.push({ max, min, peak2peak: max - min });
        }

        let okCount = 0;
        let maxAmp = 0;
        let maxP2p = 0;
        let lastBin = { max: 0, min: 0, peak2peak: 0 };

        for (const b of bins) {
            if (binPasses(st, b.max, b.min)) okCount += 1;
            const amp = Math.max(b.peak2peak, b.max, -b.min);
            if (amp > maxAmp) maxAmp = amp;
            if (b.peak2peak > maxP2p) maxP2p = b.peak2peak;
            lastBin = b;
        }

        const minOk = minOkCount(st, required, bins.length);
        const hasEnoughBins = bins.length >= required;
        st.binsMinOk = minOk;
        st.binsOk = okCount;
        st.triggered = hasEnoughBins && okCount >= minOk;
        st.lastPeak = lastBin.max;
        st.lastValley = lastBin.min;
        st.lastPeak2peak = lastBin.peak2peak;
        st.lastAmplitude = Math.max(lastBin.peak2peak, lastBin.max, -lastBin.min);
        st.activity = strengthFromAmplitude(st, st.lastAmplitude);
        st.strength = st.triggered ? st.activity : st.activity * (okCount / Math.max(1, required));

        return {
            triggered: st.triggered,
            strength: st.strength,
            activity: st.activity,
            lastPeak: st.lastPeak,
            lastValley: st.lastValley,
            lastAmplitude: st.lastAmplitude,
            lastPeak2peak: st.lastPeak2peak,
            binsOk: st.binsOk,
            binsRequired: st.binsRequired,
            binsMinOk: st.binsMinOk,
            thresholdUv: st.thresholdUv
        };
    }

    global.SSVEP_EMG_PEAK_TRIGGER = {
        DEFAULTS,
        createPeakTriggerState,
        resetPeakTriggerState,
        syncPeakTriggerParams,
        evaluatePeakFromWindow,
        minOkCount
    };
})(typeof window !== 'undefined' ? window : globalThis);
