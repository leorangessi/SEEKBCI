// 刺激渲染引擎 JavaScript

// 全局变量
let project = null;
let currentPage = 0;
let stimulusBlocks = [];
let isRunning = false;
let startTime = 0;
let animationFrameId = null;

// 性能监控
let frameCount = 0;
let lastFpsUpdate = 0;
let currentFPS = 0;

// 刺激参数
// 刺激参数（历史常量；实际渲染用 performance.now 相位，随显示器刷新率自适应）
const REFRESH_RATE = 60;

/** 当前页面对象列表（与编辑器频率一致，用于在线解码） */
let currentPageBlockList = [];
/** sessionStorage 读取的运行选项 */
let stimulusRunOpts = null;
let stimulusEegBuffer = [];
/** 仅在本页刺激运行且在线识别开启时写入缓冲（避免停刺激/换页仍缓存旧 SSVEP） */
let stimulusEegSessionActive = false;
/** 当前识别窗口基线时刻：触发或换页后从此刻起重新收数 */
let stimulusEegSessionStartMs = 0;
let stimulusEegSamplingRate = 250;
let stimulusEegIntervalId = null;
/** @type {((event: string, data: unknown) => void) | null} */
let stimulusEegListener = null;
let stimulusEegDecodeInFlight = false;
let stimulusEegLastTriggerTs = 0;
/** 前端鼠标动作队列：避免 EEG 连续触发 / 多方块动作并发打满后端 0.35s 节流 */
let ssvepMouseQueueChain = Promise.resolve();
let ssvepLastMouseClickSentMs = 0;
let ssvepLastMouseDoubleClickSentMs = 0;
const SSVEP_MOUSE_CLICK_MIN_GAP_MS = 380;
const SSVEP_MOUSE_DOUBLE_CLICK_MIN_GAP_MS = 1300;
/** 绑定鼠标动作的目标，EEG 触发冷却不得低于此后端节流 */
const SSVEP_MOUSE_TRIGGER_MIN_COOLDOWN_MS = 400;
let stimulusEegLastIntervalDecodeTs = 0;
/** 置信度模式「连续两次同一频率」：上一次已过阈值的 softmax 第一名频率（Hz） */
let stimulusEegLastStableCandidateHz = null;
let stimulusEegDeviceHooked = false;
/** 控制面板「最近 5 次识别」 */
const STIMULUS_EEG_HISTORY_MAX = 20;
/** 识别触发后橙黄高亮保持至间隔/冷却结束 */
let decodeTriggeredHoldTimer = null;
let decodeTriggeredBlockId = null;
/** 页面跳转未填写延迟时，先高亮识别对象再跳转（毫秒） */
const PAGE_LINK_DEFAULT_DELAY_MS = 1000;
const MIN_SOFTMAX_PROBABILITY = 0.03;
let stimulusEegDecodeHistory = [];
/** 缓存设备 SSVEP 通道下标，避免每次 decode 重复 applyChannelConfig */
let cachedSsvepChIdxForDecode = null;
let cachedSsvepChIdxAtMs = 0;

/** 多模态：设备流触发，不在刺激区渲染方块 */
let multimodalRuntimeConfigs = [];
/** SSVEP 已识别、等待多模态确认后再执行动作 */
let ssvepPendingConfirm = null;
/** @type {((event: string, data: unknown) => void) | null} */
let stimulusMultimodalListener = null;
/** 最近一条 WS data（供运动条形图在 tick 间隔内使用） */
let stimulusLastMotionMessage = null;
/** 上一帧运动检测状态（供控制面板显示真实触发进度） */
let lastMotionTriggerUi = null;
let lastMotionTriggerUiList = [];
let lastMotionStreamPullMs = 0;
let lastMotionBufSeen = 0;
let motionBufStaleCount = 0;
/** @type {Map<string, { since: number|null, prevHold: boolean, lastFire: number }>} */
const motionHoldLocal = new Map();

function resetMotionHoldLocal() {
    motionHoldLocal.clear();
}

/** SSVEP 进入待确认/待取消后清空确认门、取消门的持续计时，避免咬牙早于识别导致无法触发 */
function resetMotionHoldForPendingGates() {
    for (const cfg of getMotionDetectionConfigs()) {
        if (!cfg.isConfirmGate && !cfg.isCancelGate) continue;
        const phys =
            cfg.physicalChannel != null && cfg.physicalChannel >= 0
                ? cfg.physicalChannel
                : resolveBlockPhysicalChannel(cfg);
        const key = cfg.blockId != null ? `b:${cfg.blockId}` : `p:${phys != null ? phys : cfg.channel}`;
        motionHoldLocal.delete(key);
    }
}

function motionDriveForHold(m, drive, cfg) {
    const thr = cfg.driveTriggerLevel != null ? Number(cfg.driveTriggerLevel) : 0.85;
    if (m && m.triggered) return Math.max(drive, thr);
    return drive;
}
let stimulusMultimodalTickId = null;
const MULTIMODAL_TICK_MS = 80;

// 控制面板状态
let isMinimized = true; // 默认最小化
let isAlwaysOnTop = true;
let backgroundOpacity = 100;

/** 运行配置：方波高空白（更易看到方块后方/底层内容）；默认正弦 50% 亮暗各占半周期 */
let stimulusFlickerHighBlank = false;
/** 方波模式下每个周期内「亮段」占比 0.15～0.55 */
let stimulusFlickerOnDuty = 0.35;
/** 闪烁对象整体不透明度，便于看见下层图像/窗口 */
let stimulusFlickerBlockOpacity = 0.58;

// 标记是否是首次启动（用于判断是否需要倒计时）
let isFirstStart = true;

// 浮动按钮拖动状态
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let clickTimeout = null;

function isElectronShell() {
    return !!(window.ssvepElectron && window.ssvepElectron.isShell);
}

/** Electron 壳：窗口保持系统置顶（与主进程 alwaysOnTop 一致，避免运行中被其它窗盖住） */
function syncElectronWindowAlwaysOnTop() {
    if (!isElectronShell() || typeof window.ssvepElectron.setAlwaysOnTop !== 'function') return;
    window.ssvepElectron.setAlwaysOnTop(true);
}

function setupElectronShellChrome() {
    if (!isElectronShell()) return;

    document.body.classList.add('electron-shell');

    const winAct = document.getElementById('electron-window-actions');
    if (winAct) winAct.style.display = 'flex';

    const hint = document.getElementById('hint');
    const extra = document.getElementById('hint-shell-extra');
    const dismiss = document.getElementById('hint-dismiss');
    if (extra) extra.style.display = 'block';
    if (dismiss) {
        dismiss.style.display = 'block';
        dismiss.addEventListener('click', () => {
            hint?.classList.add('hidden');
            forceElectronPassthroughRecheck();
        });
    }
    setTimeout(() => {
        hint?.classList.add('hidden');
        forceElectronPassthroughRecheck();
    }, 14000);
    syncElectronWindowAlwaysOnTop();
}

let _stimulusRelayoutTimer = null;
function scheduleStimulusLayoutRelayout() {
    if (!project || !project.pages || !project.pages[currentPage]) return;
    const blocks = project.pages[currentPage].blocks;
    if (!Array.isArray(blocks) || blocks.length === 0) return;
    if (_stimulusRelayoutTimer) clearTimeout(_stimulusRelayoutTimer);
    _stimulusRelayoutTimer = setTimeout(() => {
        _stimulusRelayoutTimer = null;
        relayoutStimulusWhenContainerReady(blocks);
    }, 250);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    setupElectronShellChrome();

    loadProject();
    setupStimulusEegDeviceListenerOnce();
    ensureMultimodalDeviceListener();
    void ensureMultimodalEmgStream();
    setupKeyboardShortcuts();
    setupFloatingButtonDrag();
    applyStimulusDebugPanelUi();
    
    // 默认显示浮动按钮，隐藏控制面板
    document.getElementById('control-panel').classList.add('minimized');
    document.getElementById('floating-control-btn').style.display = 'flex';
    
    // 浏览器内：短提示；Electron 壳内由 setupElectronShellChrome 控制时长与「知道了」
    if (!isElectronShell()) {
        setTimeout(() => {
            document.getElementById('hint').classList.add('hidden');
        }, 3000);
    }

    window.addEventListener('resize', scheduleStimulusLayoutRelayout);

    if (isElectronShell()) {
        syncElectronWindowAlwaysOnTop();
        bumpElectronPassthroughGate(800);
    }

    setupElectronMousePassthrough();
});

function ensureStimulusPageShape(page) {
    if (!page || typeof page !== 'object') return;
    if (!Array.isArray(page.blocks)) page.blocks = [];
    if (!Array.isArray(page.multimodalBlocks)) page.multimodalBlocks = [];
}

/** 与编辑器一致：优先 `actions[]`，否则回退旧版单字段 `action` */
function getBlockActions(block) {
    if (!block || typeof block !== 'object') return [];
    if (Array.isArray(block.actions) && block.actions.length > 0) return block.actions;
    if (block.action && typeof block.action === 'object') return [block.action];
    return [];
}

function blockHasExecutableActions(block) {
    return getBlockActions(block).some((a) => a && a.type && a.type !== 'none');
}

function blockHasMouseActions(block) {
    return getBlockActions(block).some(
        (a) => a && (a.type === 'mouse_click' || a.type === 'mouse_double_click')
    );
}

/** 控制面板「Python 动作执行记录」 */
const STIMULUS_PYTHON_HISTORY_MAX = 20;
let stimulusPythonActionHistory = [];

function executeBlockActions(block, sourceBlock) {
    const who = sourceBlock || block;
    void executeBlockActionsAsync(block, who);
}

async function executeBlockActionsAsync(block, sourceBlock) {
    const who = sourceBlock || block;
    for (const action of getBlockActions(block)) {
        if (!action || !action.type || action.type === 'none') continue;
        if (action.type === 'python') {
            await executePythonAction(action, who);
        } else {
            executeAction(action, who);
        }
    }
}

function currentPageHasFlickerBlocks() {
    if (!project || !project.pages || !project.pages[currentPage]) return false;
    return (project.pages[currentPage].blocks || []).length > 0;
}

function rebuildMultimodalRuntimeConfigs(options) {
    const preserveDetector = !!(options && options.preserveDetectorState);
    multimodalRuntimeConfigs = [];
    if (!project || !project.pages || !project.pages[currentPage]) return;
    ensureStimulusPageShape(project.pages[currentPage]);
    const list = project.pages[currentPage].multimodalBlocks || [];
    for (const b of list) {
        if (typeof window.ssvepNormalizeMultimodalBlock === 'function') {
            window.ssvepNormalizeMultimodalBlock(b);
        }
        if (!window.ssvepIsMultimodalChannelId || !window.ssvepIsMultimodalChannelId(b.channel)) continue;
        const actions = getBlockActions(b);
        const role =
            typeof window.ssvepGetModalityRoleForChannel === 'function'
                ? window.ssvepGetModalityRoleForChannel(b.channel)
                : null;
        const isConfirmGate =
            typeof window.ssvepBlockHasConfirmSsvepAction === 'function' &&
            window.ssvepBlockHasConfirmSsvepAction(b);
        const isCancelGate =
            !isConfirmGate &&
            typeof window.ssvepBlockHasCancelSsvepAction === 'function' &&
            window.ssvepBlockHasCancelSsvepAction(b);
        multimodalRuntimeConfigs.push({
            channel: b.channel,
            blockId: b.id,
            physicalChannel: resolveBlockPhysicalChannel(b),
            triggerType:
                role === 'motor_imagery' ? 'hold' : b.triggerType === 'hold' ? 'hold' : 'edge',
            holdThresholdUv: b.holdThresholdUv,
            holdDurationMs: b.holdDurationMs,
            edgeJumpUv: b.edgeJumpUv,
            edgeWindowMs: b.edgeWindowMs,
            edgePolarity: b.edgePolarity,
            emgWindowSec: b.emgWindowSec,
            motionWindowSec: b.motionWindowSec,
            peakWindowSec: b.peakWindowSec,
            peakThresholdUv: b.peakThresholdUv,
            peakMaxUv: b.peakMaxUv,
            minBinFraction: b.minBinFraction,
            normGate: b.normGate,
            driveTriggerLevel: b.driveTriggerLevel,
            manualNormThresholds: !!b.manualNormThresholds,
            manualUpperThresholdUv:
                b.manualUpperThresholdUv != null ? Number(b.manualUpperThresholdUv) : 25,
            manualLowerThresholdUv:
                b.manualLowerThresholdUv != null ? Number(b.manualLowerThresholdUv) : 6,
            holdRepeatMs:
                typeof b.holdRepeatMs === 'number'
                    ? b.holdRepeatMs
                    : (typeof window.ssvepGetModalityRoleForChannel === 'function' &&
                      window.ssvepGetModalityRoleForChannel(b.channel) === 'motor_imagery'
                          ? 0
                          : 400),
            actions,
            isConfirmGate,
            isCancelGate,
            confirmTimeoutMs:
                isConfirmGate && b.confirmTimeoutMs != null && Number.isFinite(Number(b.confirmTimeoutMs))
                    ? Math.max(200, Number(b.confirmTimeoutMs))
                    : isConfirmGate
                      ? 1000
                      : undefined,
            prevActive: false,
            lastHoldFire: 0,
            lastEdgeFire: 0
        });
    }
    if (
        !preserveDetector &&
        window.SSVEP_MULTIMODAL_DETECTOR &&
        typeof window.SSVEP_MULTIMODAL_DETECTOR.resetStatesFromConfigs === 'function'
    ) {
        window.SSVEP_MULTIMODAL_DETECTOR.resetStatesFromConfigs(multimodalRuntimeConfigs);
    }
    if (!preserveDetector && window.SSVEP_EMG_MOTION_RUNTIME && typeof window.SSVEP_EMG_MOTION_RUNTIME.resetAll === 'function') {
        window.SSVEP_EMG_MOTION_RUNTIME.resetAll();
    }
    if (!preserveDetector) {
        resetMotionHoldLocal();
        clearSsvepPendingConfirm();
    }
    if (currentPageHasMultimodalBlocks()) {
        startMultimodalMotionTick();
    } else {
        stopMultimodalMotionTick();
    }
    updateMotionControlPanelUi(null);
}

function pageHasConfirmSsvepGates() {
    return multimodalRuntimeConfigs.some((c) => c.isConfirmGate);
}

function pageHasCancelSsvepGates() {
    return multimodalRuntimeConfigs.some((c) => c.isCancelGate);
}

function currentPageHasMultimodalBlocks() {
    if (!project || !project.pages || !project.pages[currentPage]) return false;
    ensureStimulusPageShape(project.pages[currentPage]);
    return (project.pages[currentPage].multimodalBlocks || []).length > 0;
}

function getConfirmSsvepTimeoutMs(opts) {
    return getSsvepMultimodalWaitMs(opts);
}

/** SSVEP 识别后多模态确认/取消等待窗（秒），默认 1 s，可在运行配置中调整 */
function getSsvepMultimodalWaitMs(opts) {
    const o = opts || stimulusRunOpts || readStimulusRunOptions();
    if (o && o.ssvepMultimodalWaitSec != null && Number.isFinite(Number(o.ssvepMultimodalWaitSec))) {
        return Math.max(200, Math.min(10000, Number(o.ssvepMultimodalWaitSec) * 1000));
    }
    let ms = 1000;
    for (const c of multimodalRuntimeConfigs) {
        if (!c.isConfirmGate) continue;
        const v = c.confirmTimeoutMs;
        if (v != null && Number.isFinite(Number(v))) ms = Math.min(ms, Math.max(200, Number(v)));
    }
    return ms;
}

let ssvepPendingConfirmTimer = null;

function clearSsvepPendingConfirm() {
    if (ssvepPendingConfirmTimer != null) {
        clearTimeout(ssvepPendingConfirmTimer);
        ssvepPendingConfirmTimer = null;
    }
    ssvepPendingConfirm = null;
}

