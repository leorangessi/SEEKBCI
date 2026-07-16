/*!
 * IMU 测试页：控制设备 BMI270 ↔ 被控设备光标 / 三维地球
 */
(function () {
    const { ImuClient, PROTOCOL } = window.SSVEP_IMU_BLE;
    const { ImuCursorMapper } = window.SSVEP_IMU_MAPPER;

    const el = {
        mode2d: document.getElementById('mode-2d'),
        mode3d: document.getElementById('mode-3d'),
        panel2d: document.getElementById('panel-2d'),
        panel3d: document.getElementById('panel-3d'),
        connStatus: document.getElementById('conn-status'),
        connDetail: document.getElementById('conn-detail'),
        btnConnect: document.getElementById('btn-connect'),
        btnConnectWeb: document.getElementById('btn-connect-web'),
        btnDisconnect: document.getElementById('btn-disconnect'),
        btnCalibrate: document.getElementById('btn-calibrate'),
        sensitivity: document.getElementById('cfg-sensitivity'),
        invertX: document.getElementById('cfg-invert-x'),
        invertY: document.getElementById('cfg-invert-y'),
        systemMouse: document.getElementById('cfg-system-mouse'),
        payload: document.getElementById('payload-raw'),
        stats: document.getElementById('stats-text'),
        cursorCanvas: document.getElementById('cursor-canvas'),
        earthCanvas: document.getElementById('earth-canvas')
    };

    const client = new ImuClient();
    const mapper = new ImuCursorMapper();
    const earthRenderer =
        window.SSVEP_IMU_EARTH && window.SSVEP_IMU_EARTH.ImuEarthRenderer
            ? new window.SSVEP_IMU_EARTH.ImuEarthRenderer()
            : null;
    let viewMode = '3d';
    let cursorPos = { x: 0.5, y: 0.5 };
    let earthYaw = 0.35;
    let earthPitch = 0.18;
    let hzCounter = 0;
    let hzShown = 0;
    let hzWindowStart = performance.now();
    let mouseMoveQueue = { x: 0, y: 0 };
    let mouseFlushTimer = null;
    let lastPayload = '';

    function apiOrigin() {
        if (typeof window.ssvepResolveApiOrigin === 'function') {
            return window.ssvepResolveApiOrigin();
        }
        return window.SSVEP_API_ORIGIN || 'http://127.0.0.1:8765';
    }

    function setStatus(ok, wait, text, detail) {
        el.connStatus.className = 'status-pill ' + (ok ? 'status-ok' : wait ? 'status-wait' : 'status-bad');
        el.connStatus.textContent = text;
        el.connDetail.textContent = detail || '';
    }

    function applyMapperCfg() {
        mapper.setSensitivity(Number(el.sensitivity.value) || 42);
        mapper.cfg.invertX = !!el.invertX.checked;
        mapper.cfg.invertY = !!el.invertY.checked;
    }

    function setViewMode(mode) {
        viewMode = mode;
        el.mode2d.classList.toggle('active', mode === '2d');
        el.mode3d.classList.toggle('active', mode === '3d');
        el.panel2d.hidden = mode !== '2d';
        el.panel3d.hidden = mode !== '3d';
        resizeCanvases();
    }

    function resizeCanvases() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        [el.cursorCanvas, el.earthCanvas].forEach((canvas) => {
            if (!canvas || canvas.hidden) return;
            const parent = canvas.parentElement;
            const w = Math.max(320, parent.clientWidth - 24);
            const h = Math.max(320, parent.clientHeight - 24);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        });
    }

    function queueSystemMouse(dx, dy) {
        if (!el.systemMouse.checked || (!dx && !dy)) return;
        mouseMoveQueue.x += dx;
        mouseMoveQueue.y += dy;
        if (mouseFlushTimer) return;
        mouseFlushTimer = setTimeout(flushSystemMouse, 16);
    }

    async function flushSystemMouse() {
        mouseFlushTimer = null;
        const dx = Math.trunc(mouseMoveQueue.x);
        const dy = Math.trunc(mouseMoveQueue.y);
        mouseMoveQueue.x -= dx;
        mouseMoveQueue.y -= dy;
        if (!dx && !dy) return;
        try {
            await fetch(`${apiOrigin()}/api/system/mouse/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dx, dy })
            });
        } catch (_) {
            /* ignore network blips during continuous streaming */
        }
    }

    client.onStatus = (status, detail) => {
        const via = client.transport === 'backend' ? '后端 Bleak' : 'Web Bluetooth';
        if (status === 'connected') setStatus(true, false, `已连接 · ${via}`, detail);
        else if (status === 'scanning' || status === 'requesting' || status === 'connecting') {
            setStatus(false, true, '连接中…', detail);
        } else {
            setStatus(false, false, '未连接', detail || '请上电 ESP32_BMI270_MOUSE 后点「连接 IMU」');
        }
    };

    client.onError = (decoded) => {
        el.payload.textContent = decoded.raw || 'ERR';
        setStatus(false, true, '设备报错', decoded.code || decoded.raw);
    };

    client.onSample = (sample) => {
        lastPayload = sample.raw;
        hzCounter += 1;
        const result = mapper.onSample(sample);
        if (!result.ready) return;
        if (result.moveX || result.moveY) {
            cursorPos.x = Math.max(0.02, Math.min(0.98, cursorPos.x + result.moveX / 900));
            cursorPos.y = Math.max(0.02, Math.min(0.98, cursorPos.y + result.moveY / 900));
            queueSystemMouse(result.moveX, result.moveY);
        }
        const snap = mapper.snapshot();
        earthYaw += snap.rateX * 0.055;
        earthPitch = Math.max(-1.15, Math.min(1.15, earthPitch - snap.rateY * 0.045));
    };

    async function doConnect(mode) {
        el.btnConnect.disabled = true;
        if (el.btnConnectWeb) el.btnConnectWeb.disabled = true;
        try {
            applyMapperCfg();
            await client.connect(mode);
            mapper.startCalibration();
        } catch (err) {
            setStatus(false, false, '连接失败', err.message || String(err));
        } finally {
            el.btnConnect.disabled = false;
            if (el.btnConnectWeb) el.btnConnectWeb.disabled = false;
        }
    }

    el.btnConnect.addEventListener('click', () => doConnect('backend'));
    if (el.btnConnectWeb) {
        el.btnConnectWeb.addEventListener('click', () => doConnect('web'));
    }
    el.btnDisconnect.addEventListener('click', () => client.disconnect());
    el.btnCalibrate.addEventListener('click', () => {
        applyMapperCfg();
        mapper.startCalibration();
        cursorPos = { x: 0.5, y: 0.5 };
    });
    el.sensitivity.addEventListener('change', applyMapperCfg);
    el.invertX.addEventListener('change', applyMapperCfg);
    el.invertY.addEventListener('change', applyMapperCfg);
    el.mode2d.addEventListener('click', () => setViewMode('2d'));
    el.mode3d.addEventListener('click', () => setViewMode('3d'));

    function drawCursor(ctx, w, h) {
        ctx.clearRect(0, 0, w, h);
        const g = ctx.createRadialGradient(w * 0.5, h * 0.35, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
        g.addColorStop(0, '#122038');
        g.addColorStop(1, '#07080e');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(80,160,220,0.18)';
        ctx.lineWidth = 1;
        const step = 40;
        for (let x = 0; x < w; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let y = 0; y < h; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        const cx = cursorPos.x * w;
        const cy = cursorPos.y * h;
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 220, 255, 0.12)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#00e5ff';
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy);
        ctx.lineTo(cx + 16, cy);
        ctx.moveTo(cx, cy - 16);
        ctx.lineTo(cx, cy + 16);
        ctx.stroke();

        ctx.fillStyle = '#8ab0c8';
        ctx.font = '12px Consolas, monospace';
        ctx.fillText(`cursor ${(cursorPos.x * 100).toFixed(0)}%, ${(cursorPos.y * 100).toFixed(0)}%`, 14, 22);
    }

    function updateHud() {
        const now = performance.now();
        if (now - hzWindowStart >= 1000) {
            hzShown = hzCounter;
            hzCounter = 0;
            hzWindowStart = now;
        }
        const snap = mapper.snapshot();
        el.payload.textContent = lastPayload || client.lastError || '—';
        const cal = snap.isCalibrating
            ? `校准中… 剩余 ${snap.calibrationLeft}`
            : snap.hasStarted
                ? (snap.isStationary ? '静止 · 零偏自适应' : '跟踪中')
                : '未校准';
        el.stats.textContent =
            `协议 ${PROTOCOL.id} · ${hzShown} Hz · 样本 ${snap.sampleCount} · ` +
            `位移 ${snap.lastMove[0]},${snap.lastMove[1]} · ${cal}\n` +
            `gyro ${snap.gyro.map((v) => v.toFixed(3)).join(', ')} · ` +
            `rate ${snap.rateX.toFixed(3)}, ${snap.rateY.toFixed(3)}`;
    }

    function frame() {
        const c2 = el.cursorCanvas;
        const c3 = el.earthCanvas;
        if (viewMode === '2d' && c2) {
            drawCursor(c2.getContext('2d'), c2.clientWidth, c2.clientHeight);
        } else if (c3 && earthRenderer) {
            earthRenderer.draw(c3.getContext('2d'), c3.clientWidth, c3.clientHeight, earthYaw, earthPitch);
        }
        // 未连接时也让地球缓慢自转，方便预览质感
        if (client.status !== 'connected') {
            earthYaw += 0.0022;
        }
        updateHud();
        requestAnimationFrame(frame);
    }

    setStatus(false, false, '未连接', `目标 ${PROTOCOL.deviceName} · 推荐「连接 IMU」(后端 Bleak)`);

    applyMapperCfg();
    setViewMode('3d');
    window.addEventListener('resize', resizeCanvases);
    resizeCanvases();
    requestAnimationFrame(frame);
})();
