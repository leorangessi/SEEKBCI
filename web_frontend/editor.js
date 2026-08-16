// 项目编辑器 JavaScript

// 全局变量
let blocks = [];
let selectedBlock = null;
/** 属性面板中当前聚焦的动作槽索引（用于左侧 Python 库导入面板） */
let selectedActionIndex = 0;
let draggedBlock = null;
let dragOffset = { x: 0, y: 0 };
let blockIdCounter = 0;
let currentPage = 0;
let pages = [{ id: 0, name: 'Page 1', blocks: [], multimodalBlocks: [] }];
/** 当前页多模态方块（与 pages[currentPage].multimodalBlocks 同步） */
let multimodalBlocks = [];

/** 拖拽超过阈值后才把按下瞬间的快照入撤销栈，避免纯点击选择也产生撤销 */
let preDragSnapshotJson = null;
let dragStartPointer = null;
/** 用于判断是否实际移动过对象（避免仅点击也标脏） */
let dragStartBlockPos = null;
let resizeState = null;

const MAX_UNDO = 45;
let undoStack = [];
let redoStack = [];
/** 属性面板连续改动合并为少量撤销步 */
let propertyUndoDebounceTimer = null;

/** 离开编辑器：保存后跳转的 URL */
let pendingNavigateHref = null;

/** 相对上次「保存项目」或加载后的未保存改动；仅此时离开才弹出保存对话框 */
let editorDirty = false;

/** 内存剪贴板（深拷贝对象模板，不含最终 id） */
let internalClipboardBlockData = null;

/** 页面跳转动作默认延迟（毫秒）；与刺激页 PAGE_LINK_DEFAULT_DELAY_MS 一致 */
const PAGE_LINK_DEFAULT_DELAY_MS = 1000;
const MIN_SOFTMAX_PROBABILITY = 0.03;

/** SSVEP 闪烁频率：由用户输入（支持小数）；同页任意两路须相差 ≥ MIN_GAP */
const SSVEP_FREQ_MIN_HZ = 8;
const SSVEP_FREQ_MAX_HZ = 15.8;
const SSVEP_FREQ_MIN_GAP_HZ = 0.2;
const SSVEP_DEFAULT_FREQ_HZ = 8;
/** 保存时自动分配频率的下限（在允许范围内均匀铺开） */
const AUTO_ASSIGN_FREQ_MIN_HZ = 9;
const AUTO_ASSIGN_FREQ_MAX_HZ = 15.8;

const PHASES = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0];

function ssvepKb40() {
    return window.SSVEP_KEYBOARD_40 || null;
}

function isSsvepKeyboardBlock(block) {
    const KB = ssvepKb40();
    return KB ? KB.isSsvepKeyboardBlock(block) : !!(block && block.shape === 'ssvep_keyboard');
}

// 正六边形（平顶）外接矩形比例：height / width = sqrt(3) / 2
const REGULAR_HEX_H_OVER_W = Math.sqrt(3) / 2;

function emptyEditorAction() {
    return { type: 'none', content: '', targetPage: null, delayMs: 0 };
}

/** 单对象上的动作列表；兼容旧版仅含 `action` 字段的项目 */
function normalizeBlockActions(block) {
    if (!block || typeof block !== 'object') return;
    if (Array.isArray(block.actions) && block.actions.length > 0) {
        block.actions = block.actions.map((a) => ({
            type: a && typeof a.type === 'string' ? a.type : 'none',
            content: a && a.content != null ? String(a.content) : '',
            delayMs:
                a && a.delayMs != null && a.delayMs !== ''
                    ? Number(a.delayMs)
                    : a && a.delayMs === 0
                      ? 0
                      : 0,
            targetPage:
                a && a.targetPage != null && a.targetPage !== ''
                    ? Number(a.targetPage)
                    : a && a.targetPage === 0
                      ? 0
                      : null
        }));
    } else if (block.action && typeof block.action === 'object') {
        block.actions = [
            {
                type: typeof block.action.type === 'string' ? block.action.type : 'none',
                content: block.action.content != null ? String(block.action.content) : '',
                delayMs:
                    block.action.delayMs != null && block.action.delayMs !== ''
                        ? Number(block.action.delayMs)
                        : 0,
                targetPage:
                    block.action.targetPage != null && block.action.targetPage !== ''
                        ? Number(block.action.targetPage)
                        : block.action.targetPage === 0
                          ? 0
                          : null
            }
        ];
    } else {
        block.actions = [emptyEditorAction()];
    }
    block.action = block.actions[0];
}

function ensureProjectPagesActionsNormalized(pagesArr) {
    migrateAllMultimodalBlocks(pagesArr);
    for (const p of pagesArr || []) {
        for (const b of p.blocks || []) normalizeBlockActions(b);
        for (const b of p.multimodalBlocks || []) normalizeBlockActions(b);
    }
}

function quantizeFrequencyHz(hz) {
    if (!Number.isFinite(hz)) return hz;
    const steps = Math.round((hz - SSVEP_FREQ_MIN_HZ) / SSVEP_FREQ_MIN_GAP_HZ);
    const q = SSVEP_FREQ_MIN_HZ + steps * SSVEP_FREQ_MIN_GAP_HZ;
    return Math.round(q * 10000) / 10000;
}

function normalizeFrequencyHz(raw) {
    if (raw == null || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw).trim().replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    return quantizeFrequencyHz(n);
}

function findFrequencyConflictOnPage(pageBlocks, blockId, freqHz) {
    const self = (pageBlocks || []).find((b) => b && b.id === blockId);
    const selfIsKb = self && isSsvepKeyboardBlock(self);
    const KB = ssvepKb40();
    const entries = KB ? KB.collectPageFrequencyEntries(pageBlocks) : [];
    if (entries.length > 0 && selfIsKb) {
        for (const e of entries) {
            const bid = e.virtual ? e.virtual.parentKeyboardId : e.block && e.block.id;
            if (bid === blockId) continue;
            if (!Number.isFinite(e.hz)) continue;
            if (Math.abs(e.hz - freqHz) < SSVEP_FREQ_MIN_GAP_HZ - 1e-9) {
                return { other: e.block, otherHz: e.hz, label: e.label };
            }
        }
        return null;
    }
    for (const b of pageBlocks || []) {
        if (!b || b.id === blockId || isSsvepKeyboardBlock(b)) continue;
        const o = normalizeFrequencyHz(b.frequency);
        if (o == null) continue;
        if (Math.abs(o - freqHz) < SSVEP_FREQ_MIN_GAP_HZ - 1e-9) {
            return { other: b, otherHz: o };
        }
    }
    return null;
}

const SSVEP_PHASE_PRESETS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9];

function defaultCursorControl() {
    return {
        enabled: false,
        mapping: {
            sensitivity: 42,
            invertX: true,
            invertY: true,
            headMode: true
        },
        clickMethod: 'none',
        clickType: 'single',
        dwellMs: 900,
        dwellStillPx: 14,
        dwellCooldownMs: 700
    };
}

function mergeCursorControl(raw) {
    const base = defaultCursorControl();
    if (!raw || typeof raw !== 'object') return base;
    const dwellCooldownMs =
        raw.dwellCooldownMs != null
            ? Number(raw.dwellCooldownMs)
            : raw.dwellCooldownoldownMs != null
              ? Number(raw.dwellCooldownoldownMs)
              : base.dwellCooldownMs;
    return {
        ...base,
        ...raw,
        mapping: { ...base.mapping, ...(raw.mapping || {}) },
        dwellCooldownMs: Number.isFinite(dwellCooldownMs) ? dwellCooldownMs : base.dwellCooldownMs
    };
}

function defaultLocomotionControl() {
    return {
        enabled: false,
        mode: 'lean',
        accelForwardTh: 1.0,
        accelStrafeTh: 1.0,
        accelSensitivity: 2.5,
        invertForward: false,
        invertStrafe: false,
        smoothing: 0.78,
        adaptNeutral: true,
        adaptAlpha: 0.025,
        keys: {
            forward: 'KeyW',
            back: 'KeyS',
            left: 'KeyA',
            right: 'KeyD'
        }
    };
}

function mergeLocomotionControl(raw) {
    const base = defaultLocomotionControl();
    if (!raw || typeof raw !== 'object') return base;
    const merged = {
        ...base,
        ...raw,
        keys: { ...base.keys, ...(raw.keys || {}) }
    };
    merged.mode = 'lean';
    if (raw.accelForwardTh == null && raw.pitchThresholdDeg != null) {
        const deg = Number(raw.pitchThresholdDeg);
        if (Number.isFinite(deg)) {
            merged.accelForwardTh = Math.max(0.6, Math.sin((deg * Math.PI) / 180) * 9.80665);
        }
    }
    if (raw.accelStrafeTh == null && raw.rollThresholdDeg != null) {
        const deg = Number(raw.rollThresholdDeg);
        if (Number.isFinite(deg)) {
            merged.accelStrafeTh = Math.max(0.6, Math.sin((deg * Math.PI) / 180) * 9.80665);
        }
    }
    return merged;
}

function defaultProjectSettings() {
    return {
        autoAssignFreqPhaseOnSave: true,
        pythonImports: [],
        pythonGlobalCode: '',
        advancedFeaturesOpen: false,
        cursorControl: defaultCursorControl(),
        locomotionControl: defaultLocomotionControl()
    };
}

function normalizePythonImportsList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => String(s).trim()).filter(Boolean);
}

function getProjectPythonGlobalCode(project) {
    const settings = getProjectSettings(project || readStoredProjectShell());
    if (typeof settings.pythonGlobalCode === 'string') return settings.pythonGlobalCode;
    return normalizePythonImportsList(settings.pythonImports).join('\n');
}

function getProjectPythonImports(project) {
    const code = getProjectPythonGlobalCode(project);
    return code
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'));
}

function getProjectSettings(project) {
    const base = defaultProjectSettings();
    const raw = (project && project.settings) || {};
    return {
        ...base,
        ...raw,
        cursorControl: mergeCursorControl(raw.cursorControl),
        locomotionControl: mergeLocomotionControl(raw.locomotionControl)
    };
}

function stablePhaseForBlock(block, salt) {
    let h = 0;
    const s = String(block && block.id ? block.id : '') + '|' + String(salt != null ? salt : '');
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    const u = (h >>> 0) % SSVEP_PHASE_PRESETS.length;
    return SSVEP_PHASE_PRESETS[u];
}

function collectKeyboardUsedFrequenciesOnPage(pageBlocks) {
    const KB = ssvepKb40();
    const used = [];
    for (const b of pageBlocks || []) {
        if (!KB || !isSsvepKeyboardBlock(b)) continue;
        KB.ensureKeyboardKeyPhases(b);
        for (const vt of KB.buildKeyboardVirtualTargets(b)) {
            if (Number.isFinite(Number(vt.frequency))) used.push(Number(vt.frequency));
        }
    }
    return used;
}

function pickNextFreeFrequencyHz(used, minHz = AUTO_ASSIGN_FREQ_MIN_HZ, maxHz = AUTO_ASSIGN_FREQ_MAX_HZ) {
    for (let k = 0; k < 2000; k++) {
        const cand = Math.round((minHz + k * SSVEP_FREQ_MIN_GAP_HZ) * 10000) / 10000;
        if (cand > maxHz) break;
        if (!used.some((u) => Math.abs(u - cand) < SSVEP_FREQ_MIN_GAP_HZ - 1e-9)) return cand;
    }
    return suggestNonConflictingFrequencyHz([]);
}

/** 在 [min,max] 内为 count 个对象生成近似等间隔频率（0.2 Hz 量化） */
function computeEvenlySpacedFrequenciesHz(count, minHz = AUTO_ASSIGN_FREQ_MIN_HZ, maxHz = AUTO_ASSIGN_FREQ_MAX_HZ) {
    if (count <= 0) return [];
    if (count === 1) {
        return [quantizeFrequencyHz((minHz + maxHz) / 2)];
    }
    const out = [];
    for (let i = 0; i < count; i++) {
        const raw = minHz + (i / (count - 1)) * (maxHz - minHz);
        out.push(quantizeFrequencyHz(raw));
    }
    return out;
}

function autoAssignPageFrequenciesAndPhases(pageBlocks) {
    const used = collectKeyboardUsedFrequenciesOnPage(pageBlocks);
    const targets = (pageBlocks || []).filter((b) => b && !isSsvepKeyboardBlock(b));
    const spaced = computeEvenlySpacedFrequenciesHz(targets.length);
    for (let i = 0; i < targets.length; i++) {
        const block = targets[i];
        let hz = spaced[i];
        if (used.some((u) => Math.abs(u - hz) < SSVEP_FREQ_MIN_GAP_HZ - 1e-9)) {
            hz = pickNextFreeFrequencyHz(used);
        }
        block.frequency = hz;
        block.phase = stablePhaseForBlock(block, hz);
        used.push(hz);
    }
}

function autoAssignAllPagesFrequenciesAndPhases(pagesArr) {
    for (const page of pagesArr || []) {
        autoAssignPageFrequenciesAndPhases(page.blocks || []);
    }
}

function applyEditorSettingsToUi(project) {
    const settings = getProjectSettings(project);
    const cb = document.getElementById('editor-auto-assign-freq-phase');
    if (cb) cb.checked = settings.autoAssignFreqPhaseOnSave !== false;
    const editor = getPythonGlobalEditorEl();
    if (editor && document.activeElement !== editor) editor.value = getProjectPythonGlobalCode(project);
    const advanced = document.getElementById('advanced-features-section');
    if (advanced) advanced.style.display = settings.advancedFeaturesOpen ? '' : 'none';
    const label = document.getElementById('advanced-features-btn-label');
    if (label) label.textContent = settings.advancedFeaturesOpen ? '隐藏高级功能' : '高级功能';
    refreshPythonGlobalSummary(project);
    applyCursorControlToUi(settings.cursorControl);
    applyLocomotionControlToUi(settings.locomotionControl);
}

function applyCursorControlToUi(cc) {
    const cfg = mergeCursorControl(cc);
    const enabled = document.getElementById('editor-cursor-control-enabled');
    const opts = document.getElementById('editor-cursor-control-options');
    const method = document.getElementById('editor-cursor-click-method');
    const clickType = document.getElementById('editor-cursor-click-type');
    const dwellMs = document.getElementById('editor-cursor-dwell-ms');
    const dwellStill = document.getElementById('editor-cursor-dwell-still');
    const dwellCd = document.getElementById('editor-cursor-dwell-cooldown');
    const dwellWrap = document.getElementById('editor-cursor-dwell-params');
    const sens = document.getElementById('editor-cursor-sensitivity');
    const invX = document.getElementById('editor-cursor-invert-x');
    const invY = document.getElementById('editor-cursor-invert-y');
    const head = document.getElementById('editor-cursor-head-mode');
    if (enabled) enabled.checked = !!cfg.enabled;
    if (opts) opts.style.display = cfg.enabled ? '' : 'none';
    if (method) method.value = cfg.clickMethod || 'none';
    if (clickType) clickType.value = cfg.clickType || 'single';
    if (dwellMs) dwellMs.value = String(cfg.dwellMs);
    if (dwellStill) dwellStill.value = String(cfg.dwellStillPx);
    if (dwellCd) dwellCd.value = String(cfg.dwellCooldownMs);
    if (dwellWrap) dwellWrap.style.display = cfg.clickMethod === 'dwell' ? '' : 'none';
    if (sens) sens.value = String((cfg.mapping && cfg.mapping.sensitivity) || 42);
    if (invX) invX.checked = !!(cfg.mapping && cfg.mapping.invertX);
    if (invY) invY.checked = !!(cfg.mapping && cfg.mapping.invertY);
    if (head) head.checked = !!(cfg.mapping && cfg.mapping.headMode);
}

function readCursorControlFromUi() {
    const enabled = document.getElementById('editor-cursor-control-enabled');
    const method = document.getElementById('editor-cursor-click-method');
    const clickType = document.getElementById('editor-cursor-click-type');
    const dwellMs = document.getElementById('editor-cursor-dwell-ms');
    const dwellStill = document.getElementById('editor-cursor-dwell-still');
    const dwellCd = document.getElementById('editor-cursor-dwell-cooldown');
    const sens = document.getElementById('editor-cursor-sensitivity');
    const invX = document.getElementById('editor-cursor-invert-x');
    const invY = document.getElementById('editor-cursor-invert-y');
    const head = document.getElementById('editor-cursor-head-mode');
    const base = defaultCursorControl();
    if (!enabled) return base;
    const clickMethod = method && method.value ? method.value : 'none';
    return {
        enabled: !!enabled.checked,
        mapping: {
            sensitivity: Math.max(5, Math.min(120, Number(sens && sens.value) || 42)),
            invertX: invX ? !!invX.checked : true,
            invertY: invY ? !!invY.checked : true,
            headMode: head ? !!head.checked : true
        },
        clickMethod: ['none', 'dwell', 'space'].includes(clickMethod) ? clickMethod : 'none',
        clickType: clickType && clickType.value === 'double' ? 'double' : 'single',
        dwellMs: Math.max(200, Math.min(5000, Number(dwellMs && dwellMs.value) || 900)),
        dwellStillPx: Math.max(1, Math.min(80, Number(dwellStill && dwellStill.value) || 14)),
        dwellCooldownMs: Math.max(200, Math.min(5000, Number(dwellCd && dwellCd.value) || 700))
    };
}

function onEditorCursorControlChange() {
    const shell = readStoredProjectShell();
    shell.settings = { ...defaultProjectSettings(), ...(shell.settings || {}) };
    shell.settings.cursorControl = readCursorControlFromUi();
    applyCursorControlToUi(shell.settings.cursorControl);
    localStorage.setItem(
        'ssvep_project',
        JSON.stringify({
            ...shell,
            pages,
            currentPage,
            runConfig: { ...defaultRunConfig(), ...(shell.runConfig || {}) }
        })
    );
    markEditorDirty();
}

function applyLocomotionControlToUi(lc) {
    const cfg = mergeLocomotionControl(lc);
    const enabled = document.getElementById('editor-loco-enabled');
    const opts = document.getElementById('editor-loco-options');
    const sens = document.getElementById('editor-loco-sens');
    const fwdTh = document.getElementById('editor-loco-pitch-th');
    const strTh = document.getElementById('editor-loco-roll-th');
    const invF = document.getElementById('editor-loco-invert-fwd');
    const invS = document.getElementById('editor-loco-invert-strafe');
    if (enabled) enabled.checked = !!cfg.enabled;
    if (opts) opts.style.display = cfg.enabled ? '' : 'none';
    if (sens) sens.value = String(Number(cfg.accelSensitivity).toFixed(1));
    if (fwdTh) fwdTh.value = String(Number(cfg.accelForwardTh).toFixed(2));
    if (strTh) strTh.value = String(Number(cfg.accelStrafeTh).toFixed(2));
    if (invF) invF.checked = !!cfg.invertForward;
    if (invS) invS.checked = !!cfg.invertStrafe;
}

function readLocomotionControlFromUi() {
    const enabled = document.getElementById('editor-loco-enabled');
    const sens = document.getElementById('editor-loco-sens');
    const fwdTh = document.getElementById('editor-loco-pitch-th');
    const strTh = document.getElementById('editor-loco-roll-th');
    const invF = document.getElementById('editor-loco-invert-fwd');
    const invS = document.getElementById('editor-loco-invert-strafe');
    const base = defaultLocomotionControl();
    if (!enabled) return base;
    return {
        ...base,
        enabled: !!enabled.checked,
        mode: 'lean',
        accelSensitivity: Math.max(0.2, Math.min(12, Number(sens && sens.value) || 2.5)),
        accelForwardTh: Math.max(0.2, Math.min(6, Number(fwdTh && fwdTh.value) || 1.0)),
        accelStrafeTh: Math.max(0.2, Math.min(6, Number(strTh && strTh.value) || 1.0)),
        invertForward: invF ? !!invF.checked : false,
        invertStrafe: invS ? !!invS.checked : false
    };
}

function onEditorLocomotionControlChange() {
    const shell = readStoredProjectShell();
    shell.settings = { ...defaultProjectSettings(), ...(shell.settings || {}) };
    shell.settings.locomotionControl = readLocomotionControlFromUi();
    applyLocomotionControlToUi(shell.settings.locomotionControl);
    localStorage.setItem(
        'ssvep_project',
        JSON.stringify({
            ...shell,
            pages,
            currentPage,
            runConfig: { ...defaultRunConfig(), ...(shell.runConfig || {}) }
        })
    );
    markEditorDirty();
}

function syncProjectSettingsFromEditorUi(project) {
    project.settings = { ...defaultProjectSettings(), ...(project.settings || {}) };
    const cb = document.getElementById('editor-auto-assign-freq-phase');
    if (cb) project.settings.autoAssignFreqPhaseOnSave = !!cb.checked;
    const impEditor = getPythonGlobalEditorEl();
    if (impEditor) {
        project.settings.pythonGlobalCode = impEditor.value;
        project.settings.pythonImports = normalizePythonImportsList(
            impEditor.value.split('\n').filter((line) => {
                const t = line.trim();
                return t && !t.startsWith('#') && (t.startsWith('import ') || t.startsWith('from '));
            })
        );
    }
    if (document.getElementById('editor-cursor-control-enabled')) {
        project.settings.cursorControl = readCursorControlFromUi();
    } else {
        project.settings.cursorControl = mergeCursorControl(project.settings.cursorControl);
    }
    if (document.getElementById('editor-loco-enabled')) {
        project.settings.locomotionControl = readLocomotionControlFromUi();
    } else {
        project.settings.locomotionControl = mergeLocomotionControl(project.settings.locomotionControl);
    }
    return project.settings;
}