function expireSsvepPendingConfirmDueToTimeout() {
    if (!ssvepPendingConfirm || ssvepPendingConfirm.cancelMode) return;
    const pending = ssvepPendingConfirm;
    const timeoutMs = pending.timeoutMs ?? getConfirmSsvepTimeoutMs();
    const label = pending.block?.label || pending.block?.frequency || '';
    clearSsvepPendingConfirm();
    setEegStatusLine(
        `SSVEP「${label}」未在 ${(timeoutMs / 1000).toFixed(1)}s 内确认，本次动作已跳过`
    );
}

function tryReleaseSsvepPendingAutoExecute() {
    if (!ssvepPendingConfirm || !ssvepPendingConfirm.cancelMode) return;
    const pending = ssvepPendingConfirm;
    clearSsvepPendingConfirm();
    setEegStatusLine(`已执行：${pending.block?.label || ''}`);
    handleBlockClick(pending.block);
    if (stimulusEegSessionActive) resetStimulusEegDecodeBaseline();
}

function onSsvepPendingConfirmTimerFired() {
    if (!ssvepPendingConfirm) return;
    if (ssvepPendingConfirm.cancelMode) tryReleaseSsvepPendingAutoExecute();
    else expireSsvepPendingConfirmDueToTimeout();
}

function scheduleSsvepPendingConfirmTimeout() {
    if (ssvepPendingConfirmTimer != null) {
        clearTimeout(ssvepPendingConfirmTimer);
        ssvepPendingConfirmTimer = null;
    }
    if (!ssvepPendingConfirm) return;
    const timeoutMs = ssvepPendingConfirm.cancelMode
        ? ssvepPendingConfirm.holdMs ?? getDecodeHighlightHoldMs(ssvepPendingConfirm.opts)
        : ssvepPendingConfirm.timeoutMs ?? getConfirmSsvepTimeoutMs();
    const remaining = Math.max(0, timeoutMs - (Date.now() - ssvepPendingConfirm.createdMs));
    ssvepPendingConfirmTimer = setTimeout(onSsvepPendingConfirmTimerFired, remaining);
}

function tickSsvepPendingConfirmTimeout() {
    if (!ssvepPendingConfirm) return;
    const timeoutMs = ssvepPendingConfirm.cancelMode
        ? ssvepPendingConfirm.holdMs ?? getDecodeHighlightHoldMs(ssvepPendingConfirm.opts)
        : ssvepPendingConfirm.timeoutMs ?? getConfirmSsvepTimeoutMs();
    if (Date.now() - ssvepPendingConfirm.createdMs >= timeoutMs) {
        onSsvepPendingConfirmTimerFired();
    }
}

/** @returns {boolean} true = 已排队等待多模态确认/取消窗，尚未执行动作 */
function queueOrExecuteSsvepTrigger(block, data, opts) {
    tickSsvepPendingConfirmTimeout();
    const waitMs = getSsvepMultimodalWaitMs(opts);
    if (pageHasConfirmSsvepGates()) {
        if (ssvepPendingConfirm) {
            const prev = ssvepPendingConfirm.block;
            clearSsvepPendingConfirm();
            if (prev && prev.id !== block.id) {
                setEegStatusLine(`上一识别「${prev.label || ''}」未确认，已由新识别取代`);
            }
        }
        ssvepPendingConfirm = {
            block,
            data,
            opts,
            createdMs: Date.now(),
            createdPerfMs: performance.now(),
            timeoutMs: waitMs,
            cancelMode: false
        };
        resetMotionHoldForPendingGates();
        scheduleSsvepPendingConfirmTimeout();
        const meta = window.SSVEP_MULTIMODAL_BY_ID;
        const gates = multimodalRuntimeConfigs
            .filter((c) => c.isConfirmGate)
            .map((c) => (meta && meta[c.channel] ? meta[c.channel].short : c.channel))
            .join(' / ');
        setEegStatusLine(
            `SSVEP 已识别 ${block.label || ''} — 请在 ${(waitMs / 1000).toFixed(1)}s 内由 ${gates} 确认`
        );
        if (opts) maybeSpeakDecodeResult(block, opts);
        return true;
    }
    if (pageHasCancelSsvepGates()) {
        if (ssvepPendingConfirm) {
            const prev = ssvepPendingConfirm.block;
            clearSsvepPendingConfirm();
            if (prev && prev.id !== block.id) {
                setEegStatusLine(`上一识别「${prev.label || ''}」已取消，由新识别取代`);
            }
        }
        ssvepPendingConfirm = {
            block,
            data,
            opts,
            createdMs: Date.now(),
            createdPerfMs: performance.now(),
            holdMs: waitMs,
            timeoutMs: waitMs,
            cancelMode: true
        };
        resetMotionHoldForPendingGates();
        scheduleSsvepPendingConfirmTimeout();
        const meta = window.SSVEP_MULTIMODAL_BY_ID;
        const gates = multimodalRuntimeConfigs
            .filter((c) => c.isCancelGate)
            .map((c) => (meta && meta[c.channel] ? meta[c.channel].short : c.channel))
            .join(' / ');
        setEegStatusLine(
            `SSVEP 已识别 ${block.label || ''} — ${(waitMs / 1000).toFixed(1)}s 内可用 ${gates} 取消，否则执行动作`
        );
        if (opts) maybeSpeakDecodeResult(block, opts);
        return true;
    }
    handleBlockClick(block);
    return false;
}

function tryReleaseSsvepPendingFromConfirm(cfg) {
    if (!ssvepPendingConfirm || !cfg || !cfg.isConfirmGate || ssvepPendingConfirm.cancelMode) return;
    const pending = ssvepPendingConfirm;
    clearSsvepPendingConfirm();
    clearDecodeTriggeredHighlight();
    setEegStatusLine(`已确认，执行：${pending.block.label || ''}`);
    if (pending.opts) maybeSpeakMultimodalGateResult(cfg, 'confirm', pending.opts);
    handleBlockClick(pending.block);
    if (stimulusEegSessionActive) resetStimulusEegDecodeBaseline();
}

function tryCancelSsvepPendingFromCancel(cfg) {
    if (!ssvepPendingConfirm || !cfg || !cfg.isCancelGate) return;
    const pending = ssvepPendingConfirm;
    clearSsvepPendingConfirm();
    clearDecodeTriggeredHighlight();
    setEegStatusLine(`已取消 SSVEP 动作：${pending.block?.label || ''}`);
    if (pending.opts) maybeSpeakMultimodalGateResult(cfg, 'cancel', pending.opts);
    if (stimulusEegSessionActive) resetStimulusEegDecodeBaseline();
}

function pickMultimodalScalar(channelId, physicalChannel, message, lastRow) {
    if (message && message.multimodal && typeof message.multimodal[channelId] === 'number') {
        return message.multimodal[channelId];
    }
    let idx = -1;
    if (physicalChannel != null && physicalChannel >= 0) {
        idx = physicalChannel;
    } else {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (CFG && typeof CFG.getMultimodalPhysicalIndex === 'function') {
            const phys = CFG.getMultimodalPhysicalIndex(channelId);
            if (phys != null && phys >= 0) idx = phys;
        }
    }
    if (idx < 0) {
        const meta = window.SSVEP_MULTIMODAL_BY_ID && window.SSVEP_MULTIMODAL_BY_ID[channelId];
        idx = meta ? meta.fallbackIndex : -1;
    }
    if (idx >= 0 && Array.isArray(lastRow) && lastRow.length > idx) {
        return Number(lastRow[idx]) || 0;
    }
    return null;
}

let motionBarsCanvas = null;
let motionBarsCtx = null;

function resolveBlockPhysicalChannel(block) {
    if (!block) return null;
    if (block.physicalChannel != null && Number.isFinite(Number(block.physicalChannel))) {
        return Number(block.physicalChannel);
    }
    const BARS = window.SSVEP_EMG_MOTION_BARS;
    if (BARS && typeof BARS.resolvePhysicalChannel === 'function') {
        const idx = BARS.resolvePhysicalChannel(block);
        return idx >= 0 ? idx : null;
    }
    const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
    if (CFG && block.channel && typeof CFG.getMultimodalPhysicalIndex === 'function') {
        const phys = CFG.getMultimodalPhysicalIndex(block.channel);
        if (phys != null && phys >= 0) return phys;
    }
    const meta = window.SSVEP_MULTIMODAL_BY_ID && block.channel ? window.SSVEP_MULTIMODAL_BY_ID[block.channel] : null;
    return meta && meta.fallbackIndex >= 0 ? meta.fallbackIndex : null;
}

function blockToMotionPanelCfg(block) {
    const role =
        typeof window.ssvepGetModalityRoleForChannel === 'function'
            ? window.ssvepGetModalityRoleForChannel(block.channel)
            : null;
    return {
        channel: block.channel,
        blockId: block.id,
        physicalChannel: resolveBlockPhysicalChannel(block),
        triggerType: role === 'motor_imagery' ? 'hold' : block.triggerType === 'hold' ? 'hold' : 'edge',
        holdDurationMs: block.holdDurationMs,
        holdRepeatMs: block.holdRepeatMs,
        actions: getBlockActions(block),
        isConfirmGate:
            typeof window.ssvepBlockHasConfirmSsvepAction === 'function' &&
            window.ssvepBlockHasConfirmSsvepAction(block),
        isCancelGate:
            typeof window.ssvepBlockHasCancelSsvepAction === 'function' &&
            window.ssvepBlockHasCancelSsvepAction(block),
        confirmTimeoutMs:
            block.confirmTimeoutMs != null && Number.isFinite(Number(block.confirmTimeoutMs))
                ? Math.max(200, Number(block.confirmTimeoutMs))
                : 1000,
        peakWindowSec: block.peakWindowSec,
        peakThresholdUv: block.peakThresholdUv,
        peakMaxUv: block.peakMaxUv,
        minBinFraction: block.minBinFraction,
        normGate: block.normGate,
        driveTriggerLevel: block.driveTriggerLevel,
        emgWindowSec: block.emgWindowSec,
        motionWindowSec: block.motionWindowSec,
        manualNormThresholds: !!block.manualNormThresholds,
        manualUpperThresholdUv:
            block.manualUpperThresholdUv != null ? Number(block.manualUpperThresholdUv) : 25,
        manualLowerThresholdUv:
            block.manualLowerThresholdUv != null ? Number(block.manualLowerThresholdUv) : 6
    };
}

function getMotionBlocksOnPage() {
    if (!project || !project.pages || !project.pages[currentPage]) return [];
    ensureStimulusPageShape(project.pages[currentPage]);
    const out = [];
    for (const b of project.pages[currentPage].multimodalBlocks || []) {
        if (typeof window.ssvepNormalizeMultimodalBlock === 'function') {
            window.ssvepNormalizeMultimodalBlock(b);
        }
        const role =
            typeof window.ssvepGetModalityRoleForChannel === 'function'
                ? window.ssvepGetModalityRoleForChannel(b.channel)
                : null;
        if (role !== 'motor_imagery') continue;
        out.push(b);
    }
    return out;
}

function getMotorRuntimeConfigs() {
    const DET = window.SSVEP_MULTIMODAL_DETECTOR;
    if (!DET || typeof DET.isMotorConfig !== 'function') return [];
    return multimodalRuntimeConfigs.filter((cfg) => DET.isMotorConfig(cfg));
}

function listMotorPhysicalIndices() {
    const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
    if (CFG && typeof CFG.getPhysicalChannelsForRole === 'function') {
        const arr = CFG.getPhysicalChannelsForRole('motor_imagery');
        if (Array.isArray(arr) && arr.length) return arr.slice();
    }
    const gdm = window.globalDeviceManager;
    const roles = gdm && typeof gdm.getChannelRoles === 'function' ? gdm.getChannelRoles() : null;
    if (Array.isArray(roles)) {
        const out = [];
        for (let i = 0; i < roles.length; i++) {
            if (roles[i] === 'motor_imagery') out.push(i);
        }
        if (out.length) return out;
    }
    return [];
}

function slotIdForPhysicalIndex(phys) {
    const BY_ID = window.SSVEP_MULTIMODAL_BY_ID;
    if (BY_ID) {
        for (const meta of Object.values(BY_ID)) {
            if (meta && meta.role === 'motor_imagery' && meta.fallbackIndex === phys) return meta.id;
        }
    }
    return phys === 3 ? 'motion_right' : 'motion_left';
}

/** 控制面板条形图：设备角色为「运动想象」的物理通道；参数优先取自当前页 MOTION 块 */
function getMotionPanelConfigs() {
    const motorPhys = listMotorPhysicalIndices();
    if (!motorPhys.length) return [];
    const blocks = getMotionBlocksOnPage();
    const blockByPhys = new Map();
    let template = null;
    for (const b of blocks) {
        const cfg = blockToMotionPanelCfg(b);
        template = template || cfg;
        const phys = cfg.physicalChannel;
        if (phys != null && phys >= 0 && motorPhys.includes(phys)) blockByPhys.set(phys, cfg);
    }
    const out = [];
    for (const phys of motorPhys) {
        if (blockByPhys.has(phys)) {
            out.push(blockByPhys.get(phys));
            continue;
        }
        const base = template || {};
        out.push({
            channel: slotIdForPhysicalIndex(phys),
            blockId: null,
            physicalChannel: phys,
            triggerType: 'hold',
            holdDurationMs: base.holdDurationMs != null ? base.holdDurationMs : 600,
            holdRepeatMs: 0,
            actions: [],
            driveTriggerLevel: base.driveTriggerLevel != null ? base.driveTriggerLevel : 0.85,
            emgWindowSec: base.emgWindowSec != null ? base.emgWindowSec : 1,
            motionWindowSec: base.motionWindowSec != null ? base.motionWindowSec : 1,
            peakWindowSec: base.peakWindowSec != null ? base.peakWindowSec : 0.6,
            peakThresholdUv: base.peakThresholdUv,
            peakMaxUv: base.peakMaxUv,
            minBinFraction: base.minBinFraction,
            normGate: base.normGate,
            manualNormThresholds: !!base.manualNormThresholds,
            manualUpperThresholdUv:
                base.manualUpperThresholdUv != null ? Number(base.manualUpperThresholdUv) : 25,
            manualLowerThresholdUv:
                base.manualLowerThresholdUv != null ? Number(base.manualLowerThresholdUv) : 6
        });
    }
    return out;
}

function isMotionCfg(cfg) {
    if (!cfg) return false;
    const DET = window.SSVEP_MULTIMODAL_DETECTOR;
    if (DET && typeof DET.isMotorConfig === 'function' && DET.isMotorConfig(cfg)) return true;
    const role =
        typeof window.ssvepGetModalityRoleForChannel === 'function' && cfg.channel
            ? window.ssvepGetModalityRoleForChannel(cfg.channel)
            : null;
    return role === 'motor_imagery';
}

function pickAggregateTriggerUi(list) {
    if (!list || !list.length) return null;
    const fired = list.find((u) => u.firedThisTick);
    if (fired) return fired;
    const held = list.find((u) => u.holdActive);
    if (held) return held;
    const above = list.filter((u) => u.aboveThreshold);
    if (above.length) return above.reduce((a, b) => ((b.drive || 0) > (a.drive || 0) ? b : a), above[0]);
    return list.reduce((a, b) => ((b.drive || 0) > (a.drive || 0) ? b : a), list[0]);
}

function pageHasMotionInput() {
    return currentPageHasMultimodalBlocks() && listMotorPhysicalIndices().length > 0;
}

function initMotionBarsCanvas() {
    if (!motionBarsCanvas) {
        motionBarsCanvas = document.getElementById('motion-bars-canvas');
        motionBarsCtx = motionBarsCanvas ? motionBarsCanvas.getContext('2d') : null;
    }
}

function cfgHasExecutableActions(cfg) {
    return (cfg.actions || []).some(
        (a) =>
            a &&
            a.type &&
            a.type !== 'none' &&
            a.type !== 'confirm_ssvep' &&
            a.type !== 'cancel_ssvep'
    );
}

function motionCfgLabel(cfg) {
    const meta = window.SSVEP_MULTIMODAL_BY_ID && cfg.channel ? window.SSVEP_MULTIMODAL_BY_ID[cfg.channel] : null;
    const short = meta ? meta.short : cfg.channel || '?';
    const ch =
        cfg.physicalChannel != null && Number.isFinite(Number(cfg.physicalChannel))
            ? ` Ch${Number(cfg.physicalChannel) + 1}`
            : '';
    return `${short}${ch}`;
}

