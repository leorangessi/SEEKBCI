/**
 * 运行刺激配置归一化（项目管理 / 编辑器 / 刺激页共用）
 * - 置信度模式默认 2 s 窗（在线 FBCCA 较稳）；定时模式默认 0.8 s
 * - 用户显式设置的窗长（0.3～5 s）原样保留，运行时不再强制抬到 1 s / 2 s
 */
(function (global) {
    const WINDOW_MIN = 0.3;
    const WINDOW_MAX = 5.0;

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
    global.normalizeStimulusRunConfig = normalizeStimulusRunConfig;
    global.readLastStimulusRunConfig = readLastStimulusRunConfig;
    global.getEffectiveRunConfigForModal = getEffectiveRunConfigForModal;
    global.attachProjectIdToRunConfig = attachProjectIdToRunConfig;
})(typeof window !== 'undefined' ? window : globalThis);