function onEditorAutoAssignSettingChange() {
    const shell = readStoredProjectShell();
    shell.settings = { ...defaultProjectSettings(), ...(shell.settings || {}) };
    const cb = document.getElementById('editor-auto-assign-freq-phase');
    if (cb) shell.settings.autoAssignFreqPhaseOnSave = !!cb.checked;
    localStorage.setItem(
        'ssvep_project',
        JSON.stringify({ ...shell, pages, currentPage, runConfig: { ...defaultRunConfig(), ...(shell.runConfig || {}) } })
    );
    markEditorDirty();
}

function suggestNonConflictingFrequencyHz(pageBlocks) {
    const KB = ssvepKb40();
    const used = KB
        ? KB.collectPageFrequencyEntries(pageBlocks)
              .map((e) => e.hz)
              .filter((n) => Number.isFinite(n))
        : (pageBlocks || []).map((b) => normalizeFrequencyHz(b.frequency)).filter((n) => n != null);
    for (let k = 0; k < 2000; k++) {
        const cand = SSVEP_DEFAULT_FREQ_HZ + k * SSVEP_FREQ_MIN_GAP_HZ;
        if (cand > SSVEP_FREQ_MAX_HZ) break;
        if (!used.some((u) => Math.abs(u - cand) < SSVEP_FREQ_MIN_GAP_HZ - 1e-9)) {
            return Math.round(cand * 10000) / 10000;
        }
    }
    for (let f = SSVEP_FREQ_MIN_HZ; f <= SSVEP_FREQ_MAX_HZ; f += SSVEP_FREQ_MIN_GAP_HZ) {
        const cand = Math.round(f * 10000) / 10000;
        if (!used.some((u) => Math.abs(u - cand) < SSVEP_FREQ_MIN_GAP_HZ - 1e-9)) return cand;
    }
    return SSVEP_DEFAULT_FREQ_HZ;
}

function collectSsvepFrequencyValidationErrors(project) {
    const errors = [];
    for (const page of project.pages || []) {
        const blocks = page.blocks || [];
        if (blocks.length === 0) continue;
        const KB = ssvepKb40();
        const freqEntries = KB
            ? KB.collectPageFrequencyEntries(blocks)
            : blocks
                  .filter((b) => b && b.frequency != null)
                  .map((b) => ({ label: b.label, hz: Number(b.frequency), block: b }));
        for (let i = 0; i < freqEntries.length; i++) {
            const fi = freqEntries[i].hz;
            if (!Number.isFinite(fi)) {
                if (!KB || !KB.isSsvepKeyboardBlock(freqEntries[i].block)) {
                    errors.push({
                        type: 'error',
                        message: `对象「${freqEntries[i].label}」的频率无效`,
                        details: `画布: ${page.name}`,
                        suggestion: '请填写有效数字（Hz）'
                    });
                }
                continue;
            }
            for (let j = i + 1; j < freqEntries.length; j++) {
                const fj = freqEntries[j].hz;
                if (!Number.isFinite(fj)) continue;
                if (Math.abs(fi - fj) < SSVEP_FREQ_MIN_GAP_HZ - 1e-9) {
                    errors.push({
                        type: 'error',
                        message: `画布「${page.name}」闪烁频率过近`,
                        details: `「${freqEntries[i].label}」(${fi} Hz) 与 「${freqEntries[j].label}」(${fj} Hz) 间隔须 ≥ ${SSVEP_FREQ_MIN_GAP_HZ} Hz`,
                        suggestion: '调整频率使任意两路至少相差 0.2 Hz，或保存时启用自动分配'
                    });
                }
            }
        }
        for (const block of blocks) {
            if (!block || isSsvepKeyboardBlock(block)) continue;
            const freq = normalizeFrequencyHz(block.frequency);
            if (freq == null) continue;
            if (freq < SSVEP_FREQ_MIN_HZ || freq > SSVEP_FREQ_MAX_HZ) {
                errors.push({
                    type: 'error',
                    message: `对象「${block.label}」的频率不在允许范围`,
                    details: `画布: ${page.name}，当前: ${freq} Hz，允许: ${SSVEP_FREQ_MIN_HZ}～${SSVEP_FREQ_MAX_HZ} Hz`,
                    suggestion: '将闪烁频率改为允许范围内（可含小数）'
                });
            }
        }
    }
    return errors;
}

function showEditorFrequencyValidationErrors(errors, actionLabel) {
    const lines = errors.map(
        (e) =>
            `${e.message}\n${e.details || ''}${e.suggestion ? `\n💡 ${e.suggestion}` : ''}`
    );
    alert(`${actionLabel}失败：频率检查未通过\n\n${lines.join('\n\n')}`);
}

function onEditorSsvepBlockFrequencyCommit(raw) {
    if (!selectedBlock || isMultimodalBlock(selectedBlock)) return;
    const hz = normalizeFrequencyHz(raw);
    if (hz == null) {
        alert('请输入有效数字');
        updatePropertiesPanel();
        return;
    }
    if (hz < SSVEP_FREQ_MIN_HZ || hz > SSVEP_FREQ_MAX_HZ) {
        alert(`频率须在 ${SSVEP_FREQ_MIN_HZ}～${SSVEP_FREQ_MAX_HZ} Hz 之间`);
        updatePropertiesPanel();
        return;
    }
    maybePushUndoForPropertyChange();
    selectedBlock.frequency = hz;
    markEditorDirty();
    saveToLocalStorage();
    updatePropertiesPanel();
}

/** 编辑器画布网格（与参考图叠放时网格在上层） */
const EDITOR_CANVAS_GRID = `linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px)`;

const EDITOR_REF_IMAGE_MODES = {
    fit: { size: 'contain', repeat: 'no-repeat', position: 'center center' },
    stretch: { size: '100% 100%', repeat: 'no-repeat', position: '0 0' },
    tile: { size: 'auto', repeat: 'repeat', position: '0 0' }
};

function getEditorRefImageMode() {
    const p = pages[currentPage];
    const m = p && p.editorRefImageMode;
    return EDITOR_REF_IMAGE_MODES[m] ? m : 'stretch';
}

function syncEditorRefImageModeUi() {
    const row = document.getElementById('editor-ref-image-mode-row');
    const sel = document.getElementById('editor-ref-image-mode');
    const p = pages[currentPage];
    const hasRef = !!(p && p.editorRefImage);
    if (row) row.style.display = hasRef ? 'block' : 'none';
    if (sel) sel.value = getEditorRefImageMode();
}

function applyEditorPageCanvasBackground() {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    const p = pages[currentPage];
    const ref = p && typeof p.editorRefImage === 'string' && p.editorRefImage.length > 0 ? p.editorRefImage : null;
    if (ref) {
        const safe = ref.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const mode = getEditorRefImageMode();
        const cfg = EDITOR_REF_IMAGE_MODES[mode];
        /* EDITOR_CANVAS_GRID 含两层渐变，参考图为第三层；每层必须各写 size/repeat，否则按 CSS 会循环套用导致图片变成 20px 平铺 */
        canvas.style.backgroundImage = `${EDITOR_CANVAS_GRID}, url("${safe}")`;
        canvas.style.backgroundSize = `20px 20px, 20px 20px, ${cfg.size}`;
        canvas.style.backgroundPosition = `0 0, 0 0, ${cfg.position}`;
        canvas.style.backgroundRepeat = `repeat, repeat, ${cfg.repeat}`;
        canvas.style.backgroundColor = '#1a1a1a';
    } else {
        canvas.style.backgroundImage = EDITOR_CANVAS_GRID;
        canvas.style.backgroundSize = '20px 20px';
        canvas.style.backgroundPosition = '0 0';
        canvas.style.backgroundRepeat = 'repeat';
        canvas.style.backgroundColor = '';
    }
    syncEditorRefImageModeUi();
}

function onEditorRefImageModeChange() {
    const sel = document.getElementById('editor-ref-image-mode');
    if (!sel || !pages[currentPage] || !pages[currentPage].editorRefImage) return;
    pushUndoSnapshot();
    pages[currentPage].editorRefImageMode = sel.value;
    applyEditorPageCanvasBackground();
    markEditorDirty();
    saveToLocalStorage();
}

/**
 * 大图缩小为 JPEG，减轻 localStorage 压力；小图保持原样。
 */
function optimizeEditorRefImageDataUrl(rawDataUrl, done) {
    const img = new Image();
    img.onload = () => {
        const maxEdge = 2560;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (!w || !h) {
            done(rawDataUrl);
            return;
        }
        const needShrink = Math.max(w, h) > maxEdge;
        const longDataUrl = rawDataUrl.length > 2_200_000;
        if (!needShrink && !longDataUrl) {
            done(rawDataUrl);
            return;
        }
        if (needShrink) {
            const scale = maxEdge / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) {
            done(rawDataUrl);
            return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        try {
            done(c.toDataURL('image/jpeg', 0.9));
        } catch {
            done(rawDataUrl);
        }
    };
    img.onerror = () => done(rawDataUrl);
    img.src = rawDataUrl;
}

function onEditorRefImageFileChange(ev) {
    const input = ev.target;
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) {
        alert('请选择图片文件');
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        if (!pages[currentPage]) return;
        const raw = reader.result;
        optimizeEditorRefImageDataUrl(raw, (finalUrl) => {
            if (!pages[currentPage]) return;
            pushUndoSnapshot();
            pages[currentPage].editorRefImage = finalUrl;
            if (!pages[currentPage].editorRefImageMode) {
                pages[currentPage].editorRefImageMode = 'stretch';
            }
            applyEditorPageCanvasBackground();
            markEditorDirty();
            saveToLocalStorage();
        });
    };
    reader.onerror = () => alert('读取图片失败');
    reader.readAsDataURL(f);
}

function clearEditorPageRefImage() {
    if (!pages[currentPage]) return;
    if (!pages[currentPage].editorRefImage) {
        alert('当前页没有参考图');
        return;
    }
    if (!confirm('确定删除当前页的参考背景图？')) return;
    pushUndoSnapshot();
    delete pages[currentPage].editorRefImage;
    delete pages[currentPage].editorRefImageMode;
    applyEditorPageCanvasBackground();
    markEditorDirty();
    saveToLocalStorage();
}

/** keyboard-binding.js 未加载（路径错误/缓存）时的降级，避免面板报错且录制仍可用 */
(function ensureKeyboardBindingShim() {
    if (typeof parseKeyboardBinding === 'function') return;
    console.warn('[SSVEP 编辑器] keyboard-binding.js 未加载，使用内置键盘绑定实现');
    const MOD_ORDER = ['ctrl', 'shift', 'alt', 'meta'];
    function parseKeyboardBinding(raw) {
        if (raw == null || raw === '') return null;
        const s = String(raw).trim();
        if (!s) return null;
        if (s.startsWith('{')) {
            try {
                const o = JSON.parse(s);
                if (o && o.v === 1 && Array.isArray(o.chords)) return o;
            } catch (_) { /* ignore */ }
        }
        return { v: 1, legacyText: s };
    }
    function hasKeyboardBinding(binding) {
        if (!binding) return false;
        if (binding.legacyText) return binding.legacyText.length > 0;
        return Array.isArray(binding.chords) && binding.chords.length > 0;
    }
    function modLabel(m) {
        if (m === 'ctrl') return 'Ctrl';
        if (m === 'shift') return 'Shift';
        if (m === 'alt') return 'Alt';
        if (m === 'meta') return 'Win';
        return m;
    }
    function codeToShortLabel(code) {
        if (!code) return '?';
        if (code.startsWith('Key') && code.length === 4) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
        const named = {
            Space: 'Space',
            Enter: 'Enter',
            Tab: 'Tab',
            Backspace: 'Backspace',
            Delete: 'Delete',
            Escape: 'Esc',
            ArrowUp: '↑',
            ArrowDown: '↓',
            ArrowLeft: '←',
            ArrowRight: '→'
        };
        if (named[code]) return named[code];
        if (/^F\d{1,2}$/.test(code)) return code;
        return code;
    }
    function formatChord(chord) {
        if (!chord || !chord.code) return '';
        const parts = [];
        const mods = chord.mods || [];
        for (const m of MOD_ORDER) {
            if (mods.includes(m)) parts.push(modLabel(m));
        }
        parts.push(codeToShortLabel(chord.code));
        return parts.join('+');
    }
    function formatKeyboardBindingDisplay(binding) {
        if (!binding) return '（未绑定）';
        if (binding.legacyText) return binding.legacyText;
        if (!binding.chords || binding.chords.length === 0) return '（未绑定）';
        return binding.chords.map(formatChord).join(' → ');
    }
    function chordFromKeyboardEvent(e) {
        const mods = [];
        if (e.ctrlKey) mods.push('ctrl');
        if (e.shiftKey) mods.push('shift');
        if (e.altKey) mods.push('alt');
        if (e.metaKey) mods.push('meta');
        return { mods, code: e.code };
    }
    function isModifierKeyCode(code) {
        return /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(code);
    }
    function serializeKeyboardBinding(chords) {
        return JSON.stringify({ v: 1, chords: chords || [] });
    }
    Object.assign(window, {
        parseKeyboardBinding,
        formatKeyboardBindingDisplay,
        chordFromKeyboardEvent,
        isModifierKeyCode,
        serializeKeyboardBinding,
        hasKeyboardBinding
    });
})();

/** @type {{ blockId: number, actionIndex: number, twoPart: boolean, chords: Array<{mods:string[], code:string}> } | null} */
let keyRecording = null;

function setKbDisplayRecording(/** @type {boolean} */ active, blockId, actionIndex) {
    const disp = document.getElementById(`kb-display-${blockId}-${actionIndex}`);
    if (!disp) return;
    if (active) disp.classList.add('kb-recording-active');
    else disp.classList.remove('kb-recording-active');
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getBlockById(id) {
    for (let i = 0; i < pages.length; i++) {
        const list = [...(pages[i].blocks || []), ...(pages[i].multimodalBlocks || [])];
        const found = list.find((b) => b.id === id);
        if (found) return found;
    }
    return null;
}

function isMultimodalBlock(b) {
    return !!(b && typeof window.ssvepIsMultimodalChannelId === 'function' && window.ssvepIsMultimodalChannelId(b.channel));
}

function normalizeMultimodalBlockInEditor(block) {
    if (!block || !isMultimodalBlock(block)) return block;
    if (typeof window.ssvepNormalizeMultimodalBlock === 'function') {
        window.ssvepNormalizeMultimodalBlock(block);
    } else if (typeof window.ssvepMigrateMultimodalChannelId === 'function') {
        block.channel = window.ssvepMigrateMultimodalChannelId(block.channel);
    }
    normalizeBlockActions(block);
    if (typeof window.ssvepBlockHasConfirmSsvepAction === 'function' && window.ssvepBlockHasConfirmSsvepAction(block)) {
        block.actions = [{ type: 'confirm_ssvep', content: '', targetPage: null, delayMs: 0 }];
    } else if (typeof window.ssvepBlockHasCancelSsvepAction === 'function' && window.ssvepBlockHasCancelSsvepAction(block)) {
        block.actions = [{ type: 'cancel_ssvep', content: '', targetPage: null, delayMs: 0 }];
    }
    return block;
}

function migrateAllMultimodalBlocks(pagesArr) {
    for (const p of pagesArr || []) {
        for (const b of p.multimodalBlocks || []) normalizeMultimodalBlockInEditor(b);
    }
}

function blockDomId(b) {
    return isMultimodalBlock(b) ? `mm-block-${b.id}` : `block-${b.id}`;
}

function ensurePagesMultimodalSlots(pagesArr) {
    if (!Array.isArray(pagesArr)) return;
    for (const p of pagesArr) {
        if (!Array.isArray(p.blocks)) p.blocks = [];
        if (!Array.isArray(p.multimodalBlocks)) p.multimodalBlocks = [];
    }
}

function syncCurrentPageArraysToPages() {
    const p = pages[currentPage];
    if (!p) return;
    p.blocks = blocks;
    p.multimodalBlocks = multimodalBlocks;
}

function getOccupiedMultimodalChannelIds(exceptBlockId) {
    const used = new Set();
    for (const b of multimodalBlocks) {
        if (exceptBlockId != null && b.id === exceptBlockId) continue;
        if (b && b.channel) used.add(b.channel);
    }
    return used;
}

function refreshMultimodalChannelPicker() {
    const sel = document.getElementById('mm-channel-picker');
    if (!sel || !window.SSVEP_MULTIMODAL_CHANNELS) return;
    const occ = getOccupiedMultimodalChannelIds(null);
    const prev = sel.value;
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '选择通道…';
    sel.appendChild(placeholder);
    for (const c of window.SSVEP_MULTIMODAL_CHANNELS) {
        if (occ.has(c.id)) continue;
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.short;
        sel.appendChild(opt);
    }
    if (prev && !occ.has(prev) && [...sel.options].some((o) => o.value === prev)) {
        sel.value = prev;
    }
}

function rerenderAllCanvasBlocks() {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    canvas.innerHTML = '';
    blocks.forEach((block) => renderBlock(block));
    multimodalBlocks.forEach((block) => renderMultimodalBlock(block));
    applyEditorPageCanvasBackground();
}

function addMultimodalBlockFromPicker() {
    const sel = document.getElementById('mm-channel-picker');
    if (!sel || !sel.value) {
        alert('请先选择要绑定的通道');
        return;
    }
    addMultimodalBlock(sel.value);
}

function addMultimodalBlock(channelId) {
    if (!window.ssvepIsMultimodalChannelId || !window.ssvepIsMultimodalChannelId(channelId)) return;
    const occ = getOccupiedMultimodalChannelIds(null);
    if (occ.has(channelId)) {
        alert('该通道在本页已被使用');
        return;
    }
    pushUndoSnapshot();
    const canvas = document.getElementById('canvas');
    const canvasRect = canvas.getBoundingClientRect();
    const meta = window.SSVEP_MULTIMODAL_BY_ID && window.SSVEP_MULTIMODAL_BY_ID[channelId];
    const id = blockIdCounter++;
    const isMotion = meta && meta.role === 'motor_imagery';
    const block = {
        id,
        channel: channelId,
        physicalChannel:
            typeof window.ssvepDefaultPhysicalChannelForSlot === 'function'
                ? window.ssvepDefaultPhysicalChannelForSlot(channelId)
                : null,
        triggerType: isMotion ? 'hold' : 'edge',
        emgWindowSec: 1.0,
        motionWindowSec: 1.0,
        peakWindowSec: 0.6,
        peakThresholdUv: 50,
        peakMaxUv: 200,
        minBinFraction: 0.4,
        normGate: 0.8,
        driveTriggerLevel: 0.85,
        manualThresholdsEnabled: false,
        manualUpperThresholdUv: 25,
        manualLowerThresholdUv: 6,
        holdDurationMs: 600,
        edgeJumpUv: 50,
        edgeWindowMs: 80,
        edgePolarity: 'rise',
        eogDetectMode: 'pulse',
        pulseOnsetUv: 45,
        pulseRecoverRatio: 0.35,
        pulseMaxMs: 420,
        pulseMinMs: 40,
        baselineTauSec: 1.5,
        refractoryMs: 350,
        holdRepeatMs: 0,
        x: Math.random() * Math.max(80, canvasRect.width - 220) + 40,
        y: Math.random() * Math.max(80, canvasRect.height - 180) + 40,
        width: 130,
        height: 100,
        label: meta ? meta.short : channelId,
        actions: [emptyEditorAction()]
    };
    normalizeMultimodalBlockInEditor(block);
    multimodalBlocks.push(block);
    syncCurrentPageArraysToPages();
    renderMultimodalBlock(block);
    selectBlock(block);
    refreshMultimodalChannelPicker();
    markEditorDirty();
    saveToLocalStorage();
}

function formatMultimodalBlockCanvasHtml(block) {
    const meta = window.SSVEP_MULTIMODAL_BY_ID && window.SSVEP_MULTIMODAL_BY_ID[block.channel];
    const short = meta ? meta.short : block.channel;
    const ch =
        block.physicalChannel != null && Number.isFinite(Number(block.physicalChannel))
            ? ` · Ch${Number(block.physicalChannel) + 1}`
            : '';
    return `<span style="font-weight:700;font-size:12px;">${escapeHtml(short)}${escapeHtml(ch)}</span>`;
}

function renderMultimodalBlock(block) {
    normalizeMultimodalBlockInEditor(block);
    const canvas = document.getElementById('canvas');
    const blockEl = document.createElement('div');
    blockEl.className = 'block block-multimodal';
    blockEl.id = blockDomId(block);
    blockEl.style.left = block.x + 'px';
    blockEl.style.top = block.y + 'px';
    blockEl.style.width = block.width + 'px';
    blockEl.style.height = block.height + 'px';
    blockEl.innerHTML = formatMultimodalBlockCanvasHtml(block);

    blockEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectBlock(block);
    });

    blockEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        preDragSnapshotJson = getEditorStateSnapshot();
        dragStartPointer = { x: e.clientX, y: e.clientY };
        dragStartBlockPos = { x: block.x, y: block.y };
        draggedBlock = block;
        const rect = blockEl.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        blockEl.classList.add('dragging');
    });

    canvas.appendChild(blockEl);
}

/**
 * 修正跨页重复的 block.id，并同步 blockIdCounter。
 * 加载旧项目后若继续添加对象，计数器未递增会产生重复 DOM id（如多个 #block-0），拖拽会错位。
 */
function dedupeBlockIdsAndSyncCounter() {
    const seen = new Set();
    let maxId = -1;
    for (const p of pages) {
        const both = [...(p.blocks || []), ...(p.multimodalBlocks || [])];
        for (const b of both) {
            let id = typeof b.id === 'number' && Number.isFinite(b.id) ? Math.floor(b.id) : NaN;
            if (!Number.isFinite(id) || id < 0 || seen.has(id)) {
                id = maxId + 1;
                while (seen.has(id)) id++;
                b.id = id;
            }
            seen.add(b.id);
            maxId = Math.max(maxId, b.id);
        }
    }
    blockIdCounter = maxId + 1;
}

function getEditorStateSnapshot() {
    syncCurrentPageArraysToPages();
    return JSON.stringify({
        pages: JSON.parse(JSON.stringify(pages)),
        currentPage,
        blockIdCounter
    });
}

