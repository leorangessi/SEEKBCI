// SSVEP测试 JavaScript - 使用真实EEG数据

// 全局变量
let testRunning = false;
let currentTrial = 0;
let totalTrials = 0;
let testResults = [];
let confusionMatrix = {};
let stimulusEngine = null;
/** 当前试次要注视的目标索引 0～7，刺激绘制时高亮该方块 */
let currentStimulusTargetIndex = null;
let eegDataBuffer = []; // EEG数据缓冲区
let isDeviceConnected = false;
/** WebSocket 最近一包名义采样率（用于 FBCCA 后端） */
let eegSamplingRate = 250;
/** 是否已收到过设备数据包（用于阻止“假测试/模拟”误导） */
let hasEegStream = false;
/** 倒计时 interval，便于停止测试时清理 */
let countdownIntervalId = null;
/** 上一试次是否使用了服务端「切段」FBCCA（对齐 lsl_received_data 边界） */
let lastTrialUsedServerCapture = false;
/** 速度测试：轮询定时器 */
let speedPollTimerId = null;
/** 速度测试：单试次超时 */
let speedTrialTimeoutId = null;
/** 速度测试：decode_window 请求进行中 */
let speedDecodeInFlight = false;
/** 速度测试：连续确认候选频率 Hz */
let speedStableCandidateHz = null;
/** 速度测试：刺激开始时刻（performance.now） */
let speedTrialStartMs = 0;
/** 速度测试：当前试次误触发次数 */
let speedCurrentTrialFalsePositives = 0;
/** 速度测试：全程误触发总次数 */
let speedFalsePositiveTotal = 0;
/** 速度测试：当前试次是否进行中（防重复 finish） */
let speedTrialActive = false;
/** 当前测试模式（开始后固定，避免中途切换） */
let activeTestMode = 'accuracy';

// 测试配置（相位与 ssevp/9_cca_withoutvideo.py 中 Phas 一致）
const TEST_CONFIG = {
    frequencies: [8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0],
    /** 每目标初相，与 Psychopy 脚本一致 */
    phases: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0],
    /** 与 9_cca_withoutvideo 中 sin(2π f·frameN/60+Phas) 的 60 一致 */
    stimRefHz: 60,
    positions: [
        { x: 0.25, y: 0.25, label: '左上' },
        { x: 0.75, y: 0.25, label: '右上' },
        { x: 0.25, y: 0.75, label: '左下' },
        { x: 0.75, y: 0.75, label: '右下' },
        { x: 0.5, y: 0.25, label: '上中' },
        { x: 0.5, y: 0.75, label: '下中' },
        { x: 0.25, y: 0.5, label: '左中' },
        { x: 0.75, y: 0.5, label: '右中' }
    ]
};

function getSsvepChannelIndicesForTest() {
    const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG || window.SSVEP_FBCCA_CHANNELS;
    if (CFG && typeof CFG.getGlobalSsvepChannelIndices === 'function') {
        return CFG.getGlobalSsvepChannelIndices();
    }
    if (
        window.globalDeviceManager &&
        typeof window.globalDeviceManager.getSsvepChannelIndices === 'function'
    ) {
        return window.globalDeviceManager.getSsvepChannelIndices();
    }
    return null;
}

function updateFbccaChannelHint() {
    const el = document.getElementById('fbcca-channel-hint');
    if (!el) return;
    const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
    const roles = CFG && typeof CFG.loadFullConfig === 'function' ? CFG.loadFullConfig().channelRoles : null;
    if (roles && typeof CFG.formatRolesSummary === 'function') {
        el.textContent = CFG.formatRolesSummary(roles);
        return;
    }
    const chIdx = getSsvepChannelIndicesForTest();
    if (CFG && typeof CFG.formatFbccaChannelIndicesLabel === 'function') {
        el.textContent = `FBCCA：${CFG.formatFbccaChannelIndicesLabel(chIdx)}`;
        return;
    }
    el.textContent = chIdx && chIdx.length
        ? `FBCCA：Ch${chIdx.map((i) => i + 1).join('、')}`
        : 'FBCCA：Ch1–8（请在设备管理配置 SSVEP 通道）';
}

function getTestMode() {
    const el = document.getElementById('test-mode');
    return el ? el.value : 'accuracy';
}

function onTestModeChange() {
    const mode = getTestMode();
    const isSpeed = mode === 'speed';
    const accPanel = document.getElementById('accuracy-config-panel');
    const speedPanel = document.getElementById('speed-config-panel');
    if (accPanel) accPanel.style.display = isSpeed ? 'none' : 'block';
    if (speedPanel) speedPanel.style.display = isSpeed ? 'block' : 'none';

    document.querySelectorAll('.speed-only-stat').forEach((el) => {
        el.style.display = isSpeed ? 'flex' : 'none';
    });
    document.querySelectorAll('.speed-only-result').forEach((el) => {
        el.style.display = isSpeed ? 'block' : 'none';
    });

    const titleEl = document.getElementById('test-page-title');
    if (titleEl) {
        titleEl.textContent = isSpeed ? 'SSVEP识别速度测试' : 'SSVEP准确度测试';
    }
    const avgLabel = document.getElementById('avg-response-time-label');
    if (avgLabel) {
        avgLabel.textContent = isSpeed ? '平均识别耗时(ms)' : '平均响应时间(ms)';
    }

    const instr = document.getElementById('instruction-text-body');
    if (instr) {
        if (isSpeed) {
            instr.innerHTML =
                '1. 依次提示 8 个目标（8～15 Hz），提示阶段显示<strong>青色蓝框</strong>，请注视该方块<br>' +
                '2. 固定 1 秒提示后开始闪烁并<strong>开始计时</strong>；在线滑动窗 decode_window 轮询识别<br>' +
                '3. 触发规则与刺激项目置信度模式一致：可选 Top1 概率 + Top1−Top2 差值，或仅 Softmax 阈值；可选连续两次同频确认<br>' +
                '4. 正确识别目标后进入下一对象；误触发其他对象计入错误并继续本试次<br>' +
                '5. 测试结束统计平均/中位识别耗时、准确率与误触发次数';
        } else {
            instr.innerHTML =
                '1. 测试将依次显示8个闪烁方块（8～15 Hz）<br>' +
                '2. 与 Psychopy 脚本一致：目标顺序为 8→15 Hz 循环（非随机）；提示阶段即可看到<strong>静态</strong>八个方块与青色注视框，倒计时结束后开始闪烁<br>' +
                '3. 请注视指定的目标方块；真实识别由本机后端 FBCCA 完成：整段试次中<strong>最后至多 4 秒</strong>参与分类<br>' +
                '4. 保持头部稳定，减少眨眼<br>' +
                '5. 测试完成后查看结果报告';
        }
    }
    onSpeedTriggerRuleChange();
}