function getMotionDetectionConfigs() {
    ensureMultimodalRuntimeConfigsReady();
    const blocks = getMotionBlocksOnPage();
    if (blocks.length) {
        return blocks.map((b) => {
            const rt = multimodalRuntimeConfigs.find((c) => c.blockId === b.id);
            return rt || blockToMotionPanelCfg(b);
        });
    }
    return multimodalRuntimeConfigs.filter((cfg) => isMotionCfg(cfg));
}

function metricForMotionCfg(metrics, cfg) {
    const phys =
        cfg.physicalChannel != null && cfg.physicalChannel >= 0
            ? cfg.physicalChannel
            : resolveBlockPhysicalChannel(cfg);
    if (phys != null && phys >= 0) {
        const byPhys = metrics.find((m) => m.physicalCh === phys);
        if (byPhys) return byPhys;
    }
    const label = motionCfgLabel(cfg);
    return metrics.find((m) => m.label === label) || null;
}

function tickLocalMotionHold(cfg, drive, tMs) {
    const thr = cfg.driveTriggerLevel != null ? Number(cfg.driveTriggerLevel) : 0.85;
    const needMs =
        cfg.holdDurationMs != null && Number.isFinite(Number(cfg.holdDurationMs))
            ? Math.max(50, Number(cfg.holdDurationMs))
            : 600;
    const release = thr * 0.88;
    const phys =
        cfg.physicalChannel != null && cfg.physicalChannel >= 0
            ? cfg.physicalChannel
            : resolveBlockPhysicalChannel(cfg);
    const key = cfg.blockId != null ? `b:${cfg.blockId}` : `p:${phys != null ? phys : cfg.channel}`;
    let st = motionHoldLocal.get(key);
    if (!st) st = { since: null, prevHold: false, lastFire: 0 };

    const prevHold = st.prevHold;
    if (drive >= thr - 1e-6) {
        if (st.since == null) st.since = tMs;
    } else if (drive <= release + 1e-6) {
        st.since = null;
    }

    const sustainMs = st.since != null ? Math.max(0, tMs - st.since) : 0;
    const holdActive = sustainMs >= needMs;
    let holdFireRepeat = false;
    const justBecame = holdActive && !prevHold;
    if (justBecame) {
        holdFireRepeat = true;
        st.lastFire = tMs;
    } else if (holdActive) {
        const repeatMs = typeof cfg.holdRepeatMs === 'number' ? cfg.holdRepeatMs : 0;
        if (repeatMs > 0 && tMs - st.lastFire >= repeatMs) {
            holdFireRepeat = true;
            st.lastFire = tMs;
        }
    }
    st.prevHold = holdActive;
    motionHoldLocal.set(key, st);

    return {
        sustainMs,
        needMs,
        holdActive,
        holdFireRepeat,
        justBecame,
        holdSince: st.since,
        aboveThreshold: drive >= thr,
        threshold: thr
    };
}

function runMotionBlockDetection(message, t, metrics, motorUiList) {
    const cfgs = getMotionDetectionConfigs();
    for (const cfg of cfgs) {
        const m = metricForMotionCfg(metrics, cfg);
        const drive = m ? m.drive : 0;
        const hold = tickLocalMotionHold(cfg, motionDriveForHold(m, drive, cfg), t);
        let firedThisTick = false;

        if (cfg.isConfirmGate) {
            if (
                hold.holdFireRepeat &&
                hold.justBecame &&
                ssvepPendingConfirm &&
                !ssvepPendingConfirm.cancelMode
            ) {
                tryReleaseSsvepPendingFromConfirm(cfg);
            }
        } else if (cfg.isCancelGate) {
            if (hold.holdFireRepeat && hold.justBecame && ssvepPendingConfirm) {
                tryCancelSsvepPendingFromCancel(cfg);
            }
        } else if (hold.holdFireRepeat) {
            const ran = [];
            for (const action of cfg.actions || []) {
                if (
                    action &&
                    action.type !== 'none' &&
                    action.type !== 'confirm_ssvep' &&
                    action.type !== 'cancel_ssvep'
                ) {
                    executeAction(action);
                    ran.push(action.type);
                }
            }
            firedThisTick = ran.length > 0;
            if (firedThisTick) {
                setEegStatusLine(`已触发 ${motionCfgLabel(cfg)}：${ran.join(', ')}`);
                const opts = stimulusRunOpts || readStimulusRunOptions();
                maybeSpeakMultimodalGateResult(cfg, 'trigger', opts);
            } else if (!cfgHasExecutableActions(cfg)) {
                console.warn('[MOTION] 已达触发条件，但块未配置动作:', cfg.channel, cfg.blockId);
            }
        }

        motorUiList.push({
            blockId: cfg.blockId,
            label: m ? m.label : motionCfgLabel(cfg),
            physicalChannel: m ? m.physicalCh : cfg.physicalChannel,
            drive,
            threshold: hold.threshold,
            sustainMs: hold.sustainMs,
            needMs: hold.needMs,
            holdActive: hold.holdActive,
            aboveThreshold: hold.aboveThreshold,
            inWarmup: false,
            warmupRemainMs: 0,
            hasActions: cfgHasExecutableActions(cfg),
            isConfirmGate: !!cfg.isConfirmGate,
            isCancelGate: !!cfg.isCancelGate,
            firedThisTick
        });
    }
}

function findTriggerUiForMetric(m, uiList) {
    if (!uiList || !uiList.length) return null;
    const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
    return (
        uiList.find((u) => u.label === m.label) ||
        uiList.find((u) => norm(u.label) === norm(m.label)) ||
        uiList.find((u) => u.physicalChannel === m.physicalCh) ||
        null
    );
}

function formatChannelTriggerFoot(m, ui) {
    const drive = m.drive;
    const thr = m.driveThreshold;
    if (ui) {
        if (ui.firedThisTick) return '成功触发（动作已执行）';
        if (ui.holdActive) return ui.hasActions ? '成功触发' : '成功触发·未配置动作';
        if (ui.inWarmup) return `预热 ${(ui.warmupRemainMs / 1000).toFixed(1)}s`;
        if (ui.aboveThreshold || drive >= thr) {
            return `达到触发门限 · 持续 ${Math.round(ui.sustainMs)}/${Math.round(ui.needMs)} ms`;
        }
    }
    if (drive >= thr) return `达到触发门限 · 持续 ${Math.round(ui.sustainMs)}/${Math.round(ui.needMs)} ms`;
    return `驱动 ${drive.toFixed(2)}/${thr.toFixed(2)}`;
}

async function ensureMotionStreamFresh(message) {
    const RUN = window.SSVEP_EMG_MOTION_RUNTIME;
    if (!RUN) return;
    if (typeof RUN.maintainStreamSync === 'function') RUN.maintainStreamSync(message);
    const len = typeof RUN.displayBufferLength === 'function' ? RUN.displayBufferLength() : 0;
    if (len === lastMotionBufSeen) motionBufStaleCount += 1;
    else {
        motionBufStaleCount = 0;
        lastMotionBufSeen = len;
    }
    const now = Date.now();
    const stale = motionBufStaleCount >= 2;
    const needPull = stale || len < 80 || now - lastMotionStreamPullMs > 450;
    if (needPull && typeof RUN.maintainStreamAsync === 'function') {
        lastMotionStreamPullMs = now;
        await RUN.maintainStreamAsync();
        lastMotionBufSeen = typeof RUN.displayBufferLength === 'function' ? RUN.displayBufferLength() : len;
        motionBufStaleCount = 0;
    }
}

function refreshMotionMetrics(message) {
    const BARS = window.SSVEP_EMG_MOTION_BARS;
    if (!BARS || typeof BARS.refreshMetricsForConfigs !== 'function') return [];
    return BARS.refreshMetricsForConfigs(getMotionPanelConfigs(), message || stimulusLastMotionMessage);
}
function formatMotionTriggerFoot(ui) {
    if (!ui) return '等待检测…';
    if (ui.isConfirmGate) {
        if (ssvepPendingConfirm && !ssvepPendingConfirm.cancelMode) {
            const timeoutMs = ssvepPendingConfirm.timeoutMs ?? getConfirmSsvepTimeoutMs();
            const remain = Math.max(0, timeoutMs - (Date.now() - ssvepPendingConfirm.createdMs));
            if (ui.holdActive) return `可确认 · 剩余 ${(remain / 1000).toFixed(1)}s`;
            if (ui.aboveThreshold) {
                return `确认门限 · 持续 ${Math.round(ui.sustainMs)}/${Math.round(ui.needMs)} ms · 剩 ${(remain / 1000).toFixed(1)}s`;
            }
            return `待确认 · 驱动 ${ui.drive.toFixed(2)}/${ui.threshold.toFixed(2)} · 剩 ${(remain / 1000).toFixed(1)}s`;
        }
        return '本块为 SSVEP 确认门，需先完成 SSVEP 识别';
    }
    if (ui.isCancelGate) {
        if (ssvepPendingConfirm) {
            const holdMs =
                ssvepPendingConfirm.holdMs ?? getDecodeHighlightHoldMs(ssvepPendingConfirm.opts);
            const remain = Math.max(0, holdMs - (Date.now() - ssvepPendingConfirm.createdMs));
            return `可取消 SSVEP · 剩余 ${(remain / 1000).toFixed(1)}s`;
        }
        return '本块为 SSVEP 取消门，需先完成 SSVEP 识别';
    }
    if (ui.inWarmup) return `预热 ${(ui.warmupRemainMs / 1000).toFixed(1)}s 后启用触发`;
    if (ui.firedThisTick) return '成功触发（动作已执行）';
    if (ui.holdActive) {
        return ui.hasActions ? '成功触发' : '成功触发，但未配置可执行动作';
    }
    if (ui.aboveThreshold) {
        return `达到触发门限 · 持续 ${Math.round(ui.sustainMs)}/${Math.round(ui.needMs)} ms`;
    }
    return `驱动 ${ui.drive.toFixed(2)} / 门限 ${ui.threshold.toFixed(2)}`;
}

function updateMotionTriggerPill(triggerUi) {
    const pill = document.getElementById('motion-trigger-pill');
    if (!pill) return;
    let cls = 'motion-stream-pill motion-stream-pill--wait';
    let text = '等待检测';
    if (!triggerUi) {
        pill.className = cls;
        pill.textContent = text;
        return;
    }
    if (triggerUi.inWarmup) {
        text = `预热 ${(triggerUi.warmupRemainMs / 1000).toFixed(1)}s`;
    } else if (triggerUi.firedThisTick) {
        cls = 'motion-stream-pill motion-stream-pill--hit';
        text = '成功触发';
    } else if (triggerUi.holdActive) {
        cls = 'motion-stream-pill motion-stream-pill--hit';
        text = triggerUi.hasActions ? '成功触发' : '成功触发·无动作';
    } else if (triggerUi.aboveThreshold) {
        cls = 'motion-stream-pill motion-stream-pill--live';
        text = '达到触发门限';
    } else {
        text = `驱动 ${triggerUi.drive.toFixed(2)}/${triggerUi.threshold.toFixed(2)}`;
    }
    pill.className = cls;
    pill.textContent = text;
}

function updateMotionStreamPill(health) {
    const pill = document.getElementById('motion-stream-pill');
    if (!pill) return;
    const h = health || {};
    let cls = 'motion-stream-pill motion-stream-pill--wait';
    let text = '等待设备';

    if (!h.connected) {
        text = '设备未连接';
    } else if (h.state === 'connecting') {
        text = '连接数据流…';
    } else if (h.state === 'buffering') {
        text = `缓冲中 ${h.buf || 0}`;
    } else if (h.state === 'live') {
        cls = 'motion-stream-pill motion-stream-pill--live';
        text = '实时';
    } else {
        text = h.wsOk ? `缓冲 ${h.buf || 0}` : 'WS 重连中';
    }
    pill.className = cls;
    pill.textContent = text;
}