function applyEditorStateSnapshot(jsonStr) {
    stopKeyboardRecording(false);
    const s = JSON.parse(jsonStr);
    pages = s.pages;
    ensurePagesMultimodalSlots(pages);
    currentPage = s.currentPage;
    blockIdCounter = typeof s.blockIdCounter === 'number' ? s.blockIdCounter : 0;
    blocks = pages[currentPage] ? pages[currentPage].blocks || [] : [];
    multimodalBlocks = pages[currentPage] ? pages[currentPage].multimodalBlocks || [] : [];
    dedupeBlockIdsAndSyncCounter();
    ensureProjectPagesActionsNormalized(pages);
    rerenderAllCanvasBlocks();
    renderPageTabs();
    refreshMultimodalChannelPicker();
    deselectBlock();
    markEditorDirty();
    saveToLocalStorage();
}

function pushUndoSnapshot() {
    undoStack.push(getEditorStateSnapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
}

function undoEditor() {
    if (undoStack.length === 0) return;
    const current = getEditorStateSnapshot();
    const prev = undoStack.pop();
    redoStack.push(current);
    applyEditorStateSnapshot(prev);
}

function redoEditor() {
    if (redoStack.length === 0) return;
    const current = getEditorStateSnapshot();
    const next = redoStack.pop();
    undoStack.push(current);
    applyEditorStateSnapshot(next);
}

function clearUndoRedoStacks() {
    undoStack = [];
    redoStack = [];
}

function maybePushUndoForPropertyChange() {
    if (propertyUndoDebounceTimer) return;
    pushUndoSnapshot();
    propertyUndoDebounceTimer = setTimeout(() => {
        propertyUndoDebounceTimer = null;
    }, 480);
}

function markEditorDirty() {
    editorDirty = true;
}

function clearEditorDirty() {
    editorDirty = false;
}

function shouldPromptBeforeLeaveEditor() {
    return editorDirty;
}

/** 供右下角设备状态条等跳转前询问是否保存（返回 false 表示已拦截，由页面弹窗处理） */
function ssvepBeforeNavigate(href) {
    if (!shouldPromptBeforeLeaveEditor()) return true;
    openExitConfirmModal(href);
    return false;
}
window.ssvepBeforeNavigate = ssvepBeforeNavigate;
window.shouldPromptBeforeLeaveEditor = shouldPromptBeforeLeaveEditor;
window.openExitConfirmModal = openExitConfirmModal;

function snapshotBlockForClipboard(block) {
    return JSON.parse(JSON.stringify(block));
}

function copySelectedBlockToClipboard() {
    if (!selectedBlock) return;
    internalClipboardBlockData = snapshotBlockForClipboard(selectedBlock);
}

function pasteBlockFromClipboard() {
    if (!internalClipboardBlockData) return;
    const canvas = document.getElementById('canvas');
    if (!canvas) return;

    const block = JSON.parse(JSON.stringify(internalClipboardBlockData));
    const id = blockIdCounter++;
    const canvasRect = canvas.getBoundingClientRect();
    const w = Number(block.width) || 150;
    const h = Number(block.height) || 150;
    let nx = Number(block.x) + 24;
    let ny = Number(block.y) + 24;
    nx = Math.max(0, Math.min(nx, canvasRect.width - w));
    ny = Math.max(0, Math.min(ny, canvasRect.height - h));

    let label = typeof block.label === 'string' ? block.label.trim() : '';
    if (isMultimodalBlock(block)) {
        const meta = window.SSVEP_MULTIMODAL_BY_ID && window.SSVEP_MULTIMODAL_BY_ID[block.channel];
        label = meta ? meta.short : block.channel;
    } else if (label) {
        label = label.replace(/\s+副本\d*$/, '').trim();
        label = `${label} 副本`;
    } else {
        label = `对象 ${id + 1}`;
    }

    block.id = id;
    block.x = nx;
    block.y = ny;
    block.label = label;
    normalizeBlockActions(block);

    if (isMultimodalBlock(block)) {
        const occ = getOccupiedMultimodalChannelIds(null);
        if (occ.has(block.channel)) {
            const free = (window.SSVEP_MULTIMODAL_CHANNEL_IDS || []).find((cid) => !occ.has(cid));
            if (!free) {
                alert('当前页多模态通道已满，无法粘贴');
                return;
            }
            block.channel = free;
        }
        normalizeMultimodalBlockInEditor(block);
        if (block.triggerType !== 'hold') block.triggerType = 'edge';
        pushUndoSnapshot();
        multimodalBlocks.push(block);
        syncCurrentPageArraysToPages();
        renderMultimodalBlock(block);
        refreshMultimodalChannelPicker();
    } else {
        pushUndoSnapshot();
        let f = normalizeFrequencyHz(block.frequency);
        if (f == null || f < SSVEP_FREQ_MIN_HZ || f > SSVEP_FREQ_MAX_HZ) {
            f = suggestNonConflictingFrequencyHz(blocks);
        }
        if (findFrequencyConflictOnPage(blocks, block.id, f)) {
            f = suggestNonConflictingFrequencyHz(blocks);
        }
        block.frequency = f;
        blocks.push(block);
        syncCurrentPageArraysToPages();
        renderBlock(block);
    }
    selectBlock(block);
    markEditorDirty();
    saveToLocalStorage();
}

function openExitConfirmModal(targetHref) {
    pendingNavigateHref = targetHref;
    const el = document.getElementById('exit-confirm-modal');
    if (el) el.classList.add('open');
}

function closeExitConfirmModal() {
    pendingNavigateHref = null;
    const el = document.getElementById('exit-confirm-modal');
    if (el) el.classList.remove('open');
}

function exitConfirmSave() {
    const href = pendingNavigateHref;
    closeExitConfirmModal();
    if (!href) return;
    saveProject({
        skipPromptIfNamed: true,
        onComplete: (ok) => {
            if (ok) window.location.href = href;
        }
    });
}

function exitConfirmDiscard() {
    const href = pendingNavigateHref;
    if (!href) return;
    localStorage.removeItem('ssvep_project');
    closeExitConfirmModal();
    window.location.href = href;
}

function exitConfirmCancel() {
    closeExitConfirmModal();
}

function stopKeyboardRecording(/** @type {boolean} */ keepPartial) {
    const rec = keyRecording;
    if (rec) {
        window.removeEventListener('keydown', onKeyRecordKeydown, true);
        keyRecording = null;
        document.body.classList.remove('key-recording');
        if (!keepPartial) {
            setKbDisplayRecording(false, rec.blockId, rec.actionIndex);
            const btn = document.getElementById(`kb-record-btn-${rec.blockId}-${rec.actionIndex}`);
            const hint = document.getElementById(`kb-hint-${rec.blockId}-${rec.actionIndex}`);
            if (btn) {
                btn.textContent = '录制快捷键';
                btn.classList.remove('kb-recording-active');
            }
            if (hint) {
                hint.innerHTML =
                    '选择「键盘快捷键」后约半秒内会<strong>自动监听</strong>；也可点此区域或下方按钮。按 Esc 取消。';
            }
        }
    }
}

function onKeyRecordKeydown(e) {
    if (!keyRecording) return;
    if (e.repeat) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stopKeyboardRecording(false);
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (isModifierKeyCode(e.code)) return;

    const chord = chordFromKeyboardEvent(e);
    keyRecording.chords.push(chord);

    const hint = document.getElementById(`kb-hint-${keyRecording.blockId}-${keyRecording.actionIndex}`);
    const needSecond = keyRecording.twoPart && keyRecording.chords.length < 2;
    if (needSecond) {
        if (hint) hint.textContent = '请按下第二段组合键（VS Code 式双段），或按 Esc 取消';
        return;
    }

    const blockId = keyRecording.blockId;
    const actionIndex = keyRecording.actionIndex;
    const chords = keyRecording.chords.slice();
    stopKeyboardRecording(false);

    const block = getBlockById(blockId);
    if (!block) return;
    normalizeBlockActions(block);
    const act = block.actions[actionIndex];
    if (!act || act.type !== 'keyboard') return;

    act.content = serializeKeyboardBinding(chords);
    block.action = block.actions[0];
    markEditorDirty();
    saveToLocalStorage();

    const disp = document.getElementById(`kb-display-${blockId}-${actionIndex}`);
    if (disp) {
        disp.textContent = formatKeyboardBindingDisplay(parseKeyboardBinding(act.content));
    }
}

function toggleKeyboardRecordingFor(actionIndex) {
    if (!selectedBlock) return;
    normalizeBlockActions(selectedBlock);
    const act = selectedBlock.actions[actionIndex];
    if (!act || act.type !== 'keyboard') return;

    const bid = selectedBlock.id;
    if (keyRecording && keyRecording.blockId === bid && keyRecording.actionIndex === actionIndex) {
        stopKeyboardRecording(false);
        return;
    }

    if (keyRecording) stopKeyboardRecording(false);

    const twoPartEl = document.getElementById(`kb-two-part-${bid}-${actionIndex}`);
    const twoPart = !!(twoPartEl && twoPartEl.checked);

    keyRecording = {
        blockId: bid,
        actionIndex,
        twoPart,
        chords: []
    };
    window.addEventListener('keydown', onKeyRecordKeydown, true);
    document.body.classList.add('key-recording');
    setKbDisplayRecording(true, bid, actionIndex);

    const btn = document.getElementById(`kb-record-btn-${bid}-${actionIndex}`);
    const hint = document.getElementById(`kb-hint-${bid}-${actionIndex}`);
    if (btn) {
        btn.textContent = '停止录制';
        btn.classList.add('kb-recording-active');
    }
    if (hint) {
        hint.textContent = twoPart
            ? '请按下第一段组合键，然后第二段（或按 Esc 取消）'
            : '请按下组合键（或按 Esc 取消）';
    }
}

function clearKeyboardBindingFor(actionIndex) {
    if (!selectedBlock) return;
    normalizeBlockActions(selectedBlock);
    const act = selectedBlock.actions[actionIndex];
    if (!act || act.type !== 'keyboard') return;
    if (keyRecording && keyRecording.blockId === selectedBlock.id && keyRecording.actionIndex === actionIndex) {
        stopKeyboardRecording(false);
    }
    maybePushUndoForPropertyChange();
    act.content = '';
    selectedBlock.action = selectedBlock.actions[0];
    markEditorDirty();
    saveToLocalStorage();
    const disp = document.getElementById(`kb-display-${selectedBlock.id}-${actionIndex}`);
    if (disp) disp.textContent = formatKeyboardBindingDisplay(null);
}

function getPythonGlobalEditorEl() {
    return document.getElementById('python-global-editor');
}

function refreshPythonGlobalSummary(project) {
    const el = document.getElementById('python-global-summary');
    if (!el) return;
    const code = getProjectPythonGlobalCode(project || readStoredProjectShell());
    const lines = code ? code.split('\n').filter((l) => l.trim()).length : 0;
    const chars = code ? code.length : 0;
    if (!lines) {
        el.textContent = '尚未配置全局代码';
        return;
    }
    el.textContent = `已配置 ${lines} 行（${chars} 字符）· 点击「打开 Python 全局编辑器」编辑`;
}

function openPythonGlobalEditorModal() {
    const modal = document.getElementById('python-global-modal');
    const editor = getPythonGlobalEditorEl();
    if (!modal || !editor) return;
    editor.value = getProjectPythonGlobalCode();
    modal.classList.add('open');
    setTimeout(() => editor.focus(), 80);
}

function closePythonGlobalEditorModal() {
    document.getElementById('python-global-modal')?.classList.remove('open');
}

function saveAndClosePythonGlobalEditorModal() {
    onPythonGlobalChange();
    markEditorDirty();
    refreshPythonGlobalSummary();
    closePythonGlobalEditorModal();
}

const PYTHON_GLOBAL_EXAMPLES = {
    hello: '# 最简单：验证 Python 调度是否通\nprint("SSVEP Python 调度 OK")',
    beep: '# Windows 蜂鸣（无需第三方库）\nimport winsound\nwinsound.Beep(880, 300)\nprint("蜂鸣已播放")',
    tello:
        'from djitellopy import Tello\nimport time\n\n' +
        '# 电脑须先连 Tello 热点 TELLO-XXXXXX（与 9_cca_withoutvideo.py 相同流程）\n' +
        'tello = Tello()\n' +
        'tello.connect()\n' +
        'tello.set_speed(10)\n' +
        'print("Tello 已连接, 电池:", tello.get_battery(), "%, 高度:", tello.get_height(), "cm")'
};

const PYTHON_ACTION_TEMPLATES = {
    takeoff:
        'import time\n' +
        'print("发送 takeoff…")\n' +
        'tello.takeoff()\n' +
        'time.sleep(3)\n' +
        'print("takeoff 完成, 高度:", tello.get_height(), "cm")',
    move_up:
        'import time\n' +
        'print("当前高度:", tello.get_height(), "cm")\n' +
        'tello.move_up(50)\n' +
        'time.sleep(2)\n' +
        'print("上升后高度:", tello.get_height(), "cm")',
    land:
        'import time\n' +
        'print("发送 land…")\n' +
        'tello.land()\n' +
        'time.sleep(2)\n' +
        'print("降落完成")'
};

function insertPythonActionTemplate(actionIndex, key) {
    if (!selectedBlock) return;
    const sample = PYTHON_ACTION_TEMPLATES[key];
    if (!sample) return;
    normalizeBlockActions(selectedBlock);
    if (!selectedBlock.actions[actionIndex]) return;
    if (selectedBlock.actions[actionIndex].content && selectedBlock.actions[actionIndex].content.trim()) {
        if (!confirm('将替换当前动作 Python 代码，是否继续？')) return;
    }
    maybePushUndoForPropertyChange();
    selectedBlock.actions[actionIndex].content = sample;
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
    updatePropertiesPanel();
}

function insertPythonGlobalExample(key) {
    const editor = getPythonGlobalEditorEl();
    if (!editor) return;
    const sample = PYTHON_GLOBAL_EXAMPLES[key];
    if (!sample) return;
    if (editor.value.trim() && !confirm('将替换当前全局代码，是否继续？')) return;
    editor.value = sample;
    onPythonGlobalChange();
    editor.focus();
}

/** Python 编译检查进行中状态 */
const pythonCompileState = {
    inProgress: false,
    abortController: null,
    progressTimer: null
};

function isPythonCompileInProgress() {
    return !!pythonCompileState.inProgress;
}

function setPythonCompileUiBusy(busy) {
    pythonCompileState.inProgress = busy;
    const runBtn = document.getElementById('btn-editor-run-stimulus');
    const compileBtn = document.getElementById('btn-python-compile');
    if (runBtn) {
        runBtn.disabled = busy;
        runBtn.classList.toggle('btn-disabled', busy);
    }
    if (compileBtn) {
        compileBtn.disabled = busy;
        compileBtn.classList.toggle('btn-disabled', busy);
    }
}

function setPythonCompileProgress(percent, statusText) {
    const bar = document.getElementById('python-compile-progress-bar');
    const pct = document.getElementById('python-compile-percent');
    const status = document.getElementById('python-compile-status');
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    if (bar) bar.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
    if (status && statusText) status.textContent = statusText;
}

function resetPythonCompileModalUi() {
    setPythonCompileProgress(0, '准备中…');
    const result = document.getElementById('python-compile-result');
    if (result) {
        result.className = '';
        result.textContent = '';
        result.style.display = 'none';
    }
    const stopBtn = document.getElementById('python-compile-stop-btn');
    const closeBtn = document.getElementById('python-compile-close-btn');
    if (stopBtn) stopBtn.style.display = '';
    if (closeBtn) closeBtn.style.display = 'none';
}

function openPythonCompileModal() {
    resetPythonCompileModalUi();
    document.getElementById('python-compile-modal')?.classList.add('open');
}

function closePythonCompileModal() {
    if (pythonCompileState.progressTimer) {
        clearInterval(pythonCompileState.progressTimer);
        pythonCompileState.progressTimer = null;
    }
    document.getElementById('python-compile-modal')?.classList.remove('open');
    setPythonCompileUiBusy(false);
    pythonCompileState.abortController = null;
}

function finishPythonCompileModal(success, message) {
    if (pythonCompileState.progressTimer) {
        clearInterval(pythonCompileState.progressTimer);
        pythonCompileState.progressTimer = null;
    }
    setPythonCompileProgress(100, success ? '检查完成' : '检查结束');
    const result = document.getElementById('python-compile-result');
    const stopBtn = document.getElementById('python-compile-stop-btn');
    const closeBtn = document.getElementById('python-compile-close-btn');
    if (result) {
        result.style.display = 'block';
        result.className = success ? 'success' : 'error';
        result.textContent = message;
    }
    if (stopBtn) stopBtn.style.display = 'none';
    if (closeBtn) closeBtn.style.display = '';
    setPythonCompileUiBusy(false);
    pythonCompileState.abortController = null;
}

function stopPythonCompile() {
    if (pythonCompileState.abortController) {
        pythonCompileState.abortController.abort();
    }
    if (pythonCompileState.progressTimer) {
        clearInterval(pythonCompileState.progressTimer);
        pythonCompileState.progressTimer = null;
    }
    finishPythonCompileModal(false, '已停止编译检查。');
}

function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function editorSelectActionSlot(actionIndex) {
    if (!selectedBlock) return;
    selectedActionIndex = actionIndex;
    highlightSelectedActionSlot();
}

function toggleAdvancedFeatures() {
    const shell = readStoredProjectShell();
    const settings = getProjectSettings(shell);
    settings.advancedFeaturesOpen = !settings.advancedFeaturesOpen;
    persistProjectShellPatch({ settings });
    applyEditorSettingsToUi({ ...shell, settings });
}

function highlightSelectedActionSlot() {
    const panel = document.getElementById('properties-panel');
    if (!panel) return;
    panel.querySelectorAll('.editor-action-slot').forEach((el, i) => {
        el.classList.toggle('editor-action-slot-active', i === selectedActionIndex);
    });
}

let pythonGlobalInputTimer = null;
function onPythonGlobalInput() {
    if (pythonGlobalInputTimer) clearTimeout(pythonGlobalInputTimer);
    pythonGlobalInputTimer = setTimeout(onPythonGlobalChange, 400);
}

function onPythonGlobalChange() {
    const editor = getPythonGlobalEditorEl();
    if (!editor) return;
    const code = editor.value || '';
    const shell = readStoredProjectShell();
    const settings = {
        ...getProjectSettings(shell),
        pythonGlobalCode: code,
        pythonImports: normalizePythonImportsList(
            code.split('\n').filter((line) => {
                const t = line.trim();
                return t && !t.startsWith('#') && (t.startsWith('import ') || t.startsWith('from '));
            })
        )
    };
    persistProjectShellPatch({ settings });
    refreshPythonGlobalSummary({ settings });
}

function collectEditorPythonSnippets() {
    syncCurrentPageArraysToPages();
    const snippets = [];
    for (const page of pages || []) {
        const allBlocks = [...(page.blocks || []), ...(page.multimodalBlocks || [])];
        for (const block of allBlocks) {
            normalizeBlockActions(block);
            (block.actions || []).forEach((action, idx) => {
                if (action && action.type === 'python' && String(action.content || '').trim()) {
                    snippets.push({
                        code: String(action.content || ''),
                        label: `${page.name || 'Page'} / ${block.label || `对象${block.id}`} / 动作${idx + 1}`
                    });
                }
            });
        }
    }
    return snippets;
}

async function compileProjectPythonCode() {
    if (isPythonCompileInProgress()) return;

    onPythonGlobalChange();
    const editor = getPythonGlobalEditorEl();
    const globalCode = editor ? editor.value || '' : getProjectPythonGlobalCode();
    const snippets = collectEditorPythonSnippets();
    if (!globalCode.trim() && snippets.length === 0) {
        alert('当前没有 Python 全局代码或 Python 动作片段可编译。');
        return;
    }

    setPythonCompileUiBusy(true);
    openPythonCompileModal();

    const abortController = new AbortController();
    pythonCompileState.abortController = abortController;

    let visualProgress = 0;
    const stageTexts = [
        '同步全局代码…',
        '检查语法…',
        '静态分析全局代码（不连机、不执行 connect）…',
        '检查各动作片段…',
        '等待后端响应…'
    ];
    let stageIdx = 0;
    setPythonCompileProgress(5, stageTexts[0]);

    pythonCompileState.progressTimer = setInterval(() => {
        if (visualProgress < 88) {
            visualProgress += visualProgress < 40 ? 4 : 2;
            if (visualProgress > 20 && stageIdx < 1) stageIdx = 1;
            if (visualProgress > 38 && stageIdx < 2) stageIdx = 2;
            if (visualProgress > 58 && stageIdx < 3) stageIdx = 3;
            if (visualProgress > 72 && stageIdx < 4) stageIdx = 4;
            setPythonCompileProgress(visualProgress, stageTexts[stageIdx]);
        }
    }, 180);

    const origin = typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
    try {
        await sleepMs(120);
        if (abortController.signal.aborted) return;

        const res = await fetch(`${origin}/api/system/python/compile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ global_code: globalCode, snippets }),
            signal: abortController.signal
        });
        const payload = await res.json().catch(() => null);
        if (abortController.signal.aborted) return;

        if (!res.ok || !payload || payload.success === false) {
            const detail = payload && payload.detail ? payload.detail : `HTTP ${res.status}`;
            throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
        }

        const issues = Array.isArray(payload.issues) ? payload.issues : [];
        const errors = issues.filter((it) => it.severity === 'error');
        const warnings = issues.filter((it) => it.severity !== 'error');

        if (issues.length === 0) {
            finishPythonCompileModal(
                true,
                `编译检查通过。\n\n已静态检查全局代码与 ${snippets.length} 个 Python 动作片段。\n运行时才会执行 connect 等连机操作。`
            );
            return;
        }

        const lines = issues.map((it, idx) => {
            const sev = it.severity === 'error' ? '错误' : '警告';
            return `${idx + 1}. [${sev}] ${it.label || ''}\n   ${it.message || ''}`;
        });
        const summary =
            errors.length > 0
                ? `发现 ${errors.length} 个错误${warnings.length ? `、${warnings.length} 个警告` : ''}：\n\n${lines.join('\n\n')}`
                : `发现 ${warnings.length} 个警告：\n\n${lines.join('\n\n')}`;
        finishPythonCompileModal(errors.length === 0, summary);
    } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error(err);
        finishPythonCompileModal(
            false,
            `编译检查失败：${err.message || String(err)}\n\n请确认 Python 后端已启动。`
        );
    }
}

function editorSyncLegacyAction(block) {
    if (block && Array.isArray(block.actions) && block.actions.length) {
        block.action = block.actions[0];
    }
}

function editorSetActionType(actionIndex, type) {
    if (!selectedBlock) return;
    if (isMultimodalBlock(selectedBlock) && (type === 'confirm_ssvep' || type === 'cancel_ssvep')) return;
    normalizeBlockActions(selectedBlock);
    if (!selectedBlock.actions[actionIndex]) return;
    if (keyRecording && keyRecording.blockId === selectedBlock.id && keyRecording.actionIndex === actionIndex) {
        stopKeyboardRecording(false);
    }
    pushUndoSnapshot();
    const defaultContent =
        type === 'physical_device' || type === 'iot_platform'
            ? createDefaultPhysicalDeviceActionContent(type)
            : '';
    selectedBlock.actions[actionIndex] = {
        type,
        content: defaultContent,
        targetPage: null,
        delayMs: type === 'page_link' ? PAGE_LINK_DEFAULT_DELAY_MS : 0
    };
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
    editorSelectActionSlot(actionIndex);
    updatePropertiesPanel();
    if (type === 'keyboard') {
        setTimeout(() => {
            if (
                selectedBlock &&
                selectedBlock.actions[actionIndex] &&
                selectedBlock.actions[actionIndex].type === 'keyboard' &&
                !keyRecording
            ) {
                toggleKeyboardRecordingFor(actionIndex);
            }
        }, 350);
    }
}

function editorAddActionSlot() {
    if (!selectedBlock) return;
    if (
        isMultimodalBlock(selectedBlock) &&
        ((typeof window.ssvepBlockHasConfirmSsvepAction === 'function' &&
            window.ssvepBlockHasConfirmSsvepAction(selectedBlock)) ||
            (typeof window.ssvepBlockHasCancelSsvepAction === 'function' &&
                window.ssvepBlockHasCancelSsvepAction(selectedBlock)))
    ) {
        return;
    }
    normalizeBlockActions(selectedBlock);
    pushUndoSnapshot();
    selectedBlock.actions.push(emptyEditorAction());
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
    updatePropertiesPanel();
}

function editorRemoveActionSlot(actionIndex) {
    if (!selectedBlock) return;
    normalizeBlockActions(selectedBlock);
    if (selectedBlock.actions.length <= 1) {
        alert('至少保留一条动作；可将类型改为「无动作」。');
        return;
    }
    if (keyRecording && keyRecording.blockId === selectedBlock.id && keyRecording.actionIndex === actionIndex) {
        stopKeyboardRecording(false);
    }
    pushUndoSnapshot();
    selectedBlock.actions.splice(actionIndex, 1);
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
    updatePropertiesPanel();
}

function editorMoveActionSlot(actionIndex, delta) {
    if (!selectedBlock || (delta !== 1 && delta !== -1)) return;
    normalizeBlockActions(selectedBlock);
    const j = actionIndex + delta;
    if (j < 0 || j >= selectedBlock.actions.length) return;
    if (
        keyRecording &&
        keyRecording.blockId === selectedBlock.id &&
        (keyRecording.actionIndex === actionIndex || keyRecording.actionIndex === j)
    ) {
        stopKeyboardRecording(false);
    }
    pushUndoSnapshot();
    const tmp = selectedBlock.actions[actionIndex];
    selectedBlock.actions[actionIndex] = selectedBlock.actions[j];
    selectedBlock.actions[j] = tmp;
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
    updatePropertiesPanel();
}

function editorUpdateActionContent(actionIndex, value) {
    if (!selectedBlock) return;
    normalizeBlockActions(selectedBlock);
    maybePushUndoForPropertyChange();
    if (!selectedBlock.actions[actionIndex]) return;
    selectedBlock.actions[actionIndex].content = value;
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
}

function editorUpdateActionTargetPage(actionIndex, raw) {
    if (!selectedBlock) return;
    normalizeBlockActions(selectedBlock);
    maybePushUndoForPropertyChange();
    const v = raw === '' || raw == null ? null : parseInt(raw, 10);
    selectedBlock.actions[actionIndex].targetPage = Number.isFinite(v) ? v : null;
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
}

function editorUpdateActionDelayMs(actionIndex, raw) {
    if (!selectedBlock) return;
    normalizeBlockActions(selectedBlock);
    maybePushUndoForPropertyChange();
    const v = raw == null || raw === '' ? 0 : parseInt(String(raw), 10);
    selectedBlock.actions[actionIndex].delayMs = Number.isFinite(v) ? Math.max(0, v) : 0;
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
}

function getEditorPhysicalDevices() {
    try {
        const list = JSON.parse(localStorage.getItem('seekbci_physical_devices') || '[]');
        return Array.isArray(list) ? list : [];
    } catch (_) {
        return [];
    }
}

function createDefaultPhysicalDeviceActionContent(type) {
    const devices = getEditorPhysicalDevices().filter((d) =>
        type === 'physical_device' ? d.protocol === 'ble_seekphy' : d.protocol !== 'ble_seekphy'
    );
    const dev = devices[0] || null;
    if (!dev) return '';
    const firstAction = Array.isArray(dev.actions) && dev.actions[0] ? dev.actions[0] : null;
    const action = firstAction ? firstAction.id || firstAction.action || '' : '';
    return JSON.stringify({
        deviceId: dev.deviceId || '',
        physicalId: dev.physicalId || '',
        deviceName: dev.name || dev.alias || '',
        action,
        actionLabel: firstAction ? firstAction.label || action : action,
        raw: firstAction && firstAction.raw ? firstAction.raw : undefined
    });
}

function parseEditorDeviceActionContent(raw) {
    try {
        const obj = JSON.parse(String(raw || '{}'));
        return obj && typeof obj === 'object' ? obj : {};
    } catch (_) {
        return {};
    }
}

function updatePhysicalDeviceActionBinding(actionIndex, field, value) {
    if (!selectedBlock) return;
    normalizeBlockActions(selectedBlock);
    const act = selectedBlock.actions[actionIndex];
    if (!act) return;
    maybePushUndoForPropertyChange();
    const payload = parseEditorDeviceActionContent(act.content);
    payload[field] = value;
    if (field === 'deviceId') {
        const dev = getEditorPhysicalDevices().find((d) => d.deviceId === value);
        payload.physicalId = dev && dev.physicalId ? dev.physicalId : '';
        payload.deviceName = dev && dev.name ? dev.name : '';
        const firstAction = dev && Array.isArray(dev.actions) && dev.actions[0] ? dev.actions[0] : null;
        payload.action = firstAction ? firstAction.id || firstAction.action || '' : '';
        payload.actionLabel = firstAction ? firstAction.label || firstAction.id || '' : '';
    }
    if (field === 'action') {
        const dev = getEditorPhysicalDevices().find((d) => d.deviceId === payload.deviceId);
        const item = dev && Array.isArray(dev.actions) ? dev.actions.find((a) => (a.id || a.action) === value) : null;
        payload.actionLabel = item ? item.label || item.id || item.action || value : value;
        if (item && item.raw) payload.raw = item.raw;
    }
    act.content = JSON.stringify(payload);
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
    updatePropertiesPanel();
}

function buildActionDetailHtml(block, actionIndex, isMultimodal) {
    const act = block.actions[actionIndex];
    if (!act) return '';
    const bid = block.id;
    const i = actionIndex;
    if (act.type === 'python') {
        return `
            <div class="property-group" style="margin-top:8px;">
                <label class="property-label">Python代码</label>
                <p style="font-size:11px;color:#888;line-height:1.45;margin:0 0 6px 0;">与 <code style="color:#888;">9_cca</code> 脚本相同：全局里 connect+set_speed；动作里写 takeoff/move_up。须先 takeoff 再 move_up。</p>
                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">
                    <button type="button" class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="insertPythonActionTemplate(${i}, 'takeoff')">插入：起飞</button>
                    <button type="button" class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="insertPythonActionTemplate(${i}, 'move_up')">插入：上升50cm</button>
                    <button type="button" class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="insertPythonActionTemplate(${i}, 'land')">插入：降落</button>
                </div>
                <textarea class="property-input" rows="4" placeholder="例如: tello.takeoff()"
                          onfocus="editorSelectActionSlot(${i})"
                          onchange="editorUpdateActionContent(${i}, this.value)">${escapeHtml(act.content || '')}</textarea>
            </div>`;
    }
    if (act.type === 'keyboard') {
        const displayText = formatKeyboardBindingDisplay(parseKeyboardBinding(act.content));
        const recordingThis =
            keyRecording && keyRecording.blockId === bid && keyRecording.actionIndex === i;
        return `
            <div class="property-group" style="margin-top:8px;">
                <label class="property-label">快捷键（按物理键录入，勿在此打字）</label>
                <label class="kb-checkbox-row">
                    <input type="checkbox" id="kb-two-part-${bid}-${i}">
                    <span>双段组合（先按第一段、再按第二段，类似 VS Code）</span>
                </label>
                <div class="kb-display${recordingThis ? ' kb-recording-active' : ''}" id="kb-display-${bid}-${i}"
                     role="button" tabindex="0"
                     onclick="toggleKeyboardRecordingFor(${i})"
                     onkeydown="if(event.key==='Enter'||event.code==='Space'){event.preventDefault();toggleKeyboardRecordingFor(${i});}"
                     title="点击开始/停止录制；选择本动作约 0.35 秒后自动开始监听按键">${escapeHtml(displayText)}</div>
                <p class="kb-hint" id="kb-hint-${bid}-${i}">选择「键盘快捷键」后约半秒内会<strong>自动监听</strong>；也可点此区域或下方按钮。按 Esc 取消。</p>
                <div class="kb-actions">
                    <button type="button" class="kb-btn" id="kb-record-btn-${bid}-${i}" onclick="toggleKeyboardRecordingFor(${i})">${
            recordingThis ? '停止录制' : '录制快捷键'
        }</button>
                    <button type="button" class="kb-btn kb-btn-secondary" onclick="clearKeyboardBindingFor(${i})">清除</button>
                </div>
            </div>`;
    }
    if (act.type === 'physical_device' || act.type === 'iot_platform') {
        const devices = getEditorPhysicalDevices().filter((d) =>
            act.type === 'physical_device' ? d.protocol === 'ble_seekphy' : d.protocol !== 'ble_seekphy'
        );
        const payload = parseEditorDeviceActionContent(act.content);
        const selectedDeviceId = payload.deviceId || (devices[0] && devices[0].deviceId) || '';
        const selectedDevice = devices.find((d) => d.deviceId === selectedDeviceId) || devices[0] || null;
        const actions = selectedDevice && Array.isArray(selectedDevice.actions) ? selectedDevice.actions : [];
        const selectedAction = payload.action || (actions[0] && (actions[0].id || actions[0].action)) || '';
        if (!devices.length) {
            return `
            <div class="property-group" style="margin-top:8px;">
                <label class="property-label">${act.type === 'physical_device' ? '物理设备动作' : '物联网平台动作'}</label>
                <p style="font-size:12px;color:#aaa;line-height:1.6;">暂无可选设备。请先到「设备管理 → 物理世界」绑定 SEEKPHY 设备，或注册非 SEEKPHY 设备。</p>
            </div>`;
        }
        return `
            <div class="property-group" style="margin-top:8px;">
                <label class="property-label">选择设备</label>
                <select class="property-input" onchange="updatePhysicalDeviceActionBinding(${i}, 'deviceId', this.value)">
                    ${devices.map((d) => `<option value="${escapeHtml(d.deviceId || '')}" ${d.deviceId === selectedDeviceId ? 'selected' : ''}>${escapeHtml(d.name || d.alias || d.deviceId || '未命名设备')}</option>`).join('')}
                </select>
            </div>
            <div class="property-group" style="margin-top:8px;">
                <label class="property-label">选择动作</label>
                <select class="property-input" onchange="updatePhysicalDeviceActionBinding(${i}, 'action', this.value)">
                    ${actions.map((a) => {
                        const id = a.id || a.action || '';
                        return `<option value="${escapeHtml(id)}" ${id === selectedAction ? 'selected' : ''}>${escapeHtml(a.label || id)}</option>`;
                    }).join('')}
                </select>
                <p style="font-size:11px;color:#888;line-height:1.45;margin-top:6px;">运行时将按当前设备和动作生成物理世界命令。</p>
            </div>`;
    }

    if (act.type === 'page_link') {
        const rawDelay = Number.isFinite(Number(act.delayMs)) ? Math.max(0, parseInt(String(act.delayMs), 10)) : 0;
        const delayMs = rawDelay > 0 ? rawDelay : PAGE_LINK_DEFAULT_DELAY_MS;
        return `
            <div class="property-group" style="margin-top:8px;">
                <label class="property-label">目标页面</label>
                <select class="property-input" onchange="editorUpdateActionTargetPage(${i}, this.value)">
                    <option value="">选择页面</option>
                    ${pages.map((p, pi) => `
                        <option value="${pi}" ${act.targetPage === pi ? 'selected' : ''}>${escapeHtml(p.name)}</option>
                    `).join('')}
                </select>
            </div>
            <div class="property-group" style="margin-top:8px;">
                <label class="property-label">跳转延迟（毫秒；默认 ${PAGE_LINK_DEFAULT_DELAY_MS}）</label>
                <input type="number" class="property-input" min="0" step="50" value="${delayMs}"
                       onchange="editorUpdateActionDelayMs(${i}, this.value)">
                <p style="font-size:11px;color:#888;line-height:1.45;margin:6px 0 0 0;">识别触发后先橙黄高亮该对象，延迟结束再跳转；默认 ${PAGE_LINK_DEFAULT_DELAY_MS} ms（1 秒）。填 0 也按默认处理。</p>
            </div>`;
    }
    if (act.type === 'mouse_click') {
        const mmHint = isMultimodal
            ? '多模态通道触发时，在<strong>当前系统光标位置</strong>发送左键单击（可与 IMU 光标配合：头动瞄准，通道触发点击）。'
            : '运行刺激时，在本方块<strong>几何中心</strong>发送系统级<strong>左键单击</strong>；后端会<strong>暂移光标并单击后恢复原位置</strong>。';
        return `
            <div class="property-group" style="margin-top:8px;">
                <p style="font-size:12px;color:#aaa;line-height:1.55;">
                    ${mmHint}<br><br>
                    单击触发频率限制更短（约 <strong>0.35 秒</strong>），用于配合双击/多步操作。<br><br>
                    须开启<strong>系统选项</strong>并安装 <code style="color:#888;">pynput</code>。
                </p>
            </div>`;
    }
    if (act.type === 'mouse_double_click') {
        const mmHint = isMultimodal
            ? '多模态通道触发时，在<strong>当前系统光标位置</strong>发送左键双击（可与 IMU 光标配合）。'
            : '运行刺激时，在本方块<strong>几何中心</strong>发送系统级<strong>左键双击</strong>；后端会<strong>暂移光标并双击后恢复原位置</strong>。';
        return `
            <div class="property-group" style="margin-top:8px;">
                <p style="font-size:12px;color:#aaa;line-height:1.55;">
                    ${mmHint}<br><br>
                    两次双击之间后端强制间隔约 <strong>1.25 秒</strong>，避免连续触发导致鼠标不可用。<br><br>
                    ${
                        isMultimodal
                            ? ''
                            : '<strong>Electron 桌面壳：</strong>透明区默认<strong>鼠标穿透</strong>，双击会落到下层（如浏览器）；坐标由主进程换算，减少上下偏差。<br><br>'
                    }
                    须开启<strong>系统选项</strong>并安装 <code style="color:#888;">pynput</code>。
                </p>
            </div>`;
    }
    if (act.type === 'mouse_hold') {
        return `
            <div class="property-group" style="margin-top:8px;">
                <p style="font-size:12px;color:#aaa;line-height:1.55;">
                    <strong>连续按住（肌电推荐）</strong>：通道能量<strong>超过驱动阈值时按住</strong>系统左键，
                    <strong>低于阈值（含回滞）时松开</strong>。用于拖拽、长按等连续按压模拟。<br><br>
                    与「鼠标单击」不同：不会点一下就放；只要能量持续超阈就一直按着。<br><br>
                    多模态在<strong>当前系统光标位置</strong>按住（可与 IMU 光标配合）。须开启<strong>系统选项</strong>并安装 <code style="color:#888;">pynput</code>。
                </p>
            </div>`;
    }
    if (act.type === 'mouse_right_click') {
        return `
            <div class="property-group" style="margin-top:8px;">
                <p style="font-size:12px;color:#aaa;line-height:1.55;">
                    在<strong>当前系统光标位置</strong>发送<strong>右键单击</strong>（适合左侧咬肌 EMG 等）。<br><br>
                    须开启<strong>系统选项</strong>、启用 IMU/系统键鼠，并安装 <code style="color:#888;">pynput</code>。
                </p>
            </div>`;
    }
    if (act.type === 'imu_sens_cycle') {
        return `
            <div class="property-group" style="margin-top:8px;">
                <p style="font-size:12px;color:#aaa;line-height:1.55;">
                    循环切换 IMU 光标灵敏度倍率：<strong>0.5× → 1× → 2× → 0.5×</strong>（相对项目「光标灵敏度」基准）。<br><br>
                    触发后屏幕中央短暂显示当前倍率。需已启用项目 <strong>IMU 光标控制</strong>。
                </p>
            </div>`;
    }
    if (act.type === 'cursor_center') {
        return `
            <div class="property-group" style="margin-top:8px;">
                <p style="font-size:12px;color:#aaa;line-height:1.55;">
                    将系统光标移回<strong>主屏正中央</strong>（适合右眼电等）。须开启<strong>系统选项</strong>。
                </p>
            </div>`;
    }
    return '';
}

function buildEditorActionsSectionHtml(block, isMultimodal) {
    normalizeBlockActions(block);
    if (
        isMultimodal &&
        typeof window.ssvepBlockHasConfirmSsvepAction === 'function' &&
        window.ssvepBlockHasConfirmSsvepAction(block)
    ) {
        const confirmMs =
            block.confirmTimeoutMs != null && Number.isFinite(Number(block.confirmTimeoutMs))
                ? Math.max(200, Number(block.confirmTimeoutMs))
                : 1000;
        return `<div class="property-group">
            <label class="property-label">动作</label>
            <label class="kb-checkbox-row" style="display:flex;align-items:flex-start;gap:8px;margin:0 0 8px;cursor:pointer;color:#ccc;">
                <input type="checkbox" checked onchange="editorSetMultimodalConfirmSsvep(this.checked)" style="margin-top:3px;">
                <span><strong>确认 SSVEP 刺激</strong>：SSVEP 识别结果出现后，须本通道触发一次才执行 SSVEP 对象动作。<br><span style="color:#888;font-size:11px;">与「取消 SSVEP 刺激」互斥，勾选后不可与其他动作同时使用。</span></span>
            </label>
            <label class="kb-checkbox-row" style="display:flex;align-items:flex-start;gap:8px;margin:0;cursor:pointer;color:#888;">
                <input type="checkbox" disabled style="margin-top:3px;">
                <span><strong>取消 SSVEP 刺激</strong>（与确认互斥）</span>
            </label>
            <div class="property-group" style="margin-top:12px;">
                <label class="property-label">确认时限（毫秒）</label>
                <input type="number" class="property-input" min="200" step="100" value="${confirmMs}"
                       onchange="updateMultimodalScalar('confirmTimeoutMs', this.value)">
                <p style="font-size:11px;color:#888;line-height:1.45;margin-top:6px;">
                    SSVEP 识别后须在此时间内完成本通道触发，否则跳过本次 SSVEP 动作。可被运行对话框「多模态确认/取消等待」覆盖（取更短值）。
                </p>
            </div>
            <p style="font-size:11px;color:#7ec8e3;margin:10px 0 0;">已启用确认门控；取消勾选后可配置常规多模态动作。</p>
        </div>`;
    }
    if (
        isMultimodal &&
        typeof window.ssvepBlockHasCancelSsvepAction === 'function' &&
        window.ssvepBlockHasCancelSsvepAction(block)
    ) {
        return `<div class="property-group">
            <label class="property-label">动作</label>
            <label class="kb-checkbox-row" style="display:flex;align-items:flex-start;gap:8px;margin:0 0 8px;cursor:pointer;color:#888;">
                <input type="checkbox" disabled style="margin-top:3px;">
                <span><strong>确认 SSVEP 刺激</strong>（与取消互斥）</span>
            </label>
            <label class="kb-checkbox-row" style="display:flex;align-items:flex-start;gap:8px;margin:0;cursor:pointer;color:#ccc;">
                <input type="checkbox" checked onchange="editorSetMultimodalCancelSsvep(this.checked)" style="margin-top:3px;">
                <span><strong>取消 SSVEP 刺激</strong>：SSVEP 识别后，在本通道触发可取消刚识别目标的待执行动作；超时未取消则自动执行。<br><span style="color:#888;font-size:11px;">等待时长在运行刺激对话框「多模态确认/取消等待」中配置（默认 1 s）。与确认互斥。</span></span>
            </label>
            <p style="font-size:11px;color:#7ec8e3;margin:10px 0 0;">已启用取消门控；取消勾选后可配置常规多模态动作。</p>
        </div>`;
    }
    if (isMultimodal) {
        const inner = buildEditorRegularActionsListHtml(block, true);
        return `<div class="property-group">
            <label class="property-label">动作</label>
            <label class="kb-checkbox-row" style="display:flex;align-items:flex-start;gap:8px;margin:0 0 8px;cursor:pointer;color:#ccc;">
                <input type="checkbox" onchange="editorSetMultimodalConfirmSsvep(this.checked)" style="margin-top:3px;">
                <span><strong>确认 SSVEP 刺激</strong>（勾选后不可与其他动作同时使用）</span>
            </label>
            <label class="kb-checkbox-row" style="display:flex;align-items:flex-start;gap:8px;margin:0 0 10px;cursor:pointer;color:#ccc;">
                <input type="checkbox" onchange="editorSetMultimodalCancelSsvep(this.checked)" style="margin-top:3px;">
                <span><strong>取消 SSVEP 刺激</strong>（与确认互斥；识别后触发可取消待执行 SSVEP 动作）</span>
            </label>
            <p style="font-size:11px;color:#888;line-height:1.45;margin:0 0 10px 0;">未勾选确认/取消时，本通道触发将直接执行下列动作。</p>
            ${inner}
        </div>`;
    }
    return buildEditorRegularActionsListHtml(block, false);
}

function buildEditorRegularActionsListHtml(block, isMultimodal) {
    normalizeBlockActions(block);
    const typeOrder = [
        'none',
        'python',
        'keyboard',
        'page_link',
        'physical_device',
        'iot_platform',
        'mouse_click',
        'mouse_double_click',
        'mouse_right_click',
        'mouse_hold',
        'imu_sens_cycle',
        'cursor_center'
    ];
    const labels = {
        none: '无动作',
        python: 'Python动作',
        keyboard: '键盘快捷键',
        page_link: '页面跳转',
        physical_device: '物理设备动作',
        iot_platform: '物联网平台动作',
        mouse_click: '鼠标单击（系统级）',
        mouse_double_click: '鼠标双击（系统级）',
        mouse_right_click: '鼠标右键（当前光标）',
        mouse_hold: '鼠标按住（超阈按下/低于松开）',
        imu_sens_cycle: 'IMU灵敏度循环（0.5×/1×/2×）',
        cursor_center: '光标回屏幕中央'
    };
    let html = isMultimodal
        ? ''
        : `<div class="property-group">
        <label class="property-label">动作（可多项）</label>
        <p style="font-size:11px;color:#888;line-height:1.45;margin:0 0 10px 0;">同一触发内按<strong>列表顺序从上到下</strong>依次执行。至少保留一条（可为「无动作」）。</p>`;
    block.actions.forEach((act, i) => {
        const slotActive = i === selectedActionIndex;
        html += `<div class="editor-action-slot${slotActive ? ' editor-action-slot-active' : ''}" style="border:1px solid #444;border-radius:8px;padding:12px;margin-bottom:10px;background:#1a1a1a;" onfocusin="editorSelectActionSlot(${i})" tabindex="-1">`;
        html += `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">`;
        html += `<strong style="color:#ccc;">动作 ${i + 1}</strong><span style="display:flex;flex-wrap:wrap;gap:4px;">`;
        html += `<button type="button" class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="editorMoveActionSlot(${i},-1)" ${
            i === 0 ? 'disabled' : ''
        }>上移</button>`;
        html += `<button type="button" class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="editorMoveActionSlot(${i},1)" ${
            i === block.actions.length - 1 ? 'disabled' : ''
        }>下移</button>`;
        html += `<button type="button" class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="editorRemoveActionSlot(${i})" ${
            block.actions.length <= 1 ? 'disabled' : ''
        }>删除</button></span></div>`;
        html += `<select class="property-input" style="margin-bottom:4px;" onchange="editorSetActionType(${i}, this.value)" onfocus="editorSelectActionSlot(${i})">`;
        typeOrder.forEach((t) => {
            html += `<option value="${t}" ${act.type === t ? 'selected' : ''}>${labels[t]}</option>`;
        });
        html += `</select>`;
        html += buildActionDetailHtml(block, i, isMultimodal);
        html += `</div>`;
    });
    html += `<button type="button" class="btn btn-secondary" style="margin-top:4px;" onclick="editorAddActionSlot()">＋ 添加动作</button>`;
    if (!isMultimodal) html += `</div>`;
    return html;
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');

    const modal = document.getElementById('exit-confirm-modal');
    document.getElementById('exit-modal-save')?.addEventListener('click', exitConfirmSave);
    document.getElementById('exit-modal-discard')?.addEventListener('click', exitConfirmDiscard);
    document.getElementById('exit-modal-cancel')?.addEventListener('click', exitConfirmCancel);
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) exitConfirmCancel();
    });

    const saveModal = document.getElementById('save-project-modal');
    document.getElementById('save-project-confirm')?.addEventListener('click', confirmSaveProjectNameModal);
    document.getElementById('save-project-cancel')?.addEventListener('click', closeSaveProjectNameModal);
    saveModal?.addEventListener('click', (e) => {
        if (e.target === saveModal) closeSaveProjectNameModal();
    });
    document.getElementById('save-project-name-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            confirmSaveProjectNameModal();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeSaveProjectNameModal();
        }
    });

    window.addEventListener('focus', () => {
        if (selectedBlock && isMultimodalBlock(selectedBlock)) {
            normalizeMultimodalBlockInEditor(selectedBlock);
            refreshMultimodalBlockEl(selectedBlock);
            updatePropertiesPanel();
        }
    });

    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Escape' && modal?.classList.contains('open')) {
                e.preventDefault();
                exitConfirmCancel();
                return;
            }
            if (e.key === 'Escape' && saveModal?.classList.contains('open')) {
                e.preventDefault();
                closeSaveProjectNameModal();
                return;
            }
            if (keyRecording) return;
            const tag = e.target && e.target.tagName;
            const inField =
                tag === 'INPUT' ||
                tag === 'TEXTAREA' ||
                tag === 'SELECT' ||
                (e.target && e.target.isContentEditable);
            if (inField) return;
            if (modal?.classList.contains('open')) return;
            if (saveModal?.classList.contains('open')) return;

            const mod = e.ctrlKey || e.metaKey;

            if (mod && e.code === 'KeyC' && selectedBlock) {
                e.preventDefault();
                copySelectedBlockToClipboard();
                return;
            }
            if (mod && e.code === 'KeyV' && internalClipboardBlockData) {
                e.preventDefault();
                pasteBlockFromClipboard();
                return;
            }
            if ((e.code === 'Delete' || e.code === 'Backspace') && selectedBlock) {
                e.preventDefault();
                deleteBlock();
                return;
            }

            if (e.code === 'Space' && selectedBlock && !isMultimodalBlock(selectedBlock)) {
                e.preventDefault();
                pushUndoSnapshot();
                selectedBlock.rotation = ((Number(selectedBlock.rotation) || 0) + 15) % 360;
                const el = document.getElementById(blockDomId(selectedBlock));
                if (el) applyEditorBlockShapeStyle(el, selectedBlock);
                markEditorDirty();
                saveToLocalStorage();
                updatePropertiesPanel();
                return;
            }

            if (mod && e.code === 'KeyZ' && !e.shiftKey) {
                e.preventDefault();
                undoEditor();
            } else if (mod && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
                e.preventDefault();
                redoEditor();
            }
        },
        true
    );

    // 画布点击事件（取消选择）
    canvas.addEventListener('click', (e) => {
        if (e.target === canvas) {
            deselectBlock();
        }
    });
    
    // 检查是否是创建新项目模式
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'new') {
        // 创建新项目模式：清空画布
        createNewProjectMode();
    } else {
        // 加载本地保存的项目
        loadFromLocalStorage();
    }
    refreshSystemOptionButton();

    const runBackdrop = (id, onBackdrop) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', (e) => {
            if (e.target === el) onBackdrop();
        });
    };
    runBackdrop('run-config-modal', closeRunConfigModal);
    runBackdrop('run-config-modal-threshold', closeRunThresholdParamModal);
    runBackdrop('run-config-modal-interval', closeRunIntervalParamModal);

    refreshMultimodalChannelPicker();
});