function onSpeedTriggerRuleChange() {
    const rule = document.getElementById('speed-trigger-rule')?.value || 'prob_margin';
    const marginGroup = document.getElementById('speed-margin-group');
    if (marginGroup) marginGroup.style.display = rule === 'prob_only' ? 'none' : 'block';
}

function getSpeedTestOptions() {
    const triggerRule = document.getElementById('speed-trigger-rule')?.value || 'prob_margin';
    const minProbability = parseFloat(document.getElementById('speed-min-prob')?.value) || 0.28;
    const minMargin = parseFloat(document.getElementById('speed-min-margin')?.value) || 0.08;
    return {
        triggerRule,
        minProbability: Math.min(0.99, Math.max(0.05, minProbability)),
        minMargin: Math.min(0.5, Math.max(0.02, minMargin)),
        requireStable: !!document.getElementById('speed-require-stable')?.checked,
        windowSec: parseFloat(document.getElementById('speed-window-sec')?.value) || 0.8,
        pollMs: parseInt(document.getElementById('speed-poll-ms')?.value, 10) || 280,
        maxTrialSec: parseInt(document.getElementById('speed-max-trial-sec')?.value, 10) || 30
    };
}

function stopSpeedPolling() {
    if (speedPollTimerId !== null) {
        clearInterval(speedPollTimerId);
        speedPollTimerId = null;
    }
    if (speedTrialTimeoutId !== null) {
        clearTimeout(speedTrialTimeoutId);
        speedTrialTimeoutId = null;
    }
    speedDecodeInFlight = false;
    speedStableCandidateHz = null;
    speedTrialActive = false;
}

function resolveTestPredictedIndexFromTop(top) {
    if (!top) return -1;
    if (Number.isInteger(top.index) && top.index >= 0 && top.index < TEST_CONFIG.frequencies.length) {
        return top.index;
    }
    const hz = Number(top.frequency_hz);
    if (!Number.isFinite(hz)) return -1;
    for (let i = 0; i < TEST_CONFIG.frequencies.length; i++) {
        if (Math.abs(TEST_CONFIG.frequencies[i] - hz) < 0.09) return i;
    }
    return -1;
}

function speedTestCheckTrigger(data, opts) {
    const ranked = data.ranked_by_probability || [];
    if (!ranked.length) return { triggered: false };

    const top = ranked[0];
    const p1 = Number(top.probability);
    const predIdx = resolveTestPredictedIndexFromTop(top);
    const hz = Number(top.frequency_hz);
    if (predIdx < 0 || !Number.isFinite(hz)) return { triggered: false };

    if (opts.triggerRule === 'prob_only') {
        if (p1 < opts.minProbability) {
            speedStableCandidateHz = null;
            return { triggered: false, predIdx, hz, p1 };
        }
    } else {
        if (ranked.length < 2) {
            speedStableCandidateHz = null;
            return { triggered: false };
        }
        const p2 = Number(ranked[1].probability);
        if (!(p1 >= opts.minProbability && p1 - p2 >= opts.minMargin)) {
            speedStableCandidateHz = null;
            return { triggered: false, predIdx, hz, p1, p2 };
        }
    }

    if (opts.requireStable) {
        const prev = speedStableCandidateHz;
        const stableTol = 0.09;
        const same = prev != null && Number.isFinite(prev) && Math.abs(prev - hz) < stableTol;
        if (!same) {
            speedStableCandidateHz = hz;
            return { triggered: false, pendingStable: true, predIdx, hz, p1 };
        }
        speedStableCandidateHz = null;
    }

    return { triggered: true, predIdx, hz, p1 };
}

async function speedTestDecodeOnce(opts) {
    const gm = window.globalDeviceManager;
    const srFromDevice =
        gm && gm.deviceInfo && typeof gm.deviceInfo.sampling_rate === 'number'
            ? gm.deviceInfo.sampling_rate
            : null;
    const sr = srFromDevice || eegSamplingRate || 250;
    const windowSec = Math.min(5, Math.max(0.3, Number(opts.windowSec) || 0.8));
    const n = Math.max(50, Math.round(sr * windowSec));

    let slice = [];
    if (eegDataBuffer.length >= n) {
        slice = eegDataBuffer.slice(-n);
    }
    if (slice.length < n && gm && typeof gm.getRecentData === 'function') {
        const sec = Math.min(8, Math.max(windowSec + 0.5, 2));
        const recent = gm.getRecentData(sec);
        if (recent && recent.length >= n) {
            slice = recent.slice(-n);
        }
    }
    if (slice.length < n || !Array.isArray(slice[0])) {
        return null;
    }

    const origin =
        typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
    const decodeBody = {
        samples: slice,
        sampling_rate: sr,
        frequencies_hz: TEST_CONFIG.frequencies,
        phases: TEST_CONFIG.phases,
        window_sec: windowSec
    };
    const chIdx = getSsvepChannelIndicesForTest();
    if (chIdx && chIdx.length) decodeBody.channel_indices = chIdx;

    try {
        const resp = await fetch(`${origin}/api/ssvep/fbcca/decode_window`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(decodeBody)
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            console.warn('decode_window 失败:', data.detail || resp.status);
            return null;
        }
        return data;
    } catch (err) {
        console.warn('decode_window 请求失败:', err);
        return null;
    }
}