function updateMotionControlPanelUi(message, precomputedMetrics) {
    const wrap = document.getElementById('motion-bars-wrap');
    const BARS = window.SSVEP_EMG_MOTION_BARS;
    const motorCfgs = getMotionPanelConfigs();
    if (!wrap) return;
    if (!currentPageHasMultimodalBlocks() || !listMotorPhysicalIndices().length || !motorCfgs.length) {
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = 'flex';
    initMotionBarsCanvas();
    const statusEl = document.getElementById('motion-drive-status');
    if (!BARS || !motionBarsCanvas || !motionBarsCtx) {
        if (statusEl) statusEl.textContent = '运动条形图模块未加载';
        return;
    }

    const RUN = window.SSVEP_EMG_MOTION_RUNTIME;
    const streamMsg = message || stimulusLastMotionMessage;

    const paintMotionBars = (metrics) => {
        const rows = metrics && metrics.length ? metrics : refreshMotionMetrics(streamMsg);
        const panelW = Math.max(260, Math.min(320, (wrap.clientWidth || 300) - 4));
        let normGate = 0.8;
        for (const c of motorCfgs) {
            const g = c.normGate != null ? Number(c.normGate) : 0.8;
            if (Number.isFinite(g)) normGate = Math.max(normGate, g);
        }
        BARS.drawMotionBars(motionBarsCanvas, motionBarsCtx, rows, {
            width: panelW,
            normGate,
            panel: true
        });
        const health = RUN && typeof RUN.getStreamHealth === 'function' ? RUN.getStreamHealth() : null;
        const triggerUi =
            pickAggregateTriggerUi(lastMotionTriggerUiList) ||
            lastMotionTriggerUi ||
            pickAggregateTriggerUi(
                rows.map((m) => {
                    const ui = findTriggerUiForMetric(m, lastMotionTriggerUiList);
                    return {
                        label: m.label,
                        drive: m.drive,
                        threshold: m.driveThreshold,
                        aboveThreshold: ui ? ui.aboveThreshold : m.drive >= m.driveThreshold,
                        holdActive: ui ? ui.holdActive : false,
                        inWarmup: ui ? ui.inWarmup : false,
                        warmupRemainMs: ui ? ui.warmupRemainMs : 0,
                        hasActions: ui ? ui.hasActions : false,
                        firedThisTick: ui ? ui.firedThisTick : false,
                        sustainMs: ui ? ui.sustainMs : 0,
                        needMs: ui ? ui.needMs : 600
                    };
                })
            );
        updateMotionTriggerPill(triggerUi);
        updateMotionStreamPill(health);
        if (statusEl) {
            if (!rows.length) {
                statusEl.textContent = health
                    ? `未绑定物理通道\n缓冲 ${health.buf} 样本 · ${health.wsOk ? 'WS 已连接' : 'WS 未连接'}`
                    : '未绑定物理通道';
            } else {
                const lines = rows.map((m) => {
                    const ui = findTriggerUiForMetric(m, lastMotionTriggerUiList);
                    return `${m.label}  norm ${m.norm.toFixed(2)}  驱动 ${m.drive.toFixed(2)}/${m.driveThreshold.toFixed(2)} — ${formatChannelTriggerFoot(m, ui)}`;
                });
                if (health) lines.push(`缓冲 ${health.buf} 样本`);
                if (
                    !lastMotionTriggerUiList.length &&
                    rows.some((m) => m.drive >= m.driveThreshold) &&
                    !getMotionDetectionConfigs().length
                ) {
                    lines.push('提示：当前页无 MOTION 方块，无法统计持续/触发动作');
                }
                statusEl.textContent = lines.join('\n');
            }
        }
    };

    if (precomputedMetrics) {
        paintMotionBars(precomputedMetrics);
        return;
    }

    void ensureMotionStreamFresh(streamMsg).then(() => {
        if (wrap.style.display === 'none') return;
        paintMotionBars(refreshMotionMetrics(streamMsg));
    });
    paintMotionBars(refreshMotionMetrics(streamMsg));
}

function ensureMultimodalRuntimeConfigsReady() {
    if (!project || !project.pages || !project.pages[currentPage]) return;
    const mm = project.pages[currentPage].multimodalBlocks || [];
    const motionBlocks = getMotionBlocksOnPage();
    const hasMotionRuntime = multimodalRuntimeConfigs.some((c) => isMotionCfg(c));
    if (motionBlocks.length && !hasMotionRuntime) {
        rebuildMultimodalRuntimeConfigs();
        return;
    }
    if (!multimodalRuntimeConfigs.length && mm.length) {
        rebuildMultimodalRuntimeConfigs();
    }
}

function processMultimodalRuntimeTick(message) {
    if (!project) return;
    tickSsvepPendingConfirmTimeout();
    ensureMultimodalRuntimeConfigsReady();
    const hasMotionUi = pageHasMotionInput();
    const t = performance.now();
    const DET = window.SSVEP_MULTIMODAL_DETECTOR;
    const motorUiList = [];

    if (DET && multimodalRuntimeConfigs.length) {
        for (const cfg of multimodalRuntimeConfigs) {
            if (isMotionCfg(cfg)) continue;

            const out = DET.processConfig(cfg, message || {}, t);
            const edgeFire = !!out.edgeFire;
            const holdFireRepeat = !!out.holdFireRepeat;

            if (cfg.isConfirmGate) {
                const pendingSince = ssvepPendingConfirm
                    ? ssvepPendingConfirm.createdPerfMs ?? ssvepPendingConfirm.createdMs
                    : null;
                if (cfg.triggerType === 'edge') {
                    if (
                        edgeFire &&
                        ssvepPendingConfirm &&
                        !ssvepPendingConfirm.cancelMode &&
                        pendingSince != null &&
                        t >= pendingSince
                    ) {
                        cfg.lastEdgeFire = t;
                        tryReleaseSsvepPendingFromConfirm(cfg);
                    }
                } else if (
                    holdFireRepeat &&
                    ssvepPendingConfirm &&
                    !ssvepPendingConfirm.cancelMode &&
                    pendingSince != null &&
                    t >= pendingSince
                ) {
                    cfg.lastHoldFire = t;
                    tryReleaseSsvepPendingFromConfirm(cfg);
                }
                continue;
            }

            if (cfg.isCancelGate) {
                const pendingSince = ssvepPendingConfirm
                    ? ssvepPendingConfirm.createdPerfMs ?? ssvepPendingConfirm.createdMs
                    : null;
                if (cfg.triggerType === 'edge') {
                    if (edgeFire && ssvepPendingConfirm && pendingSince != null && t >= pendingSince) {
                        cfg.lastEdgeFire = t;
                        tryCancelSsvepPendingFromCancel(cfg);
                    }
                } else if (holdFireRepeat && ssvepPendingConfirm && pendingSince != null && t >= pendingSince) {
                    cfg.lastHoldFire = t;
                    tryCancelSsvepPendingFromCancel(cfg);
                }
                continue;
            }

            if (cfg.triggerType === 'edge') {
                if (edgeFire) {
                    cfg.lastEdgeFire = t;
                    let ran = false;
                    for (const action of cfg.actions || []) {
                        if (
                            action &&
                            action.type !== 'none' &&
                            action.type !== 'confirm_ssvep' &&
                            action.type !== 'cancel_ssvep'
                        ) {
                            executeAction(action);
                            ran = true;
                        }
                    }
                    if (ran) {
                        const opts = stimulusRunOpts || readStimulusRunOptions();
                        maybeSpeakMultimodalGateResult(cfg, 'trigger', opts);
                    }
                }
            } else if (holdFireRepeat) {
                cfg.lastHoldFire = t;
                let ran = false;
                for (const action of cfg.actions || []) {
                    if (
                        action &&
                        action.type !== 'none' &&
                        action.type !== 'confirm_ssvep' &&
                        action.type !== 'cancel_ssvep'
                    ) {
                        executeAction(action);
                        ran = true;
                    }
                }
                if (ran) {
                    const opts = stimulusRunOpts || readStimulusRunOptions();
                    maybeSpeakMultimodalGateResult(cfg, 'trigger', opts);
                }
            }
        }
    }

    const metrics = hasMotionUi ? refreshMotionMetrics(message) : [];
    runMotionBlockDetection(message, t, metrics, motorUiList);

    lastMotionTriggerUiList = motorUiList;
    lastMotionTriggerUi = pickAggregateTriggerUi(motorUiList);

    if (hasMotionUi) {
        updateMotionControlPanelUi(message, metrics);
        void ensureMotionStreamFresh(message).then(() => {
            const fresh = refreshMotionMetrics(message);
            updateMotionControlPanelUi(message, fresh);
        });
    }
}

function onStimulusDeviceStream(event, message) {
    if (event === 'wsConnected' || event === 'statusChange') {
        void ensureMultimodalEmgStream();
        if (pageHasMotionInput()) updateMotionControlPanelUi(null);
        return;
    }
    if (event !== 'data' || !message) return;
    stimulusLastMotionMessage = message;
    if (!project) return;
    processMultimodalRuntimeTick(message);
}

function startMultimodalMotionTick() {
    stopMultimodalMotionTick();
    stimulusMultimodalTickId = setInterval(() => {
        processMultimodalRuntimeTick(null);
    }, MULTIMODAL_TICK_MS);
}

function stopMultimodalMotionTick() {
    if (stimulusMultimodalTickId != null) {
        clearInterval(stimulusMultimodalTickId);
        stimulusMultimodalTickId = null;
    }
}

async function ensureMultimodalEmgStream() {
    const RUN = window.SSVEP_EMG_MOTION_RUNTIME;
    if (!RUN || typeof RUN.ensureDeviceStream !== 'function') return;
    const gdm = window.globalDeviceManager;
    if (gdm) gdm.loadChannelConfig();
    try {
        await RUN.ensureDeviceStream();
    } catch (e) {
        console.warn('[stimulus] EMG stream:', e);
    }
}

function ensureMultimodalDeviceListener() {
    if (stimulusMultimodalListener || !window.globalDeviceManager) return;
    stimulusMultimodalListener = onStimulusDeviceStream;
    window.globalDeviceManager.addEventListener(stimulusMultimodalListener);
}

// 加载项目
function loadProject() {
    // 从localStorage加载
    const saved = localStorage.getItem('ssvep_project');
    
    if (saved) {
        try {
            project = JSON.parse(saved);
            currentPage = 0;
            project.currentPage = 0;
            for (const p of project.pages || []) ensureStimulusPageShape(p);

                applyRuntimePresentationOptions();
                applyFlickerOptionsFromRunConfig();

                // 加载当前页面的方块
            if (project.pages && project.pages[currentPage]) {
                const page = project.pages[currentPage];
                const blocks = page.blocks || [];
                const mm = page.multimodalBlocks || [];
                let summary = countStimulusTargetSummary(blocks);
                if (mm.length && !blocks.length) summary = `${mm.length} 多模态`;
                else if (mm.length) summary += ` + ${mm.length} 多模态`;
                document.getElementById('block-count').textContent = summary;
                
                relayoutStimulusWhenContainerReady(blocks);
                
                // 隐藏加载提示
                document.getElementById('loading').style.display = 'none';
                
                // 显示控制面板（最小化状态）
                document.getElementById('control-panel').classList.remove('hidden');
                // 默认最小化为浮动图标
                document.getElementById('floating-control-btn').style.display = 'flex';
                refreshPanelExitStopLabel();
                
                project.settings = project.settings || {};
                refreshStimulusSystemOptionUi();
                updateEegUiVisibility();
                void ssvepResetPythonSession();
                stimulusPythonActionHistory = [];
                renderPythonActionHistory();

                rebuildMultimodalRuntimeConfigs();
                ensureMultimodalDeviceListener();
                void ensureMultimodalEmgStream();
                ensureStimulusEegLoopRunning(true);

                if (currentPageHasFlickerBlocks()) {
                    setTimeout(() => startStimulus(), 500);
                } else if (pageHasMotionInput() || multimodalRuntimeConfigs.length) {
                    const st = document.getElementById('status-text');
                    if (st) {
                        st.textContent = '多模态监测中';
                        st.style.color = '#4CAF50';
                    }
                }
            } else {
                showError('未找到项目数据');
            }
        } catch (error) {
            showError('加载项目失败: ' + error.message);
        }
    } else {
        showError('未找到保存的项目，请先在编辑器中创建项目');
    }
}

/** 将编辑器画布坐标系映射到当前刺激容器（与保存时的 stimulusLayoutRef 一致） */
function getStimulusLayoutScale() {
    const container = document.getElementById('stimulus-container');
    if (!container || !project || !project.pages || !project.pages[currentPage]) {
        return { sx: 1, sy: 1 };
    }
    const ref = project.pages[currentPage].stimulusLayoutRef;
    const cr = container.getBoundingClientRect();
    const rw = ref && Number(ref.width) > 0 ? Number(ref.width) : 0;
    const rh = ref && Number(ref.height) > 0 ? Number(ref.height) : 0;
    if (!rw || !rh) return { sx: 1, sy: 1 };
    let cw = cr.width;
    let ch = cr.height;
    /* 未全屏时容器可能尚未完成布局，rect 为 0 会导致方块宽高为 0 不可见 */
    if (cw < 32 || ch < 32) {
        cw = window.innerWidth || rw;
        ch = window.innerHeight || rh;
    }
    return { sx: cw / rw, sy: ch / rh };
}

function relayoutStimulusWhenContainerReady(blocks, attempt = 0) {
    const container = document.getElementById('stimulus-container');
    const r = container ? container.getBoundingClientRect() : { width: 0, height: 0 };
    if (r.width >= 32 && r.height >= 32) {
        createStimulusBlocks(blocks);
        return;
    }
    if (attempt < 48) {
        requestAnimationFrame(() => relayoutStimulusWhenContainerReady(blocks, attempt + 1));
    } else {
        createStimulusBlocks(blocks);
    }
}

function ssvepKb40() {
    return window.SSVEP_KEYBOARD_40 || null;
}

function isSsvepKeyboardBlock(block) {
    const KB = ssvepKb40();
    return KB ? KB.isSsvepKeyboardBlock(block) : !!(block && block.shape === 'ssvep_keyboard');
}

function countStimulusTargetSummary(blocks) {
    let keys = 0;
    let objs = 0;
    for (const b of blocks || []) {
        if (isSsvepKeyboardBlock(b)) keys += 40;
        else objs += 1;
    }
    if (keys > 0 && objs === 0) return `${keys} 键`;
    if (keys > 0) return `${keys} 键 + ${objs}`;
    return String((blocks || []).length);
}

function refreshStimulusDecodeTargetList(blocks) {
    const KB = ssvepKb40();
    if (KB) {
        currentPageBlockList = KB.expandPageBlocksForDecode(blocks || []);
        return;
    }
    currentPageBlockList = Array.isArray(blocks) ? blocks.slice() : [];
}

function isTransparentRunBackground() {
    const cfg = readStimulusRunOptions();
    return !!(cfg && cfg.transparentBackground);
}

/**
 * 透明叠窗时半透明+screen 混合会严重削弱 SSVEP 对比度；键盘默认实心黑底，其它对象可单独开启。
 */
function shouldBlockUseOpaqueFlickerBackdrop(block) {
    if (!block) return false;
    return block.opaqueFlickerRegion === true;
}

function appendStimulusFlickerEntry(element, target, baseColor, opaqueBackdrop) {
    stimulusBlocks.push({
        element,
        frequency: target.frequency,
        phase: target.phase,
        baseColor: baseColor || target.color || '#00D9FF',
        decodeTarget: target,
        opaqueBackdrop: !!opaqueBackdrop
    });
}

function applyOpaqueBackdropToElement(el, enabled) {
    if (!el) return;
    if (enabled) {
        el.style.mixBlendMode = 'normal';
        el.dataset.ssvepOpaqueFlicker = '1';
    } else {
        el.style.mixBlendMode =
            stimulusFlickerBlockOpacity < 0.95 ? 'screen' : 'normal';
        delete el.dataset.ssvepOpaqueFlicker;
    }
}

function createStimulusKeyboardDom(block, sx, sy, container) {
    const KB = ssvepKb40();
    if (!KB) return;
    const wrap = document.createElement('div');
    wrap.className = 'stimulus-block stimulus-keyboard-wrap';
    wrap.id = `stimulus-${block.id}`;
    wrap.style.left = block.x * sx + 'px';
    wrap.style.top = block.y * sy + 'px';
    wrap.style.width = block.width * sx + 'px';
    wrap.style.height = block.height * sy + 'px';
    wrap.style.transformOrigin = 'center center';
    wrap.style.transform = `rotate(${Number(block.rotation) || 0}deg)`;
    wrap.style.opacity = '1';
    const kbOpaque = shouldBlockUseOpaqueFlickerBackdrop(block);
    if (kbOpaque) {
        wrap.style.backgroundColor = '#000000';
        wrap.style.mixBlendMode = 'normal';
    } else {
        wrap.style.backgroundColor = 'transparent';
        wrap.style.mixBlendMode = stimulusFlickerBlockOpacity < 0.95 ? 'screen' : 'normal';
    }
    wrap.style.cursor = 'default';

    const virtuals = KB.buildKeyboardVirtualTargets(block);
    const byId = Object.fromEntries(virtuals.map((v) => [v.keyId, v]));
    const accent = block.color || '#00D9FF';

    for (const row of KB.KB_ROWS) {
        const rowEl = document.createElement('div');
        rowEl.className = 'ssvep-kb-row';
        for (const cell of row) {
            const vt = byId[cell.id];
            if (!vt) continue;
            const flex = cell.flex != null ? cell.flex : 1;
            const keyEl = document.createElement('div');
            keyEl.className =
                'stimulus-block stimulus-kb-key' + (flex > 1.2 ? ' ssvep-kb-wide' : '');
            keyEl.id = `stimulus-${vt.id}`;
            keyEl.style.flex = `${flex} 1 0`;
            keyEl.innerHTML = `<span class="stimulus-kb-label">${escapeHtml(vt.label)}</span>`;
            keyEl.style.cursor = 'pointer';
            keyEl.addEventListener('click', (e) => {
                e.stopPropagation();
                handleBlockClick(vt);
            });
            rowEl.appendChild(keyEl);
            applyOpaqueBackdropToElement(keyEl, kbOpaque);
            appendStimulusFlickerEntry(keyEl, vt, accent, kbOpaque);
        }
        wrap.appendChild(rowEl);
    }
    container.appendChild(wrap);
}

// 创建刺激方块
function createStimulusBlocks(blocks) {
    refreshStimulusDecodeTargetList(blocks);
    const container = document.getElementById('stimulus-container');
    container.innerHTML = '';
    stimulusBlocks = [];

    const { sx, sy } = getStimulusLayoutScale();

    blocks.forEach((block) => {
        if (isSsvepKeyboardBlock(block)) {
            createStimulusKeyboardDom(block, sx, sy, container);
            return;
        }

        const blockEl = document.createElement('div');
        blockEl.className = 'stimulus-block';
        blockEl.id = `stimulus-${block.id}`;

        blockEl.style.left = block.x * sx + 'px';
        blockEl.style.top = block.y * sy + 'px';
        blockEl.style.width = block.width * sx + 'px';
        blockEl.style.height = block.height * sy + 'px';
        blockEl.textContent = block.label;
        blockEl.style.opacity = '1';
        const blockOpaque = shouldBlockUseOpaqueFlickerBackdrop(block);
        if (blockOpaque) {
            blockEl.style.backgroundColor = '#000000';
            blockEl.style.mixBlendMode = 'normal';
        } else {
            blockEl.style.mixBlendMode = stimulusFlickerBlockOpacity < 0.95 ? 'screen' : 'normal';
        }

        blockEl.style.borderRadius = '8px';
        blockEl.style.clipPath = 'none';
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
        blockEl.style.transformOrigin = 'center center';
        blockEl.style.transform = `rotate(${Number(block.rotation) || 0}deg)`;

        blockEl.style.cursor = 'pointer';
        blockEl.addEventListener('click', () => {
            handleBlockClick(block);
        });

        container.appendChild(blockEl);
        appendStimulusFlickerEntry(blockEl, block, block.color, blockOpaque);
    });
}

/** 透明刺激窗叠在浏览器上时，先 blur 刺激窗以便 pynput 把键送到已聚焦的下层输入框 */
async function prepareSystemKeyTargetFocus() {
    if (isElectronShell() && typeof window.ssvepElectron?.blurStimulusWindow === 'function') {
        try {
            await window.ssvepElectron.blurStimulusWindow();
            await new Promise((r) => setTimeout(r, 100));
        } catch (e) {
            console.warn('blurStimulusWindow failed', e);
        }
        return;
    }
    if (isTransparentRunBackground() && document.activeElement === document.body) {
        window.blur();
    }
}

async function ssvepSendKeyboardChords(chords) {
    await prepareSystemKeyTargetFocus();
    const origin =
        typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
    const res = await fetch(`${origin}/api/system/keyboard/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chords })
    });
    let msg = '';
    try {
        const j = await res.json();
        if (j && typeof j.detail === 'string') msg = j.detail;
        else if (Array.isArray(j.detail))
            msg = j.detail
                .map((x) => (typeof x === 'object' && x.msg ? x.msg : String(x)))
                .join('; ');
    } catch (_) {
        /* ignore */
    }
    if (!res.ok) throw new Error(msg || `HTTP ${res.status}`);
}

async function ssvepExecutePythonCode(code, globalCode, sourceLabel) {
    const origin =
        typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
    const res = await fetch(`${origin}/api/system/python/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code,
            global_code: globalCode || '',
            source_label: sourceLabel || ''
        })
    });
    let payload = null;
    let msg = '';
    try {
        payload = await res.json();
        if (payload && typeof payload.detail === 'string') msg = payload.detail;
        else if (Array.isArray(payload.detail))
            msg = payload.detail
                .map((x) => (typeof x === 'object' && x.msg ? x.msg : String(x)))
                .join('; ');
        else if (payload && typeof payload.output === 'string') msg = payload.output;
    } catch (_) {
        /* ignore */
    }
    if (!res.ok) {
        const err = new Error(msg || `HTTP ${res.status}`);
        err.payload = payload;
        throw err;
    }
    return {
        output: (payload && payload.output) || msg || '执行成功',
        global_executed: !!(payload && payload.global_executed),
        global_cached: !!(payload && payload.global_cached),
        duration_ms: payload && payload.duration_ms != null ? payload.duration_ms : null
    };
}

