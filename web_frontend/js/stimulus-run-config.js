/**
 * 运行刺激配置归一化（项目管理 / 编辑器 / 刺激页共用）
 * - 置信度模式默认 2 s 窗（在线 FBCCA 较稳）；定时模式默认 0.8 s
 * - 用户显式设置的窗长（0.3～5 s）原样保留，运行时不再强制抬到 1 s / 2 s
 * - 闪烁双色：flickerColorOn / flickerColorOff（默认白/黑）
 */
(function (global) {
    const WINDOW_MIN = 0.3;
    const WINDOW_MAX = 5.0;
    const DEFAULT_FLICKER_ON = '#ffffff';
    const DEFAULT_FLICKER_OFF = '#000000';

    function normalizeHexColor(raw, fallback) {
        const fb = fallback || DEFAULT_FLICKER_ON;
        if (raw == null) return fb;
        let s = String(raw).trim();
        if (!s) return fb;
        if (s[0] !== '#') s = '#' + s;
        const m3 = /^#([0-9a-fA-F]{3})$/.exec(s);
        if (m3) {
            const h = m3[1];
            return ('#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]).toLowerCase();
        }
        const m6 = /^#([0-9a-fA-F]{6})$/.exec(s);
        if (m6) return ('#' + m6[1]).toLowerCase();
        return fb;
    }

    function hexToRgb(hex) {
        const h = normalizeHexColor(hex, '#000000').slice(1);
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16)
        };
    }

    /** brightness 0～255 → 在 off/on 两色之间插值的 CSS rgba */
    function flickerColorCss(brightness, onHex, offHex, alpha) {
        const t = Math.max(0, Math.min(1, Number(brightness) / 255));
        const a = alpha == null ? 1 : Math.max(0, Math.min(1, Number(alpha)));
        const on = hexToRgb(onHex || DEFAULT_FLICKER_ON);
        const off = hexToRgb(offHex || DEFAULT_FLICKER_OFF);
        const r = Math.round(off.r + (on.r - off.r) * t);
        const g = Math.round(off.g + (on.g - off.g) * t);
        const b = Math.round(off.b + (on.b - off.b) * t);
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    /** 根据亮相/暗相插值后的亮度选对比文字色 */
    function flickerLabelColor(brightness, onHex, offHex) {
        const t = Math.max(0, Math.min(1, Number(brightness) / 255));
        const on = hexToRgb(onHex || DEFAULT_FLICKER_ON);
        const off = hexToRgb(offHex || DEFAULT_FLICKER_OFF);
        const r = off.r + (on.r - off.r) * t;
        const g = off.g + (on.g - off.g) * t;
        const b = off.b + (on.b - off.b) * t;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        return lum > 140 ? '#111111' : '#eeeeee';
    }

    function normalizeStimulusRunConfig(cfg) {
        if (!cfg || typeof cfg !== 'object') return cfg;
        const out = { ...cfg };
        const mode = out.mode === 'interval' ? 'interval' : 'threshold';
        const defaultW = mode === 'interval' ? 0.8 : 2.0;
        let w = Number(out.windowSec);
        if (!Number.isFinite(w)) w = defaultW;
        out.windowSec = Math.min(WINDOW_MAX, Math.max(WINDOW_MIN, w));
        const poll = Number(out.pollMs);
        out.pollMs = Number.isFinite(poll) && poll >= 120 ? poll : 320;
        let wait = Number(out.ssvepMultimodalWaitSec);
        if (!Number.isFinite(wait)) wait = 1.0;
        out.ssvepMultimodalWaitSec = Math.min(10, Math.max(0.2, wait));
        out.flickerColorOn = normalizeHexColor(out.flickerColorOn, DEFAULT_FLICKER_ON);
        out.flickerColorOff = normalizeHexColor(out.flickerColorOff, DEFAULT_FLICKER_OFF);
        let minP = Number(out.minProbability);
        if (Number.isFinite(minP)) {
            out.minProbability = Math.min(0.99, Math.max(0.03, minP));
        }
        return out;
    }

    function readLastStimulusRunConfig() {
        try {
            let raw = null;
            if (typeof sessionStorage !== 'undefined') {
                raw = sessionStorage.getItem('stimulus_run_config');
            }
            if (!raw && typeof localStorage !== 'undefined') {
                raw = localStorage.getItem('stimulus_run_config');
            }
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /** 打开运行对话框时：项目已存配置 + 实验同步参数 + 最近一次同项目运行配置（后者优先） */
    function getEffectiveRunConfigForModal(project, defaults) {
        const base = { ...(defaults || {}), ...((project && project.runConfig) || {}) };
        let merged = base;
        if (typeof global.readExperimentRunConfigPatch === 'function') {
            const expPatch = global.readExperimentRunConfigPatch();
            if (expPatch) merged = { ...merged, ...expPatch };
        }
        const last = readLastStimulusRunConfig();
        if (last && project && project.id && last._projectId === project.id) {
            const { _projectId, ...rest } = last;
            return normalizeStimulusRunConfig({ ...merged, ...rest });
        }
        return normalizeStimulusRunConfig(merged);
    }

    function attachProjectIdToRunConfig(cfg, projectId) {
        if (!cfg || typeof cfg !== 'object') return cfg;
        const out = { ...cfg };
        if (projectId) out._projectId = projectId;
        return out;
    }

    global.STIMULUS_WINDOW_SEC_MIN = WINDOW_MIN;
    global.STIMULUS_WINDOW_SEC_MAX = WINDOW_MAX;
    global.DEFAULT_FLICKER_COLOR_ON = DEFAULT_FLICKER_ON;
    global.DEFAULT_FLICKER_COLOR_OFF = DEFAULT_FLICKER_OFF;
    global.normalizeHexColor = normalizeHexColor;
    global.flickerColorCss = flickerColorCss;
    global.flickerLabelColor = flickerLabelColor;
    global.normalizeStimulusRunConfig = normalizeStimulusRunConfig;
    global.readLastStimulusRunConfig = readLastStimulusRunConfig;
    global.getEffectiveRunConfigForModal = getEffectiveRunConfigForModal;
    global.attachProjectIdToRunConfig = attachProjectIdToRunConfig;
})(typeof window !== 'undefined' ? window : globalThis);