// 创建新项目模式
function createNewProjectMode() {
    clearUndoRedoStacks();
    // 清空所有数据
    blocks = [];
    selectedBlock = null;
    blockIdCounter = 0;
    currentPage = 0;
    pages = [{ id: 0, name: 'Page 1', blocks: [], multimodalBlocks: [] }];
    multimodalBlocks = [];

    // 清空画布
    const canvas = document.getElementById('canvas');
    canvas.innerHTML = '';
    applyEditorPageCanvasBackground();

    // 清空localStorage中的当前项目
    localStorage.removeItem('ssvep_project');
    
    // 渲染页面标签
    renderPageTabs();
    refreshMultimodalChannelPicker();

    // 取消选择
    deselectBlock();

    refreshSystemOptionButton();
    clearEditorDirty();
    console.log('新建项目模式：画布已清空');
}

// 返回主页（带保存 / 不保存 / 取消）
function backToHome() {
    if (!shouldPromptBeforeLeaveEditor()) {
        window.location.href = 'index.html';
        return;
    }
    openExitConfirmModal('index.html');
}

// 返回项目管理（与返回主页相同的退出确认）
function backToProjectManager() {
    if (!shouldPromptBeforeLeaveEditor()) {
        window.location.href = 'project-manager.html';
        return;
    }
    openExitConfirmModal('project-manager.html');
}