async function ssvepResetPythonSession() {
    const origin =
        typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
    try {
        await fetch(`${origin}/api/system/python/reset-session`, { method: 'POST' });
    } catch (e) {
        console.warn('[stimulus] python reset-session:', e);
    }
}

async function ssvepSendMouseDoubleClickRaw(x, y) {
    const origin =
        typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
    const res = await fetch(`${origin}/api/system/mouse/double-click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y })
    });
    let msg = '';
    try {
        const j = await res.json();
        if (j && typeof j.detail === 'string') msg = j.detail;
        else if (Array.isArray(j.detail))
            msg = j.detail
                .map((x) => (typeof x === 'object' && x.msg ? x.msg : String(x)))
                .join('; ');
    } catch (_) {
        /* ignore */
    }
    if (!res.ok) throw new Error(msg || `HTTP ${res.status}`);
}

async function ssvepSendMouseClickRaw(x, y) {
    const origin =
        typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
    const res = await fetch(`${origin}/api/system/mouse/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y })
    });
    let msg = '';
    try {
        const j = await res.json();
        if (j && typeof j.detail === 'string') msg = j.detail;
        else if (Array.isArray(j.detail))
            msg = j.detail
                .map((x) => (typeof x === 'object' && x.msg ? x.msg : String(x)))
                .join('; ');
    } catch (_) {
        /* ignore */
    }
    if (!res.ok) throw new Error(msg || `HTTP ${res.status}`);
}

async function runSsvepMouseActionQueued(kind, x, y) {
    const minGap =
        kind === 'double' ? SSVEP_MOUSE_DOUBLE_CLICK_MIN_GAP_MS : SSVEP_MOUSE_CLICK_MIN_GAP_MS;
    const now = Date.now();
    const last = kind === 'double' ? ssvepLastMouseDoubleClickSentMs : ssvepLastMouseClickSentMs;
    const wait = last + minGap - now;
    if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
    }
    if (kind === 'double') {
        await ssvepSendMouseDoubleClickRaw(x, y);
        ssvepLastMouseDoubleClickSentMs = Date.now();
    } else {
        await ssvepSendMouseClickRaw(x, y);
        ssvepLastMouseClickSentMs = Date.now();
    }
}

function enqueueSsvepMouseAction(kind, x, y) {
    ssvepMouseQueueChain = ssvepMouseQueueChain
        .then(() => runSsvepMouseActionQueued(kind, x, y))
        .catch((err) => {
            console.error('鼠标动作失败:', err);
            throw err;
        });
    return ssvepMouseQueueChain;
}

/** 刺激方块 DOM 几何中心 → 屏幕像素（Electron 用主进程 getContentBounds 修正任务栏/边框偏差） */
async function getStimulusBlockCenterScreenPxAsync(block) {
    if (!block) return null;
    const el = document.getElementById(`stimulus-${block.id}`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width * 0.5;
    const cy = r.top + r.height * 0.5;
    if (isElectronShell() && typeof window.ssvepElectron?.viewportPointToScreen === 'function') {
        try {
            return await window.ssvepElectron.viewportPointToScreen(cx, cy);
        } catch (e) {
            console.warn('viewportPointToScreen failed', e);
        }
    }
    const sx = typeof window.screenX === 'number' ? window.screenX : window.screenLeft || 0;
    const sy = typeof window.screenY === 'number' ? window.screenY : window.screenTop || 0;
    return { x: sx + cx, y: sy + cy };
}

let _electronPassthroughLast = null;
let _electronPointerClient = { x: 0, y: 0 };
/** 此时间之前不开启鼠标穿透，避免启动瞬间焦点被下层窗口抢走、窗口「消失」 */
let _electronPassthroughGateUntil = 0;

function bumpElectronPassthroughGate(extraMs) {
    const t = performance.now() + (extraMs || 0);
    if (t > _electronPassthroughGateUntil) _electronPassthroughGateUntil = t;
}

function panelExitStopOrStart() {
    if (isRunning) stopStimulus();
    else startStimulus();
}

function refreshPanelExitStopLabel() {
    const b = document.getElementById('panel-stop-btn');
    if (b) b.textContent = isRunning ? '停止视觉' : '开始视觉';
}

function isElectronInteractiveHit(clientX, clientY) {
    const candidates = [
        'floating-control-btn',
        'control-panel',
        'hint',
        'hint-dismiss',
        'stimulus-container'
    ];
    for (const id of candidates) {
        const el = document.getElementById(id);
        if (!el) continue;
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        if (id === 'hint' && el.classList.contains('hidden')) continue;
            if (id === 'stimulus-container') {
            const hit = document.elementFromPoint(clientX, clientY);
            if (
                !hit ||
                !hit.closest ||
                (!hit.closest('.stimulus-kb-key') && !hit.closest('.stimulus-block'))
            )
                continue;
        }
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return true;
    }
    return false;
}

function refreshElectronMousePassthroughFromPoint(clientX, clientY) {
    if (!isElectronShell() || typeof window.ssvepElectron?.setMousePassthrough !== 'function') return;
    if (performance.now() < _electronPassthroughGateUntil) {
        if (_electronPassthroughLast !== false) {
            _electronPassthroughLast = false;
            window.ssvepElectron.setMousePassthrough(false, true).catch(() => {});
        }
        return;
    }
    const overUi = isElectronInteractiveHit(clientX, clientY);
    const passthrough = !overUi;
    if (_electronPassthroughLast === passthrough) return;
    _electronPassthroughLast = passthrough;
    window.ssvepElectron.setMousePassthrough(passthrough, true).catch(() => {});
}

function forceElectronPassthroughRecheck() {
    _electronPassthroughLast = null;
    refreshElectronMousePassthroughFromPoint(_electronPointerClient.x, _electronPointerClient.y);
}

function setupElectronMousePassthrough() {
    if (!isElectronShell() || typeof window.ssvepElectron?.setMousePassthrough !== 'function') return;
    document.addEventListener(
        'mousemove',
        (e) => {
            _electronPointerClient.x = e.clientX;
            _electronPointerClient.y = e.clientY;
            refreshElectronMousePassthroughFromPoint(e.clientX, e.clientY);
        },
        true
    );
    _electronPassthroughLast = null;
    refreshElectronMousePassthroughFromPoint(0, 0);
}

function refreshStimulusSystemOptionUi() {
    const btn = document.getElementById('stimulus-system-option-btn');
    const hint = document.getElementById('stimulus-system-option-hint');
    if (!btn || !project) return;
    const on = !!(project.settings && project.settings.systemKeyboardBridge);
    btn.textContent = on ? '✓ 系统选项已启用' : '启用系统选项（键鼠）';
    if (hint) hint.style.display = on ? 'none' : 'block';
}

async function toggleStimulusSystemOption() {
    if (!project) return;
    project.settings = project.settings || {};
    const next = !project.settings.systemKeyboardBridge;
    if (next) {
        const origin =
            typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
        try {
            const r = await fetch(`${origin}/api/system/keyboard/status`);
            const j = await r.json();
            if (!j.available) {
                alert(
                    '暂时无法启用：\n' +
                        (j.detail || '后端不可用') +
                        '\n\n请先启动 Python 后端并安装：pip install pynput'
                );
                return;
            }
        } catch (e) {
            console.error(e);
            alert('无法连接后端，请先启动 SSVEP Python API（默认端口 8000）。');
            return;
        }
    }
    project.settings.systemKeyboardBridge = next;
    try {
        const raw = localStorage.getItem('ssvep_project');
        const shell = raw ? JSON.parse(raw) : {};
        shell.settings = { ...(shell.settings || {}), systemKeyboardBridge: next };
        shell.pages = project.pages;
        shell.currentPage = currentPage;
        localStorage.setItem('ssvep_project', JSON.stringify(shell));
    } catch (e) {
        console.warn('保存系统选项失败', e);
    }
    refreshStimulusSystemOptionUi();
}


function hideStimulusPresentation() {
    const c = document.getElementById('stimulus-container');
    if (!c) return;
    c.style.visibility = 'hidden';
}

function showStimulusPresentation() {
    const c = document.getElementById('stimulus-container');
    if (!c) return;
    c.style.visibility = 'visible';
}
// 处理对象点击
function handleBlockClick(block) {
    console.log('对象被点击:', block.label);

    // 视觉反馈
    const blockEl = document.getElementById(`stimulus-${block.id}`);
    if (blockEl) {
        blockEl.style.transform = 'scale(0.95)';
        setTimeout(() => {
            blockEl.style.transform = 'scale(1)';
        }, 100);
    }

    // 执行动作（鼠标双击等需当前方块上下文以计算屏幕坐标）
    executeBlockActions(block, block);
}


function pushPythonActionLog(entry) {
    if (!entry) return;
    stimulusPythonActionHistory.unshift(entry);
    if (stimulusPythonActionHistory.length > STIMULUS_PYTHON_HISTORY_MAX) {
        stimulusPythonActionHistory.length = STIMULUS_PYTHON_HISTORY_MAX;
    }
    if (isStimulusDebugOpen()) {
        renderPythonActionHistory();
    }
}

function isStimulusDebugOpen() {
    return localStorage.getItem('seekbci_stimulus_debug') === '1';
}

function toggleStimulusDebugPanel() {
    const open = !isStimulusDebugOpen();
    localStorage.setItem('seekbci_stimulus_debug', open ? '1' : '0');
    applyStimulusDebugPanelUi();
}

function applyStimulusDebugPanelUi() {
    const open = isStimulusDebugOpen();
    const panel = document.getElementById('stimulus-debug-panel');
    const btn = document.getElementById('stimulus-debug-toggle-btn');
    if (panel) panel.style.display = open ? 'block' : 'none';
    if (btn) btn.textContent = open ? '🐛 Debug：开' : '🐛 Debug：关';
}

window.toggleStimulusDebugPanel = toggleStimulusDebugPanel;

function summarizePythonCode(code) {
    const one = String(code || '').replace(/\s+/g, ' ').trim();
    const call = one.match(/([a-zA-Z_][\w]*)\s*\(/);
    return call ? call[1] + '()' : one.slice(0, 36) || '（空）';
}

function renderPythonActionHistory() {
    const el = document.getElementById('python-action-history');
    if (!el) return;
    if (!stimulusPythonActionHistory.length) {
        el.innerHTML = '<div class="eeg-history-empty">暂无记录</div>';
        return;
    }
    el.innerHTML = stimulusPythonActionHistory
        .map((e, i) => {
            const time = new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false });
            const cls = ['eeg-history-item', 'python-history-item', e.success ? 'ok' : 'fail', i === 0 ? 'eeg-history-top' : '']
                .filter(Boolean)
                .join(' ');
            const icon = e.success ? '✓' : '✗';
            const fn = summarizePythonCode(e.code);
            const out = e.success
                ? String(e.output || '').split('\n')[0].slice(0, 48)
                : String(e.error || '失败').slice(0, 48);
            return `<div class="${cls}" style="font-size:11px;line-height:1.45;">
                <span class="eeg-history-time">${time}</span>
                <strong>${icon}</strong> ${escapeHtml(e.sourceLabel || 'Python')}
                · <code style="color:#90caf9;">${escapeHtml(fn)}</code>
                ${out ? `<span style="color:${e.success ? '#a5d6a7' : '#ef9a9a'};"> — ${escapeHtml(out)}</span>` : ''}
            </div>`;
        })
        .join('');
}

function getProjectPythonGlobalCodeForRun() {
    const settings = (project && project.settings) || {};
    let globalCode = typeof settings.pythonGlobalCode === 'string' ? settings.pythonGlobalCode : '';
    if (!globalCode.trim() && Array.isArray(settings.pythonImports)) {
        globalCode = settings.pythonImports.filter((s) => typeof s === 'string' && s.trim()).join('\n');
    }
    return globalCode;
}

async function executePythonAction(action, sourceBlock) {
    const code = (action.content || '').trim();
    if (!code) return;
    const globalCode = getProjectPythonGlobalCodeForRun();
    const sourceLabel =
        (sourceBlock && (sourceBlock.label || sourceBlock.id != null ? `对象#${sourceBlock.id}` : '')) || 'Python';
    const ts = Date.now();
    console.log('[Python]', sourceLabel, code, globalCode ? '(with global)' : '(no global)');
    try {
        const result = await ssvepExecutePythonCode(code, globalCode, sourceLabel);
        pushPythonActionLog({
            ts,
            success: true,
            sourceLabel,
            code,
            output: result.output,
            global_executed: result.global_executed,
            global_cached: result.global_cached,
            duration_ms: result.duration_ms
        });
        const statusText = `Python ✓ ${sourceLabel}: ${String(result.output || 'OK').slice(0, 100)}`;
        setEegStatusLine(statusText);
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.textContent = statusText.slice(0, 80);
    } catch (err) {
        console.error(err);
        pushPythonActionLog({
            ts,
            success: false,
            sourceLabel,
            code,
            error: err.message || String(err),
            global_executed: false,
            global_cached: false,
            duration_ms: null
        });
        const statusText = `Python ✗ ${sourceLabel}: ${err.message || String(err)}`;
        setEegStatusLine(statusText);
        const statusEl = document.getElementById('status-text');
        if (statusEl) statusEl.textContent = 'Python 执行失败';
        alert(`Python 执行失败（${sourceLabel}）：\n${err.message || String(err)}\n\n请查看控制面板「Python 动作记录」。`);
    }
}