async function speedPollTick(targetIndex, targetFreq, opts) {
    if (!testRunning || speedDecodeInFlight) return;
    speedDecodeInFlight = true;
    try {
        const data = await speedTestDecodeOnce(opts);
        if (!data || !testRunning) return;

        const check = speedTestCheckTrigger(data, opts);
        const statusEl = document.getElementById('recognition-result');

        if (!check.triggered) {
            if (check.pendingStable && check.hz != null) {
                statusEl.textContent = `待确认: ${check.hz.toFixed(1)} Hz p=${(check.p1 * 100).toFixed(1)}%`;
            } else if (check.hz != null && check.p1 != null) {
                const delta =
                    check.p2 != null ? ` Δ=${((check.p1 - check.p2) * 100).toFixed(1)}%` : '';
                statusEl.textContent = `解码: ${check.hz.toFixed(1)} Hz p=${(check.p1 * 100).toFixed(1)}%${delta}（未触发）`;
            }
            return;
        }

        const predIdx = check.predIdx;
        const recognizedFreq = TEST_CONFIG.frequencies[predIdx];

        if (predIdx === targetIndex) {
            const responseTime = performance.now() - speedTrialStartMs;
            finishSpeedTrial({
                targetIndex,
                targetFreq,
                correct: true,
                recognizedIndex: predIdx,
                recognizedFreq,
                responseTime,
                falsePositivesBeforeCorrect: speedCurrentTrialFalsePositives
            });
        } else {
            speedCurrentTrialFalsePositives++;
            speedFalsePositiveTotal++;
            confusionMatrix[targetFreq][recognizedFreq]++;
            speedStableCandidateHz = null;
            statusEl.textContent = `误触发: ${recognizedFreq} Hz ❌（继续注视 ${targetFreq} Hz）`;
            updateRealtimeStats();
        }
    } finally {
        speedDecodeInFlight = false;
    }
}

function finishSpeedTrial(params) {
    if (!speedTrialActive || !testRunning) return;
    speedTrialActive = false;
    stopSpeedPolling();

    const {
        targetIndex,
        targetFreq,
        correct,
        recognizedIndex,
        recognizedFreq,
        responseTime,
        timeout,
        falsePositivesBeforeCorrect
    } = params;

    testResults.push({
        trial: currentTrial,
        targetFreq,
        targetIndex,
        recognizedFreq: recognizedFreq ?? null,
        recognizedIndex: recognizedIndex ?? -1,
        correct: !!correct,
        timeout: !!timeout,
        responseTime: responseTime || 0,
        falsePositivesBeforeCorrect: falsePositivesBeforeCorrect ?? speedCurrentTrialFalsePositives,
        testMode: 'speed',
        usedRealData: isDeviceConnected && hasEegStream
    });

    if (correct && recognizedFreq) {
        confusionMatrix[targetFreq][recognizedFreq]++;
    }

    updateRealtimeStats();

    const statusEl = document.getElementById('recognition-result');
    if (correct) {
        statusEl.textContent = `${recognizedFreq} Hz ✅ ${Math.round(responseTime)} ms`;
    } else if (timeout) {
        statusEl.textContent = `超时未识别 ${targetFreq} Hz ❌`;
    }

    const indicator = document.getElementById('target-indicator');
    if (indicator) indicator.style.display = 'none';
    currentStimulusTargetIndex = null;

    if (stimulusEngine) {
        stimulusEngine.stop();
    }

    setTimeout(() => runTrial(), correct ? 800 : 1000);
}

function startSpeedStimulus(targetFreq, targetIndex) {
    const opts = getSpeedTestOptions();
    speedStableCandidateHz = null;
    speedCurrentTrialFalsePositives = 0;
    speedDecodeInFlight = false;

    const indicator = document.getElementById('target-indicator');
    const targetFreqSpan = document.getElementById('target-freq');
    if (indicator) indicator.style.display = 'block';
    if (targetFreqSpan) targetFreqSpan.textContent = targetFreq;
    currentStimulusTargetIndex = targetIndex;

    if (stimulusEngine) {
        stimulusEngine.start();
    }

    speedTrialActive = true;
    speedTrialStartMs = performance.now();
    stopSpeedPolling();

    speedPollTimerId = setInterval(() => {
        speedPollTick(targetIndex, targetFreq, opts);
    }, opts.pollMs);

    speedTrialTimeoutId = setTimeout(() => {
        finishSpeedTrial({
            targetIndex,
            targetFreq,
            correct: false,
            timeout: true,
            responseTime: opts.maxTrialSec * 1000,
            falsePositivesBeforeCorrect: speedCurrentTrialFalsePositives
        });
    }, opts.maxTrialSec * 1000);

    speedPollTick(targetIndex, targetFreq, opts);
}

function buildClassifyRequestPayload(samples, samplingRate) {
    const payload = { samples, sampling_rate: samplingRate };
    const chIdx = getSsvepChannelIndicesForTest();
    if (chIdx && chIdx.length) payload.channel_indices = chIdx;
    return payload;
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initializeTest();
    checkDeviceConnection();
    setupDeviceListener();
    updateFbccaChannelHint();
    onTestModeChange();
    initExperimentSyncUi();
});
window.addEventListener('focus', updateFbccaChannelHint);

// 初始化测试
function initializeTest() {
    // 初始化混淆矩阵
    TEST_CONFIG.frequencies.forEach(freq => {
        confusionMatrix[freq] = {};
        TEST_CONFIG.frequencies.forEach(f => {
            confusionMatrix[freq][f] = 0;
        });
    });
}

// 设置设备监听器
function setupDeviceListener() {
    if (window.globalDeviceManager) {
        // 监听设备事件
        window.globalDeviceManager.addEventListener((event, data) => {
            if (event === 'data') {
                handleEEGData(data);
            } else if (event === 'connected') {
                onDeviceConnected();
            } else if (event === 'disconnected') {
                onDeviceDisconnected();
            }
        });
        
        // 检查初始连接状态
        const status = window.globalDeviceManager.getStatus();
        if (status.isConnected) {
            onDeviceConnected();
        }
    }
}