// 添加对象
function addBlock(shape) {
    pushUndoSnapshot();
    const canvas = document.getElementById('canvas');
    const canvasRect = canvas.getBoundingClientRect();

    const id = blockIdCounter++;
    const block = {
        id,
        shape: shape,
        x: Math.random() * (canvasRect.width - 200) + 100,
        y: Math.random() * (canvasRect.height - 200) + 100,
        width: shape === 'circle' ? 96 : shape === 'hexagon' ? 120 : 110,
        height: shape === 'circle' ? 96 : shape === 'hexagon' ? Math.round(120 * REGULAR_HEX_H_OVER_W) : 110,
        label: `对象 ${id + 1}`,
        frequency: suggestNonConflictingFrequencyHz(blocks),
        phase: PHASES[0],
        color: '#00D9FF',
        rotation: 0,
        actions: [emptyEditorAction()]
    };
    normalizeBlockActions(block);

    blocks.push(block);
    pages[currentPage].blocks = blocks;
    renderBlock(block);
    selectBlock(block);
    
    // 自动保存
    markEditorDirty();
    saveToLocalStorage();
}

function addSsvepKeyboardBlock() {
    const KB = ssvepKb40();
    if (!KB) {
        alert('SSVEP 键盘模块未加载，请刷新页面后重试。');
        return;
    }
    if (KB.countSsvepKeyboardsOnPage(blocks) > 0) {
        alert('当前页已有 SSVEP 键盘，每页仅允许放置一个。');
        return;
    }
    const other = KB.countNonKeyboardSsvepBlocks(blocks);
    if (other > 0) {
        const ok = confirm(
            `当前页还有 ${other} 个其它闪烁对象。\n\n建议键盘专页仅保留键盘（勿与其它 SSVEP 方块同页）。是否仍要添加？`
        );
        if (!ok) return;
    }
    pushUndoSnapshot();
    const canvas = document.getElementById('canvas');
    const canvasRect = canvas.getBoundingClientRect();
    const id = blockIdCounter++;
    const block = KB.createSsvepKeyboardBlockTemplate(id, canvasRect.width, canvasRect.height);
    normalizeBlockActions(block);
    blocks.push(block);
    pages[currentPage].blocks = blocks;
    renderBlock(block);
    selectBlock(block);
    markEditorDirty();
    saveToLocalStorage();
}

function renderEditorKeyboardDom(blockEl, block) {
    const KB = ssvepKb40();
    if (!KB) return;
    let root = blockEl.querySelector('.ssvep-kb-root');
    if (!root) {
        root = document.createElement('div');
        root.className = 'ssvep-kb-root';
        root.style.cssText =
            'display:flex;flex-direction:column;flex:1;width:100%;height:100%;min-height:0;pointer-events:none;';
        blockEl.appendChild(root);
    }
    root.innerHTML = '';
    KB.ensureKeyboardKeyPhases(block);
    const defs = KB.getSsvepKeyboard40KeyDefs(block);
    const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
    for (const row of KB.KB_ROWS) {
        const rowEl = document.createElement('div');
        rowEl.className = 'ssvep-kb-row';
        for (const cell of row) {
            const def = byId[cell.id];
            const keyEl = document.createElement('div');
            const flex = cell.flex != null ? cell.flex : 1;
            keyEl.className = 'ssvep-kb-key' + (flex > 1.2 ? ' ssvep-kb-wide' : '');
            keyEl.style.flex = `${flex} 1 0`;
            keyEl.textContent = def ? def.display : cell.id;
            if (def) {
                keyEl.title = `${def.display} · ${def.frequencyHz.toFixed(2)} Hz · phase ${def.phase.toFixed(2)}`;
            }
            rowEl.appendChild(keyEl);
        }
        root.appendChild(rowEl);
    }
}

function attachEditorResizeHandle(blockEl, block) {
    let handle = blockEl.querySelector('.resize-handle');
    if (handle) handle.remove();
    handle = document.createElement('span');
    handle.className = 'resize-handle';
    handle.title = '拖动改变大小';
    blockEl.appendChild(handle);
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pushUndoSnapshot();
        resizeState = {
            block,
            startX: e.clientX,
            startY: e.clientY,
            startW: Number(block.width) || 100,
            startH: Number(block.height) || 100
        };
    });
}

function setEditorBlockLabel(blockEl, block) {
    if (isSsvepKeyboardBlock(block)) {
        blockEl.textContent = '';
        blockEl.classList.add('block-ssvep-keyboard');
        renderEditorKeyboardDom(blockEl, block);
        attachEditorResizeHandle(blockEl, block);
        return;
    }
    blockEl.classList.remove('block-ssvep-keyboard');
    blockEl.textContent = block.label || '';
    attachEditorResizeHandle(blockEl, block);
}

function applyEditorBlockShapeStyle(blockEl, block) {
    blockEl.classList.remove('block-ssvep-keyboard');
    blockEl.style.borderRadius = '8px';
    blockEl.style.clipPath = 'none';
    if (isSsvepKeyboardBlock(block)) {
        blockEl.classList.add('block-ssvep-keyboard');
        blockEl.style.borderRadius = '10px';
        blockEl.style.clipPath = 'none';
        renderEditorKeyboardDom(blockEl, block);
        return;
    }
    if (block.shape === 'circle') {
        blockEl.style.borderRadius = '50%';
    } else if (block.shape === 'triangle') {
        blockEl.style.borderRadius = '0';
        blockEl.style.clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
    } else if (block.shape === 'hexagon') {
        blockEl.style.borderRadius = '0';
        blockEl.style.clipPath = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
    } else if (block.shape === 'diamond') {
        blockEl.style.borderRadius = '0';
        blockEl.style.clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
    } else if (block.shape === 'pentagon') {
        blockEl.style.borderRadius = '0';
        blockEl.style.clipPath = 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)';
    }
    blockEl.style.transform = `rotate(${Number(block.rotation) || 0}deg)`;
}

// 渲染方块
function renderBlock(block) {
    const canvas = document.getElementById('canvas');
    const blockEl = document.createElement('div');
    blockEl.className = 'block';
    blockEl.id = `block-${block.id}`;
    blockEl.style.left = block.x + 'px';
    blockEl.style.top = block.y + 'px';
    blockEl.style.width = block.width + 'px';
    blockEl.style.height = block.height + 'px';
    if (isSsvepKeyboardBlock(block)) {
        blockEl.style.backgroundColor = 'rgba(0,0,0,0.55)';
    } else {
        blockEl.style.backgroundColor = block.color;
    }
    blockEl.style.transformOrigin = 'center center';
    if (block.rotation == null) block.rotation = 0;
    setEditorBlockLabel(blockEl, block);
    applyEditorBlockShapeStyle(blockEl, block);
    
    // 点击选择
    blockEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectBlock(block);
    });
    
    // 拖拽开始（真正移动后再把按下前的快照入栈，见 mousemove）
    blockEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        preDragSnapshotJson = getEditorStateSnapshot();
        dragStartPointer = { x: e.clientX, y: e.clientY };
        dragStartBlockPos = { x: block.x, y: block.y };
        draggedBlock = block;
        const rect = blockEl.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left;
        dragOffset.y = e.clientY - rect.top;
        blockEl.classList.add('dragging');
    });
    
    canvas.appendChild(blockEl);
}

// 鼠标移动事件（拖拽）
document.addEventListener('mousemove', (e) => {
    if (resizeState) {
        const canvas = document.getElementById('canvas');
        const canvasRect = canvas.getBoundingClientRect();
        const b = resizeState.block;
        const minSize = b.shape === 'circle' ? 24 : 28;
        let nw = resizeState.startW + (e.clientX - resizeState.startX);
        let nh = resizeState.startH + (e.clientY - resizeState.startY);
        nw = Math.max(minSize, Math.min(nw, canvasRect.width - b.x));
        nh = Math.max(minSize, Math.min(nh, canvasRect.height - b.y));
        if (e.shiftKey || b.shape === 'circle' || b.shape === 'pentagon') {
            const s = Math.min(nw, nh);
            nw = s;
            nh = s;
        }
        if (b.shape === 'hexagon') {
            if (e.shiftKey) {
                const s = Math.min(nw, nh / REGULAR_HEX_H_OVER_W);
                nw = s;
                nh = s * REGULAR_HEX_H_OVER_W;
            } else {
                nh = nw * REGULAR_HEX_H_OVER_W;
            }
        }
        b.width = Math.round(nw);
        b.height = Math.round(nh);
        const el = document.getElementById(blockDomId(b));
        if (el) {
            el.style.width = b.width + 'px';
            el.style.height = b.height + 'px';
        }
        if (selectedBlock && selectedBlock.id === b.id) syncPropertiesPanelGeometryFromBlock(b);
        return;
    }

    if (draggedBlock) {
        if (preDragSnapshotJson && dragStartPointer) {
            const dx = e.clientX - dragStartPointer.x;
            const dy = e.clientY - dragStartPointer.y;
            if (dx * dx + dy * dy > 9) {
                undoStack.push(preDragSnapshotJson);
                if (undoStack.length > MAX_UNDO) undoStack.shift();
                redoStack.length = 0;
                preDragSnapshotJson = null;
                dragStartPointer = null;
            }
        }

        const canvas = document.getElementById('canvas');
        const canvasRect = canvas.getBoundingClientRect();
        
        let newX = e.clientX - canvasRect.left - dragOffset.x;
        let newY = e.clientY - canvasRect.top - dragOffset.y;
        
        // 边界限制
        newX = Math.max(0, Math.min(newX, canvasRect.width - draggedBlock.width));
        newY = Math.max(0, Math.min(newY, canvasRect.height - draggedBlock.height));
        
        // 网格对齐（可选）
        const gridSize = 20;
        newX = Math.round(newX / gridSize) * gridSize;
        newY = Math.round(newY / gridSize) * gridSize;
        
        draggedBlock.x = newX;
        draggedBlock.y = newY;

        const blockEl = document.getElementById(blockDomId(draggedBlock));
        if (!blockEl) {
            draggedBlock = null;
            return;
        }
        blockEl.style.left = newX + 'px';
        blockEl.style.top = newY + 'px';
        
        if (selectedBlock && selectedBlock.id === draggedBlock.id) {
            syncPropertiesPanelGeometryFromBlock(draggedBlock);
        }
    }
});

// 鼠标释放事件
document.addEventListener('mouseup', () => {
    if (resizeState) {
        resizeState = null;
        markEditorDirty();
        saveToLocalStorage();
    }
    preDragSnapshotJson = null;
    dragStartPointer = null;
    if (draggedBlock) {
        const moved =
            dragStartBlockPos &&
            (Math.round(draggedBlock.x) !== Math.round(dragStartBlockPos.x) ||
                Math.round(draggedBlock.y) !== Math.round(dragStartBlockPos.y));
        const blockEl = document.getElementById(blockDomId(draggedBlock));
        if (blockEl) blockEl.classList.remove('dragging');
        draggedBlock = null;
        dragStartBlockPos = null;

        if (moved) markEditorDirty();
        // 保存
        saveToLocalStorage();
    }
});

// 选择方块
function selectBlock(block) {
    // 取消之前的选择
    if (selectedBlock) {
        if (selectedBlock.id !== block.id) stopKeyboardRecording(false);
        const prevEl = document.getElementById(blockDomId(selectedBlock));
        if (prevEl) prevEl.classList.remove('selected');
    }

    selectedBlock = block;
    const blockEl = document.getElementById(blockDomId(block));
    blockEl.classList.add('selected');

    normalizeBlockActions(block);
    const pythonIdx = (block.actions || []).findIndex((a) => a && a.type === 'python');
    selectedActionIndex = pythonIdx >= 0 ? pythonIdx : 0;

    updatePropertiesPanel();
}

// 取消选择
function deselectBlock() {
    stopKeyboardRecording(false);
    if (selectedBlock) {
        const blockEl = document.getElementById(blockDomId(selectedBlock));
        if (blockEl) blockEl.classList.remove('selected');
        selectedBlock = null;
    }

    selectedActionIndex = 0;

    document.getElementById('properties-panel').innerHTML = `
        <div class="no-selection">
            <div style="font-size: 48px; margin-bottom: 10px;">👆</div>
            <p>点击画布中的对象<br>查看和编辑属性</p>
        </div>
    `;
}

function buildMultimodalPhysicalChannelOptions(block) {
    const cands =
        typeof window.ssvepListPhysicalCandidatesForSlot === 'function'
            ? window.ssvepListPhysicalCandidatesForSlot(block.channel)
            : [];
    if (!cands.length) {
        return `<option value="">（请先在设备管理将通道设为眼电/运动）</option>`;
    }
    return cands
        .map((c) => {
            const sel = block.physicalChannel === c.index ? 'selected' : '';
            return `<option value="${c.index}" ${sel}>${escapeHtml(c.label)}</option>`;
        })
        .join('');
}