// 执行动作；sourceBlock 为触发方块的引用（仅 mouse_double_click 等需要）
function executeAction(action, sourceBlock) {
    switch(action.type) {
        case 'python':
            void executePythonAction(action, sourceBlock);
            break;
            
        case 'keyboard': {
            const binding = parseKeyboardBinding(action.content);
            const label = formatKeyboardBindingDisplay(binding);
            console.log('触发键盘快捷键:', action.content, label);
            if (binding && binding.legacyText) {
                alert(
                    '当前快捷键为旧版文本，请在项目编辑器中重新用「录制快捷键」绑定后再试。'
                );
                break;
            }
            if (!binding || !binding.chords || binding.chords.length === 0) {
                alert('未绑定快捷键。');
                break;
            }
            const bridgeOn = !!(project && project.settings && project.settings.systemKeyboardBridge);
            if (!bridgeOn) {
                alert(
                    `未启用系统键盘：「${label}」\n\n请先在编辑器的「启动系统选项」中开启，并保证本机 Python 后端在运行（浏览器无法直接向其他软件注入按键）。`
                );
                break;
            }
            ssvepSendKeyboardChords(binding.chords).catch((err) => {
                console.error(err);
                alert(`按键发送失败：${err.message || String(err)}\n请确认后端已启动且已安装 pynput。`);
            });
            if (isTransparentRunBackground()) {
                setEegStatusLine(
                    '已发送按键：请先让下层窗口（如浏览器输入框）处于焦点；透明运行时刺激窗不会抢焦点'
                );
            }
            break;
        }

        case 'mouse_click': {
            const bridgeOn = !!(project && project.settings && project.settings.systemKeyboardBridge);
            if (!bridgeOn) {
                alert(
                    '未启用系统选项：鼠标单击需由本机后端注入。\n\n请在编辑器的「启动系统选项」中开启，并保证 Python 后端与 pynput 可用。'
                );
                break;
            }
            if (!sourceBlock) {
                alert('鼠标单击动作仅适用于闪烁方块（缺少方块上下文）。');
                break;
            }
            void (async () => {
                const pos = await getStimulusBlockCenterScreenPxAsync(sourceBlock);
                if (!pos) {
                    alert('无法取得方块在屏幕上的位置（未找到刺激页上的该对象）。');
                    return;
                }
                try {
                    await enqueueSsvepMouseAction('click', pos.x, pos.y);
                } catch (err) {
                    console.error(err);
                    const msg = err.message || String(err);
                    if (!msg.includes('过于频繁')) {
                        alert(`鼠标单击发送失败：${msg}\n请确认后端已启动且已安装 pynput。`);
                    }
                }
            })();
            break;
        }

        case 'mouse_double_click': {
            const bridgeOn = !!(project && project.settings && project.settings.systemKeyboardBridge);
            if (!bridgeOn) {
                alert(
                    '未启用系统选项：鼠标双击需由本机后端注入。\n\n请在编辑器的「启动系统选项」中开启，并保证 Python 后端与 pynput 可用。'
                );
                break;
            }
            if (!sourceBlock) {
                alert('鼠标双击动作仅适用于闪烁方块（缺少方块上下文）。');
                break;
            }
            void (async () => {
                const pos = await getStimulusBlockCenterScreenPxAsync(sourceBlock);
                if (!pos) {
                    alert('无法取得方块在屏幕上的位置（未找到刺激页上的该对象）。');
                    return;
                }
                try {
                    await enqueueSsvepMouseAction('double', pos.x, pos.y);
                } catch (err) {
                    console.error(err);
                    const msg = err.message || String(err);
                    if (!msg.includes('过于频繁')) {
                        alert(`鼠标双击发送失败：${msg}\n请确认后端已启动且已安装 pynput。`);
                    }
                }
            })();
            break;
        }

        case 'page_link': {
            if (action.targetPage !== null && action.targetPage !== undefined) {
                const delayMs = resolvePageLinkDelayMs(action);
                console.log('跳转到页面:', action.targetPage, 'delayMs=', delayMs);

                setTimeout(() => {
                    const wasRunning = isRunning;
                    if (wasRunning) stopStimulus();
                    hideStimulusPresentation();
                    showStimulusPresentation();
                    switchToPage(action.targetPage);
                    if (wasRunning) startStimulusDirectly();
                }, delayMs);
            }
            break;
        }
            
        case 'confirm_ssvep':
        case 'cancel_ssvep':
            break;

        default:
            console.log('无动作');
    }
}

// 切换到指定页面
function switchToPage(pageIndex) {
    if (!project || !project.pages || !project.pages[pageIndex]) {
        console.error('页面不存在:', pageIndex);
        return;
    }
    
    // 停止当前刺激
    const wasRunning = isRunning;
    if (isRunning) {
        stopStimulus();
    }
    
    // 切换页面
    currentPage = pageIndex;
    ensureStimulusPageShape(project.pages[currentPage]);
    const blocks = project.pages[currentPage].blocks || [];
    endStimulusEegSession();

    rebuildMultimodalRuntimeConfigs();

    // 重新创建刺激方块
    relayoutStimulusWhenContainerReady(blocks);
    
    // 更新显示
    document.getElementById('block-count').textContent = countStimulusTargetSummary(blocks);
    
    // 如果之前在运行，自动开始新页面（不需要倒计时）
    if (wasRunning) {
        setTimeout(() => {
            startStimulusDirectly(); // 直接启动，不倒计时
        }, 500);
    }
    
    console.log('已切换到页面:', pageIndex);
}

// 开始视觉刺激（SSVEP 闪烁；多模态检测独立运行）
function startStimulus() {
    if (isRunning) return;
    
    // 只有首次启动才显示倒计时
    if (isFirstStart) {
        isFirstStart = false;
        // 显示倒计时（倒计时期间显示所有对象但不闪烁）
        showCountdown(3, () => {
            startStimulusDirectly();
        });
    } else {
        // 非首次启动，直接开始
        startStimulusDirectly();
    }
}

// 直接启动刺激（不倒计时）
function startStimulusDirectly() {
    if (isRunning) return;

    if (isElectronShell()) {
        bumpElectronPassthroughGate(600);
        const cfg = readStimulusRunOptions();
        const stealFocus = !(cfg && cfg.transparentBackground);
        if (stealFocus && typeof window.ssvepElectron?.focusStimulusWindow === 'function') {
            const f = () => window.ssvepElectron.focusStimulusWindow().catch(() => {});
            f();
            [120, 350, 900, 2000].forEach((ms) => setTimeout(f, ms));
        }
    }

    const blocks = project.pages[currentPage]?.blocks || [];
    relayoutStimulusWhenContainerReady(blocks);

    isRunning = true;
    startTime = performance.now();
    frameCount = 0;
    lastFpsUpdate = startTime;
    
    // 更新UI
    document.getElementById('start-btn').classList.add('hidden');
    document.getElementById('stop-btn').classList.remove('hidden');
    const stEl = document.getElementById('status-text');
    if (pageHasMotionInput() || multimodalRuntimeConfigs.length) {
        stEl.textContent = '视觉刺激 + 多模态';
    } else {
        stEl.textContent = '视觉刺激运行中';
    }
    stEl.style.color = '#4CAF50';
    
    // 开始渲染循环
    renderLoop();
    
    console.log('视觉刺激开始');
    refreshPanelExitStopLabel();
    ensureStimulusEegLoopRunning(false);
    syncElectronWindowAlwaysOnTop();
    ensureMultimodalDeviceListener();
    void ensureMultimodalEmgStream();
    forceElectronPassthroughRecheck();
}

// 停止视觉刺激（多模态检测继续）
function stopStimulus() {
    if (!isRunning) return;

    isRunning = false;

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // 重置所有方块颜色
    stimulusBlocks.forEach(block => {
        block.element.style.backgroundColor = block.baseColor;
    });
    
    // 更新UI
    document.getElementById('start-btn').classList.remove('hidden');
    document.getElementById('stop-btn').classList.add('hidden');
    const stEl = document.getElementById('status-text');
    if (pageHasMotionInput() || multimodalRuntimeConfigs.length) {
        stEl.textContent = '多模态监测中';
        stEl.style.color = '#4CAF50';
    } else {
        stEl.textContent = '已停止';
        stEl.style.color = '#FF5252';
    }
    
    console.log('视觉刺激停止');
    refreshPanelExitStopLabel();
    syncElectronWindowAlwaysOnTop();
}

// 渲染循环
function renderLoop() {
    if (!isRunning) return;
    
    const currentTime = performance.now();
    const elapsedTime = (currentTime - startTime) / 1000; // 秒
    
    // 更新每个方块的亮度
    stimulusBlocks.forEach((block) => {
        const brightness = stimulusBlockBrightness(block, elapsedTime);
        const alpha = block.opaqueBackdrop ? 1 : stimulusFlickerBlockOpacity;
        block.element.style.backgroundColor = `rgba(${brightness}, ${brightness}, ${brightness}, ${alpha})`;
    });
    
    // 更新FPS
    frameCount++;
    if (currentTime - lastFpsUpdate >= 1000) {
        currentFPS = Math.round(frameCount * 1000 / (currentTime - lastFpsUpdate));
        document.getElementById('fps-value').textContent = currentFPS;
        
        // FPS颜色指示
        const fpsEl = document.getElementById('fps-value');
        if (currentFPS >= 55) {
            fpsEl.style.color = '#4CAF50'; // 绿色：良好
        } else if (currentFPS >= 45) {
            fpsEl.style.color = '#FFC107'; // 黄色：一般
        } else {
            fpsEl.style.color = '#FF5252'; // 红色：差
        }
        
        frameCount = 0;
        lastFpsUpdate = currentTime;
    }
    
    // 更新运行时间
    const minutes = Math.floor(elapsedTime / 60);
    const seconds = Math.floor(elapsedTime % 60);
    document.getElementById('time-text').textContent = 
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    // 继续下一帧
    animationFrameId = requestAnimationFrame(renderLoop);
}

// 显示倒计时
function showCountdown(seconds, callback) {
    let count = seconds;
    
    // 倒计时期间显示所有对象（不闪烁）
    stimulusBlocks.forEach(block => {
        const v = 136;
        block.element.style.backgroundColor = `rgba(${v}, ${v}, ${v}, ${stimulusFlickerBlockOpacity})`;
        block.element.style.display = 'flex';
    });
    
    const countdownEl = document.createElement('div');
    countdownEl.className = 'countdown';
    countdownEl.textContent = count;
    document.body.appendChild(countdownEl);
    
    const interval = setInterval(() => {
        count--;
        if (count > 0) {
            countdownEl.textContent = count;
        } else {
            clearInterval(interval);
            countdownEl.remove();
            if (callback) callback();
        }
    }, 1000);
}

// 切换全屏
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.error('无法进入全屏:', err);
        });
    } else {
        document.exitFullscreen();
    }
}

// 切换FPS显示
function toggleFPS() {
    const fpsDisplay = document.getElementById('fps-display');
    fpsDisplay.classList.toggle('hidden');
}

// 切换控制面板
function toggleControlPanel() {
    const panel = document.getElementById('control-panel');
    const floatingBtn = document.getElementById('floating-control-btn');
    
    if (isMinimized) {
        // 展开面板
        panel.classList.remove('minimized');
        floatingBtn.style.display = 'none';
        isMinimized = false;
        updateMotionControlPanelUi(null);
    } else {
        // 最小化面板
        panel.classList.add('minimized');
        floatingBtn.style.display = 'flex';
        isMinimized = true;
    }
    forceElectronPassthroughRecheck();
}

// 切换置顶（壳内仅影响控制浮窗 z-index；系统级置顶由主进程保持）
function toggleAlwaysOnTop() {
    isAlwaysOnTop = !isAlwaysOnTop;
    const panel = document.getElementById('control-panel');
    const floatingBtn = document.getElementById('floating-control-btn');
    
    if (isAlwaysOnTop) {
        panel.style.zIndex = '10000';
        floatingBtn.style.zIndex = '10000';
        document.getElementById('always-on-top-btn').textContent = '✓ 置于顶层';
    } else {
        panel.style.zIndex = '1000';
        floatingBtn.style.zIndex = '1000';
        document.getElementById('always-on-top-btn').textContent = '置于顶层';
    }
    syncElectronWindowAlwaysOnTop();
}

// 更新背景透明度
function updateOpacity(value) {
    backgroundOpacity = parseInt(value);
    document.getElementById('opacity-value').textContent = backgroundOpacity + '%';
    
    const container = document.getElementById('stimulus-container');
    container.style.backgroundColor = `rgba(0, 0, 0, ${backgroundOpacity / 100})`;
}

function getStimulusReturnPage() {
    try {
        const raw = sessionStorage.getItem('stimulus_return_page');
        if (raw && /^[a-z0-9._-]+\.html$/i.test(raw)) return raw;
    } catch (_) {
        /* ignore */
    }
    return null;
}

function stopStimulusIfRunning(promptText) {
    if (!isRunning) return true;
    if (!confirm(promptText || '刺激正在运行，确定要退出吗？')) return false;
    stopStimulus();
    return true;
}

/** 退出刺激：Electron 恢复带导航的正常窗口；浏览器同页跳转 */
function exitStimulusTo(htmlFile) {
    if (!stopStimulusIfRunning('刺激正在运行，确定要退出吗？')) return;
    const page = htmlFile || getStimulusReturnPage() || 'project-manager.html';
    if (isElectronShell() && typeof window.ssvepElectron.exitStimulusTo === 'function') {
        window.ssvepElectron.exitStimulusTo(page);
        return;
    }
    window.location.href = page;
}

// 关闭运行 → 回到进入刺激前的页面（默认项目管理）
function closeStimulus() {
    exitStimulusTo(null);
}

// 返回编辑器
function backToEditor() {
    if (!stopStimulusIfRunning('刺激正在运行，确定要返回编辑器吗？')) return;
    if (isElectronShell() && typeof window.ssvepElectron.exitStimulusTo === 'function') {
        window.ssvepElectron.exitStimulusTo('editor.html');
        return;
    }
    window.location.href = 'editor.html';
}

// 设置浮动按钮拖动
function setupFloatingButtonDrag() {
    const floatingBtn = document.getElementById('floating-control-btn');
    let startX = 0;
    let startY = 0;
    
    // 双击事件 - 打开/关闭面板
    floatingBtn.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleControlPanel();
    });
    
    // 单击拖动
    floatingBtn.addEventListener('mousedown', (e) => {
        // 只响应左键
        if (e.button !== 0) return;
        
        isDragging = false;
        
        const rect = floatingBtn.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        startX = e.clientX;
        startY = e.clientY;
        
        // 防止文本选择
        e.preventDefault();
        e.stopPropagation();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (e.buttons === 1) { // 左键按下
            const moveDistance = Math.sqrt(
                Math.pow(e.clientX - startX, 2) +
                Math.pow(e.clientY - startY, 2)
            );
            
            // 移动超过3像素就开始拖动
            if (moveDistance > 3) {
                isDragging = true;
                
                const x = e.clientX - dragOffsetX;
                const y = e.clientY - dragOffsetY;
                
                // 限制在窗口范围内
                const maxX = window.innerWidth - floatingBtn.offsetWidth;
                const maxY = window.innerHeight - floatingBtn.offsetHeight;
                
                const boundedX = Math.max(0, Math.min(x, maxX));
                const boundedY = Math.max(0, Math.min(y, maxY));
                
                floatingBtn.style.left = boundedX + 'px';
                floatingBtn.style.top = boundedY + 'px';
                floatingBtn.style.right = 'auto';
                
                // 改变光标样式
                floatingBtn.style.cursor = 'grabbing';
            }
            
            e.preventDefault();
        }
    });
    
    document.addEventListener('mouseup', (e) => {
        if (isDragging) {
            isDragging = false;
            floatingBtn.style.cursor = 'move';
        }
    });
}

// 键盘快捷键
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        switch(e.key.toLowerCase()) {
            case 'h':
                toggleControlPanel();
                break;
            case 'f':
                toggleFullscreen();
                break;
            case ' ':
                e.preventDefault();
                if (isRunning) {
                    stopStimulus();
                } else {
                    startStimulus();
                }
                break;
            case 'escape':
                if (isRunning) {
                    stopStimulus();
                }
                break;
        }
    });
}

// 显示错误
function showError(message) {
    document.getElementById('loading').innerHTML = `
        <div style="color: #FF5252; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
            <div style="font-size: 18px; margin-bottom: 20px;">${message}</div>
            <button class="btn" onclick="backToEditor()" 
                    style="max-width: 200px; margin: 0 auto;">
                返回编辑器
            </button>
        </div>
    `;
}