// 处理EEG数据
function handleEEGData(message) {
    if (!message.data || message.data.length === 0) return;
    hasEegStream = true;
    if (typeof message.sampling_rate === 'number' && message.sampling_rate > 0) {
        eegSamplingRate = message.sampling_rate;
    }

    // 添加到缓冲区
    eegDataBuffer.push(...message.data);
    
    // 限制缓冲区大小（保留最近至少 6 秒，保证 trial 末段可截取 4 s 做 FBCCA）
    const samplingRate = message.sampling_rate || eegSamplingRate || 250;
    const maxSamples = Math.ceil(samplingRate * 6);
    if (eegDataBuffer.length > maxSamples) {
        eegDataBuffer = eegDataBuffer.slice(-maxSamples);
    }
}

// 设备连接
function onDeviceConnected() {
    isDeviceConnected = true;
    const deviceStatus = document.getElementById('device-status');
    const deviceText = document.getElementById('device-text');
    
    deviceStatus.classList.add('active');
    deviceText.textContent = '设备已连接';
    
    console.log('设备已连接，使用真实EEG数据');
}

// 设备断开
function onDeviceDisconnected() {
    isDeviceConnected = false;
    hasEegStream = false;
    const deviceStatus = document.getElementById('device-status');
    const deviceText = document.getElementById('device-text');
    
    deviceStatus.classList.remove('active');
    deviceText.textContent = '设备未连接';
    
    eegDataBuffer = [];
    console.log('设备已断开');
}

// 检查设备连接
function checkDeviceConnection() {
    if (window.globalDeviceManager) {
        const status = window.globalDeviceManager.getStatus();
        if (status.isConnected) {
            onDeviceConnected();
        } else {
            onDeviceDisconnected();
        }
    } else {
        onDeviceDisconnected();
    }
}

// 隐藏说明
function hideInstruction() {
    document.getElementById('instruction-overlay').style.display = 'none';
}

// 开始测试
function startTest() {
    // 强制要求真实设备数据流，避免误导
    if (!isDeviceConnected || !hasEegStream) {
        alert('未检测到 EEG 实时数据流：无法开始测试。\n\n请先到「设备管理」连接设备，并确认 WebSocket 推流正常（页面状态应显示 EEG 缓冲在增长）。');
        return;
    }

    // 获取配置
    activeTestMode = getTestMode();
    if (activeTestMode === 'quality' || activeTestMode === 'full') {
        alert('信号质量分析与完整测试尚未实现，请先选择「准确度测试」或「识别速度测试」。');
        return;
    }

    const repeatCount = parseInt(document.getElementById('repeat-count').value);
    
    // 计算总试次
    totalTrials = TEST_CONFIG.frequencies.length * repeatCount;
    currentTrial = 0;
    testResults = [];
    speedFalsePositiveTotal = 0;
    speedCurrentTrialFalsePositives = 0;
    
    // 重置混淆矩阵
    TEST_CONFIG.frequencies.forEach(freq => {
        TEST_CONFIG.frequencies.forEach(f => {
            confusionMatrix[freq][f] = 0;
        });
    });
    
    // 更新UI
    testRunning = true;
    document.getElementById('start-btn').disabled = true;
    document.getElementById('stop-btn').disabled = false;
    document.getElementById('test-status').classList.add('active');
    document.getElementById('test-text').textContent = '测试中';
    
    // 隐藏说明，显示刺激
    document.getElementById('instruction-overlay').style.display = 'none';
    document.getElementById('stimulus-display').classList.add('active');
    document.getElementById('results-view').classList.remove('active');
    
    // 初始化刺激引擎
    initStimulusEngine();
    
    // 开始第一个试次
    setTimeout(() => runTrial(), 500);
}

// 停止测试
function stopTest() {
    if (!confirm('确定要停止测试吗？当前进度将丢失。')) {
        return;
    }
    
    testRunning = false;
    currentStimulusTargetIndex = null;
    stopSpeedPolling();

    if (countdownIntervalId !== null) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }
    const cd = document.getElementById('countdown-overlay');
    if (cd) cd.style.display = 'none';

    if (isDeviceConnected) {
        const origin =
            typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
        fetch(`${origin}/api/devices/trial_segment/cancel`, { method: 'POST' }).catch(() => {});
    }

    // 停止刺激
    if (stimulusEngine) {
        stimulusEngine.stop();
    }
    
    // 更新UI
    document.getElementById('start-btn').disabled = false;
    document.getElementById('stop-btn').disabled = true;
    document.getElementById('test-status').classList.remove('active');
    document.getElementById('test-text').textContent = '已停止';
    document.getElementById('stimulus-display').classList.remove('active');
    document.getElementById('instruction-overlay').style.display = 'flex';
    
    // 重置进度
    updateProgress(0, 0);
}

// 运行单个试次
function runTrial() {
    if (!testRunning || currentTrial >= totalTrials) {
        finishTest();
        return;
    }
    
    currentTrial++;
    
    // 与 9_cca_withoutvideo.py 一致：loop_id 每试次 +1，注视目标按 0→7 循环（非随机）
    const targetIndex = (currentTrial - 1) % TEST_CONFIG.frequencies.length;
    const targetFreq = TEST_CONFIG.frequencies[targetIndex];
    const targetPos = TEST_CONFIG.positions[targetIndex];
    
    // 更新进度
    updateProgress(currentTrial, totalTrials);
    document.getElementById('current-target').textContent = `${targetFreq} Hz (${targetPos.label})`;
    
    currentStimulusTargetIndex = targetIndex;
    if (stimulusEngine && typeof stimulusEngine.drawStaticCue === 'function') {
        stimulusEngine.drawStaticCue(targetIndex);
    }

    // 显示倒计时（画布上已为静态布局）
    const isSpeed = activeTestMode === 'speed';
    showCountdown(targetFreq, targetPos.label, () => {
        if (isSpeed) {
            startSpeedStimulus(targetFreq, targetIndex);
        } else {
            startStimulus(targetFreq, targetIndex);
        }
    }, { speedMode: isSpeed });
}