function editorSetMultimodalConfirmSsvep(enabled) {
    if (!selectedBlock || !isMultimodalBlock(selectedBlock)) return;
    if (enabled && typeof window.ssvepBlockHasCancelSsvepAction === 'function' && window.ssvepBlockHasCancelSsvepAction(selectedBlock)) {
        return;
    }
    pushUndoSnapshot();
    if (enabled) {
        selectedBlock.actions = [{ type: 'confirm_ssvep', content: '', targetPage: null, delayMs: 0 }];
        if (selectedBlock.confirmTimeoutMs == null) selectedBlock.confirmTimeoutMs = 1000;
    } else if (
        typeof window.ssvepBlockHasConfirmSsvepAction === 'function' &&
        window.ssvepBlockHasConfirmSsvepAction(selectedBlock)
    ) {
        selectedBlock.actions = [emptyEditorAction()];
    }
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
    updatePropertiesPanel();
}

function editorSetMultimodalCancelSsvep(enabled) {
    if (!selectedBlock || !isMultimodalBlock(selectedBlock)) return;
    if (enabled && typeof window.ssvepBlockHasConfirmSsvepAction === 'function' && window.ssvepBlockHasConfirmSsvepAction(selectedBlock)) {
        return;
    }
    pushUndoSnapshot();
    if (enabled) {
        selectedBlock.actions = [{ type: 'cancel_ssvep', content: '', targetPage: null, delayMs: 0 }];
    } else if (
        typeof window.ssvepBlockHasCancelSsvepAction === 'function' &&
        window.ssvepBlockHasCancelSsvepAction(selectedBlock)
    ) {
        selectedBlock.actions = [emptyEditorAction()];
    }
    editorSyncLegacyAction(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
    updatePropertiesPanel();
}

window.editorSetMultimodalCancelSsvep = editorSetMultimodalCancelSsvep;

function updateMultimodalPhysicalChannel(raw) {
    if (!selectedBlock || !isMultimodalBlock(selectedBlock)) return;
    const idx = raw === '' || raw == null ? null : parseInt(String(raw), 10);
    maybePushUndoForPropertyChange();
    selectedBlock.physicalChannel = Number.isFinite(idx) ? idx : null;
    normalizeMultimodalBlockInEditor(selectedBlock);
    refreshMultimodalBlockEl(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
}

function updateMultimodalChannelFromPanel(newChannel) {
    if (!selectedBlock || !isMultimodalBlock(selectedBlock)) return;
    if (!window.ssvepIsMultimodalChannelId(newChannel)) return;
    const occ = getOccupiedMultimodalChannelIds(selectedBlock.id);
    if (occ.has(newChannel)) {
        alert('该槽位已被本页其他多模态方块使用');
        updatePropertiesPanel();
        return;
    }
    maybePushUndoForPropertyChange();
    selectedBlock.channel = newChannel;
    if (typeof window.ssvepDefaultPhysicalChannelForSlot === 'function') {
        selectedBlock.physicalChannel = window.ssvepDefaultPhysicalChannelForSlot(newChannel);
    }
    normalizeMultimodalBlockInEditor(selectedBlock);
    refreshMultimodalBlockEl(selectedBlock);
    refreshMultimodalChannelPicker();
    markEditorDirty();
    saveToLocalStorage();
    updatePropertiesPanel();
}

function updateMultimodalScalar(prop, raw) {
    if (!selectedBlock || !isMultimodalBlock(selectedBlock)) return;
    maybePushUndoForPropertyChange();
    if (prop === 'holdThresholdUv') selectedBlock.holdThresholdUv = Math.max(1, parseFloat(raw) || 30);
    else if (prop === 'emgWindowSec' || prop === 'motionWindowSec') {
        const v = Math.max(0.1, parseFloat(raw) || 1);
        selectedBlock.emgWindowSec = v;
        selectedBlock.motionWindowSec = v;
    } else if (prop === 'peakWindowSec') {
        selectedBlock.peakWindowSec = Math.max(0.2, parseFloat(raw) || 0.6);
    } else if (prop === 'peakThresholdUv') {
        selectedBlock.peakThresholdUv = Math.max(10, parseFloat(raw) || 50);
    } else if (prop === 'peakMaxUv') {
        selectedBlock.peakMaxUv = Math.max(80, parseFloat(raw) || 200);
    } else if (prop === 'minBinFraction') {
        selectedBlock.minBinFraction = Math.max(0.2, Math.min(1, parseFloat(raw) || 0.4));
    } else if (prop === 'normGate') {
        selectedBlock.normGate = Math.max(0, Math.min(1, parseFloat(raw) || 0.8));
    } else if (prop === 'manualNormThresholds') {
        selectedBlock.manualNormThresholds = raw === true || raw === 'true' || raw === '1' || raw === 1;
        updatePropertiesPanel();
    } else if (prop === 'manualUpperThresholdUv') {
        selectedBlock.manualUpperThresholdUv = Math.max(2, parseFloat(raw) || 25);
    } else if (prop === 'manualLowerThresholdUv') {
        selectedBlock.manualLowerThresholdUv = Math.max(0, parseFloat(raw) || 6);
    } else if (prop === 'driveTriggerLevel') {
        selectedBlock.driveTriggerLevel = Math.max(0.5, Math.min(1, parseFloat(raw) || 0.85));
    } else if (prop === 'holdDurationMs') selectedBlock.holdDurationMs = Math.max(50, parseInt(raw, 10) || 600);
    else if (prop === 'edgeJumpUv') selectedBlock.edgeJumpUv = Math.max(1, parseFloat(raw) || 50);
    else if (prop === 'edgeWindowMs') selectedBlock.edgeWindowMs = Math.max(20, parseInt(raw, 10) || 80);
    else if (prop === 'edgePolarity') {
        selectedBlock.edgePolarity =
            raw === 'fall' || raw === 'both' ? raw : 'rise';
    } else if (prop === 'eogDetectMode') {
        selectedBlock.eogDetectMode = raw === 'edge' ? 'edge' : 'pulse';
        if (selectedBlock.triggerType === 'hold') selectedBlock.triggerType = 'edge';
        updatePropertiesPanel();
    } else if (prop === 'pulseOnsetUv') {
        selectedBlock.pulseOnsetUv = Math.max(1, parseFloat(raw) || 45);
        selectedBlock.edgeJumpUv = selectedBlock.pulseOnsetUv;
    } else if (prop === 'pulseRecoverRatio') {
        selectedBlock.pulseRecoverRatio = Math.max(0.1, Math.min(0.9, parseFloat(raw) || 0.35));
    } else if (prop === 'pulseMaxMs') {
        selectedBlock.pulseMaxMs = Math.max(80, parseInt(raw, 10) || 420);
    } else if (prop === 'pulseMinMs') {
        selectedBlock.pulseMinMs = Math.max(10, parseInt(raw, 10) || 40);
    } else if (prop === 'baselineTauSec') {
        selectedBlock.baselineTauSec = Math.max(0.3, parseFloat(raw) || 1.5);
    } else if (prop === 'refractoryMs') {
        selectedBlock.refractoryMs = Math.max(50, parseInt(raw, 10) || 350);
    } else if (prop === 'holdRepeatMs') selectedBlock.holdRepeatMs = Math.max(0, parseInt(raw, 10) || 0);
    else if (prop === 'confirmTimeoutMs') {
        selectedBlock.confirmTimeoutMs = Math.max(200, parseInt(raw, 10) || 1000);
    } else if (prop === 'triggerType') {
        selectedBlock.triggerType = raw === 'hold' ? 'hold' : 'edge';
        updatePropertiesPanel();
    }
    normalizeMultimodalBlockInEditor(selectedBlock);
    markEditorDirty();
    saveToLocalStorage();
}

/** 眼电检测模式：pulse | edge | hold（与眼电测试对齐） */
function updateMultimodalEogMode(mode) {
    if (!selectedBlock || !isMultimodalBlock(selectedBlock)) return;
    if (mode === 'hold') {
        selectedBlock.triggerType = 'hold';
        selectedBlock.eogDetectMode = 'pulse';
    } else {
        selectedBlock.triggerType = 'edge';
        selectedBlock.eogDetectMode = mode === 'edge' ? 'edge' : 'pulse';
    }
    normalizeMultimodalBlockInEditor(selectedBlock);
    updatePropertiesPanel();
    markEditorDirty();
    saveToLocalStorage();
}

function refreshMultimodalBlockEl(block) {
    if (!isMultimodalBlock(block)) return;
    const blockEl = document.getElementById(blockDomId(block));
    if (!blockEl) return;
    blockEl.style.left = block.x + 'px';
    blockEl.style.top = block.y + 'px';
    blockEl.style.width = block.width + 'px';
    blockEl.style.height = block.height + 'px';
    blockEl.innerHTML = formatMultimodalBlockCanvasHtml(block);
}

function propertiesPanelHasFocusedFieldInput() {
    const ae = document.activeElement;
    if (!ae || typeof ae.closest !== 'function') return false;
    const panel = document.getElementById('properties-panel');
    if (!panel || !panel.contains(ae)) return false;
    if (ae.tagName === 'TEXTAREA') return true;
    if (ae.tagName !== 'INPUT') return false;
    const t = (ae.type || '').toLowerCase();
    return t === 'text' || t === 'number' || t === 'color' || t === '';
}

function syncPropertiesPanelGeometryFromBlock(block) {
    if (!block || propertiesPanelHasFocusedFieldInput()) return;
    const panel = document.getElementById('properties-panel');
    if (!panel || !selectedBlock || selectedBlock.id !== block.id) return;
    const setNum = (prop, val) => {
        const el = panel.querySelector(`[data-prop-geom="${prop}"]`);
        if (el) el.value = val;
    };
    setNum('x', Math.round(block.x));
    setNum('y', Math.round(block.y));
    setNum('width', block.width);
    setNum('height', block.height);
    if (block.rotation != null) setNum('rotation', Number(block.rotation) || 0);
}

function updatePropertiesPanel() {
    if (!selectedBlock) return;
    if (propertiesPanelHasFocusedFieldInput()) return;

    if (isMultimodalBlock(selectedBlock)) {
        normalizeMultimodalBlockInEditor(selectedBlock);
        const b = selectedBlock;
        const occ = getOccupiedMultimodalChannelIds(b.id);
        const channelOptions = (window.SSVEP_MULTIMODAL_CHANNELS || [])
            .map((c) => {
                const taken = occ.has(c.id) && c.id !== b.channel;
                return `<option value="${c.id}" ${b.channel === c.id ? 'selected' : ''} ${
                    taken ? 'disabled' : ''
                }>${escapeHtml(c.short)}</option>`;
            })
            .join('');
        const tt = b.triggerType === 'hold' ? 'hold' : 'edge';
        const holdThr = typeof b.holdThresholdUv === 'number' ? b.holdThresholdUv : 30;
        const holdDur = typeof b.holdDurationMs === 'number' ? b.holdDurationMs : 600;
        const edgeJump = typeof b.edgeJumpUv === 'number' ? b.edgeJumpUv : 50;
        const edgeWin = typeof b.edgeWindowMs === 'number' ? b.edgeWindowMs : 80;
        const edgePol =
            b.edgePolarity === 'fall' || b.edgePolarity === 'both' ? b.edgePolarity : 'rise';
        const eogMode = b.eogDetectMode === 'edge' ? 'edge' : 'pulse';
        const pulseOnset = typeof b.pulseOnsetUv === 'number' ? b.pulseOnsetUv : edgeJump || 45;
        const pulseRecover = typeof b.pulseRecoverRatio === 'number' ? b.pulseRecoverRatio : 0.35;
        const pulseMax = typeof b.pulseMaxMs === 'number' ? b.pulseMaxMs : 420;
        const pulseMin = typeof b.pulseMinMs === 'number' ? b.pulseMinMs : 40;
        const baselineTau = typeof b.baselineTauSec === 'number' ? b.baselineTauSec : 1.5;
        const refractory = typeof b.refractoryMs === 'number' ? b.refractoryMs : 350;
        const hrm = typeof b.holdRepeatMs === 'number' ? b.holdRepeatMs : 0;
        const metaRole =
            window.SSVEP_MULTIMODAL_BY_ID && window.SSVEP_MULTIMODAL_BY_ID[b.channel]
                ? window.SSVEP_MULTIMODAL_BY_ID[b.channel].role
                : null;
        const isMotion = metaRole === 'motor_imagery';
        const emgWin = typeof b.emgWindowSec === 'number' ? b.emgWindowSec : typeof b.motionWindowSec === 'number' ? b.motionWindowSec : 1;
        const peakWin = typeof b.peakWindowSec === 'number' ? b.peakWindowSec : 0.6;
        const peakThr = typeof b.peakThresholdUv === 'number' ? b.peakThresholdUv : 50;
        const peakMax = typeof b.peakMaxUv === 'number' ? b.peakMaxUv : 200;
        const minBins = typeof b.minBinFraction === 'number' ? b.minBinFraction : 0.4;
        const normGate = typeof b.normGate === 'number' ? b.normGate : 0.8;
        const driveThr = typeof b.driveTriggerLevel === 'number' ? b.driveTriggerLevel : 0.85;
        const manualNorm = !!b.manualNormThresholds;
        const manualUpper = typeof b.manualUpperThresholdUv === 'number' ? b.manualUpperThresholdUv : 25;
        const manualLower = typeof b.manualLowerThresholdUv === 'number' ? b.manualLowerThresholdUv : 6;
        const eogParamsHtml = !isMotion
            ? `
        <p style="font-size:11px;color:#888;line-height:1.45;margin-bottom:10px;">
            与<strong>眼电测试</strong>同源：SSVEP 参考去基线 + EMA；默认<strong>升–落脉冲</strong>（眨眼典型波形），亦可改短窗突变或持续。
            <a href="eog-test.html" target="_blank" style="color:#c9a0ff;">打开眼电测试调参 →</a>
        </p>
        <div class="property-group">
            <label class="property-label">检测模式</label>
            <select class="property-input" onchange="updateMultimodalEogMode(this.value)">
                <option value="pulse" ${tt !== 'hold' && eogMode === 'pulse' ? 'selected' : ''}>升–落脉冲（推荐，似眨眼）</option>
                <option value="edge" ${tt !== 'hold' && eogMode === 'edge' ? 'selected' : ''}>短窗突变沿</option>
                <option value="hold" ${tt === 'hold' ? 'selected' : ''}>持续性（差分超阈并维持）</option>
            </select>
        </div>
        ${
            tt !== 'hold'
                ? `
        <div class="property-group">
            <label class="property-label">极性</label>
            <select class="property-input" onchange="updateMultimodalScalar('edgePolarity', this.value)">
                <option value="rise" ${edgePol === 'rise' ? 'selected' : ''}>正向（上升 / 正脉冲）</option>
                <option value="fall" ${edgePol === 'fall' ? 'selected' : ''}>反向（下降 / 负脉冲）</option>
                <option value="both" ${edgePol === 'both' ? 'selected' : ''}>双向（绝对值）</option>
            </select>
        </div>
        <div class="property-group">
            <label class="property-label">基线 EMA τ（秒）</label>
            <input type="number" class="property-input" step="0.1" min="0.3" max="5" value="${baselineTau}"
                   onchange="updateMultimodalScalar('baselineTauSec', this.value)">
        </div>
        <div class="property-group">
            <label class="property-label">不应期（毫秒）</label>
            <input type="number" class="property-input" min="50" step="50" value="${refractory}"
                   onchange="updateMultimodalScalar('refractoryMs', this.value)">
        </div>
        ${
            eogMode === 'pulse'
                ? `
        <div class="property-group">
            <label class="property-label">升沿阈值（µV）</label>
            <input type="number" class="property-input" step="any" min="1" value="${pulseOnset}"
                   onchange="updateMultimodalScalar('pulseOnsetUv', this.value)">
            <p style="font-size:10px;color:#8a7ab8;margin-top:4px;">→ 去基线后越过此值进入升起，回落后触发一次。</p>
        </div>
        <div class="property-group">
            <label class="property-label">回落比例（相对峰值）</label>
            <input type="number" class="property-input" step="0.05" min="0.1" max="0.9" value="${pulseRecover}"
                   onchange="updateMultimodalScalar('pulseRecoverRatio', this.value)">
        </div>
        <div class="property-group">
            <label class="property-label">脉冲最长 / 最短（ms）</label>
            <div class="property-row">
                <input type="number" class="property-input" min="80" step="20" value="${pulseMax}"
                       onchange="updateMultimodalScalar('pulseMaxMs', this.value)" title="最长">
                <input type="number" class="property-input" min="10" step="10" value="${pulseMin}"
                       onchange="updateMultimodalScalar('pulseMinMs', this.value)" title="最短">
            </div>
        </div>`
                : `
        <div class="property-group">
            <label class="property-label">突变阈值（µV）</label>
            <input type="number" class="property-input" step="any" min="1" value="${edgeJump}"
                   onchange="updateMultimodalScalar('edgeJumpUv', this.value)">
        </div>
        <div class="property-group">
            <label class="property-label">突变观测窗（毫秒）</label>
            <input type="number" class="property-input" min="20" step="10" value="${edgeWin}"
                   onchange="updateMultimodalScalar('edgeWindowMs', this.value)">
        </div>`
        }`
                : `
        <div class="property-group">
            <label class="property-label">持续活跃阈值（µV，相对 SSVEP 参考）</label>
            <input type="number" class="property-input" step="any" min="1" value="${holdThr}"
                   onchange="updateMultimodalScalar('holdThresholdUv', this.value)">
        </div>
        <div class="property-group">
            <label class="property-label">持续时长（毫秒）</label>
            <input type="number" class="property-input" min="50" step="50" value="${holdDur}"
                   onchange="updateMultimodalScalar('holdDurationMs', this.value)">
        </div>
        <div class="property-group">
            <label class="property-label">持续触发的重复间隔（毫秒）</label>
            <input type="number" class="property-input" min="50" step="10" value="${hrm}"
                   onchange="updateMultimodalScalar('holdRepeatMs', this.value)">
        </div>`
        }`
            : '';
        const motionEmgParamsHtml = isMotion
            ? `
        <p style="font-size:11px;color:#888;line-height:1.45;margin-bottom:12px;">
            条形图：<strong>左柱</strong> = norm（OpenBCI 滑动平均 |µV| + 自适应阈）；<strong>右柱</strong> = bin 检测驱动。两路参数独立，见各字段说明。
        </p>
        <div class="property-group">
            <label class="property-label">norm 窗长（秒）</label>
            <input type="number" class="property-input" step="0.1" min="0.1" max="5" value="${emgWin}"
                   onchange="updateMultimodalScalar('emgWindowSec', this.value)">
            <p style="font-size:10px;color:#5a8ab8;margin-top:4px;">→ 左柱 norm、avg|µV|；窗越长越平滑。</p>
        </div>
        <div class="property-group">
            <label class="property-label">norm 驱动门限（0～1，默认 0.8）</label>
            <input type="number" class="property-input" step="0.02" min="0" max="1" value="${normGate}"
                   onchange="updateMultimodalScalar('normGate', this.value)">
            <p style="font-size:10px;color:#5a8ab8;margin-top:4px;">→ norm 超过该值才计入驱动；左柱红虚线位置。</p>
        </div>
        <div class="property-group">
            <label class="property-label" style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" ${manualNorm ? 'checked' : ''}
                       onchange="updateMultimodalScalar('manualNormThresholds', this.checked)">
                固定 norm 上/下阈（µV）
            </label>
            <p style="font-size:10px;color:#5a8ab8;margin-top:4px;">未勾选 = OpenBCI 自适应（默认）；勾选后 norm 公式中的上/下阈为你填写的固定值。</p>
        </div>
        <div class="property-group" style="${manualNorm ? '' : 'opacity:0.45'}">
            <label class="property-label">固定上阈（µV）</label>
            <input type="number" class="property-input" step="1" min="2" max="200" value="${manualUpper}"
                   ${manualNorm ? '' : 'disabled'}
                   onchange="updateMultimodalScalar('manualUpperThresholdUv', this.value)">
        </div>
        <div class="property-group" style="${manualNorm ? '' : 'opacity:0.45'}">
            <label class="property-label">固定下阈（µV）</label>
            <input type="number" class="property-input" step="1" min="0" max="199" value="${manualLower}"
                   ${manualNorm ? '' : 'disabled'}
                   onchange="updateMultimodalScalar('manualLowerThresholdUv', this.value)">
        </div>
        <div class="property-group">
            <label class="property-label">峰谷检测窗（秒）</label>
            <input type="number" class="property-input" step="0.1" min="0.2" max="5" value="${peakWin}"
                   onchange="updateMultimodalScalar('peakWindowSec', this.value)">
            <p style="font-size:10px;color:#5a8ab8;margin-top:4px;">→ 右柱 bin 段数（段长固定 0.2 s）。</p>
        </div>
        <div class="property-group">
            <label class="property-label">波峰/波谷阈（µV）</label>
            <input type="number" class="property-input" step="5" min="10" value="${peakThr}"
                   onchange="updateMultimodalScalar('peakThresholdUv', this.value)">
            <p style="font-size:10px;color:#5a8ab8;margin-top:4px;">→ 单段是否达标、峰/谷读数旁 (±阈)；<strong>不改变</strong>左柱 norm。</p>
        </div>
        <div class="property-group">
            <label class="property-label">力度上限（µV）</label>
            <input type="number" class="property-input" step="10" min="80" value="${peakMax}"
                   onchange="updateMultimodalScalar('peakMaxUv', this.value)">
            <p style="font-size:10px;color:#5a8ab8;margin-top:4px;">→ 右柱高度刻度，不改变达标段数。</p>
        </div>
        <div class="property-group">
            <label class="property-label">达标 bin 比例（0.4=40%）</label>
            <input type="number" class="property-input" step="0.1" min="0.2" max="1" value="${minBins}"
                   onchange="updateMultimodalScalar('minBinFraction', this.value)">
            <p style="font-size:10px;color:#5a8ab8;margin-top:4px;">→ bin 显示「a/b需」中的 b；达标 a 段即触发。</p>
        </div>
        <div class="property-group">
            <label class="property-label">触发驱动门限（0～1，默认 0.85）</label>
            <input type="number" class="property-input" step="0.05" min="0.5" max="1" value="${driveThr}"
                   onchange="updateMultimodalScalar('driveTriggerLevel', this.value)">
            <p style="font-size:10px;color:#5a8ab8;margin-top:4px;">→ 运行刺激时驱动≥该值并持续「持续时长」后执行动作。</p>
        </div>
        <div class="property-group">
            <label class="property-label">持续时长（毫秒）</label>
            <input type="number" class="property-input" min="50" step="50" value="${holdDur}"
                   onchange="updateMultimodalScalar('holdDurationMs', this.value)">
        </div>
        <div class="property-group">
            <label class="property-label">重复间隔（毫秒，0=每次咬牙只触发一次）</label>
            <input type="number" class="property-input" min="0" step="10" value="${hrm}"
                   onchange="updateMultimodalScalar('holdRepeatMs', this.value)">
        </div>`
            : '';
        const triggerTypeHtml = '';

        const panel = document.getElementById('properties-panel');
        panel.innerHTML = `
        <h3 style="color: #C9A0FF; margin-bottom: 20px;">🧠 多模态通道</h3>
        <p style="font-size:12px;color:#888;line-height:1.5;margin-bottom:16px;">
            运行刺激时<strong>不在画面显示</strong>。运动通道与 EMG 测试相同；眼电与<strong>眼电测试</strong>相同（升–落脉冲 / 突变沿）。
        </p>
        <div class="property-group">
            <label class="property-label">槽位类型（EOG-L/R · MOTION-L/R，每页唯一）</label>
            <select class="property-input" onchange="updateMultimodalChannelFromPanel(this.value)">
                ${channelOptions}
            </select>
        </div>
        <div class="property-group">
            <label class="property-label">绑定物理通道</label>
            <select class="property-input" onchange="updateMultimodalPhysicalChannel(this.value)">
                ${buildMultimodalPhysicalChannelOptions(b)}
            </select>
        </div>
        <div class="property-group">
            <label class="property-label">位置 / 大小（仅编辑器布局）</label>
            <div class="property-row">
                <input type="number" class="property-input" placeholder="X" value="${Math.round(b.x)}"
                       onchange="updateBlockProperty('x', parseFloat(this.value))">
                <input type="number" class="property-input" placeholder="Y" value="${Math.round(b.y)}"
                       onchange="updateBlockProperty('y', parseFloat(this.value))">
            </div>
            <div class="property-row" style="margin-top:8px;">
                <input type="number" class="property-input" placeholder="宽" value="${b.width}"
                       onchange="updateBlockProperty('width', parseFloat(this.value))">
                <input type="number" class="property-input" placeholder="高" value="${b.height}"
                       onchange="updateBlockProperty('height', parseFloat(this.value))">
            </div>
        </div>
        ${triggerTypeHtml}
        ${eogParamsHtml}
        ${motionEmgParamsHtml}
        ${buildEditorActionsSectionHtml(b, true)}
        <button class="delete-btn" onclick="deleteBlock()">🗑️ 删除多模态方块</button>
        `;
        highlightSelectedActionSlot();
        return;
    }

    if (isSsvepKeyboardBlock(selectedBlock)) {
        const KB = ssvepKb40();
        if (KB && selectedBlock) KB.ensureKeyboardKeyPhases(selectedBlock);
        const defs = KB ? KB.getSsvepKeyboard40KeyDefs(selectedBlock) : [];
        const panel = document.getElementById('properties-panel');
        panel.innerHTML = `
        <h3 style="color: #7B61FF; margin-bottom: 20px;">⌨️ SSVEP 键盘 (40)</h3>
        <p style="font-size:12px;color:#888;line-height:1.5;margin-bottom:14px;">
            QWERTY 布局：数字行 + 字母 + Caps / Space / Bksp / Enter。<br>
            频率 <strong>${KB ? KB.FREQ_BASE_HZ.toFixed(1) : '8.0'}～${KB ? KB.FREQ_MAX_HZ.toFixed(1) : '15.8'} Hz</strong>，步长 0.2 Hz；各键<strong>随机相位</strong>（联合频率-相位 FBCCA，解码窗建议 ≥2 s）。<br>
            各键默认绑定对应系统按键；运行刺激前请在编辑器开启<strong>启动系统选项</strong>。
        </p>
        <div class="property-group">
            <label class="property-label">标签</label>
            <input type="text" class="property-input" data-prop-field="label" value="${escapeHtml(selectedBlock.label || '')}"
                   oninput="updateBlockProperty('label', this.value)">
        </div>
        <div class="property-group">
            <label class="property-label">位置 / 大小</label>
            <div class="property-row">
                <input type="number" class="property-input" value="${Math.round(selectedBlock.x)}"
                       onchange="updateBlockProperty('x', parseFloat(this.value))">
                <input type="number" class="property-input" value="${Math.round(selectedBlock.y)}"
                       onchange="updateBlockProperty('y', parseFloat(this.value))">
            </div>
            <div class="property-row" style="margin-top:8px;">
                <input type="number" class="property-input" min="320" value="${selectedBlock.width}"
                       onchange="updateBlockProperty('width', parseFloat(this.value))">
                <input type="number" class="property-input" min="200" value="${selectedBlock.height}"
                       onchange="updateBlockProperty('height', parseFloat(this.value))">
            </div>
        </div>
        <div class="property-group">
            <label class="property-label">键面高亮色</label>
            <input type="color" class="property-input" value="${selectedBlock.color}"
                   onchange="updateBlockProperty('color', this.value)">
        </div>
        <div class="property-group">
            <label class="property-label" style="display:flex;align-items:center;gap:8px;font-weight:normal;color:#ccc;">
                <input type="checkbox" ${selectedBlock.opaqueFlickerRegion !== false ? 'checked' : ''}
                       onchange="updateBlockProperty('opaqueFlickerRegion', this.checked)">
                透明运行时实心黑底闪烁区（推荐）
            </label>
            <p style="font-size:11px;color:#888;line-height:1.45;margin-top:6px;">
                仅键盘矩形区域内不透明闪烁，页面其余区域仍可透明透视；可显著提高透明叠窗时的识别率。
            </p>
        </div>
        <div class="property-group">
            <label class="property-label">频率分配（只读）</label>
            <p style="font-size:11px;color:#888;max-height:120px;overflow-y:auto;line-height:1.45;">
                ${defs
                    .map((d) => `${escapeHtml(d.display)} ${d.frequencyHz.toFixed(2)} Hz phase ${d.phase.toFixed(2)}`)
                    .join(' · ')}
            </p>
        </div>
        <button class="delete-btn" onclick="deleteBlock()">🗑️ 删除键盘</button>
        `;
        highlightSelectedActionSlot();
        return;
    }

    const panel = document.getElementById('properties-panel');
    panel.innerHTML = `
        <h3 style="color: #00D9FF; margin-bottom: 20px;">⚙️ SSVEP 对象属性</h3>
        
        <div class="property-group">
            <label class="property-label">标签</label>
            <input type="text" class="property-input" data-prop-field="label" value="${escapeHtml(selectedBlock.label || '')}" 
                   oninput="updateBlockProperty('label', this.value)">
        </div>
        
        <div class="property-group">
            <label class="property-label">形状</label>
            <select class="property-input" onchange="updateBlockProperty('shape', this.value)">
                <option value="rectangle" ${selectedBlock.shape === 'rectangle' ? 'selected' : ''}>矩形</option>
                <option value="circle" ${selectedBlock.shape === 'circle' ? 'selected' : ''}>圆形</option>
                <option value="triangle" ${selectedBlock.shape === 'triangle' ? 'selected' : ''}>三角形</option>
                <option value="hexagon" ${selectedBlock.shape === 'hexagon' ? 'selected' : ''}>六边形</option>
                <option value="diamond" ${selectedBlock.shape === 'diamond' ? 'selected' : ''}>菱形</option>
                <option value="pentagon" ${selectedBlock.shape === 'pentagon' ? 'selected' : ''}>五边形</option>
            </select>
        </div>
        
        <div class="property-group">
            <label class="property-label">位置</label>
            <div class="property-row">
                <input type="number" class="property-input" data-prop-geom="x" placeholder="X" value="${Math.round(selectedBlock.x)}"
                       onchange="updateBlockProperty('x', parseFloat(this.value))">
                <input type="number" class="property-input" data-prop-geom="y" placeholder="Y" value="${Math.round(selectedBlock.y)}"
                       onchange="updateBlockProperty('y', parseFloat(this.value))">
            </div>
        </div>
        
        <div class="property-group">
            <label class="property-label">大小</label>
            <div class="property-row">
                <input type="number" class="property-input" data-prop-geom="width" placeholder="宽" min="24" value="${selectedBlock.width}"
                       onchange="updateBlockProperty('width', parseFloat(this.value))">
                <input type="number" class="property-input" data-prop-geom="height" placeholder="高" min="24" value="${selectedBlock.height}"
                       onchange="updateBlockProperty('height', parseFloat(this.value))">
            </div>
        </div>
        
        <div class="property-group">
            <label class="property-label">旋转（度；选中对象按空格 +15°）</label>
            <input type="number" class="property-input" data-prop-geom="rotation" min="0" max="359" step="1" value="${Number(selectedBlock.rotation) || 0}"
                   onchange="updateBlockProperty('rotation', parseFloat(this.value))">
        </div>
        
        <div class="property-group">
            <label class="property-label">颜色</label>
            <input type="color" class="property-input" value="${selectedBlock.color}"
                   onchange="updateBlockProperty('color', this.value)">
        </div>
        
        <div class="property-group">
            <label class="property-label">闪烁频率 (Hz，可含小数)</label>
            <input type="number" class="property-input" step="${SSVEP_FREQ_MIN_GAP_HZ}" min="${SSVEP_FREQ_MIN_HZ}" max="${SSVEP_FREQ_MAX_HZ}"
                   value="${escapeHtml(String(normalizeFrequencyHz(selectedBlock.frequency) ?? SSVEP_DEFAULT_FREQ_HZ))}"
                   onchange="onEditorSsvepBlockFrequencyCommit(this.value)"
                   title="保存或运行前将检查同页频率间隔">
            <p style="font-size:11px;color:#888;margin-top:6px;line-height:1.45;">
                允许范围 ${SSVEP_FREQ_MIN_HZ}～${SSVEP_FREQ_MAX_HZ.toFixed(1)} Hz，步长 ${SSVEP_FREQ_MIN_GAP_HZ} Hz。编辑时可自由填写；<strong>保存/运行</strong>时检查与同页其它对象至少相隔 ${SSVEP_FREQ_MIN_GAP_HZ} Hz。勾选自动分配时，保存会在 ${AUTO_ASSIGN_FREQ_MIN_HZ}～${AUTO_ASSIGN_FREQ_MAX_HZ} Hz 内均匀分配。
            </p>
        </div>
        
        <div class="property-group">
            <label class="property-label">相位</label>
            <select class="property-input" onchange="updateBlockProperty('phase', parseFloat(this.value))">
                ${PHASES.map((p, i) => `
                    <option value="${p}" ${selectedBlock.phase === p ? 'selected' : ''}>${p} (${i})</option>
                `).join('')}
            </select>
        </div>

        <div class="property-group">
            <label class="property-label" style="display:flex;align-items:center;gap:8px;font-weight:normal;color:#ccc;">
                <input type="checkbox" ${selectedBlock.opaqueFlickerRegion ? 'checked' : ''}
                       onchange="updateBlockProperty('opaqueFlickerRegion', this.checked)">
                透明运行时实心黑底闪烁区
            </label>
            <p style="font-size:11px;color:#888;line-height:1.45;margin-top:6px;">
                勾选后该对象区域为黑底高对比闪烁；不勾选则沿用半透明叠加（识别率通常较低）。请在编辑器中设置，运行时不再提供此项。
            </p>
        </div>
        
        ${buildEditorActionsSectionHtml(selectedBlock, false)}
        
        <button class="delete-btn" onclick="deleteBlock()">🗑️ 删除对象</button>
    `;
    highlightSelectedActionSlot();
}

// 更新方块属性
function updateBlockProperty(property, value) {
    if (!selectedBlock) return;

    maybePushUndoForPropertyChange();

    if (property.includes('.')) {
        const parts = property.split('.');
        selectedBlock[parts[0]][parts[1]] = value;
    } else {
        if ((property === 'width' || property === 'height') && (!Number.isFinite(value) || value < 24)) value = 24;
        if (selectedBlock.shape === 'hexagon' && (property === 'width' || property === 'height')) {
            const curW = Number(selectedBlock.width) || value;
            const curH = Number(selectedBlock.height) || Math.round(curW * REGULAR_HEX_H_OVER_W);
            if (property === 'width') {
                selectedBlock.width = value;
                selectedBlock.height = Math.round(value * REGULAR_HEX_H_OVER_W);
            } else {
                selectedBlock.height = value;
                selectedBlock.width = Math.round(value / REGULAR_HEX_H_OVER_W);
            }
            property = '_size_pair_synced_';
        } else if ((property === 'width' || property === 'height') && selectedBlock.shape === 'pentagon') {
            selectedBlock.width = value;
            selectedBlock.height = value;
            property = '_size_pair_synced_';
        }
        if (property === 'rotation') value = ((Number(value) || 0) % 360 + 360) % 360;
        if (property !== '_size_pair_synced_') {
            if (property === 'label') selectedBlock[property] = value != null ? String(value) : '';
            else selectedBlock[property] = value;
        }
    }

    if (isMultimodalBlock(selectedBlock)) {
        refreshMultimodalBlockEl(selectedBlock);
        const el = document.getElementById(blockDomId(selectedBlock));
        if (el) el.classList.add('selected');
        markEditorDirty();
        saveToLocalStorage();
        return;
    }
    
    // 重新渲染方块
    const blockEl = document.getElementById(`block-${selectedBlock.id}`);
    if (blockEl) {
        blockEl.style.left = selectedBlock.x + 'px';
        blockEl.style.top = selectedBlock.y + 'px';
        blockEl.style.width = selectedBlock.width + 'px';
        blockEl.style.height = selectedBlock.height + 'px';
        if (isSsvepKeyboardBlock(selectedBlock)) {
            blockEl.style.backgroundColor = 'rgba(0,0,0,0.55)';
        } else {
            blockEl.style.backgroundColor = selectedBlock.color;
        }
        setEditorBlockLabel(blockEl, selectedBlock);
        applyEditorBlockShapeStyle(blockEl, selectedBlock);
    }
    
    markEditorDirty();
    saveToLocalStorage();
}

// 删除对象
function deleteBlock() {
    if (!selectedBlock) return;

    if (confirm('确定要删除这个对象吗？')) {
        pushUndoSnapshot();
        const domId = blockDomId(selectedBlock);
        document.getElementById(domId)?.remove();

        if (isMultimodalBlock(selectedBlock)) {
            multimodalBlocks = multimodalBlocks.filter((b) => b.id !== selectedBlock.id);
            syncCurrentPageArraysToPages();
            refreshMultimodalChannelPicker();
        } else {
            blocks = blocks.filter((b) => b.id !== selectedBlock.id);
            syncCurrentPageArraysToPages();
        }
        selectedBlock = null;

        deselectBlock();
        markEditorDirty();
        saveToLocalStorage();
    }
}

// 清空画布
function clearCanvas() {
    if (confirm('确定要清空画布吗？所有对象将被删除！')) {
        pushUndoSnapshot();
        blocks.forEach((block) => {
            document.getElementById(`block-${block.id}`)?.remove();
        });
        multimodalBlocks.forEach((block) => {
            document.getElementById(blockDomId(block))?.remove();
        });

        blocks = [];
        multimodalBlocks = [];
        syncCurrentPageArraysToPages();
        selectedBlock = null;
        deselectBlock();
        refreshMultimodalChannelPicker();
        markEditorDirty();
        saveToLocalStorage();
    }
}

// 添加页面
function addPage() {
    const pageId = pages.length;
    const pageName = prompt('请输入页面名称:', `Page ${pageId + 1}`);
    if (pageName) {
        pushUndoSnapshot();
        pages.push({ id: pageId, name: pageName, blocks: [], multimodalBlocks: [] });
        renderPageTabs();
        markEditorDirty();
        saveToLocalStorage();
    }
}

// 删除页面
function deletePage(pageIndex) {
    if (pages.length <= 1) {
        alert('至少需要保留一个页面！');
        return;
    }
    
    if (confirm(`确定要删除页面 "${pages[pageIndex].name}" 吗？`)) {
        pushUndoSnapshot();
        pages.splice(pageIndex, 1);
        
        // 如果删除的是当前页面，切换到第一页
        if (pageIndex === currentPage) {
            currentPage = 0;
            ensurePagesMultimodalSlots(pages);
            blocks = pages[0].blocks || [];
            multimodalBlocks = pages[0].multimodalBlocks || [];

            rerenderAllCanvasBlocks();
            refreshMultimodalChannelPicker();
            deselectBlock();
        } else if (pageIndex < currentPage) {
            // 如果删除的页面在当前页面之前，调整当前页面索引
            currentPage--;
        }
        
        renderPageTabs();
        markEditorDirty();
        saveToLocalStorage();
    }
}

// 切换页面
function switchPage(pageIndex) {
    if (pageIndex === currentPage) return;
    stopKeyboardRecording(false);
    pushUndoSnapshot();
    syncCurrentPageArraysToPages();
    snapshotStimulusLayoutRefForCurrentPage();

    // 切换到新页面
    currentPage = pageIndex;
    ensurePagesMultimodalSlots(pages);
    blocks = pages[currentPage].blocks || [];
    multimodalBlocks = pages[currentPage].multimodalBlocks || [];

    rerenderAllCanvasBlocks();

    // 更新标签页样式
    renderPageTabs();
    refreshMultimodalChannelPicker();

    deselectBlock();
}

// 渲染页面标签
function renderPageTabs() {
    const tabsContainer = document.querySelector('.page-tabs');
    tabsContainer.innerHTML = pages.map((page, index) => `
        <div class="page-tab ${index === currentPage ? 'active' : ''}" onclick="switchPage(${index})">
            ${page.name}
            ${pages.length > 1 ? `<span class="delete-page-btn" onclick="event.stopPropagation(); deletePage(${index})">×</span>` : ''}
        </div>
    `).join('') + '<div class="add-page-btn" onclick="addPage()">+ 添加页面</div>';
}

function getExistingProjectNameFromStorage() {
    const saved = localStorage.getItem('ssvep_project');
    if (!saved) return '我的SSVEP项目';
    try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name && String(parsed.name).trim()) {
            return String(parsed.name).trim();
        }
    } catch (_) {
        /* ignore */
    }
    return '我的SSVEP项目';
}

