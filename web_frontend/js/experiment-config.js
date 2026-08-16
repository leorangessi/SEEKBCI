/**
 * 实验测试参数 ↔ 项目 runConfig / settings 同步
 */
(function (global) {
    const STORAGE_KEY = 'seekbci_experiment_config';
    const PROJECTS_KEY = 'ssvep_projects';
    const CURRENT_PROJECT_KEY = 'ssvep_project';

    function defaultRunConfigBaseline() {
        return {
            eegEnabled: true,
            mode: 'threshold',
            windowSec: 2.0,
            cooldownSec: 1.5,
            pollMs: 320,
            intervalSec: 3,
            minProbability: 0.28,
            minMargin: 0.08,
            thresholdRequireStable: false,
            transparentBackground: false,
            startFullscreen: false,
            flickerHighBlank: false,
            flickerOnDutyPercent: 32,
            flickerBlockOpacityPercent: 58,
            flickerColorOn: '#ffffff',
            flickerColorOff: '#000000',
            speakOnDecode: false,
            ssvepMultimodalWaitSec: 1.0
        };
    }

    function numVal(id, fallback) {
        const el = document.getElementById(id);
        if (!el) return fallback;
        const v = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
        return Number.isFinite(v) ? v : fallback;
    }

    function collectSsvepSpeedFromDom() {
        const triggerRule = document.getElementById('speed-trigger-rule')?.value || 'prob_margin';
        const minProbability = parseFloat(document.getElementById('speed-min-prob')?.value) || 0.28;
        const minMargin = parseFloat(document.getElementById('speed-min-margin')?.value) || 0.08;
        return {
            source: 'ssvep-test',
            mode: 'speed',
            triggerRule,
            minProbability: Math.min(0.99, Math.max(0.05, minProbability)),
            minMargin: Math.min(0.5, Math.max(0.02, minMargin)),
            requireStable: !!document.getElementById('speed-require-stable')?.checked,
            windowSec: parseFloat(document.getElementById('speed-window-sec')?.value) || 0.8,
            pollMs: parseInt(document.getElementById('speed-poll-ms')?.value, 10) || 280,
            maxTrialSec: parseInt(document.getElementById('speed-max-trial-sec')?.value, 10) || 30
        };
    }

    function collectStimulusRunFromDom() {
        const duty = parseInt(document.getElementById('exp-flicker-on-duty')?.value, 10);
        const opacity = parseInt(document.getElementById('exp-flicker-block-opacity')?.value, 10);
        const normHex =
            typeof global.normalizeHexColor === 'function'
                ? global.normalizeHexColor
                : (v, fb) => (v && String(v).trim() ? String(v).trim() : fb);
        return {
            source: 'test-stimulus',
            flickerHighBlank: !!document.getElementById('exp-flicker-high-blank')?.checked,
            flickerOnDutyPercent: Number.isFinite(duty) ? Math.min(50, Math.max(15, duty)) : 32,
            flickerBlockOpacityPercent: Number.isFinite(opacity) ? Math.min(100, Math.max(20, opacity)) : 58,
            flickerColorOn: normHex(document.getElementById('exp-flicker-color-on')?.value, '#ffffff'),
            flickerColorOff: normHex(document.getElementById('exp-flicker-color-off')?.value, '#000000')
        };
    }

    function collectEmgTestFromDom() {
        return {
            source: 'emg-test',
            windowSec: numVal('cfg-window', 1.0),
            normGate: numVal('cfg-norm-gate', 0.8),
            manualThresholds: !!document.getElementById('cfg-manual-thresholds')?.checked,
            manualUpper: numVal('cfg-manual-upper', 25),
            manualLower: numVal('cfg-manual-lower', 6),
            peakWindowSec: numVal('cfg-peak-window', 0.6),
            peakThreshold: numVal('cfg-peak-threshold', 50),
            peakMax: numVal('cfg-peak-max', 200),
            minBins: numVal('cfg-min-bins', 0.4),
            holdMs: numVal('cfg-hold-ms', 600),
            spring: numVal('cfg-spring', 10),
            damping: numVal('cfg-damping', 5),
            maxForce: numVal('cfg-max-force', 1.2),
            xyMap: {
                xNeg: document.getElementById('map-x-neg')?.value || '',
                xPos: document.getElementById('map-x-pos')?.value || '',
                yPos: document.getElementById('map-y-pos')?.value || '',
                yNeg: document.getElementById('map-y-neg')?.value || ''
            }
        };
    }

    function experimentSpeedToRunConfig(speed) {
        if (!speed || typeof speed !== 'object') return null;
        const patch = {
            eegEnabled: true,
            mode: 'threshold',
            windowSec: speed.windowSec,
            pollMs: speed.pollMs,
            minProbability: speed.minProbability,
            minMargin: speed.triggerRule === 'prob_only' ? 0 : speed.minMargin,
            thresholdRequireStable: !!speed.requireStable
        };
        if (typeof global.normalizeStimulusRunConfig === 'function') {
            return global.normalizeStimulusRunConfig(patch);
        }
        return patch;
    }

    function stimulusRunToRunConfig(stimulus) {
        if (!stimulus || typeof stimulus !== 'object') return null;
        const patch = {
            flickerHighBlank: !!stimulus.flickerHighBlank,
            flickerOnDutyPercent: stimulus.flickerOnDutyPercent,
            flickerBlockOpacityPercent: stimulus.flickerBlockOpacityPercent,
            flickerColorOn: stimulus.flickerColorOn || '#ffffff',
            flickerColorOff: stimulus.flickerColorOff || '#000000'
        };
        if (typeof global.normalizeStimulusRunConfig === 'function') {
            return global.normalizeStimulusRunConfig(patch);
        }
        return patch;
    }

    function loadExperimentConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function saveExperimentConfig(cfg) {
        const prev = loadExperimentConfig() || {};
        const payload = {
            ...prev,
            ...cfg,
            updatedAt: new Date().toISOString()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        return payload;
    }

    function readExperimentRunConfigPatch() {
        const cfg = loadExperimentConfig();
        if (!cfg) return null;
        let patch = null;
        if (cfg.ssvepSpeed) patch = experimentSpeedToRunConfig(cfg.ssvepSpeed);
        if (cfg.stimulusRun) {
            const sp = stimulusRunToRunConfig(cfg.stimulusRun);
            patch = patch ? { ...patch, ...sp } : sp;
        }
        if (cfg.keyboardTest && typeof cfg.keyboardTest === 'object') {
            const kb = { ...cfg.keyboardTest };
            delete kb.source;
            if (typeof global.normalizeStimulusRunConfig === 'function') {
                Object.assign(kb, global.normalizeStimulusRunConfig(kb));
            }
            patch = patch ? { ...patch, ...kb } : kb;
        }
        return patch;
    }

    function saveCurrentSsvepSpeedExperiment() {
        const ssvepSpeed = collectSsvepSpeedFromDom();
        return saveExperimentConfig({
            ssvepSpeed,
            runConfigPatch: experimentSpeedToRunConfig(ssvepSpeed)
        });
    }

    function saveCurrentStimulusExperiment() {
        const stimulusRun = collectStimulusRunFromDom();
        return saveExperimentConfig({
            stimulusRun,
            runConfigPatch: stimulusRunToRunConfig(stimulusRun)
        });
    }

    function saveCurrentEmgExperiment() {
        const emgTest = collectEmgTestFromDom();
        return saveExperimentConfig({ emgTest });
    }

    function applySsvepSpeedToDom(ssvepSpeed) {
        if (!ssvepSpeed) return;
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el && val != null) el.value = String(val);
        };
        const setCheck = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!val;
        };
        if (ssvepSpeed.triggerRule) set('speed-trigger-rule', ssvepSpeed.triggerRule);
        set('speed-min-prob', ssvepSpeed.minProbability);
        set('speed-min-margin', ssvepSpeed.minMargin);
        setCheck('speed-require-stable', ssvepSpeed.requireStable);
        set('speed-window-sec', ssvepSpeed.windowSec);
        set('speed-poll-ms', ssvepSpeed.pollMs);
        set('speed-max-trial-sec', ssvepSpeed.maxTrialSec);
        if (typeof global.onSpeedTriggerRuleChange === 'function') {
            global.onSpeedTriggerRuleChange();
        }
    }

    function applyStimulusRunToDom(stimulusRun) {
        if (!stimulusRun) return;
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el && val != null) el.value = String(val);
        };
        const setCheck = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!val;
        };
        setCheck('exp-flicker-high-blank', stimulusRun.flickerHighBlank);
        set('exp-flicker-on-duty', stimulusRun.flickerOnDutyPercent);
        set('exp-flicker-block-opacity', stimulusRun.flickerBlockOpacityPercent);
        set('exp-flicker-color-on', stimulusRun.flickerColorOn || '#ffffff');
        set('exp-flicker-color-off', stimulusRun.flickerColorOff || '#000000');
    }

    function listLocalProjects() {
        try {
            const raw = localStorage.getItem(PROJECTS_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function persistProjectUpdate(projectId, mutator) {
        const projects = listLocalProjects();
        const idx = projects.findIndex((p) => p && p.id === projectId);
        if (idx < 0) throw new Error('项目不存在，请先在项目管理中创建');
        mutator(projects[idx]);
        projects[idx].experimentSyncedAt = new Date().toISOString();
        projects[idx].updated_at = projects[idx].experimentSyncedAt;
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
        try {
            const curRaw = localStorage.getItem(CURRENT_PROJECT_KEY);
            if (curRaw) {
                const cur = JSON.parse(curRaw);
                if (cur && cur.id === projectId) {
                    Object.assign(cur, projects[idx]);
                    localStorage.setItem(CURRENT_PROJECT_KEY, JSON.stringify(cur));
                }
            }
        } catch (_) {
            /* ignore */
        }
        return projects[idx];
    }

    function syncExperimentToProject(projectId) {
        if (!projectId) throw new Error('请选择要同步的项目');
        const saved = saveCurrentSsvepSpeedExperiment();
        const patch = saved.runConfigPatch || experimentSpeedToRunConfig(saved.ssvepSpeed);
        if (!patch) throw new Error('无法生成运行配置');
        const project = persistProjectUpdate(projectId, (p) => {
            p.runConfig = {
                ...defaultRunConfigBaseline(),
                ...(p.runConfig || {}),
                ...patch
            };
        });
        return { project, runConfig: project.runConfig, experiment: saved };
    }

    function syncStimulusToProject(projectId) {
        if (!projectId) throw new Error('请选择要同步的项目');
        const saved = saveCurrentStimulusExperiment();
        const patch = saved.runConfigPatch || stimulusRunToRunConfig(saved.stimulusRun);
        if (!patch) throw new Error('无法生成运行配置');
        const project = persistProjectUpdate(projectId, (p) => {
            p.runConfig = {
                ...defaultRunConfigBaseline(),
                ...(p.runConfig || {}),
                ...patch
            };
        });
        return { project, runConfig: project.runConfig, experiment: saved };
    }

    function syncEmgToProject(projectId) {
        if (!projectId) throw new Error('请选择要同步的项目');
        const saved = saveCurrentEmgExperiment();
        const project = persistProjectUpdate(projectId, (p) => {
            p.settings = p.settings || {};
            p.settings.experimentEmg = saved.emgTest;
        });
        return { project, experiment: saved };
    }

    function populateProjectSelect(selectId) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const projects = listLocalProjects();
        const prev = sel.value;
        sel.innerHTML = '';
        if (!projects.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '（暂无本地项目）';
            sel.appendChild(opt);
            sel.disabled = true;
            return;
        }
        sel.disabled = false;
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '选择项目…';
        sel.appendChild(placeholder);
        projects.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name || p.id;
            sel.appendChild(opt);
        });
        if (prev && projects.some((p) => p.id === prev)) sel.value = prev;
        else {
            try {
                const cur = JSON.parse(localStorage.getItem(CURRENT_PROJECT_KEY) || 'null');
                if (cur && cur.id) sel.value = cur.id;
            } catch (_) {
                /* ignore */
            }
        }
    }

    global.SEEKBCI_EXPERIMENT = {
        STORAGE_KEY,
        defaultRunConfigBaseline,
        collectSsvepSpeedFromDom,
        collectStimulusRunFromDom,
        collectEmgTestFromDom,
        experimentSpeedToRunConfig,
        stimulusRunToRunConfig,
        loadExperimentConfig,
        saveExperimentConfig,
        readExperimentRunConfigPatch,
        saveCurrentSsvepSpeedExperiment,
        saveCurrentStimulusExperiment,
        saveCurrentEmgExperiment,
        applySsvepSpeedToDom,
        applyStimulusRunToDom,
        syncExperimentToProject,
        syncStimulusToProject,
        syncEmgToProject,
        populateProjectSelect,
        listLocalProjects
    };
    global.readExperimentRunConfigPatch = readExperimentRunConfigPatch;
})(typeof window !== 'undefined' ? window : globalThis);