// 显示倒计时
function showCountdown(targetFreq, targetLabel, callback, options) {
    const isSpeed = options && options.speedMode;
    const cueDuration = isSpeed
        ? 1
        : parseInt(document.getElementById('cue-duration').value, 10);
    const overlay = document.getElementById('countdown-overlay');
    const countdownNumber = document.getElementById('countdown-number');
    const countdownTarget = document.getElementById('countdown-target');
    const countdownTitle = overlay ? overlay.querySelector('.instruction-title') : null;

    if (countdownIntervalId !== null) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }

    overlay.style.display = 'block';
    if (countdownTitle) {
        countdownTitle.textContent = isSpeed ? '请注视青色蓝框对象' : '准备注视目标';
    }
    countdownTarget.textContent = isSpeed
        ? `目标: ${targetFreq} Hz (${targetLabel}) — 1 秒后开始闪烁并计时`
        : `目标: ${targetFreq} Hz (${targetLabel})`;

    let count = Math.max(1, cueDuration);
    countdownNumber.textContent = count;

    countdownIntervalId = setInterval(() => {
        count--;
        if (count > 0) {
            countdownNumber.textContent = count;
        } else {
            clearInterval(countdownIntervalId);
            countdownIntervalId = null;
            overlay.style.display = 'none';
            callback();
        }
    }, 1000);
}

// 开始刺激
async function startStimulus(targetFreq, targetIndex) {
    const trialDuration = parseInt(document.getElementById('trial-duration').value);
    
    // 显示目标指示器
    const indicator = document.getElementById('target-indicator');
    const targetFreqSpan = document.getElementById('target-freq');
    indicator.style.display = 'block';
    targetFreqSpan.textContent = targetFreq;
    currentStimulusTargetIndex = targetIndex;

    // 与 lsl_received_data.py 一致：在刺激起始由服务端标记「start」，WebSocket 读循环写入试次缓冲
    if (isDeviceConnected) {
        const origin =
            typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
        try {
            const r = await fetch(`${origin}/api/devices/trial_segment/start`, { method: 'POST' });
            if (!r.ok) {
                const t = await r.text().catch(() => '');
                console.warn('trial_segment/start 未成功:', r.status, t);
            }
        } catch (e) {
            console.warn('trial_segment/start 请求失败:', e);
        }
    }

    // 启动刺激引擎
    if (stimulusEngine) {
        stimulusEngine.start();
    }
    
    // 清空EEG缓冲区（波形/备用）；优先使用服务端切段 classify_captured
    eegDataBuffer = [];
    
    // 记录开始时间
    const startTime = performance.now();
    
    // 等待刺激时长后进行识别（FBCCA 在后端执行）
    setTimeout(async () => {
        const endTime = performance.now();
        const responseTime = endTime - startTime;
        
        const recognizedIndex = await recognizeSSVEP(targetIndex);
        const recognizedFreq = TEST_CONFIG.frequencies[recognizedIndex];
        
        // 记录结果
        const isCorrect = recognizedIndex === targetIndex;
        testResults.push({
            trial: currentTrial,
            targetFreq: targetFreq,
            targetIndex: targetIndex,
            recognizedFreq: recognizedFreq,
            recognizedIndex: recognizedIndex,
            correct: isCorrect,
            responseTime: responseTime,
            usedRealData:
                isDeviceConnected && (lastTrialUsedServerCapture || eegDataBuffer.length > 0)
        });
        
        // 更新混淆矩阵
        confusionMatrix[targetFreq][recognizedFreq]++;
        
        // 更新实时统计
        updateRealtimeStats();
        
        // 显示识别结果
        const resultText = `${recognizedFreq} Hz ${isCorrect ? '✅' : '❌'}`;
        const dataSource =
            isDeviceConnected && (lastTrialUsedServerCapture || eegDataBuffer.length > 0)
                ? lastTrialUsedServerCapture
                    ? '(真实数据·服务端切段)'
                    : '(真实数据·前端缓冲)'
                : '(模拟)';
        document.getElementById('recognition-result').textContent = resultText + ' ' + dataSource;
        
        // 隐藏目标指示器
        indicator.style.display = 'none';
        currentStimulusTargetIndex = null;

        // 停止刺激
        if (stimulusEngine) {
            stimulusEngine.stop();
        }
        
        // 短暂延迟后进行下一个试次
        setTimeout(() => runTrial(), 1000);
        
    }, trialDuration * 1000);
}

// SSVEP 识别：仅允许真实 EEG（无数据流直接报错）
async function recognizeSSVEP(targetIndex) {
    return await recognizeFromEEG(targetIndex);
}

