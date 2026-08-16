/**
 * 眼电 EOG 测试 — 去基线波形 + 升–落/突变触发可视化。
 */
(function () {
    const EOG = () => window.SSVEP_EOG_PULSE || null;
    const CHANNEL_COLORS = [
        '#c9a0ff',
        '#a78bfa',
        '#8b5cf6',
        '#7c3aed',
        '#e9d5ff',
        '#d8b4fe',
        '#c084fc',
        '#a855f7'
    ];
    const LOCAL_KEY = 'ssvep_eog_test_params_v1';
    const WAVE_KEEP_MS = 4000;

    /** @type {Record<number, object>} */
    let channelStates = {};
    /** @type {Record<number, object>} */
    let channelUi = {};
    let triggerMarkers = []; // { t, ch, peak }
    let deviceConnected = false;
    let hasStream = false;
    let listenerAttached = false;
    let rafId = 0;
    let lastTickMs = 0;
    let bufferConsumeIdx = 0;
    let totalFires = 0;
    let fireTimestamps = [];
    let blinkUntilMs = 0;
    let flashUntilMs = 0;
    /** @type {Record<number, { row: HTMLElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, color: string }>} */
    let wavePanels = {};
    let waveLayoutKey = '';
    let lastHttpPullMs = 0;
    let httpPullInFlight = false;

    function getApiBase() {
        return typeof window.ssvepGetDevicesApiBase === 'function'
            ? window.ssvepGetDevicesApiBase()
            : `${typeof window.ssvepResolveApiOrigin === 'function' ? window.ssvepResolveApiOrigin() : 'http://127.0.0.1:8000'}/api/devices`;
    }

    function getSr(message) {
        const fromMsg = message && Number(message.sampling_rate);
        if (Number.isFinite(fromMsg) && fromMsg > 0) return fromMsg;
        const gdm = window.globalDeviceManager;
        const sr = gdm && gdm.deviceInfo && Number(gdm.deviceInfo.sampling_rate);
        return Number.isFinite(sr) && sr > 0 ? sr : 250;
    }

    function getEogChannelIndices() {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (CFG && typeof CFG.getPhysicalChannelsForRole === 'function') {
            return CFG.getPhysicalChannelsForRole('eog');
        }
        const gdm = window.globalDeviceManager;
        const roles = gdm && typeof gdm.getChannelRoles === 'function' ? gdm.getChannelRoles() : null;
        if (!Array.isArray(roles)) return [];
        const out = [];
        for (let i = 0; i < roles.length; i++) {
            if (roles[i] === 'eog') out.push(i);
        }
        return out;
    }

    function channelLabel(ch) {
        return `Ch${Number(ch) + 1}`;
    }

    function readCfg() {
        const mode = document.getElementById('cfg-mode')?.value || 'pulse';
        return {
            mode: mode === 'edge' ? 'edge' : 'pulse',
            edgePolarity: document.getElementById('cfg-polarity')?.value || 'rise',
            baselineTauSec: parseFloat(document.getElementById('cfg-baseline-tau')?.value) || 1.5,
            refractoryMs: parseInt(document.getElementById('cfg-refractory')?.value, 10) || 350,
            pulseOnsetUv: parseFloat(document.getElementById('cfg-pulse-onset')?.value) || 45,
            pulseRecoverRatio: parseFloat(document.getElementById('cfg-pulse-recover')?.value) || 0.35,
            pulseMaxMs: parseInt(document.getElementById('cfg-pulse-max')?.value, 10) || 420,
            pulseMinMs: parseInt(document.getElementById('cfg-pulse-min')?.value, 10) || 40,
            edgeJumpUv: parseFloat(document.getElementById('cfg-edge-jump')?.value) || 50,
            edgeWindowMs: parseInt(document.getElementById('cfg-edge-window')?.value, 10) || 80,
            historyKeepMs: WAVE_KEEP_MS
        };
    }

    function applyModeUi() {
        const mode = document.getElementById('cfg-mode')?.value || 'pulse';
        const pulse = document.getElementById('pulse-params');
        const edge = document.getElementById('edge-params');
        if (pulse) pulse.classList.toggle('on', mode === 'pulse');
        if (edge) edge.classList.toggle('on', mode === 'edge');
    }

    function ensureState(ch) {
        const mod = EOG();
        if (!mod) return null;
        const cfg = readCfg();
        if (!channelStates[ch]) {
            channelStates[ch] = mod.createChannelState(cfg);
        } else {
            mod.syncParams(channelStates[ch], cfg);
        }
        return channelStates[ch];
    }

    function resetAll() {
        const mod = EOG();
        const cfg = readCfg();
        const chs = getEogChannelIndices();
        channelStates = {};
        channelUi = {};
        triggerMarkers = [];
        totalFires = 0;
        fireTimestamps = [];
        for (const ch of chs) {
            if (!mod) continue;
            channelStates[ch] = mod.createChannelState(cfg);
            channelUi[ch] = { metric: 0, phase: 'idle', fireCount: 0, peak: 0 };
        }
        updateEyeLabel();
        waveLayoutKey = '';
        ensureWavePanels();
        renderChannelCards();
        const pill = document.getElementById('trigger-preview');
        if (pill) {
            pill.className = 'status-pill status-wait';
            pill.textContent = '已重置，等待事件…';
        }
    }

    function noteFire(ch, peak, tMs) {
        totalFires += 1;
        fireTimestamps.push(tMs);
        const cutoff = tMs - 60000;
        fireTimestamps = fireTimestamps.filter((x) => x >= cutoff);
        triggerMarkers.push({ t: tMs, ch, peak });
        if (triggerMarkers.length > 80) triggerMarkers = triggerMarkers.slice(-80);
        blinkUntilMs = tMs + 160;
        flashUntilMs = tMs + 280;
        updateEyeLabel();
        const pill = document.getElementById('trigger-preview');
        if (pill) {
            pill.className = 'status-pill status-fire';
            pill.textContent = `触发 · Ch${ch + 1} · ${peak.toFixed(0)} µV`;
        }
        const card = document.getElementById(`eog-card-${ch}`);
        if (card) {
            card.classList.add('fire');
            setTimeout(() => card.classList.remove('fire'), 400);
        }
        const panel = wavePanels[ch];
        if (panel && panel.row) {
            panel.row.classList.add('fire');
            setTimeout(() => panel.row.classList.remove('fire'), 400);
        }
    }

    function updateEyeLabel() {
        const el = document.getElementById('eye-fire-count');
        if (el) el.textContent = String(totalFires);
        const rate = document.getElementById('fire-rate');
        if (rate) rate.textContent = `触发 ${fireTimestamps.length} / min`;
    }

    function feedFromRows(rows, tMsEnd, sr) {
        const mod = EOG();
        if (!mod || !rows || !rows.length) return false;
        const chs = getEogChannelIndices();
        if (!chs.length) return false;
        let any = false;
        for (const ch of chs) {
            const st = ensureState(ch);
            if (!st) continue;
            const out = mod.feedRows(st, rows, ch, tMsEnd, sr);
            channelUi[ch] = {
                metric: out.metric || 0,
                phase: out.phase || st.pulsePhase,
                fireCount: out.fireCount || st.fireCount,
                peak: out.peak || st.pulsePeak || 0
            };
            if (out.events && out.events.length) {
                for (const ev of out.events) noteFire(ch, ev.peak || Math.abs(ev.metric), ev.t);
            }
            any = true;
        }
        return any;
    }

    function ingestFromMessage(message) {
        const plot =
            message && Array.isArray(message.data_display) && message.data_display.length
                ? message.data_display
                : message && Array.isArray(message.data)
                  ? message.data
                  : null;
        if (!plot || !plot.length) return false;
        let rows = plot;
        if (typeof window.normalizeDeviceStreamSamples === 'function') {
            const n = window.normalizeDeviceStreamSamples({ ...message, data: plot });
            if (Array.isArray(n) && n.length) rows = n;
        }
        const sr = getSr(message);
        const tMs = performance.now();
        return feedFromRows(rows, tMs, sr);
    }

    function refreshFromDisplayBuffer() {
        const gdm = window.globalDeviceManager;
        if (!gdm) return false;
        const buf = gdm.dataDisplayBuffer;
        if (!Array.isArray(buf) || !buf.length) return false;
        const chs = getEogChannelIndices();
        if (!chs.length) return false;
        const sr = getSr();
        // 只消费新增样本，避免重复喂入导致假脉冲
        const start = Math.min(bufferConsumeIdx, buf.length);
        const slice = buf.slice(start);
        bufferConsumeIdx = buf.length;
        if (!slice.length) {
            // 缓冲被裁短时复位
            if (bufferConsumeIdx > buf.length) bufferConsumeIdx = 0;
            return false;
        }
        // 若缓冲环被大量替换，可能 start 无效
        if (start === 0 && slice.length === buf.length && buf.length > sr * 2) {
            // 首次：只吃尾部约 0.25s，避免冷启动误触发
            const n = Math.max(1, Math.floor(sr * 0.25));
            return feedFromRows(buf.slice(-n), performance.now(), sr);
        }
        return feedFromRows(slice, performance.now(), sr);
    }

    function isDeviceLive() {
        const gdm = window.globalDeviceManager;
        return !!(deviceConnected || (gdm && gdm.isConnected));
    }

    function updateConnUi() {
        const pill = document.getElementById('conn-status');
        const detail = document.getElementById('conn-detail');
        const chs = getEogChannelIndices();
        const gdm = window.globalDeviceManager;
        const live = isDeviceLive();
        if (pill) {
            pill.className = 'status-pill ' + (live ? 'status-ok' : 'status-bad');
            pill.textContent = live ? '已连接' : '未连接';
        }
        if (detail) {
            if (!live) detail.textContent = '请先在设备管理连接 EEG';
            else if (!chs.length) detail.textContent = '已连接，但未将任何通道角色设为「眼电」';
            else detail.textContent = `眼电通道：${chs.map((c) => channelLabel(c)).join('、')} · ${hasStream ? 'WS 流' : '缓冲/HTTP'}`;
        }
        const srEl = document.getElementById('sr-label');
        if (srEl) {
            const sr = gdm && gdm.deviceInfo ? gdm.deviceInfo.sampling_rate : null;
            srEl.textContent = sr ? `采样率 ${sr} Hz` : '采样率 — Hz';
        }
    }

    function renderChannelCards() {
        const wrap = document.getElementById('channel-cards');
        if (!wrap) return;
        const chs = getEogChannelIndices();
        const cfg = readCfg();
        const thr = cfg.mode === 'pulse' ? cfg.pulseOnsetUv : cfg.edgeJumpUv;
        if (!chs.length) {
            wrap.innerHTML =
                '<p class="form-hint" style="color:#888;">无眼电通道。请到设备管理将通道标为「眼电」。</p>';
            return;
        }
        wrap.innerHTML = chs
            .map((ch, i) => {
                const ui = channelUi[ch] || { metric: 0, phase: 'idle', fireCount: 0, peak: 0 };
                const abs = Math.abs(ui.metric || 0);
                const pct = Math.max(0, Math.min(100, (abs / Math.max(1, thr)) * 100));
                const thrPct = Math.min(100, (thr / Math.max(thr, abs, 1)) * 100);
                const color = CHANNEL_COLORS[i % CHANNEL_COLORS.length];
                return `
                <div class="ch-card" id="eog-card-${ch}">
                    <div class="name" style="color:${color}">${channelLabel(ch)}</div>
                    <div class="meta">
                        metric <b>${(ui.metric || 0).toFixed(1)}</b> µV ·
                        相位 <b>${ui.phase || 'idle'}</b><br>
                        峰值 <b>${(ui.peak || 0).toFixed(0)}</b> ·
                        累计 <b>${ui.fireCount || 0}</b>
                    </div>
                    <div class="ch-metric-bar">
                        <div class="ch-metric-fill" style="width:${pct}%;background:linear-gradient(90deg,${color}88,${color})"></div>
                        <div class="ch-metric-thr" style="left:${thrPct}%"></div>
                    </div>
                </div>`;
            })
            .join('');
    }

    function ensureWavePanels() {
        const stack = document.getElementById('wave-stack');
        if (!stack) return;
        const chs = getEogChannelIndices();
        const key = chs.join(',');
        if (key === waveLayoutKey && Object.keys(wavePanels).length === chs.length) {
            // 更新标题读数
            for (const ch of chs) updateWaveRowHead(ch);
            return;
        }
        waveLayoutKey = key;
        wavePanels = {};
        stack.innerHTML = '';
        if (!chs.length) {
            stack.innerHTML = '<div class="wave-empty">请配置眼电通道后查看波形（每路独立显示）</div>';
            return;
        }
        chs.forEach((ch, i) => {
            const color = CHANNEL_COLORS[i % CHANNEL_COLORS.length];
            const row = document.createElement('div');
            row.className = 'wave-row';
            row.id = `wave-row-${ch}`;
            row.innerHTML = `
                <div class="wave-row-head">
                    <span class="name" style="color:${color}">${channelLabel(ch)}</span>
                    <span class="meta" id="wave-meta-${ch}">metric <b>—</b> µV</span>
                </div>
                <canvas id="wave-canvas-${ch}"></canvas>`;
            stack.appendChild(row);
            const canvas = row.querySelector('canvas');
            const ctx = canvas.getContext('2d');
            wavePanels[ch] = { row, canvas, ctx, color };
        });
        resizeAllWaves();
    }

    function updateWaveRowHead(ch) {
        const el = document.getElementById(`wave-meta-${ch}`);
        if (!el) return;
        const ui = channelUi[ch] || { metric: 0, phase: 'idle', fireCount: 0, peak: 0 };
        el.innerHTML =
            `metric <b>${(ui.metric || 0).toFixed(1)}</b> µV · ` +
            `相位 <b>${ui.phase || 'idle'}</b> · ` +
            `峰值 <b>${(ui.peak || 0).toFixed(0)}</b> · ` +
            `累计 <b>${ui.fireCount || 0}</b>`;
    }

    function resizeAllWaves() {
        const dpr = window.devicePixelRatio || 1;
        Object.keys(wavePanels).forEach((chKey) => {
            const panel = wavePanels[chKey];
            if (!panel || !panel.canvas) return;
            const canvas = panel.canvas;
            const parent = canvas.parentElement;
            const cssW = Math.max(280, parent ? parent.clientWidth : 640);
            // flex 布局下首次 clientHeight 可能为 0，按通道数给保底高度
            const n = Math.max(1, getEogChannelIndices().length);
            const fallbackH = Math.max(120, Math.min(240, Math.floor((window.innerHeight - 220) / n) - 20));
            const cssH = Math.max(100, parent && parent.clientHeight > 40 ? parent.clientHeight - 32 : fallbackH);
            canvas.style.width = cssW + 'px';
            canvas.style.height = cssH + 'px';
            canvas.width = Math.floor(cssW * dpr);
            canvas.height = Math.floor(cssH * dpr);
            if (panel.ctx) panel.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        });
    }

    function drawOneChannel(ch, nowMs, colorIndex) {
        const panel = wavePanels[ch];
        if (!panel || !panel.ctx) return;
        const canvas = panel.canvas;
        const ctx = panel.ctx;
        const w = canvas.clientWidth || 640;
        const h = canvas.clientHeight || 160;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#080810';
        ctx.fillRect(0, 0, w, h);

        const cfg = readCfg();
        const thr = cfg.mode === 'pulse' ? cfg.pulseOnsetUv : cfg.edgeJumpUv;
        const t0 = nowMs - WAVE_KEEP_MS;
        const st = channelStates[ch];
        const color = panel.color || CHANNEL_COLORS[colorIndex % CHANNEL_COLORS.length];

        let yMax = Math.max(thr * 1.6, 40);
        if (st && st.metricHistory) {
            for (const p of st.metricHistory) {
                if (p.t < t0) continue;
                yMax = Math.max(yMax, Math.abs(p.v) * 1.15);
            }
        }
        const yMid = h / 2;
        const yScale = (h * 0.42) / yMax;
        const yOf = (v) => yMid - v * yScale;

        ctx.strokeStyle = '#1e1e2a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yMid);
        ctx.lineTo(w, yMid);
        ctx.stroke();

        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255,82,82,0.75)';
        ctx.beginPath();
        ctx.moveTo(0, yOf(thr));
        ctx.lineTo(w, yOf(thr));
        ctx.moveTo(0, yOf(-thr));
        ctx.lineTo(w, yOf(-thr));
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#666';
        ctx.font = '11px Segoe UI, sans-serif';
        ctx.fillText(`±${thr.toFixed(0)} µV`, 8, Math.max(12, yOf(thr) - 4));

        for (const m of triggerMarkers) {
            if (m.ch !== ch || m.t < t0) continue;
            const x = ((m.t - t0) / WAVE_KEEP_MS) * w;
            ctx.strokeStyle = 'rgba(255, 220, 100, 0.85)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 6);
            ctx.lineTo(x, h - 6);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
            ctx.beginPath();
            ctx.arc(x, 12, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }

        if (st && st.metricHistory && st.metricHistory.length >= 2) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            let started = false;
            for (const p of st.metricHistory) {
                if (p.t < t0) continue;
                const x = ((p.t - t0) / WAVE_KEEP_MS) * w;
                const y = yOf(p.v);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else ctx.lineTo(x, y);
            }
            if (started) ctx.stroke();

            if (st.pulsePhase === 'rising') {
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.35;
                ctx.fillRect(w - 5, yOf(st.pulsePeak), 4, yOf(0) - yOf(st.pulsePeak));
                ctx.globalAlpha = 1;
            }
        } else {
            ctx.fillStyle = '#444';
            ctx.font = '12px Segoe UI, sans-serif';
            ctx.fillText('等待该通道数据…', 16, h / 2);
        }
    }

    function drawWaveform(nowMs) {
        ensureWavePanels();
        const chs = getEogChannelIndices();
        chs.forEach((ch, i) => {
            updateWaveRowHead(ch);
            drawOneChannel(ch, nowMs, i);
        });
    }

    function updateEyeAnim(nowMs) {
        const ball = document.getElementById('eye-ball');
        const stage = document.getElementById('eye-stage');
        if (ball) ball.classList.toggle('blink', nowMs < blinkUntilMs);
        if (stage) stage.classList.toggle('flash', nowMs < flashUntilMs);
    }

    function tick(nowMs) {
        rafId = requestAnimationFrame(tick);
        if (nowMs - lastTickMs < 33) return;
        lastTickMs = nowMs;

        if (isDeviceLive()) {
            refreshFromDisplayBuffer();
            if (!hasStream) void pullDataFromHttpFallback();
        }
        updateConnUi();
        renderChannelCards();
        drawWaveform(nowMs);
        updateEyeAnim(nowMs);
        updateEyeLabel();
    }

    function onStreamReady() {
        deviceConnected = true;
        hasStream = true;
        bufferConsumeIdx = 0;
        updateConnUi();
        renderChannelCards();
    }

    function onStreamLost() {
        deviceConnected = false;
        hasStream = false;
        updateConnUi();
    }

    function handleStreamData(message) {
        hasStream = true;
        ingestFromMessage(message);
        // 与 buffer 双路径时对齐消费指针，减少重复
        const gdm = window.globalDeviceManager;
        if (gdm && Array.isArray(gdm.dataDisplayBuffer)) {
            bufferConsumeIdx = gdm.dataDisplayBuffer.length;
        }
    }

    function onGlobalDeviceEvent(event, data) {
        if (event === 'data') handleStreamData(data);
        else if (event === 'connected' || event === 'wsConnected') {
            onStreamReady();
            if (event === 'wsConnected' && !hasStream) void pullDataFromHttpFallback();
        } else if (event === 'disconnected' || event === 'statusChange') {
            const gdm = window.globalDeviceManager;
            if (gdm && !gdm.isConnected) onStreamLost();
            else if (event === 'statusChange' && data && data.connected) onStreamReady();
        }
    }

    function attachDeviceListener() {
        if (listenerAttached) return;
        const gdm = window.globalDeviceManager;
        if (!gdm) return;
        gdm.addEventListener(onGlobalDeviceEvent);
        listenerAttached = true;
    }

    async function syncDeviceFromBackend() {
        const gdm = window.globalDeviceManager;
        try {
            const resp = await fetch(`${getApiBase()}/status`);
            const json = await resp.json();
            if (json.success && json.status && json.status.connected) {
                deviceConnected = true;
                if (gdm) {
                    gdm.isConnected = true;
                    gdm.deviceInfo = json.status.device_info;
                    gdm.saveState();
                    gdm.loadChannelConfig();
                }
                if (gdm && (!gdm.ws || gdm.ws.readyState !== WebSocket.OPEN)) {
                    gdm.connectWebSocket(true);
                }
                return true;
            }
            deviceConnected = false;
        } catch (_e) {
            deviceConnected = false;
        }
        return deviceConnected;
    }

    async function pullDataFromHttpFallback() {
        if (httpPullInFlight || hasStream) return;
        const now = Date.now();
        if (now - lastHttpPullMs < 350) return;
        if (!isDeviceLive()) return;
        httpPullInFlight = true;
        lastHttpPullMs = now;
        try {
            const resp = await fetch(`${getApiBase()}/data?duration=0.12&for_display=true`);
            const json = await resp.json().catch(() => null);
            if (resp.ok && json && json.success && Array.isArray(json.data)) {
                ingestFromMessage({
                    data: json.data,
                    data_display: json.data,
                    sampling_rate: json.sampling_rate
                });
            }
        } catch (_e) {
            /* ignore */
        } finally {
            httpPullInFlight = false;
        }
    }

    function collectParams() {
        return { source: 'eog-test', ...readCfg() };
    }

    function applyParamsToDom(p) {
        if (!p || typeof p !== 'object') return;
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (el && v != null) el.value = v;
        };
        set('cfg-mode', p.mode);
        set('cfg-polarity', p.edgePolarity);
        set('cfg-baseline-tau', p.baselineTauSec);
        set('cfg-refractory', p.refractoryMs);
        set('cfg-pulse-onset', p.pulseOnsetUv);
        set('cfg-pulse-recover', p.pulseRecoverRatio);
        set('cfg-pulse-max', p.pulseMaxMs);
        set('cfg-pulse-min', p.pulseMinMs);
        set('cfg-edge-jump', p.edgeJumpUv);
        set('cfg-edge-window', p.edgeWindowMs);
        applyModeUi();
    }

    function saveLocal() {
        const p = collectParams();
        localStorage.setItem(LOCAL_KEY, JSON.stringify(p));
        const hint = document.getElementById('exp-sync-hint');
        if (hint) hint.textContent = '已保存到本机 localStorage';
        alert('眼电测试参数已保存到本机');
    }

    function loadLocal() {
        try {
            const raw = localStorage.getItem(LOCAL_KEY);
            if (!raw) return;
            applyParamsToDom(JSON.parse(raw));
        } catch (_e) {
            /* ignore */
        }
    }

    function listProjects() {
        try {
            const raw = localStorage.getItem('ssvep_projects');
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_e) {
            return [];
        }
    }

    function fillProjectSelect() {
        const sel = document.getElementById('exp-sync-project');
        if (!sel) return;
        const projects = listProjects();
        let curId = '';
        try {
            const cur = JSON.parse(localStorage.getItem('ssvep_project') || 'null');
            curId = cur && cur.id ? cur.id : '';
        } catch (_e) {
            /* ignore */
        }
        sel.innerHTML =
            '<option value="">（选择项目）</option>' +
            projects
                .map(
                    (p) =>
                        `<option value="${p.id}" ${p.id === curId ? 'selected' : ''}>${p.name || p.id}</option>`
                )
                .join('');
        if (curId) {
            const cur = projects.find((p) => p.id === curId);
            if (cur && cur.settings && cur.settings.experimentEog) {
                applyParamsToDom(cur.settings.experimentEog);
                const hint = document.getElementById('exp-sync-hint');
                if (hint) hint.textContent = `已从当前项目「${cur.name || cur.id}」加载眼电参数`;
            }
        }
    }

    function syncToProject() {
        const sel = document.getElementById('exp-sync-project');
        const id = sel && sel.value;
        if (!id) {
            alert('请先选择目标项目');
            return;
        }
        const projects = listProjects();
        const idx = projects.findIndex((p) => p.id === id);
        if (idx < 0) {
            alert('项目不存在');
            return;
        }
        const params = collectParams();
        const project = projects[idx];
        if (!project.settings || typeof project.settings !== 'object') project.settings = {};
        project.settings.experimentEog = params;

        // 回填多模态眼电块的 edge 参数（刺激运行沿用 multimodal-detector）
        const patchBlock = (b) => {
            if (!b || typeof b !== 'object') return;
            const meta =
                window.SSVEP_MULTIMODAL_BY_ID && window.SSVEP_MULTIMODAL_BY_ID[b.channel]
                    ? window.SSVEP_MULTIMODAL_BY_ID[b.channel]
                    : null;
            if (!meta || meta.role !== 'eog') return;
            b.triggerType = 'edge';
            b.eogDetectMode = params.mode;
            b.edgeJumpUv = params.mode === 'pulse' ? params.pulseOnsetUv : params.edgeJumpUv;
            b.edgeWindowMs = params.edgeWindowMs;
            b.edgePolarity = params.edgePolarity;
            b.pulseOnsetUv = params.pulseOnsetUv;
            b.pulseRecoverRatio = params.pulseRecoverRatio;
            b.pulseMaxMs = params.pulseMaxMs;
            b.pulseMinMs = params.pulseMinMs;
            b.baselineTauSec = params.baselineTauSec;
            b.refractoryMs = params.refractoryMs;
        };
        if (Array.isArray(project.blocks)) project.blocks.forEach(patchBlock);
        if (Array.isArray(project.stimuli)) {
            project.stimuli.forEach((s) => {
                if (s && Array.isArray(s.blocks)) s.blocks.forEach(patchBlock);
            });
        }

        projects[idx] = project;
        localStorage.setItem('ssvep_projects', JSON.stringify(projects));
        try {
            const cur = JSON.parse(localStorage.getItem('ssvep_project') || 'null');
            if (cur && cur.id === id) {
                localStorage.setItem('ssvep_project', JSON.stringify(project));
            }
        } catch (_e) {
            /* ignore */
        }
        localStorage.setItem(LOCAL_KEY, JSON.stringify(params));
        const hint = document.getElementById('exp-sync-hint');
        if (hint) hint.textContent = `已写入「${project.name || project.id}」settings.experimentEog`;
        alert(`已将眼电测试参数写入「${project.name || project.id}」。\n\n多模态眼电块的突变阈值已同步为可运行参数。`);
    }

    function bindUi() {
        document.getElementById('cfg-mode')?.addEventListener('change', () => {
            applyModeUi();
            resetAll();
        });
        [
            'cfg-polarity',
            'cfg-baseline-tau',
            'cfg-refractory',
            'cfg-pulse-onset',
            'cfg-pulse-recover',
            'cfg-pulse-max',
            'cfg-pulse-min',
            'cfg-edge-jump',
            'cfg-edge-window'
        ].forEach((id) => {
            document.getElementById(id)?.addEventListener('change', () => {
                const cfg = readCfg();
                Object.keys(channelStates).forEach((ch) => {
                    const mod = EOG();
                    if (mod) mod.syncParams(channelStates[ch], cfg);
                });
            });
        });
        document.getElementById('btn-reset')?.addEventListener('click', resetAll);
        document.getElementById('btn-save-local')?.addEventListener('click', saveLocal);
        document.getElementById('btn-sync-project')?.addEventListener('click', syncToProject);
        window.addEventListener('resize', () => {
            resizeAllWaves();
        });
    }

    async function init() {
        applyModeUi();
        loadLocal();
        fillProjectSelect();
        bindUi();
        attachDeviceListener();
        await syncDeviceFromBackend();
        const gdm = window.globalDeviceManager;
        if (gdm) {
            gdm.loadChannelConfig();
            if (gdm.isConnected) {
                deviceConnected = true;
                gdm.connectWebSocket(true);
            }
        }
        resetAll();
        ensureWavePanels();
        updateConnUi();
        rafId = requestAnimationFrame(tick);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