// 监听全屏变化
document.addEventListener('fullscreenchange', () => {
    showStimulusPresentation();
    if (!project || !project.pages || !project.pages[currentPage]) return;
    const blocks = project.pages[currentPage].blocks || [];
    requestAnimationFrame(() => relayoutStimulusWhenContainerReady(blocks));
    setTimeout(() => relayoutStimulusWhenContainerReady(blocks), 200);
});

// 页面卸载时停止刺激
window.addEventListener('beforeunload', () => {
    stopStimulusEegLoop();
    if (isRunning) {
        stopStimulus();
    }
});

// ---------- EEG 在线识别（项目管理「运行」写入 sessionStorage） ----------
/**
 * 运行配置归一化见 js/stimulus-run-config.js（window.normalizeStimulusRunConfig）
 */
function readStimulusRunOptions() {
    try {
        let raw = sessionStorage.getItem('stimulus_run_config');
        if (!raw) raw = localStorage.getItem('stimulus_run_config');
        if (!raw) return null;
        const cfg = JSON.parse(raw);
        return typeof window.normalizeStimulusRunConfig === 'function'
            ? window.normalizeStimulusRunConfig(cfg)
            : cfg;
    } catch {
        return null;
    }
}

// 若未加载 js/stimulus-run-config.js，提供降级归一化
if (typeof window.normalizeStimulusRunConfig !== 'function') {
    window.normalizeStimulusRunConfig = function normalizeStimulusRunConfigFallback(cfg) {
        if (!cfg || typeof cfg !== 'object') return cfg;
        const out = { ...cfg };
        const mode = out.mode === 'interval' ? 'interval' : 'threshold';
        let w = Number(out.windowSec);
        if (!Number.isFinite(w)) w = mode === 'interval' ? 0.8 : 2.0;
        out.windowSec = Math.min(5, Math.max(0.3, w));
        return out;
    };
}

/** 制作端「运行」对话框写入：透明背景、尝试全屏（浏览器能力范围内） */
function applyRuntimePresentationOptions() {
    const cfg = readStimulusRunOptions();
    if (!cfg) return;

    if (cfg.transparentBackground) {
        document.documentElement.style.background = 'transparent';
        document.body.style.background = 'transparent';
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.style.background = 'transparent';
        const c = document.getElementById('stimulus-container');
        if (c) c.style.backgroundColor = 'transparent';
        backgroundOpacity = 0;
        const ov = document.getElementById('opacity-value');
        if (ov) ov.textContent = '0%';
        const slider = document.getElementById('opacity-slider');
        if (slider) slider.value = '0';
        const hint = document.getElementById('hint');
        if (hint) hint.style.background = 'rgba(0,0,0,0.25)';
    }

    if (cfg.startFullscreen) {
        setTimeout(() => {
            const root = document.documentElement;
            if (root.requestFullscreen) {
                root.requestFullscreen().catch(() => {});
            }
        }, 450);
    }
}

function applyFlickerOptionsFromRunConfig() {
    const cfg = readStimulusRunOptions();
    stimulusFlickerHighBlank = !!(cfg && cfg.flickerHighBlank);
    let pct = cfg && cfg.flickerOnDutyPercent != null ? Number(cfg.flickerOnDutyPercent) : 35;
    if (!Number.isFinite(pct)) pct = 35;
    pct = Math.max(15, Math.min(50, pct));
    stimulusFlickerOnDuty = pct / 100;
    let opacityPct = cfg && cfg.flickerBlockOpacityPercent != null ? Number(cfg.flickerBlockOpacityPercent) : 58;
    if (!Number.isFinite(opacityPct)) opacityPct = 58;
    stimulusFlickerBlockOpacity = Math.max(20, Math.min(100, opacityPct)) / 100;
}

/**
 * 闪烁亮度 0～255。默认正弦；高空白模式为同频方波，亮段仅占周期的一小段（可调），暗段接近黑便于透视叠窗。
 */
function stimulusBlockBrightness(block, elapsedTime) {
    const phase = 2 * Math.PI * block.frequency * elapsedTime + block.phase * 2 * Math.PI;
    if (!stimulusFlickerHighBlank) {
        const amplitude = Math.sin(phase);
        return Math.round((amplitude + 1) * 127.5);
    }
    const duty = Math.max(0.12, Math.min(0.52, stimulusFlickerOnDuty));
    const p = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const on = p < 2 * Math.PI * duty;
    return on ? 255 : 0;
}

function persistStimulusRunConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    stimulusRunOpts = cfg;
    const payload = JSON.stringify(cfg);
    sessionStorage.setItem('stimulus_run_config', payload);
    localStorage.setItem('stimulus_run_config', payload);
}

function setStimulusSpeakOnDecode(on) {
    const cfg = readStimulusRunOptions() || {};
    cfg.speakOnDecode = !!on;
    persistStimulusRunConfig(cfg);
}

function initStimulusSpeakOnDecodeUi() {
    const wrap = document.getElementById('stimulus-speak-wrap');
    const cb = document.getElementById('stimulus-speak-on-decode');
    const cfg = readStimulusRunOptions();
    const show = !!(cfg && cfg.eegEnabled);
    if (wrap) wrap.style.display = show ? 'block' : 'none';
    if (cb) cb.checked = !!(cfg && cfg.speakOnDecode);
}

function updateEegUiVisibility() {
    stimulusRunOpts = readStimulusRunOptions();
    const w = document.getElementById('eeg-status-wrap');
    if (w) w.style.display = stimulusRunOpts && stimulusRunOpts.eegEnabled ? 'block' : 'none';
    initStimulusSpeakOnDecodeUi();
}

window.setStimulusSpeakOnDecode = setStimulusSpeakOnDecode;

function setEegStatusLine(text) {
    const el = document.getElementById('eeg-decode-status');
    if (el) el.textContent = text || '';
}

function formatStimulusPhaseLabel(phaseNorm) {
    if (phaseNorm == null || !Number.isFinite(Number(phaseNorm))) return '—';
    const p = Number(phaseNorm);
    const rad = p * 2 * Math.PI;
    return `${p.toFixed(2)}（${rad.toFixed(2)} rad）`;
}

function findBlocksNearFrequency(hz) {
    const tol = 0.09;
    return currentPageBlockList.filter((b) => {
        if (!b || b.frequency == null) return false;
        return Math.abs(Number(b.frequency) - hz) < tol;
    });
}

function buildDecodeHistoryEntry(data) {
    const ranked = data.ranked_by_probability || [];
    const top = ranked[0];
    if (!top) return null;
    const hz = Number(top.frequency_hz);
    const block = resolveDecodeTarget(data);
    const matches = findBlocksNearFrequency(hz);
    const p1 = Number(top.probability);
    const p2 = ranked.length >= 2 ? Number(ranked[1].probability) : null;
    return {
        ts: Date.now(),
        hz,
        prob: p1,
        delta: p2 != null && Number.isFinite(p2) ? p1 - p2 : null,
        label: block?.label || (matches.length ? matches.map((b) => b.label || '未命名').join(' / ') : '未匹配'),
        phase: block?.phase,
        sameFreqCount: matches.length,
        triggered: false
    };
}

function pushStimulusDecodeHistory(entry) {
    if (!entry) return;
    stimulusEegDecodeHistory.unshift(entry);
    if (stimulusEegDecodeHistory.length > STIMULUS_EEG_HISTORY_MAX) {
        stimulusEegDecodeHistory.length = STIMULUS_EEG_HISTORY_MAX;
    }
    renderStimulusDecodeHistory();
}

function markLastDecodeHistoryTriggered() {
    if (!stimulusEegDecodeHistory.length) return;
    stimulusEegDecodeHistory[0].triggered = true;
    renderStimulusDecodeHistory();
}

function renderStimulusDecodeHistory() {
    const el = document.getElementById('eeg-decode-history');
    if (!el) return;
    if (!stimulusEegDecodeHistory.length) {
        el.innerHTML = '<div class="eeg-history-empty">暂无记录</div>';
        return;
    }
    el.innerHTML = stimulusEegDecodeHistory
        .map((e, i) => {
            const time = new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false });
            const cls = [
                'eeg-history-item',
                i === 0 ? 'eeg-history-top' : '',
                e.triggered ? 'eeg-history-triggered' : ''
            ]
                .filter(Boolean)
                .join(' ');
            const probPct = (e.prob * 100).toFixed(1);
            const deltaStr =
                e.delta != null && Number.isFinite(e.delta)
                    ? `　Δ=${(e.delta * 100).toFixed(1)}%`
                    : '';
            const phaseStr = formatStimulusPhaseLabel(e.phase);
            const tags = [];
            if (e.triggered) tags.push('<span class="eeg-history-tag triggered">已触发</span>');
            if (e.sameFreqCount > 1) {
                tags.push(
                    `<span class="eeg-history-tag">同频 ${e.sameFreqCount} 对象（算法仅按频率解码）</span>`
                );
            }
            return `<div class="${cls}">
                <div class="eeg-history-row">
                    <span class="eeg-history-name">${escapeHtml(e.label || '—')}</span>
                    <span class="eeg-history-time">${time}</span>
                </div>
                <div>${escapeHtml(e.hz.toFixed(2))} Hz　相位 ${escapeHtml(phaseStr)}</div>
                <div>p=${probPct}%${deltaStr}${tags.length ? '　' + tags.join(' ') : ''}</div>
            </div>`;
        })
        .join('');
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function resetStimulusEegDecodeBaseline() {
    stimulusEegBuffer = [];
    stimulusEegLastStableCandidateHz = null;
    stimulusEegSessionStartMs = Date.now();
}

function beginStimulusEegSession() {
    stimulusEegSessionActive = true;
    resetStimulusEegDecodeBaseline();
}

function endStimulusEegSession() {
    stimulusEegSessionActive = false;
    stimulusEegBuffer = [];
    stimulusEegLastStableCandidateHz = null;
    stimulusEegSessionStartMs = 0;
    clearSsvepPendingConfirm();
}

function clearStimulusDecodeHistory() {
    stimulusEegDecodeHistory = [];
    renderStimulusDecodeHistory();
}

function setupStimulusEegDeviceListenerOnce() {
    if (stimulusEegDeviceHooked || !window.globalDeviceManager) return;
    stimulusEegDeviceHooked = true;
    stimulusEegListener = (event, message) => {
        if (event !== 'data' || !message || !message.data || message.data.length === 0) return;
        if (!stimulusEegSessionActive) return;
        if (typeof message.sampling_rate === 'number' && message.sampling_rate > 0) {
            stimulusEegSamplingRate = message.sampling_rate;
        }
        stimulusEegBuffer.push(...message.data);
        const sr = message.sampling_rate || stimulusEegSamplingRate || 250;
        const maxSamples = Math.ceil(sr * 12);
        if (stimulusEegBuffer.length > maxSamples) {
            stimulusEegBuffer = stimulusEegBuffer.slice(-maxSamples);
        }
    };
    window.globalDeviceManager.addEventListener(stimulusEegListener);
}

function getSsvepChannelIndicesForDecode() {
    const now = Date.now();
    if (cachedSsvepChIdxForDecode && now - cachedSsvepChIdxAtMs < 8000) {
        return cachedSsvepChIdxForDecode;
    }
    const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG || window.SSVEP_FBCCA_CHANNELS;
    let chIdx = null;
    if (CFG && typeof CFG.loadFullConfig === 'function') {
        const cfg = CFG.loadFullConfig();
        if (window.globalDeviceManager && typeof window.globalDeviceManager.applyChannelConfig === 'function') {
            window.globalDeviceManager.applyChannelConfig(cfg);
        }
        chIdx = cfg.ssvepChannelIndices;
    } else if (CFG && typeof CFG.getGlobalSsvepChannelIndices === 'function') {
        chIdx = CFG.getGlobalSsvepChannelIndices();
    } else if (
        window.globalDeviceManager &&
        typeof window.globalDeviceManager.getSsvepChannelIndices === 'function'
    ) {
        chIdx = window.globalDeviceManager.getSsvepChannelIndices();
    }
    cachedSsvepChIdxForDecode = chIdx;
    cachedSsvepChIdxAtMs = now;
    return chIdx;
}

function pageHasSsvepKeyboard() {
    const blocks = project && project.pages && project.pages[currentPage]
        ? project.pages[currentPage].blocks
        : [];
    return (blocks || []).some((b) => isSsvepKeyboardBlock(b));
}

/** 与 currentPageBlockList 顺序一致，供 decode_window（禁止 Set 去重打乱索引） */
function buildDecodeTargetLists() {
    const frequencies_hz = [];
    const phases = [];
    for (const b of currentPageBlockList) {
        if (!b || b.frequency == null) continue;
        const hz = Number(b.frequency);
        if (!Number.isFinite(hz)) continue;
        frequencies_hz.push(hz);
        phases.push(Number(b.phase ?? 0));
    }
    return { frequencies_hz, phases };
}

function resolveDecodeTarget(data) {
    const idx = data && data.predicted_index;
    if (
        Number.isInteger(idx) &&
        idx >= 0 &&
        idx < currentPageBlockList.length &&
        currentPageBlockList[idx] &&
        currentPageBlockList[idx].frequency != null
    ) {
        return currentPageBlockList[idx];
    }
    const hz = data && Number(data.predicted_frequency_hz);
    if (!Number.isFinite(hz)) return null;
    let best = null;
    let bestD = Infinity;
    const tol = 0.09;
    for (const b of currentPageBlockList) {
        const d = Math.abs(Number(b.frequency) - hz);
        if (d < bestD && d < tol) {
            bestD = d;
            best = b;
        }
    }
    return best;
}

function findBlockByFrequency(hz) {
    return resolveDecodeTarget({ predicted_frequency_hz: hz });
}

/**
 * 实际送入 decode_window 的窗长（秒）。
 * - 置信度模式：runConfig.windowSec（默认 2 s，用户可在 0.3～5 s 内调整）。
 * - 定时模式：间隔较长时固定 4 s；否则用 runConfig.windowSec。
 */
function clampStimulusDecodeWindowSec(raw, fallback) {
    const floor =
        typeof window.STIMULUS_WINDOW_SEC_MIN === 'number' ? window.STIMULUS_WINDOW_SEC_MIN : 0.3;
    const ceiling =
        typeof window.STIMULUS_WINDOW_SEC_MAX === 'number' ? window.STIMULUS_WINDOW_SEC_MAX : 5.0;
    const w = Number(raw);
    const use = Number.isFinite(w) ? w : fallback;
    return Math.min(ceiling, Math.max(floor, use));
}

function resolveDecodeWindowSec(opts) {
    const thresholdDefault = 2.0;
    if (!opts || !opts.eegEnabled) {
        return clampStimulusDecodeWindowSec(opts && opts.windowSec, thresholdDefault);
    }
    if (opts.mode === 'interval') {
        const intervalSec = Math.max(0.5, Number(opts.intervalSec) || 3);
        const derived = intervalSec - 0.5;
        if (derived >= 4.0) {
            return Math.min(4.0, derived);
        }
        const fromConfig = opts.windowSec != null ? Number(opts.windowSec) : derived;
        return clampStimulusDecodeWindowSec(fromConfig, derived);
    }
    return clampStimulusDecodeWindowSec(opts.windowSec, thresholdDefault);
}

/** 定时模式：送入 decode 的 EEG 段长（秒），至少覆盖一个识别间隔，供后端取末段 window_sec 分析 */
function resolveIntervalSegmentSec(opts) {
    const intervalSec = Math.max(0.5, Number(opts && opts.intervalSec) || 3);
    return intervalSec;
}