async function recognizeFromEEG(targetIndex) {
    lastTrialUsedServerCapture = false;
    const gm = window.globalDeviceManager;
    const srFromDevice =
        gm && gm.deviceInfo && typeof gm.deviceInfo.sampling_rate === 'number'
            ? gm.deviceInfo.sampling_rate
            : null;
    const sr = srFromDevice || eegSamplingRate || 250;

    const origin =
        typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';

    const chIdx = getSsvepChannelIndicesForTest();
    const capBody = chIdx && chIdx.length ? { channel_indices: chIdx } : {};

    try {
        const resp = await fetch(
            `${origin}/api/ssvep/fbcca/classify_captured?sampling_rate=${encodeURIComponent(sr)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(capBody)
            }
        );
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
            let idx = data.predicted_index;
            if (typeof idx !== 'number' && typeof data.predicted_class === 'number') {
                idx = data.predicted_class - 1;
            }
            if (typeof idx !== 'number' || idx < 0 || idx >= TEST_CONFIG.frequencies.length) {
                console.error('FBCCA classify_captured 返回异常:', data);
            } else {
                lastTrialUsedServerCapture = true;
                console.log('FBCCA（服务端切段）:', {
                    target: TEST_CONFIG.frequencies[targetIndex],
                    predicted_hz: data.predicted_frequency_hz,
                    predicted_index: idx,
                    scores: data.fbcca_scores,
                    captured_sample_count: data.captured_sample_count,
                    channel_indices: chIdx,
                    fbcca_channel_expansion: data.fbcca_channel_expansion,
                    fbcca_fusion: data.fbcca_fusion
                });
                return idx;
            }
        } else {
            console.warn('classify_captured 不可用，回退前端缓冲:', data.detail || resp.status);
        }
    } catch (err) {
        console.warn('classify_captured 请求失败，回退前端缓冲:', err);
    }

    if (eegDataBuffer.length < 50) {
        throw new Error('EEG 数据过少：请确认设备已正确推流（WebSocket /api/devices/stream 有数据），并重新开始试次。');
    }

    const segment = eegDataBuffer.slice();

    try {
        const resp = await fetch(`${origin}/api/ssvep/fbcca/classify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildClassifyRequestPayload(segment, sr))
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(String(data.detail || 'FBCCA API 错误'));
        }
        let idx = data.predicted_index;
        if (typeof idx !== 'number' && typeof data.predicted_class === 'number') {
            idx = data.predicted_class - 1;
        }
        if (typeof idx !== 'number' || idx < 0 || idx >= TEST_CONFIG.frequencies.length) {
            throw new Error('FBCCA 返回异常');
        }
        console.log('FBCCA（前端缓冲）:', {
            target: TEST_CONFIG.frequencies[targetIndex],
            predicted_hz: data.predicted_frequency_hz,
            predicted_index: idx,
            scores: data.fbcca_scores
        });
        return idx;
    } catch (err) {
        console.error('FBCCA 请求失败:', err);
        throw err;
    }
}

// 模拟SSVEP识别（备用方案）
function simulateRecognition(targetIndex) {
    throw new Error('simulateRecognition 已禁用：测试必须基于真实 EEG 数据流');
}

// 更新进度
function updateProgress(current, total) {
    document.getElementById('test-progress').textContent = `${current}/${total}`;
    const percentage = total > 0 ? (current / total) * 100 : 0;
    document.getElementById('progress-fill').style.width = percentage + '%';
}

// 更新实时统计
function updateRealtimeStats() {
    const correctCount = testResults.filter((r) => r.correct).length;
    const incorrectCount = testResults.filter((r) => !r.correct).length;
    const accuracy =
        testResults.length > 0 ? ((correctCount / testResults.length) * 100).toFixed(1) : 0;

    document.getElementById('correct-count').textContent = correctCount;
    document.getElementById('incorrect-count').textContent = incorrectCount;
    document.getElementById('current-accuracy').textContent = accuracy + '%';

    const isSpeed = activeTestMode === 'speed' || testResults.some((r) => r.testMode === 'speed');
    const falseEl = document.getElementById('speed-false-triggers');
    const avgRtEl = document.getElementById('speed-avg-rt');
    if (falseEl) falseEl.textContent = speedFalsePositiveTotal;
    if (avgRtEl) {
        const completedCorrect = testResults.filter((r) => r.correct && r.responseTime > 0);
        avgRtEl.textContent =
            completedCorrect.length > 0
                ? Math.round(
                      completedCorrect.reduce((s, r) => s + r.responseTime, 0) / completedCorrect.length
                  ) + ' ms'
                : '-';
    }
    if (isSpeed) {
        document.querySelectorAll('.speed-only-stat').forEach((el) => {
            el.style.display = 'flex';
        });
    }
}

// 完成测试
function finishTest() {
    testRunning = false;
    currentStimulusTargetIndex = null;
    stopSpeedPolling();

    if (isDeviceConnected) {
        const origin =
            typeof ssvepResolveApiOrigin === 'function' ? ssvepResolveApiOrigin() : 'http://127.0.0.1:8000';
        fetch(`${origin}/api/devices/trial_segment/cancel`, { method: 'POST' }).catch(() => {});
    }

    // 停止刺激
    if (stimulusEngine) {
        stimulusEngine.stop();
    }
    
    // 更新UI
    document.getElementById('start-btn').disabled = false;
    document.getElementById('stop-btn').disabled = true;
    document.getElementById('test-status').classList.remove('active');
    document.getElementById('test-text').textContent = '已完成';
    document.getElementById('stimulus-display').classList.remove('active');
    
    // 显示结果
    showResults();
}

// 显示结果
function showResults() {
    document.getElementById('results-view').classList.add('active');

    const isSpeed = activeTestMode === 'speed' || testResults.some((r) => r.testMode === 'speed');
    document.querySelectorAll('.speed-only-result').forEach((el) => {
        el.style.display = isSpeed ? 'block' : 'none';
    });
    const avgLabel = document.getElementById('avg-response-time-label');
    if (avgLabel) {
        avgLabel.textContent = isSpeed ? '平均识别耗时(ms)' : '平均响应时间(ms)';
    }

    // 计算统计数据
    const correctCount = testResults.filter((r) => r.correct).length;
    const incorrectCount = testResults.filter((r) => !r.correct).length;
    const accuracy = testResults.length > 0 ? ((correctCount / testResults.length) * 100).toFixed(1) : '0.0';

    const correctTrials = testResults.filter((r) => r.correct && r.responseTime > 0);
    const avgResponseTime =
        correctTrials.length > 0
            ? (
                  correctTrials.reduce((sum, r) => sum + r.responseTime, 0) / correctTrials.length
              ).toFixed(0)
            : '0';
    const sortedRt = correctTrials.map((r) => r.responseTime).sort((a, b) => a - b);
    const medianResponseTime =
        sortedRt.length > 0
            ? sortedRt.length % 2 === 1
                ? sortedRt[(sortedRt.length - 1) / 2]
                : (sortedRt[sortedRt.length / 2 - 1] + sortedRt[sortedRt.length / 2]) / 2
            : 0;

    // 更新总体统计
    document.getElementById('final-accuracy').textContent = accuracy + '%';
    document.getElementById('total-trials').textContent = testResults.length;
    document.getElementById('correct-trials').textContent = correctCount;
    document.getElementById('incorrect-trials').textContent = incorrectCount;
    document.getElementById('avg-response-time').textContent = avgResponseTime;
    const medianEl = document.getElementById('median-response-time');
    const falseTotalEl = document.getElementById('false-trigger-total');
    if (medianEl) medianEl.textContent = Math.round(medianResponseTime);
    if (falseTotalEl) falseTotalEl.textContent = speedFalsePositiveTotal;
    
    // 根据准确率设置颜色
    const accuracyElement = document.getElementById('final-accuracy');
    if (accuracy >= 80) {
        accuracyElement.style.color = '#4CAF50';
    } else if (accuracy >= 60) {
        accuracyElement.style.color = '#FF9800';
    } else {
        accuracyElement.style.color = '#F44336';
    }
    
    // 生成混淆矩阵
    generateConfusionMatrix();
    
    // 绘制频率识别率图表
    drawFrequencyChart();
}