/** @type {((name: string) => void)|null} */
let saveProjectNameModalCallback = null;

function openSaveProjectNameModal(defaultName, onConfirm) {
    const modal = document.getElementById('save-project-modal');
    const input = document.getElementById('save-project-name-input');
    if (!modal || !input) {
        const name = String(defaultName || '').trim() || '我的SSVEP项目';
        if (onConfirm) onConfirm(name);
        return;
    }
    saveProjectNameModalCallback = onConfirm;
    input.value = defaultName || '我的SSVEP项目';
    modal.classList.add('open');
    setTimeout(() => {
        input.focus();
        input.select();
    }, 0);
}

function closeSaveProjectNameModal() {
    const modal = document.getElementById('save-project-modal');
    if (modal) modal.classList.remove('open');
    saveProjectNameModalCallback = null;
}

function confirmSaveProjectNameModal() {
    const input = document.getElementById('save-project-name-input');
    const name = input ? String(input.value).trim() : '';
    if (!name) {
        alert('项目名称不能为空');
        return;
    }
    const cb = saveProjectNameModalCallback;
    closeSaveProjectNameModal();
    if (cb) cb(name);
}

function refreshProjectCanvasThumbnail(project) {
    if (!project) return;
    if (project.thumbnailSource === 'custom' && project.thumbnailImage) return;
    const TH = window.SSVEP_PROJECT_THUMBNAIL;
    if (TH && typeof TH.refreshProjectThumbnailFromCanvas === 'function') {
        TH.refreshProjectThumbnailFromCanvas(project, 0);
    }
}

