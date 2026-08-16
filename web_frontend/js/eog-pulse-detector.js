/**
 * 眼电 EOG 一次性事件检测（眨眼 / 大幅扫视）。
 *
 * 生理特征：通道相对基线出现显著幅度上升后回落（或反向），而非持续高电平。
 * 参考：VEOG 眨眼 = 陡升+陡降；短时差分/幅度阈值 + 不应期（Epling 2015、BioMed Eng Online 2013）。
 *
 * 模式：
 * - edge：短窗差分超过阈值即触发（与 multimodal-detector 眼电一致）
 * - pulse：上升越过阈值后，在时限内回落（推荐，更像眨眼）
 */
(function (global) {
    const DEFAULTS = {
        mode: 'pulse', // 'pulse' | 'edge'
        edgeJumpUv: 50,
        edgeWindowMs: 80,
        edgePolarity: 'rise', // rise | fall | both
        baselineTauSec: 1.5,
        refractoryMs: 350,
        /** pulse：相对基线绝对值超过此值视为「升」 */
        pulseOnsetUv: 45,
        /** pulse：从峰值回落到 peak×recoverRatio 以下视为「落」 */
        pulseRecoverRatio: 0.35,
        /** pulse：升→落 最大时长（眨眼典型 ~100–400 ms） */
        pulseMaxMs: 420,
        /** pulse：升后至少保持多久才允许落触发（抑制噪声尖峰） */
        pulseMinMs: 40,
        historyKeepMs: 2500
    };

    function emaAlpha(dtSec, tauSec) {
        if (!Number.isFinite(tauSec) || tauSec <= 0) return 1;
        return 1 - Math.exp(-dtSec / tauSec);
    }

    function createChannelState(opts) {
        const o = { ...DEFAULTS, ...(opts || {}) };
        return {
            ...o,
            emaDiff: null,
            lastMetric: 0,
            lastDelta: 0,
            metricHistory: [],
            lastFireMs: 0,
            fireCount: 0,
            // pulse FSM
            pulsePhase: 'idle', // idle | rising
            pulseOnsetMs: 0,
            pulsePeak: 0,
            pulsePeakMs: 0,
            pulseSign: 1,
            lastPeakUv: 0,
            lastEvent: null // { t, metric, peak, mode }
        };
    }

    function syncParams(st, opts) {
        const o = { ...DEFAULTS, ...(opts || {}) };
        st.mode = o.mode === 'edge' ? 'edge' : 'pulse';
        st.edgeJumpUv = o.edgeJumpUv;
        st.edgeWindowMs = o.edgeWindowMs;
        st.edgePolarity = o.edgePolarity;
        st.baselineTauSec = o.baselineTauSec;
        st.refractoryMs = o.refractoryMs;
        st.pulseOnsetUv = o.pulseOnsetUv;
        st.pulseRecoverRatio = o.pulseRecoverRatio;
        st.pulseMaxMs = o.pulseMaxMs;
        st.pulseMinMs = o.pulseMinMs;
        st.historyKeepMs = o.historyKeepMs;
    }

    function resetChannelState(st, opts) {
        syncParams(st, opts);
        st.emaDiff = null;
        st.lastMetric = 0;
        st.lastDelta = 0;
        st.metricHistory = [];
        st.lastFireMs = 0;
        st.fireCount = 0;
        st.pulsePhase = 'idle';
        st.pulseOnsetMs = 0;
        st.pulsePeak = 0;
        st.pulsePeakMs = 0;
        st.pulseSign = 1;
        st.lastPeakUv = 0;
        st.lastEvent = null;
    }

    function trimHistory(st, nowMs) {
        const cutoff = nowMs - st.historyKeepMs;
        while (st.metricHistory.length && st.metricHistory[0].t < cutoff) {
            st.metricHistory.shift();
        }
    }

    function metricAtOrBefore(st, targetMs) {
        for (let i = st.metricHistory.length - 1; i >= 0; i--) {
            if (st.metricHistory[i].t <= targetMs) return st.metricHistory[i].v;
        }
        return null;
    }

    function meanSsvepReference(row, excludeIndex) {
        const gdm = global.globalDeviceManager;
        let indices =
            gdm && typeof gdm.getSsvepChannelIndices === 'function' ? gdm.getSsvepChannelIndices() : null;
        if (!Array.isArray(indices) || !indices.length) {
            const CFG = global.SSVEP_DEVICE_CHANNEL_CONFIG;
            if (CFG && typeof CFG.getPhysicalChannelsForRole === 'function') {
                indices = CFG.getPhysicalChannelsForRole('ssvep');
            }
        }
        if (!Array.isArray(indices) || !indices.length) {
            if (!Array.isArray(row) || !row.length) return 0;
            for (let i = 0; i < row.length; i++) {
                if (excludeIndex != null && i === excludeIndex) continue;
                return Number(row[i]) || 0;
            }
            return Number(row[0]) || 0;
        }
        let sum = 0;
        let n = 0;
        for (const i of indices) {
            if (excludeIndex != null && i === excludeIndex) continue;
            if (i >= 0 && i < row.length) {
                sum += Number(row[i]) || 0;
                n++;
            }
        }
        return n ? sum / n : 0;
    }

    function debaseline(st, rawCh, row, chIdx, dtSec) {
        const ref = meanSsvepReference(row, chIdx);
        const pairDiff = rawCh - ref;
        const alpha = emaAlpha(dtSec, st.baselineTauSec);
        if (st.emaDiff == null || !Number.isFinite(st.emaDiff)) st.emaDiff = pairDiff;
        else st.emaDiff = st.emaDiff + alpha * (pairDiff - st.emaDiff);
        return pairDiff - st.emaDiff;
    }

    function tryFire(st, tMs, metric, peak, mode) {
        if (tMs - st.lastFireMs < st.refractoryMs) return false;
        st.lastFireMs = tMs;
        st.fireCount += 1;
        st.lastPeakUv = peak;
        st.lastEvent = { t: tMs, metric, peak, mode };
        return true;
    }

    function evaluateEdge(st, metric, tMs) {
        const prev = metricAtOrBefore(st, tMs - st.edgeWindowMs);
        if (prev == null || !Number.isFinite(prev)) return false;
        const delta = metric - prev;
        st.lastDelta = delta;
        const jump = st.edgeJumpUv;
        const pol = st.edgePolarity || 'rise';
        const meets =
            pol === 'fall' ? delta <= -jump : pol === 'both' ? Math.abs(delta) >= jump : delta >= jump;
        if (!meets) return false;
        return tryFire(st, tMs, metric, Math.abs(delta), 'edge');
    }

    /**
     * 升–落脉冲：metric 相对 0 越过 onset → 跟踪峰值 → 回落到 peak×recoverRatio 触发。
     * polarity rise：正向脉冲；fall：负向；both：绝对值。
     */
    function evaluatePulse(st, metric, tMs) {
        const pol = st.edgePolarity || 'rise';
        const onset = st.pulseOnsetUv;
        let signed = metric;
        if (pol === 'fall') signed = -metric;
        else if (pol === 'both') signed = Math.abs(metric);

        if (st.pulsePhase === 'idle') {
            if (signed >= onset) {
                st.pulsePhase = 'rising';
                st.pulseOnsetMs = tMs;
                st.pulsePeak = signed;
                st.pulsePeakMs = tMs;
                st.pulseSign = pol === 'both' ? (metric >= 0 ? 1 : -1) : pol === 'fall' ? -1 : 1;
            }
            return false;
        }

        // rising
        if (signed > st.pulsePeak) {
            st.pulsePeak = signed;
            st.pulsePeakMs = tMs;
        }

        const age = tMs - st.pulseOnsetMs;
        if (age > st.pulseMaxMs) {
            st.pulsePhase = 'idle';
            return false;
        }

        const recoverThr = Math.max(onset * 0.4, st.pulsePeak * st.pulseRecoverRatio);
        const heldLongEnough = age >= st.pulseMinMs;
        const recovering = signed <= recoverThr && st.pulsePeak >= onset;

        if (heldLongEnough && recovering) {
            const peak = st.pulsePeak;
            st.pulsePhase = 'idle';
            return tryFire(st, tMs, metric, peak, 'pulse');
        }
        return false;
    }

    /**
     * 喂入单样本。row 用于 SSVEP 参考去基线。
     * @returns {{ fired: boolean, metric: number, delta: number, phase: string }}
     */
    function feedSample(st, rawCh, row, chIdx, tMs, dtSec) {
        const metric = debaseline(st, rawCh, row, chIdx, dtSec);
        st.lastMetric = metric;
        st.metricHistory.push({ t: tMs, v: metric });
        trimHistory(st, tMs);

        let fired = false;
        if (st.mode === 'edge') fired = evaluateEdge(st, metric, tMs);
        else fired = evaluatePulse(st, metric, tMs);

        return {
            fired,
            metric,
            delta: st.lastDelta,
            phase: st.pulsePhase,
            peak: st.pulsePeak,
            fireCount: st.fireCount,
            lastEvent: st.lastEvent
        };
    }

    /**
     * 批量喂入一行行样本（与 GDM data / data_display 相同形状）。
     */
    function feedRows(st, rows, chIdx, tMsEnd, srHz) {
        const sr = Number.isFinite(srHz) && srHz > 0 ? srHz : 250;
        const dtSec = 1 / sr;
        if (!Array.isArray(rows) || !rows.length || chIdx < 0) {
            return { fired: false, metric: st.lastMetric, events: [] };
        }
        const events = [];
        let last = { fired: false, metric: st.lastMetric };
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!Array.isArray(row) || chIdx >= row.length) continue;
            const raw = Number(row[chIdx]);
            if (!Number.isFinite(raw)) continue;
            const sampleT = tMsEnd - (rows.length - 1 - i) * dtSec * 1000;
            last = feedSample(st, raw, row, chIdx, sampleT, dtSec);
            if (last.fired) events.push({ t: sampleT, metric: last.metric, peak: last.peak });
        }
        return {
            fired: events.length > 0,
            metric: last.metric,
            phase: last.phase,
            peak: st.pulsePeak,
            fireCount: st.fireCount,
            events,
            lastEvent: st.lastEvent
        };
    }

    function getHistory(st) {
        return st.metricHistory.slice();
    }

    global.SSVEP_EOG_PULSE = {
        DEFAULTS,
        createChannelState,
        syncParams,
        resetChannelState,
        feedSample,
        feedRows,
        getHistory,
        meanSsvepReference
    };
})(typeof window !== 'undefined' ? window : globalThis);