// 生成混淆矩阵
function generateConfusionMatrix() {
    const table = document.getElementById('confusion-matrix-table');
    let html = '<thead><tr><th>实际\\识别</th>';
    
    // 表头
    TEST_CONFIG.frequencies.forEach(freq => {
        html += `<th>${freq} Hz</th>`;
    });
    html += '</tr></thead><tbody>';
    
    // 表格内容
    TEST_CONFIG.frequencies.forEach(actualFreq => {
        html += `<tr><th>${actualFreq} Hz</th>`;
        TEST_CONFIG.frequencies.forEach(recognizedFreq => {
            const count = confusionMatrix[actualFreq][recognizedFreq] || 0;
            const isCorrect = actualFreq === recognizedFreq;
            const className = count > 0 ? (isCorrect ? 'correct' : 'incorrect') : '';
            html += `<td class="${className}">${count}</td>`;
        });
        html += '</tr>';
    });
    
    html += '</tbody>';
    table.innerHTML = html;
}

// 绘制频率识别率图表
function drawFrequencyChart() {
    const canvas = document.getElementById('frequency-chart');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    // 计算每个频率的识别率
    const accuracyByFreq = {};
    TEST_CONFIG.frequencies.forEach(freq => {
        const trials = testResults.filter(r => r.targetFreq === freq);
        const correct = trials.filter(r => r.correct).length;
        accuracyByFreq[freq] = trials.length > 0 ? (correct / trials.length * 100) : 0;
    });
    
    // 绘制图表
    const padding = 50;
    const chartWidth = canvas.width - padding * 2;
    const chartHeight = canvas.height - padding * 2;
    const barWidth = chartWidth / TEST_CONFIG.frequencies.length;
    
    // 清空画布
    ctx.fillStyle = '#2A2A2A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制网格线
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(canvas.width - padding, y);
        ctx.stroke();
        
        // Y轴标签
        ctx.fillStyle = '#888';
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        ctx.fillText((100 - i * 20) + '%', padding - 10, y + 4);
    }
    
    // 绘制柱状图
    TEST_CONFIG.frequencies.forEach((freq, index) => {
        const accuracy = accuracyByFreq[freq];
        const barHeight = (accuracy / 100) * chartHeight;
        const x = padding + index * barWidth + barWidth * 0.1;
        const y = padding + chartHeight - barHeight;
        const width = barWidth * 0.8;
        
        // 柱子
        const gradient = ctx.createLinearGradient(x, y, x, y + barHeight);
        gradient.addColorStop(0, '#00D9FF');
        gradient.addColorStop(1, '#0088AA');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, width, barHeight);
        
        // 频率标签
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(freq + ' Hz', x + width / 2, canvas.height - padding + 20);
        
        // 准确率标签
        ctx.fillStyle = '#00D9FF';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(accuracy.toFixed(1) + '%', x + width / 2, y - 5);
    });
    
    // X轴标签
    ctx.fillStyle = '#888';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('频率 (Hz)', canvas.width / 2, canvas.height - 10);
    
    // Y轴标签
    ctx.save();
    ctx.translate(15, canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('识别率 (%)', 0, 0);
    ctx.restore();
}

// 初始化刺激引擎
function initStimulusEngine() {
    const canvas = document.getElementById('test-canvas');
    const ctx = canvas.getContext('2d');
    
    // 设置画布大小
    canvas.width = 1200;
    canvas.height = 800;
    
    stimulusEngine = {
        running: false,
        animationId: null,
        stimStartMs: 0,

        /** 提示阶段：静态灰块 + 频率标签 + 注视框（与 Psychopy cue 同步思路，无闪烁调制） */
        drawStaticCue: function(targetIndex) {
            const size = 120;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            TEST_CONFIG.frequencies.forEach((freq, index) => {
                const pos = TEST_CONFIG.positions[index];
                const x = pos.x * canvas.width - size / 2;
                const y = pos.y * canvas.height - size / 2;
                ctx.fillStyle = '#808080';
                ctx.fillRect(x, y, size, size);
                if (index === targetIndex) {
                    ctx.strokeStyle = '#00D9FF';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(x - 2, y - 2, size + 4, size + 4);
                }
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 20px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(freq + ' Hz', x + size / 2, y + size / 2);
            });
        },

        start: function() {
            this.running = true;
            this.stimStartMs = performance.now();
            this.animate();
        },
        
        stop: function() {
            this.running = false;
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
            }
        },
        
        animate: function() {
            if (!this.running) return;
            
            const phases = TEST_CONFIG.phases || [];
            const hz = TEST_CONFIG.stimRefHz || 60;
            /* 与 Psychopy 一致：frameN 按 60Hz 离散递增（避免高刷显示器上 rAF 每帧 +1 破坏相位） */
            const elapsedSec = (performance.now() - this.stimStartMs) / 1000;
            const frameN = Math.floor(elapsedSec * hz);

            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const size = 120;
            TEST_CONFIG.frequencies.forEach((freq, index) => {
                const pos = TEST_CONFIG.positions[index];
                const x = pos.x * canvas.width - size / 2;
                const y = pos.y * canvas.height - size / 2;
                const ph = phases[index] != null ? phases[index] : 0;
                const amp = (Math.sin((2 * Math.PI * freq * frameN) / hz + ph) - 0.5) * 2;
                const brightness01 = Math.max(0, Math.min(1, (amp + 1) / 2));
                const gray = Math.floor(brightness01 * 255);

                ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
                ctx.fillRect(x, y, size, size);

                if (currentStimulusTargetIndex === index) {
                    ctx.strokeStyle = '#00D9FF';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(x - 2, y - 2, size + 4, size + 4);
                }

                ctx.fillStyle = brightness01 > 0.5 ? '#000' : '#fff';
                ctx.font = 'bold 20px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(freq + ' Hz', x + size / 2, y + size / 2);
            });

            this.animationId = requestAnimationFrame(() => this.animate());
        }
    };
}