function performSaveProject(projectName, onComplete, extraOpts) {
    syncCurrentPageArraysToPages();
    snapshotStimulusLayoutRefForCurrentPage();

    const saveAs = !!(extraOpts && extraOpts.saveAs);
    const saved = localStorage.getItem('ssvep_project');
    let project;
    let previousShell = null;

    if (saved) {
        try {
            previousShell = JSON.parse(saved);
        } catch (_) {
            previousShell = null;
        }
    }

    if (saveAs) {
        project = createNewProject(projectName);
        project.pages = JSON.parse(JSON.stringify(pages));
        if (previousShell) {
            project.runConfig = previousShell.runConfig
                ? JSON.parse(JSON.stringify(previousShell.runConfig))
                : defaultRunConfig();
            project.settings = {
                ...defaultProjectSettings(),
                ...(previousShell.settings || {})
            };
            if (previousShell.description) project.description = previousShell.description;
            if (previousShell.author) project.author = previousShell.author;
        }
    } else if (saved) {
        try {
            project = JSON.parse(saved);
            project.name = projectName;
            project.pages = pages;
            ensureProjectPagesActionsNormalized(project.pages);
            project.updated_at = new Date().toISOString();
            if (!project.id || !String(project.id).trim()) {
                project.id = 'proj_' + Date.now();
            }

            const ver = project.version && String(project.version).trim()
                ? String(project.version)
                : '1.0.0';
            const versionParts = ver.split('.');
            while (versionParts.length < 3) versionParts.push('0');
            versionParts[2] = String(parseInt(versionParts[2], 10) + 1 || 1);
            project.version = versionParts.join('.');
        } catch (error) {
            console.error('解析项目失败:', error);
            project = createNewProject(projectName);
        }
    } else {
        project = createNewProject(projectName);
    }

    ensureProjectPagesActionsNormalized(project.pages || []);
    syncProjectSettingsFromEditorUi(project);
    if (project.settings.autoAssignFreqPhaseOnSave !== false) {
        autoAssignAllPagesFrequenciesAndPhases(project.pages);
        pages = project.pages;
        rerenderAllCanvasBlocks();
        if (selectedBlock) updatePropertiesPanel();
    }

    const freqErrors = collectSsvepFrequencyValidationErrors(project);
    if (freqErrors.length > 0) {
        showEditorFrequencyValidationErrors(freqErrors, '保存');
        if (typeof onComplete === 'function') onComplete(false);
        return;
    }

    refreshProjectCanvasThumbnail(project);

    if (window.SEEKBCI_PROJECT_CONTRACT) {
        project = window.SEEKBCI_PROJECT_CONTRACT.ensureContractVersion(project);
    }

    localStorage.setItem('ssvep_project', JSON.stringify(project));
    updateProjectInList(project);
    clearEditorDirty();

    alert(saveAs ? '已另存为新项目！' : '项目已保存！');
    if (typeof onComplete === 'function') onComplete(true);
}

// 保存项目
function saveProject(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const existingName = getExistingProjectNameFromStorage();
    const onComplete = opts.onComplete;

    if (opts.skipPromptIfNamed && existingName) {
        performSaveProject(existingName, onComplete);
        return;
    }

    openSaveProjectNameModal(existingName, (projectName) => {
        performSaveProject(projectName, onComplete);
    });
}

function saveProjectAs() {
    const existingName = getExistingProjectNameFromStorage();
    const suggested = `${existingName} 副本`;
    openSaveProjectNameModal(suggested, (projectName) => {
        performSaveProject(projectName, null, { saveAs: true });
    });
}

// 创建新项目对象
function createNewProject(nameOverride) {
    const name =
        nameOverride != null && String(nameOverride).trim()
            ? String(nameOverride).trim()
            : '未命名项目';
    const now = new Date().toISOString();
    
    return {
        id: 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: name,
        description: '',
        author: '',
        version: '1.0.0',
        created_at: now,
        updated_at: now,
        thumbnail: '📊',
        pages: pages,
        frequencies: [],
        phases: PHASES,
        runConfig: defaultRunConfig(),
        settings: defaultProjectSettings(),
        version_history: [
            {
                version: '1.0.0',
                timestamp: now,
                changes: '项目创建'
            }
        ]
    };
}

// 更新项目列表中的项目
function updateProjectInList(project) {
    const projectsStr = localStorage.getItem('ssvep_projects');
    let projects = [];
    
    if (projectsStr) {
        try {
            projects = JSON.parse(projectsStr);
        } catch (error) {
            console.error('解析项目列表失败:', error);
        }
    }
    
    // 查找是否已存在
    const index = projects.findIndex(p => p.id === project.id);
    
    if (
        !project ||
        typeof project.id !== 'string' ||
        !project.id.trim() ||
        typeof project.name !== 'string' ||
        !String(project.name).trim() ||
        !Array.isArray(project.pages)
    ) {
        console.warn('跳过写入无效项目到列表', project);
        return;
    }

    if (index >= 0) {
        projects[index] = project;
    } else {
        projects.push(project);
    }

    localStorage.setItem('ssvep_projects', JSON.stringify(projects));
}

// 运行刺激（与项目管理相同的配置对话框）
function editorRunStimulus() {
    if (isPythonCompileInProgress()) {
        alert('Python 编译检查进行中，请等待完成或点击「停止」后再运行项目。');
        return;
    }
    syncCurrentPageArraysToPages();
    const mmCount = multimodalBlocks ? multimodalBlocks.length : 0;
    if (blocks.length === 0 && mmCount === 0) {
        alert('请先添加 SSVEP 闪烁对象或多模态通道再运行！');
        return;
    }
    saveToLocalStorage();
    let project;
    try {
        const raw = localStorage.getItem('ssvep_project');
        project = raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.error(e);
        project = null;
    }
    if (!project || !Array.isArray(project.pages)) {
        alert('项目数据异常，请先保存项目后再运行。');
        return;
    }
    project.pages = pages;
    ensureProjectPagesActionsNormalized(project.pages);
    const freqErrors = collectSsvepFrequencyValidationErrors(project);
    if (freqErrors.length > 0) {
        showEditorFrequencyValidationErrors(freqErrors, '运行');
        return;
    }
    openRunConfigModal(project);
}

// 导出项目
function exportProject() {
    syncCurrentPageArraysToPages();
    snapshotStimulusLayoutRefForCurrentPage();

    // 从localStorage获取项目信息
    const saved = localStorage.getItem('ssvep_project');
    let project;
    
    if (saved) {
        try {
            project = JSON.parse(saved);
            project.pages = pages;
        } catch (error) {
            console.error('解析项目失败:', error);
            project = createNewProject();
        }
    } else {
        project = createNewProject();
    }

    ensureProjectPagesActionsNormalized(project.pages || []);
    
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}_v${project.version}.ssvep.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    alert('项目已导出！');
}

// 导入项目
function importProject() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.ssvep.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const project = JSON.parse(event.target.result);
                
                // 验证项目格式
                if (!project.pages || !Array.isArray(project.pages)) {
                    throw new Error('无效的项目格式');
                }
                
                // 确保项目有ID
                if (!project.id) {
                    project.id = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                }
                
                // 确保有版本号
                if (!project.version) {
                    project.version = '1.0.0';
                }
                
                // 确保有时间戳
                const now = new Date().toISOString();
                if (!project.created_at) {
                    project.created_at = now;
                }
                project.updated_at = now;
                
                // 加载项目数据
                pages = project.pages || [{ id: 0, name: 'Page 1', blocks: [], multimodalBlocks: [] }];
                ensurePagesMultimodalSlots(pages);
                currentPage = 0;
                blocks = pages[0].blocks || [];
                multimodalBlocks = pages[0].multimodalBlocks || [];

                dedupeBlockIdsAndSyncCounter();
                ensureProjectPagesActionsNormalized(pages);
                clearUndoRedoStacks();

                // 保存到localStorage
                localStorage.setItem('ssvep_project', JSON.stringify(project));
                
                // 更新项目列表
                updateProjectInList(project);
                
                rerenderAllCanvasBlocks();
                renderPageTabs();
                refreshMultimodalChannelPicker();
                
                applyEditorSettingsToUi(project);
                alert('项目导入成功！');
                saveToLocalStorage();
                clearEditorDirty();
            } catch (error) {
                alert('导入失败：' + error.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/** 记录当前页编辑器画布尺寸，供刺激页按比例映射方块位置（与参考图对齐） */
function snapshotStimulusLayoutRefForCurrentPage() {
    const canvas = document.getElementById('canvas');
    if (!canvas || !pages[currentPage]) return;
    const r = canvas.getBoundingClientRect();
    pages[currentPage].stimulusLayoutRef = {
        width: Math.max(1, Math.round(r.width)),
        height: Math.max(1, Math.round(r.height))
    };
}

// 保存到本地存储
function saveToLocalStorage() {
    syncCurrentPageArraysToPages();
    snapshotStimulusLayoutRefForCurrentPage();
    ensureProjectPagesActionsNormalized(pages);
    const shell = readStoredProjectShell();
    const project = {
        ...shell,
        pages: pages,
        currentPage: currentPage,
        runConfig: { ...defaultRunConfig(), ...(shell.runConfig || {}) }
    };
    syncProjectSettingsFromEditorUi(project);
    localStorage.setItem('ssvep_project', JSON.stringify(project));
}

// 从本地存储加载
function loadFromLocalStorage() {
    const saved = localStorage.getItem('ssvep_project');
    if (saved) {
        try {
            const project = JSON.parse(saved);
            pages = project.pages || [{ id: 0, name: 'Page 1', blocks: [], multimodalBlocks: [] }];
            ensurePagesMultimodalSlots(pages);
            currentPage = project.currentPage || 0;
            blocks = pages[currentPage].blocks || [];
            multimodalBlocks = pages[currentPage].multimodalBlocks || [];

            dedupeBlockIdsAndSyncCounter();
            ensureProjectPagesActionsNormalized(pages);
            clearUndoRedoStacks();

            rerenderAllCanvasBlocks();
            renderPageTabs();
            refreshMultimodalChannelPicker();
            refreshSystemOptionButton();
            applyEditorSettingsToUi(project);
            clearEditorDirty();
        } catch (error) {
            console.error('加载失败:', error);
        }
    }
}

function readStoredProjectShell() {
    try {
        const raw = localStorage.getItem('ssvep_project');
        if (!raw) return {};
        const o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : {};
    } catch {
        return {};
    }
}

function refreshSystemOptionButton() {
    const btn = document.getElementById('system-option-btn');
    const label = document.getElementById('system-option-btn-label');
    if (!btn || !label) return;
    const settings = readStoredProjectShell().settings || {};
    const on = !!settings.systemKeyboardBridge;
    label.textContent = on ? '系统选项已启用' : '启动系统选项';
    btn.classList.toggle('active', on);
}

async function toggleSystemKeyboardOption() {
    const shell = readStoredProjectShell();
    const settings = { ...(shell.settings || {}) };
    if (settings.systemKeyboardBridge) {
        settings.systemKeyboardBridge = false;
        persistProjectShellPatch({ settings });
        refreshSystemOptionButton();
        return;
    }
    const origin = typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
    try {
        const r = await fetch(`${origin}/api/system/keyboard/status`);
        const j = await r.json();
        if (!j.available) {
            alert(
                '暂时无法启用系统选项：\n' +
                    (j.detail || '后端不可用') +
                    '\n\n请先启动 Python 后端，并在后端环境安装：pip install pynput'
            );
            return;
        }
        settings.systemKeyboardBridge = true;
        persistProjectShellPatch({ settings });
        alert(
            '已启用「系统选项」。运行刺激时，「键盘快捷键」「鼠标双击」等将由本机后端注入。\n\n请先切换到要接收操作的目标窗口，再触发刺激方块。'
        );
    } catch (e) {
        console.error(e);
        alert('无法连接后端 ' + origin + '。\n请先启动 SSVEP Python API（默认端口 8000）。');
    }
    refreshSystemOptionButton();
}

function persistProjectShellPatch(patch) {
    const shell = readStoredProjectShell();
    const merged = { ...shell, ...patch, pages, currentPage };
    if (patch.settings) {
        merged.settings = { ...(shell.settings || {}), ...patch.settings };
    }
    if (!merged.runConfig) merged.runConfig = { ...defaultRunConfig(), ...(shell.runConfig || {}) };
    localStorage.setItem('ssvep_project', JSON.stringify(merged));
    markEditorDirty();
}

// ---------- 运行刺激配置（与 project-manager 同源，供 editorRunStimulus 使用） ----------
let _runConfigProject = null;
let _runConfigSelectedMode = 'threshold';

function defaultRunConfig() {
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

function getProjectRunConfig(project) {
    const defaults = defaultRunConfig();
    if (typeof window.getEffectiveRunConfigForModal === 'function') {
        return window.getEffectiveRunConfigForModal(project, defaults);
    }
    const cfg = { ...defaults, ...((project && project.runConfig) || {}) };
    return typeof window.normalizeStimulusRunConfig === 'function'
        ? window.normalizeStimulusRunConfig(cfg)
        : cfg;
}

function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function setInputChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
}

function applyRunConfigToModal(project) {
    const cfg = getProjectRunConfig(project);
    _runConfigSelectedMode = cfg.mode === 'interval' ? 'interval' : 'threshold';
    setInputChecked('rc-eeg-enabled', cfg.eegEnabled);
    setInputValue('rc-window', cfg.windowSec);
    setInputValue('rc-cooldown', cfg.cooldownSec);
    setInputValue('rc-ssvep-mm-wait', cfg.ssvepMultimodalWaitSec);
    setInputChecked('rc-speak-on-decode', cfg.speakOnDecode);
    setInputChecked('rc-transparent-bg', cfg.transparentBackground);
    setInputChecked('rc-start-fullscreen', cfg.startFullscreen);
    setInputChecked('rc-flicker-high-blank', cfg.flickerHighBlank);
    setInputValue('rc-flicker-on-duty', cfg.flickerOnDutyPercent);
    setInputValue('rc-flicker-block-opacity', cfg.flickerBlockOpacityPercent);
    setInputValue(
        'rc-flicker-color-on',
        cfg.flickerColorOn ||
            (typeof window.DEFAULT_FLICKER_COLOR_ON === 'string' ? window.DEFAULT_FLICKER_COLOR_ON : '#ffffff')
    );
    setInputValue(
        'rc-flicker-color-off',
        cfg.flickerColorOff ||
            (typeof window.DEFAULT_FLICKER_COLOR_OFF === 'string' ? window.DEFAULT_FLICKER_COLOR_OFF : '#000000')
    );
    setInputValue('rc-th-minp', cfg.mode === 'threshold' ? cfg.minProbability : 0.28);
    setInputValue('rc-th-minm', cfg.minMargin);
    setInputChecked('rc-th-stable', cfg.thresholdRequireStable);
    setInputValue('rc-iv-interval', cfg.intervalSec);
    setInputValue('rc-iv-minp', cfg.mode === 'interval' ? cfg.minProbability : 0.22);
    const fw = document.getElementById('rc-flicker-duty-wrap');
    const fcb = document.getElementById('rc-flicker-high-blank');
    if (fw && fcb) fw.style.display = fcb.checked ? 'block' : 'none';
    syncRunConfigEegUi();
    updateRunModeButtons();
}

function updateRunModeButtons() {
    const th = document.getElementById('btn-rc-mode-threshold');
    const iv = document.getElementById('btn-rc-mode-interval');
    if (th) th.classList.toggle('active', _runConfigSelectedMode === 'threshold');
    if (iv) iv.classList.toggle('active', _runConfigSelectedMode === 'interval');
}

function syncRunConfigEegUi() {
    const cb = document.getElementById('rc-eeg-enabled');
    const on = cb ? cb.checked : false;
    const eegAct = document.getElementById('rc-eeg-mode-actions');
    const hint = document.getElementById('rc-eeg-footer-hint');
    const speakWrap = document.getElementById('rc-speak-wrap');
    if (eegAct) eegAct.style.display = on ? 'block' : 'none';
    if (hint) hint.style.display = on ? 'block' : 'none';
    if (speakWrap) speakWrap.style.display = on ? 'block' : 'none';
}

function openRunThresholdParamModal() {
    _runConfigSelectedMode = 'threshold';
    updateRunModeButtons();
    document.getElementById('run-config-modal-threshold')?.classList.add('active');
}

function closeRunThresholdParamModal() {
    document.getElementById('run-config-modal-threshold')?.classList.remove('active');
}

function openRunIntervalParamModal() {
    _runConfigSelectedMode = 'interval';
    updateRunModeButtons();
    document.getElementById('run-config-modal-interval')?.classList.add('active');
}

function closeRunIntervalParamModal() {
    document.getElementById('run-config-modal-interval')?.classList.remove('active');
}

function readSharedRunParams() {
    const windowRaw = parseFloat(document.getElementById('rc-window')?.value);
    const cooldownSec = parseFloat(document.getElementById('rc-cooldown')?.value) || 1.5;
    const out = {
        mode: _runConfigSelectedMode === 'interval' ? 'interval' : 'threshold',
        windowSec: Number.isFinite(windowRaw) ? windowRaw : 2.0,
        cooldownSec: Math.max(0.2, cooldownSec),
        pollMs: 320,
        speakOnDecode: !!document.getElementById('rc-speak-on-decode')?.checked,
        ssvepMultimodalWaitSec: (() => {
            const raw = parseFloat(document.getElementById('rc-ssvep-mm-wait')?.value);
            return Number.isFinite(raw) ? raw : 1.0;
        })()
    };
    return typeof window.normalizeStimulusRunConfig === 'function'
        ? window.normalizeStimulusRunConfig(out)
        : out;
}

function readRuntimePresentationForSession() {
    const dutyRaw = parseFloat(document.getElementById('rc-flicker-on-duty')?.value);
    const dutyPct = Number.isFinite(dutyRaw) ? dutyRaw : 32;
    const opacityRaw = parseFloat(document.getElementById('rc-flicker-block-opacity')?.value);
    const opacityPct = Number.isFinite(opacityRaw) ? opacityRaw : 58;
    const normHex =
        typeof window.normalizeHexColor === 'function'
            ? window.normalizeHexColor
            : (v, fb) => (v && String(v).trim() ? String(v).trim() : fb);
    return {
        transparentBackground: !!document.getElementById('rc-transparent-bg')?.checked,
        startFullscreen: !!document.getElementById('rc-start-fullscreen')?.checked,
        flickerHighBlank: !!document.getElementById('rc-flicker-high-blank')?.checked,
        flickerOnDutyPercent: Math.min(50, Math.max(15, dutyPct)),
        flickerBlockOpacityPercent: Math.min(100, Math.max(20, opacityPct)),
        flickerColorOn: normHex(document.getElementById('rc-flicker-color-on')?.value, '#ffffff'),
        flickerColorOff: normHex(document.getElementById('rc-flicker-color-off')?.value, '#000000')
    };
}

function openRunConfigModal(project) {
    _runConfigProject = project;
    const m = document.getElementById('run-config-modal');
    if (m) {
        applyRunConfigToModal(project);
        m.classList.add('active');
        return;
    }
    console.error('缺少 #run-config-modal');
    alert('当前页面缺少运行配置对话框，请对 editor.html 执行 Ctrl+F5 强制刷新。');
}

function closeRunConfigModal() {
    _runConfigProject = null;
    document.getElementById('run-config-modal')?.classList.remove('active');
    closeRunThresholdParamModal();
    closeRunIntervalParamModal();
}

function writeRunAndNavigate(runConfig) {
    const proj = _runConfigProject;
    if (!proj) return;
    syncCurrentPageArraysToPages();
    snapshotStimulusLayoutRefForCurrentPage();
    proj.pages = pages;
    proj.currentPage = currentPage;
    syncProjectSettingsFromEditorUi(proj);
    let finalConfig = {
        ...runConfig,
        ...readRuntimePresentationForSession()
    };
    if (typeof window.attachProjectIdToRunConfig === 'function') {
        finalConfig = window.attachProjectIdToRunConfig(finalConfig, proj.id);
    } else if (proj.id) {
        finalConfig._projectId = proj.id;
    }
    proj.runConfig = finalConfig;
    localStorage.setItem('ssvep_project', JSON.stringify(proj));
    updateProjectInList(proj);
    const runPayload = JSON.stringify(finalConfig);
    sessionStorage.setItem('stimulus_run_config', runPayload);
    sessionStorage.setItem('stimulus_return_page', 'editor.html');
    localStorage.setItem('stimulus_run_config', runPayload);
    closeRunConfigModal();
    window.location.href = 'stimulus.html';
}

function confirmRunStimulusSelectedMode() {
    if (!_runConfigProject) return;
    const eegOn = document.getElementById('rc-eeg-enabled')?.checked;
    if (!eegOn) {
        confirmRunStimulusNoEeg();
        return;
    }
    if (_runConfigSelectedMode === 'interval') confirmRunStimulusInterval();
    else confirmRunStimulusThreshold();
}

function confirmRunStimulusNoEeg() {
    if (!_runConfigProject) return;
    const sh = readSharedRunParams();
    writeRunAndNavigate({
        eegEnabled: false,
        mode: 'threshold',
        intervalSec: 3,
        minProbability: 0.35,
        minMargin: 0.12,
        ...sh
    });
}

function confirmRunStimulusThreshold() {
    if (!_runConfigProject) return;
    const eegOn = document.getElementById('rc-eeg-enabled')?.checked;
    if (!eegOn) {
        confirmRunStimulusNoEeg();
        return;
    }
    const minProbability = parseFloat(document.getElementById('rc-th-minp')?.value) || 0.28;
    const minMargin = parseFloat(document.getElementById('rc-th-minm')?.value) || 0.08;
    const sh = readSharedRunParams();
    writeRunAndNavigate({
        eegEnabled: true,
        mode: 'threshold',
        intervalSec: 3,
        minProbability: Math.min(0.99, Math.max(MIN_SOFTMAX_PROBABILITY, minProbability)),
        minMargin: Math.min(0.5, Math.max(0.02, minMargin)),
        thresholdRequireStable: !!document.getElementById('rc-th-stable')?.checked,
        ...sh
    });
}

function confirmRunStimulusInterval() {
    if (!_runConfigProject) return;
    const eegOn = document.getElementById('rc-eeg-enabled')?.checked;
    if (!eegOn) {
        confirmRunStimulusNoEeg();
        return;
    }
    const intervalSec = parseFloat(document.getElementById('rc-iv-interval')?.value) || 3;
    const minProbability = parseFloat(document.getElementById('rc-iv-minp')?.value) || 0.22;
    const sh = readSharedRunParams();
    writeRunAndNavigate({
        eegEnabled: true,
        mode: 'interval',
        intervalSec: Math.max(0.5, intervalSec),
        minProbability: Math.min(0.99, Math.max(MIN_SOFTMAX_PROBABILITY, minProbability)),
        minMargin: 0.12,
        ...sh
    });
}

/** 用于确认浏览器加载的是当前磁盘上的 editor.js（控制台输入 __SSVEP_EDITOR_BUILD） */
window.__SSVEP_EDITOR_BUILD = '20260522b';