async function stimulusDecodeOnce(opts) {
    const sr = stimulusEegSamplingRate || 250;
    const windowSec = resolveDecodeWindowSec(opts);
    const winSamples = Math.max(50, Math.round(sr * windowSec));
    let needSamples = winSamples;
    if (opts && opts.mode === 'interval') {
        const segSec = resolveIntervalSegmentSec(opts);
        needSamples = Math.max(winSamples, Math.round(sr * segSec));
    }

    let slice = [];
    if (stimulusEegBuffer.length >= needSamples) {
        slice = stimulusEegBuffer.slice(-needSamples);
    } else if (stimulusEegBuffer.length >= winSamples) {
        slice = stimulusEegBuffer.slice(-stimulusEegBuffer.length);
    }

    if (slice.length < winSamples) {
        const elapsedSec =
            stimulusEegSessionStartMs > 0 ? (Date.now() - stimulusEegSessionStartMs) / 1000 : 0;
        if (stimulusEegSessionActive && elapsedSec < windowSec) {
            setEegStatusLine(
                `EEG 收集中：${slice.length}/${needSamples}（分析窗 ${windowSec.toFixed(1)} s，需约 ${windowSec.toFixed(1)} s 新数据）`
            );
        } else {
            setEegStatusLine(
                `EEG 缓冲：${slice.length}/${needSamples}（请先在设备管理连接设备，再回到本页；需 WebSocket 推流）`
            );
        }
        return null;
    }
    if (!Array.isArray(slice[0])) {
        setEegStatusLine('EEG 数据格式异常（需每帧多通道）');
        return null;
    }
    const { frequencies_hz, phases } = buildDecodeTargetLists();
    if (frequencies_hz.length < 2) {
        setEegStatusLine('至少需要 2 个有效 SSVEP 目标');
        return null;
    }
    const chIdx = getSsvepChannelIndicesForDecode();
    const origin =
        typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
    const decodeBody = {
        samples: slice,
        sampling_rate: sr,
        frequencies_hz,
        phases,
        window_sec: windowSec
    };
    if (chIdx && chIdx.length) decodeBody.channel_indices = chIdx;
    const resp = await fetch(`${origin}/api/ssvep/fbcca/decode_window`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decodeBody)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        let detail = '';
        if (data && data.detail) {
            detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
        } else detail = String(resp.status);
        if (detail.includes('16') && detail.includes('频率')) {
            detail += '（请完全退出并重启 Python 后端，需加载 48 路解码）';
        }
        setEegStatusLine(`解码失败：${detail}`);
        return null;
    }
    return data;
}

function maybeTriggerFromDecode(data, opts) {
    tickSsvepPendingConfirmTimeout();
    if (ssvepPendingConfirm) return;
    const ranked = data.ranked_by_probability || [];
    if (ranked.length < 1) return;
    const top = ranked[0];
    const p1 = Number(top.probability);

    if (opts.mode === 'interval') {
        stimulusEegLastStableCandidateHz = null;
        if (p1 < opts.minProbability) {
            setEegStatusLine(
                `定时：${Number(top.frequency_hz).toFixed(2)} Hz　p=${(p1 * 100).toFixed(1)}%（低于阈值，不触发）`
            );
            return;
        }
    } else {
        if (ranked.length < 2) {
            stimulusEegLastStableCandidateHz = null;
            return;
        }
        const second = ranked[1];
        const p2 = Number(second.probability);
        if (!(p1 >= opts.minProbability && p1 - p2 >= opts.minMargin)) {
            stimulusEegLastStableCandidateHz = null;
            setEegStatusLine(
                `注视：${Number(top.frequency_hz).toFixed(2)} Hz　p=${(p1 * 100).toFixed(
                    1
                )}%　Δ=${((p1 - p2) * 100).toFixed(1)}%（未达阈值）`
            );
            return;
        }
    }

    const block = resolveDecodeTarget(data);
    const hz = block ? Number(block.frequency) : Number(top.frequency_hz);
    if (!block || !blockHasExecutableActions(block)) {
        if (opts.mode === 'threshold') stimulusEegLastStableCandidateHz = null;
        setEegStatusLine(`识别 ${hz.toFixed(2)} Hz：该对象未绑定动作`);
        return;
    }

    if (opts.mode === 'threshold' && opts.thresholdRequireStable) {
        const prev = stimulusEegLastStableCandidateHz;
        const stableTol = 0.09;
        const same =
            prev != null && Number.isFinite(prev) && Math.abs(prev - hz) < stableTol;
        if (!same) {
            stimulusEegLastStableCandidateHz = hz;
            setEegStatusLine(
                `置信度：${hz.toFixed(2)} Hz 已过阈值（连续确认：下次解码仍为该频率则触发）`
            );
            return;
        }
        stimulusEegLastStableCandidateHz = null;
    } else if (opts.mode === 'threshold') {
        stimulusEegLastStableCandidateHz = null;
    }

    const cdMs = Math.max(
        (opts.cooldownSec || 1.5) * 1000,
        blockHasMouseActions(block) ? SSVEP_MOUSE_TRIGGER_MIN_COOLDOWN_MS : 0
    );
    const now = Date.now();
    if (now - stimulusEegLastTriggerTs < cdMs) return;
    stimulusEegLastTriggerTs = now;

    setEegStatusLine(`已触发：${block.label || hz.toFixed(2)} Hz`);
    markLastDecodeHistoryTriggered();
    applyDecodeHighlight(data, true);
    const queued = queueOrExecuteSsvepTrigger(block, data, opts);
    if (!queued) {
        maybeSpeakDecodeResult(block, opts);
        /* 置信度/定时触发后丢弃旧窗，下次识别仅基于触发后的新 EEG */
        if (stimulusEegSessionActive) resetStimulusEegDecodeBaseline();
    }
}

function resolvePageLinkDelayMs(action) {
    const raw = action && action.delayMs;
    if (raw == null || raw === '' || Number(raw) === 0) return PAGE_LINK_DEFAULT_DELAY_MS;
    return Math.max(0, parseInt(String(raw), 10) || 0);
}

function getDecodeSpeakText(block) {
    if (!block) return '';
    const label = block.label != null ? String(block.label).trim() : '';
    if (label) return label;
    if (block.keyId) return String(block.keyId);
    return '';
}

function getDecodeHighlightHoldMs(opts, block) {
    const o = opts || stimulusRunOpts || readStimulusRunOptions();
    if (!o) return 1500;
    if (o.mode === 'interval') {
        return Math.max(500, (Number(o.intervalSec) || 3) * 1000);
    }
    return Math.max(
        (Number(o.cooldownSec) || 1.5) * 1000,
        block && blockHasMouseActions(block) ? SSVEP_MOUSE_TRIGGER_MIN_COOLDOWN_MS : 0
    );
}

function clearDecodeTriggeredHighlight() {
    if (decodeTriggeredHoldTimer != null) {
        clearTimeout(decodeTriggeredHoldTimer);
        decodeTriggeredHoldTimer = null;
    }
    const id = decodeTriggeredBlockId;
    decodeTriggeredBlockId = null;
    if (!id) return;
    const el = document.getElementById(`stimulus-${id}`);
    if (!el) return;
    el.classList.remove(
        'stimulus-kb-key-top',
        'stimulus-kb-key-triggered',
        'stimulus-decode-top',
        'stimulus-decode-triggered'
    );
    el.removeAttribute('data-decode-p');
}

function maybeSpeakDecodeResult(block, opts) {
    if (!opts || !opts.speakOnDecode) return;
    const text = getDecodeSpeakText(block);
    speakStimulusText(text);
}

function multimodalSlotSpeakLabel(cfg) {
    const meta = window.SSVEP_MULTIMODAL_BY_ID && cfg && cfg.channel ? window.SSVEP_MULTIMODAL_BY_ID[cfg.channel] : null;
    return meta ? meta.short : cfg && cfg.channel ? String(cfg.channel) : '多模态';
}

function speakStimulusText(text) {
    if (!text || typeof window.speechSynthesis === 'undefined') return;
    try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = /^[A-Za-z0-9\s]+$/.test(text) ? 'en-US' : 'zh-CN';
        u.rate = 1.05;
        window.speechSynthesis.speak(u);
    } catch (e) {
        console.warn('语音播报失败', e);
    }
}

function maybeSpeakMultimodalGateResult(cfg, kind, opts) {
    let text = '';
    if (kind === 'confirm') text = '确认';
    else if (kind === 'cancel') text = '取消';
    else if (kind === 'trigger') {
        if (!opts || !opts.speakOnDecode) return;
        const slot = multimodalSlotSpeakLabel(cfg);
        text = slot ? `${slot}触发` : '触发';
    }
    if (text) speakStimulusText(text);
}

function maybeSpeakSsvepPendingHint(block, opts, mode, waitMs) {
    if (!opts || !opts.speakOnDecode) return;
    maybeSpeakDecodeResult(block, opts);
}

/** 高亮当前 softmax 第一名；触发后橙黄框保持至识别间隔/冷却结束 */
function applyDecodeHighlight(data, triggered) {
    const opts = stimulusRunOpts || readStimulusRunOptions();
    if (triggered) {
        document.querySelectorAll('.stimulus-kb-key, .stimulus-block').forEach((el) => {
            el.classList.remove(
                'stimulus-kb-key-top',
                'stimulus-kb-key-triggered',
                'stimulus-decode-top',
                'stimulus-decode-triggered'
            );
            el.removeAttribute('data-decode-p');
        });
        const ranked = data && data.ranked_by_probability;
        const top = ranked && ranked[0];
        const block = resolveDecodeTarget(data);
        if (!block) return;
        const el = document.getElementById(`stimulus-${block.id}`);
        if (!el) return;
        const p = top ? Number(top.probability) : NaN;
        if (block.keyId) {
            el.classList.add('stimulus-kb-key-top', 'stimulus-kb-key-triggered');
        } else {
            el.classList.add('stimulus-decode-top', 'stimulus-decode-triggered');
        }
        if (Number.isFinite(p)) el.setAttribute('data-decode-p', `${(p * 100).toFixed(0)}%`);
        decodeTriggeredBlockId = block.id;
        if (decodeTriggeredHoldTimer != null) clearTimeout(decodeTriggeredHoldTimer);
        const holdMs = getDecodeHighlightHoldMs(opts, block);
        decodeTriggeredHoldTimer = setTimeout(() => {
            decodeTriggeredHoldTimer = null;
            decodeTriggeredBlockId = null;
            el.classList.remove(
                'stimulus-kb-key-top',
                'stimulus-kb-key-triggered',
                'stimulus-decode-top',
                'stimulus-decode-triggered'
            );
            el.removeAttribute('data-decode-p');
            setEegStatusLine('可进行下一轮注视识别');
        }, holdMs);
        return;
    }
    if (decodeTriggeredBlockId && decodeTriggeredHoldTimer) return;
    document.querySelectorAll('.stimulus-kb-key, .stimulus-block').forEach((el) => {
        el.classList.remove(
            'stimulus-kb-key-top',
            'stimulus-kb-key-triggered',
            'stimulus-decode-top',
            'stimulus-decode-triggered'
        );
        el.removeAttribute('data-decode-p');
    });
    const ranked = data && data.ranked_by_probability;
    const top = ranked && ranked[0];
    if (!top) return;
    const block = resolveDecodeTarget(data);
    if (!block) return;
    const el = document.getElementById(`stimulus-${block.id}`);
    if (!el) return;
    const p = Number(top.probability);
    if (block.keyId) {
        el.classList.add('stimulus-kb-key-top');
    } else {
        el.classList.add('stimulus-decode-top');
    }
    if (Number.isFinite(p)) el.setAttribute('data-decode-p', `${(p * 100).toFixed(0)}%`);
}

/** @deprecated 保留别名 */
function applyKeyboardDecodeHighlight(data, triggered) {
    applyDecodeHighlight(data, triggered);
}

function stimulusEegTick(opts) {
    if (!isRunning || !opts || !opts.eegEnabled) return;
    if (opts.mode !== 'threshold') return;
    if (stimulusEegDecodeInFlight) return;
    stimulusEegDecodeInFlight = true;
    stimulusDecodeOnce(opts)
        .then((data) => {
            if (data) {
                pushStimulusDecodeHistory(buildDecodeHistoryEntry(data));
                applyDecodeHighlight(data, false);
                maybeTriggerFromDecode(data, opts);
            }
        })
        .finally(() => {
            stimulusEegDecodeInFlight = false;
        });
}

function stimulusEegIntervalTick(opts) {
    if (!isRunning || !opts || !opts.eegEnabled) return;
    if (opts.mode !== 'interval') return;
    const now = Date.now();
    const period = (opts.intervalSec || 3) * 1000;
    if (now - stimulusEegLastIntervalDecodeTs < period) return;
    if (stimulusEegDecodeInFlight) return;
    stimulusEegDecodeInFlight = true;
    stimulusDecodeOnce(opts)
        .then((data) => {
            if (data) {
                stimulusEegLastIntervalDecodeTs = Date.now();
                pushStimulusDecodeHistory(buildDecodeHistoryEntry(data));
                applyDecodeHighlight(data, false);
                maybeTriggerFromDecode(data, opts);
            }
        })
        .finally(() => {
            stimulusEegDecodeInFlight = false;
        });
}

function stimulusEegMasterTick() {
    const opts = stimulusRunOpts || readStimulusRunOptions();
    if (!opts || !opts.eegEnabled || !stimulusEegSessionActive) return;
    if (!isRunning) return;
    const st = window.globalDeviceManager && window.globalDeviceManager.getStatus();
    if (st && !st.isConnected) {
        setEegStatusLine('EEG：设备未连接');
    }
    if (opts.mode === 'interval') stimulusEegIntervalTick(opts);
    else stimulusEegTick(opts);
}

function ensureStimulusEegLoopRunning(resetHistory) {
    setupStimulusEegDeviceListenerOnce();
    stimulusRunOpts = readStimulusRunOptions();
    updateEegUiVisibility();
    if (!stimulusRunOpts || !stimulusRunOpts.eegEnabled) {
        setEegStatusLine('');
        return;
    }
    const { frequencies_hz } = buildDecodeTargetLists();
    if (frequencies_hz.length < 2) {
        setEegStatusLine('在线识别需至少 2 个有效 SSVEP 目标');
        return;
    }
    if (resetHistory) clearStimulusDecodeHistory();
    if (!stimulusEegSessionActive) {
        beginStimulusEegSession();
    } else if (resetHistory) {
        resetStimulusEegDecodeBaseline();
    }

    const poll = stimulusRunOpts.pollMs || 320;
    const winSec = resolveDecodeWindowSec(stimulusRunOpts);
    const chIdx = getSsvepChannelIndicesForDecode();
    const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG || window.SSVEP_FBCCA_CHANNELS;
    const chLabel =
        CFG && typeof CFG.formatRolesSummary === 'function'
            ? CFG.formatRolesSummary(
                  window.globalDeviceManager && window.globalDeviceManager.getChannelRoles
                      ? window.globalDeviceManager.getChannelRoles()
                      : CFG.getGlobalChannelRoles && CFG.getGlobalChannelRoles()
              )
            : chIdx
              ? chIdx.map((i) => `Ch${i + 1}`).join('、')
              : 'Ch1–8';
    if (!stimulusEegIntervalId) {
        stimulusEegLastIntervalDecodeTs = Date.now();
        stimulusEegIntervalId = setInterval(() => stimulusEegMasterTick(), poll);
    }
    const visHint = isRunning ? '闪烁中' : '待开始视觉';
    const modeHint =
        stimulusRunOpts.mode === 'interval'
            ? `定时 ${(stimulusRunOpts.intervalSec || 3).toFixed(1)}s · 分析窗 ${winSec.toFixed(1)}s`
            : `置信度 · 分析窗 ${winSec.toFixed(1)}s`;
    setEegStatusLine(`EEG 在线 · ${chLabel} · ${modeHint} · ${visHint}`);
}

function startStimulusEegLoop() {
    ensureStimulusEegLoopRunning(true);
}

function stopStimulusEegLoop() {
    if (stimulusEegIntervalId) {
        clearInterval(stimulusEegIntervalId);
        stimulusEegIntervalId = null;
    }
    stimulusEegDecodeInFlight = false;
    endStimulusEegSession();
    /* 停止刺激后保留状态行与「最近 5 次」记录，便于查看 */
}

// 性能监控
if (performance && performance.memory) {
    setInterval(() => {
        if (isRunning) {
            const memory = performance.memory;
            console.log('内存使用:', {
                used: (memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB',
                total: (memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB',
                limit: (memory.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB'
            });
        }
    }, 5000);
}