// 重置测试
function resetTest() {
    currentTrial = 0;
    totalTrials = 0;
    testResults = [];
    speedFalsePositiveTotal = 0;
    speedCurrentTrialFalsePositives = 0;
    stopSpeedPolling();
    activeTestMode = getTestMode();
    
    // 重置混淆矩阵
    TEST_CONFIG.frequencies.forEach(freq => {
        TEST_CONFIG.frequencies.forEach(f => {
            confusionMatrix[freq][f] = 0;
        });
    });
    
    // 重置UI
    document.getElementById('results-view').classList.remove('active');
    document.getElementById('instruction-overlay').style.display = 'flex';
    document.getElementById('current-target').textContent = '-';
    document.getElementById('recognition-result').textContent = '-';
    updateProgress(0, 0);
    updateRealtimeStats();
}

// 导出结果
function exportResults() {
    const isSpeed = activeTestMode === 'speed' || testResults.some((r) => r.testMode === 'speed');
    const correctTrials = testResults.filter((r) => r.correct && r.responseTime > 0);
    const sortedRt = correctTrials.map((r) => r.responseTime).sort((a, b) => a - b);
    const medianRt =
        sortedRt.length > 0
            ? sortedRt.length % 2 === 1
                ? sortedRt[(sortedRt.length - 1) / 2]
                : (sortedRt[sortedRt.length / 2 - 1] + sortedRt[sortedRt.length / 2]) / 2
            : 0;

    const report = {
        timestamp: new Date().toISOString(),
        testMode: activeTestMode,
        config: isSpeed
            ? {
                  repeatCount: document.getElementById('repeat-count').value,
                  speed: getSpeedTestOptions()
              }
            : {
                  trialDuration: document.getElementById('trial-duration').value,
                  cueDuration: document.getElementById('cue-duration').value,
                  repeatCount: document.getElementById('repeat-count').value
              },
        summary: {
            totalTrials: testResults.length,
            correctTrials: testResults.filter((r) => r.correct).length,
            incorrectTrials: testResults.filter((r) => !r.correct).length,
            accuracy: (
                (testResults.filter((r) => r.correct).length / Math.max(1, testResults.length)) *
                100
            ).toFixed(2),
            avgResponseTime:
                correctTrials.length > 0
                    ? (
                          correctTrials.reduce((sum, r) => sum + r.responseTime, 0) / correctTrials.length
                      ).toFixed(2)
                    : '0',
            medianResponseTime: medianRt.toFixed(2),
            falseTriggerTotal: speedFalsePositiveTotal
        },
        confusionMatrix: confusionMatrix,
        trials: testResults
    };
    
    // 下载JSON文件
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ssvep-test-report-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    alert('测试报告已导出！');
}

function initExperimentSyncUi() {
    const E = window.SEEKBCI_EXPERIMENT;
    if (!E) return;
    E.populateProjectSelect('exp-sync-project');
    const saved = E.loadExperimentConfig();
    if (saved && saved.ssvepSpeed) {
        E.applySsvepSpeedToDom(saved.ssvepSpeed);
        const hint = document.getElementById('exp-sync-hint');
        if (hint && saved.updatedAt) {
            hint.textContent = `已加载上次保存的实验参数（${new Date(saved.updatedAt).toLocaleString('zh-CN')}）`;
        }
    }
}

function saveExperimentParamsOnly() {
    const E = window.SEEKBCI_EXPERIMENT;
    if (!E) {
        alert('实验配置模块未加载');
        return;
    }
    if (getTestMode() !== 'speed') {
        alert('请先切换到「识别速度测试」模式再保存/同步（与项目置信度运行参数对应）。');
        return;
    }
    const saved = E.saveCurrentSsvepSpeedExperiment();
    const hint = document.getElementById('exp-sync-hint');
    if (hint) {
        hint.textContent = `已保存实验参数（${new Date(saved.updatedAt).toLocaleString('zh-CN')}）`;
    }
    alert('实验参数已保存到本机，可在下方选择项目后同步。');
}

function syncExperimentParamsToProject() {
    const E = window.SEEKBCI_EXPERIMENT;
    if (!E) {
        alert('实验配置模块未加载');
        return;
    }
    if (getTestMode() !== 'speed') {
        alert('请先切换到「识别速度测试」模式。该模式参数与项目「置信度模式」运行配置一致。');
        return;
    }
    const projectId = document.getElementById('exp-sync-project')?.value;
    if (!projectId) {
        alert('请选择要同步到的项目');
        return;
    }
    try {
        const { project, runConfig } = E.syncExperimentToProject(projectId);
        const hint = document.getElementById('exp-sync-hint');
        if (hint) {
            hint.textContent = `已同步到「${project.name}」：窗长 ${runConfig.windowSec}s，轮询 ${runConfig.pollMs}ms，Top1≥${runConfig.minProbability}`;
        }
        alert(
            `已将实验参数写入「${project.name}」的运行配置。\n\n` +
                `窗长 ${runConfig.windowSec}s · 轮询 ${runConfig.pollMs}ms · Top1≥${runConfig.minProbability} · 差值≥${runConfig.minMargin}\n\n` +
                '可在项目管理器中运行该项目验证效果。'
        );
    } catch (err) {
        alert('同步失败：' + (err.message || err));
    }
}
