/**
 * 运动/肌电：过去 N 秒窗口内的平均电压或 RMS 功率（非瞬时采样触发）。
 */
(function (global) {
    const DEFAULTS = {
        windowSec: 1.0,
        metricMode: 'avg',
        uvLimit: 500
    };

    function createMotionChannelState(opts) {
        const o = { ...DEFAULTS, ...(opts || {}) };
        return {
            windowSec: o.windowSec,
            metricMode: o.metricMode === 'rms' ? 'rms' : 'avg',
            uvLimit: o.uvLimit,
            buffer: [],
            lastAvgUv: 0,
            lastRmsUv: 0,
            lastPower: 0,
            lastMetric: 0,
            ready: false
        };
    }

    function resetMotionChannelState(st, opts) {
        const o = { ...DEFAULTS, ...(opts || {}) };
        st.windowSec = o.windowSec;
        st.metricMode = o.metricMode === 'rms' ? 'rms' : 'avg';
        st.uvLimit = o.uvLimit;
        st.buffer = [];
        st.lastAvgUv = 0;
        st.lastRmsUv = 0;
        st.lastPower = 0;
        st.lastMetric = 0;
        st.ready = false;
    }

    /**
     * @param {object} st
     * @param {number[]} absUvSamples 已取 |·| 的 µV 样本
     * @param {number} samplingRateHz
     */
    function feedMotionAbsSamples(st, absUvSamples, samplingRateHz) {
        const sr = Number.isFinite(samplingRateHz) && samplingRateHz > 0 ? samplingRateHz : 250;
        for (const raw of absUvSamples || []) {
            const v = Math.abs(Number(raw) || 0);
            st.buffer.push(v <= st.uvLimit ? v : st.uvLimit);
        }

        const period = Math.max(1, Math.floor(sr * st.windowSec));
        const maxLen = period * 2;
        if (st.buffer.length > maxLen) {
            st.buffer = st.buffer.slice(-maxLen);
        }

        if (st.buffer.length < period) {
            st.ready = false;
            st.lastMetric = 0;
            return {
                avgUv: 0,
                rmsUv: 0,
                power: 0,
                metric: 0,
                ready: false,
                windowSamples: period,
                filledSamples: st.buffer.length
            };
        }

        const start = st.buffer.length - period;
        let sum = 0;
        let sumSq = 0;
        for (let j = start; j < st.buffer.length; j++) {
            sum += st.buffer[j];
            sumSq += st.buffer[j] * st.buffer[j];
        }
        const avgUv = sum / period;
        const power = sumSq / period;
        const rmsUv = Math.sqrt(power);
        const metric = st.metricMode === 'rms' ? rmsUv : avgUv;

        st.lastAvgUv = avgUv;
        st.lastRmsUv = rmsUv;
        st.lastPower = power;
        st.lastMetric = metric;
        st.ready = true;

        return {
            avgUv,
            rmsUv,
            power,
            metric,
            ready: true,
            windowSamples: period,
            filledSamples: st.buffer.length
        };
    }

    global.SSVEP_MOTION_SIGNAL = {
        DEFAULTS,
        createMotionChannelState,
        resetMotionChannelState,
        feedMotionAbsSamples
    };
})();
