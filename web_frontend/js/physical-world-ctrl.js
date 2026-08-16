/**
 * physical-world-ctrl.js
 * SEEKBCI 控制板前端 — 规则画布 + 拖拽 + 多连接
 */
(function () {
'use strict';

function getApiOrigin() {
    return (typeof window.ssvepResolveApiOrigin === 'function'
        ? window.ssvepResolveApiOrigin() : 'http://127.0.0.1:28765');
}
function getApiBase() {
    return getApiOrigin().replace(/\/$/, '') + '/api/ctrl';
}

const ACTION_NAMES = { 1: 'GPIO开关', 2: 'GPIO翻转', 3: 'DAC', 4: 'PWM', 5: 'PWM定时', 6: '舵机' };
const TRIGGER_NAMES = { 1: '边沿', 2: '阈值', 3: '线性映射' };

let devices = [];
let connectedAddrs = new Set();
let liveConnAddrs = new Set();
let selectedAddr = null;
let scanning = false;
let scanLoop = null;
let scanAbort = null;
let connecting = false;
let configDirty = false;

let deviceConfigs = {};
let canvasNodes = [];
let logicNodes = [];
let canvasConnections = [];
let ruleSets = {};
let activeRuleSet = 'default';
let draggingPin = null;
let tempLine = null;

const STORAGE_KEY = 'seekbci_ctrl_remembered';
const CONFIG_KEY = 'seekbci_ctrl_configs';
const RULES_KEY = 'seekbci_ctrl_rules';

const $ = id => document.getElementById(id);
const statusBar = $('status-bar');
function log(msg) { statusBar.textContent = msg; }

function pwPrompt(title, defaultVal) {
    return new Promise(resolve => {
        let overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center';
        overlay.innerHTML = '<div style="background:#1E1E1E;border:1px solid #444;border-radius:12px;padding:24px;min-width:320px;max-width:90vw">'
            + '<div style="color:#00D9FF;font-size:14px;margin-bottom:12px">' + title + '</div>'
            + '<input id="pw-prompt-input" type="text" value="' + (defaultVal || '') + '" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid #555;background:#2A2A2A;color:#fff;font-size:13px;outline:none" />'
            + '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">'
            + '<button id="pw-prompt-cancel" class="btn btn-secondary btn-sm">取消</button>'
            + '<button id="pw-prompt-ok" class="btn btn-primary btn-sm">确定</button>'
            + '</div></div>';
        document.body.appendChild(overlay);
        const input = document.getElementById('pw-prompt-input');
        input.focus();
        input.select();
        function close(val) { document.body.removeChild(overlay); resolve(val); }
        document.getElementById('pw-prompt-cancel').onclick = () => close(null);
        document.getElementById('pw-prompt-ok').onclick = () => close(input.value);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') close(input.value); if (e.key === 'Escape') close(null); });
        overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    });
}



async function api(path, opts = {}) {
    const res = await fetch(getApiBase() + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        signal: opts.signal || undefined
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

// ==========================================================
// Storage helpers
// ==========================================================

function freshConfig() { return { role: 'output', dins: [], adcs: [], douts: [], pwms: [], dacs: [], servos: [], alias: '' }; }
function getDeviceConfig(addr) { if (!deviceConfigs[addr]) deviceConfigs[addr] = freshConfig(); return deviceConfigs[addr]; }
function getDisplayName(d) { const c = deviceConfigs[d.address]; return (c && c.alias) ? c.alias : (d.name || d.address); }

function saveRemembered() {
    const arr = [];
    for (const addr of connectedAddrs) {
        const d = devices.find(x => x.address === addr);
        const cfg = deviceConfigs[addr];
        arr.push({ address: addr, name: d ? d.name : addr, alias: cfg ? cfg.alias : '' });
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch (_) {}
}
function loadRemembered() {
    try {
        const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        for (const item of arr) {
            connectedAddrs.add(item.address);
            if (!devices.find(d => d.address === item.address))
                devices.push({ address: item.address, name: item.name || item.address, _lastSeen: 0, type: 'ctrl' });
            if (item.alias) getDeviceConfig(item.address).alias = item.alias;
        }
    } catch (_) {}
}
function saveConfigs() { try { localStorage.setItem(CONFIG_KEY, JSON.stringify(deviceConfigs)); } catch (_) {} }
function loadConfigs() { try { deviceConfigs = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch (_) {} }
function saveRules() {
    ruleSets[activeRuleSet] = { nodes: canvasNodes, logicNodes, connections: canvasConnections };
    try { localStorage.setItem(RULES_KEY, JSON.stringify(ruleSets)); } catch (_) {}
}
function loadRules() {
    try { ruleSets = JSON.parse(localStorage.getItem(RULES_KEY) || '{}'); } catch (_) {}
    if (!ruleSets.default) ruleSets.default = { nodes: [], logicNodes: [], connections: [] };
    const set = ruleSets[activeRuleSet] || ruleSets.default;
    canvasNodes = set.nodes || [];
    logicNodes = set.logicNodes || [];
    canvasConnections = set.connections || [];
}

// ==========================================================
// Scan
// ==========================================================

function startScan() {
    if (scanning) return;
    scanning = true;
    $('btn-scan').textContent = '停止扫描';
    $('btn-scan').classList.add('btn-danger');
    $('btn-scan').classList.remove('btn-primary');
    showRadar();
    doScanCycle();
}

function stopScan() {
    scanning = false;
    if (scanAbort) { scanAbort.abort(); scanAbort = null; }
    if (scanLoop) { clearTimeout(scanLoop); scanLoop = null; }
    $('btn-scan').textContent = '扫描控制板';
    $('btn-scan').classList.remove('btn-danger');
    $('btn-scan').classList.add('btn-primary');
    hideRadar();
}

async function doScanCycle() {
    if (!scanning) return;
    scanAbort = new AbortController();
    try {
        const r = await api('/scan?timeout=4', { signal: scanAbort.signal });
        const found = r.devices || [];
        found.forEach(f => { f.type = 'ctrl'; });
        mergeDevices(found);
        renderDeviceList();
        await autoReconnectCheck(found);
        renderDeviceList();
        updateCanvasNodeStates();
        log('扫描中... 发现 ' + devices.length + ' 个设备，已连接 ' + liveConnAddrs.size);
    } catch (e) {
        if (e.name !== 'AbortError') log('扫描异常: ' + e.message);
    }
    if (scanning) scanLoop = setTimeout(doScanCycle, 1000);
}

function mergeDevices(found) {
    const now = Date.now();
    for (const d of devices) {
        const f = found.find(x => x.address === d.address);
        if (f) { d.rssi = f.rssi; d.name = f.name || d.name; d.mfg_info = f.mfg_info || d.mfg_info; d._lastSeen = now; }
    }
    for (const f of found) {
        if (!devices.find(d => d.address === f.address)) { f._lastSeen = now; devices.push(f); }
    }
    devices = devices.filter(d => connectedAddrs.has(d.address) || (now - (d._lastSeen || 0)) < 30000);
}

async function autoReconnectCheck(found) {
    for (const f of found) {
        if (connectedAddrs.has(f.address) && !liveConnAddrs.has(f.address) && !connecting) {
            connecting = true;
            try {
                const r = await api('/connect', { method: 'POST', body: JSON.stringify({ address: f.address, timeout: 8 }) });
                if (r.success || r.connected) {
                    liveConnAddrs.add(f.address);
                    log('自动重连: ' + getDisplayName(f));
                    try { await pushPinConfig(f.address); } catch (_) {}
                }
            } catch (_) {}
            connecting = false;
        }
    }
}

function showRadar() {
    let r = $('scan-radar');
    if (r) { r.style.display = 'flex'; return; }
    r = document.createElement('div');
    r.id = 'scan-radar';
    r.innerHTML = '<div class="radar-circle"></div><div class="radar-sweep"></div><div class="radar-label">扫描中...</div>';
    $('device-list').prepend(r);
}
function hideRadar() { const r = $('scan-radar'); if (r) r.remove(); }

// ==========================================================
// Device list with drag support
// ==========================================================

function renderDeviceList() {
    const list = $('device-list');
    const radarEl = $('scan-radar');
    const radarHtml = radarEl ? radarEl.outerHTML : '';
    if (!devices.length) { list.innerHTML = radarHtml + '<div class="empty-hint">未发现设备</div>'; return; }

    const now = Date.now();
    devices.sort((a, b) => {
        const ac = connectedAddrs.has(a.address) ? 0 : 1;
        const bc = connectedAddrs.has(b.address) ? 0 : 1;
        return ac !== bc ? ac - bc : (b._lastSeen || 0) - (a._lastSeen || 0);
    });

    const cards = devices.map((d, i) => {
        const wantConn = connectedAddrs.has(d.address);
        const isLive = liveConnAddrs.has(d.address);
        const fresh = (now - (d._lastSeen || 0)) < 15000;
        let statusTag;
        if (wantConn && isLive) statusTag = '<span class="tag tag-ok">已连接</span>';
        else if (wantConn && !isLive) statusTag = '<span class="tag tag-off">已连接\u00b7离线</span>';
        else if (fresh) statusTag = '<span class="tag tag-blue">在线</span>';
        else statusTag = '<span class="tag tag-off">离线</span>';
        const cls = ['dev-card'];
        if (wantConn) cls.push('selected');
        if (selectedAddr === d.address) cls.push('active-sel');
        if (!wantConn && !fresh) cls.push('offline');
        const icon = d.type === 'headband' ? '🧠' : '🎛️';
        const draggable = wantConn ? 'draggable="true"' : '';
        return `<div class="${cls.join(' ')}" data-idx="${i}" data-addr="${d.address}" ${draggable}>`
            + `<div class="dev-name">${icon} ${getDisplayName(d)} ${statusTag}</div>`
            + `<div class="dev-meta">${d.address} · RSSI:${d.rssi || '?'}</div>`
            + `<div class="dev-actions">`
            + (wantConn ? `<button class="btn btn-danger btn-sm dev-disconnect" data-addr="${d.address}">断开</button>` : '')
            + (wantConn ? `<button class="btn btn-secondary btn-sm dev-rename" data-addr="${d.address}">重命名</button>` : '')
            + `</div></div>`;
    }).join('');

    list.innerHTML = radarHtml + cards;
    bindDeviceListEvents();
}

function bindDeviceListEvents() {
    const list = $('device-list');
    list.querySelectorAll('.dev-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.dev-disconnect') || e.target.closest('.dev-rename')) return;
            handleDeviceClick(Number(card.dataset.idx));
        });
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', card.dataset.addr);
            e.dataTransfer.effectAllowed = 'copy';
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    list.querySelectorAll('.dev-disconnect').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); disconnectDevice(btn.dataset.addr); });
    });
    list.querySelectorAll('.dev-rename').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); renameDevice(btn.dataset.addr); });
    });
}

// ==========================================================
// Device actions (connect, disconnect, rename, select)
// ==========================================================

function handleDeviceClick(idx) {
    const d = devices[idx];
    if (!d) return;
    if (configDirty && selectedAddr && selectedAddr !== d.address) {
        if (!confirm('当前配置未保存，切换将丢失更改。是否继续？')) return;
        configDirty = false;
    }
    if (connectedAddrs.has(d.address)) {
        selectedAddr = d.address;
        renderDeviceList();
        updatePinout();
        showConfigPanel();
        log('已选中: ' + getDisplayName(d));
        return;
    }
    connectDevice(d);
}

async function pushPinConfig(addr) {
    const cfg = getDeviceConfig(addr);
    if (!cfg) return false;
    const dinPins = Array.from(new Set((cfg.dins || []).map(Number).filter(Number.isFinite)));
    const adcPins = Array.from(new Set((cfg.adcs || []).map(Number).filter(Number.isFinite)));
    await api('/config/pins', {
        method: 'POST',
        body: JSON.stringify({ address: addr, din_pins: dinPins, adc_pins: adcPins })
    });
    return dinPins.length > 0 || adcPins.length > 0;
}
async function connectDevice(d) {
    connecting = true;
    log('正在连接 ' + getDisplayName(d) + '...');
    try {
        const r = await api('/connect', { method: 'POST', body: JSON.stringify({ address: d.address, timeout: 10 }) });
        if (r.success || r.connected) {
            connectedAddrs.add(d.address);
            liveConnAddrs.add(d.address);
            selectedAddr = d.address;
            d._lastSeen = Date.now();
            saveRemembered();
            renderDeviceList();
            updatePinout();
            showConfigPanel();
            try {
                if (await pushPinConfig(d.address)) {
                    log('已连接并下发引脚配置: ' + getDisplayName(d));
                } else {
                    log('已连接: ' + getDisplayName(d) + ' (共 ' + connectedAddrs.size + ' 台)');
                }
            } catch (e) {
                log('已连接，引脚配置下发失败: ' + e.message);
            }
        } else { log('连接失败'); }
    } catch (e) { log('连接失败: ' + e.message); }
    connecting = false;
}

async function disconnectDevice(addr) {
    try {
        await api('/disconnect', { method: 'POST', body: JSON.stringify({ address: addr }) });
        connectedAddrs.delete(addr);
        liveConnAddrs.delete(addr);
        saveRemembered();
        if (selectedAddr === addr) { selectedAddr = null; updatePinout(); }
        updateCanvasNodeStates();
        log('已断开: ' + addr);
        renderDeviceList();
    } catch (e) { log('断开失败: ' + e.message); }
}

async function renameDevice(addr) {
    const cfg = getDeviceConfig(addr);
    const d = devices.find(x => x.address === addr);
    const current = cfg.alias || (d ? d.name : addr);
    const newName = await pwPrompt('设备别名（留空恢复原名）:', current);
    if (newName === null) return;
    cfg.alias = newName.trim();
    saveConfigs();
    saveRemembered();
    renderDeviceList();
    updateCanvasNodeStates();
}

// ==========================================================
// Pinout display
// ==========================================================

function updatePinout() {
    const container = $('pinout-container');
    if (!selectedAddr) {
        container.innerHTML = '<div class="empty-hint">选中设备后显示引脚图</div>';
        return;
    }
    const d = devices.find(x => x.address === selectedAddr);
    if (!d || d.type === 'headband') {
        container.innerHTML = '<div style="text-align:center;color:#888;font-size:13px">🧠 头环设备<br><br>信号输出: EOG / EMG / Focus</div>';
        return;
    }
    const cfg = getDeviceConfig(selectedAddr);
    const highlighted = [...(cfg.dins || []), ...(cfg.adcs || []), ...(cfg.douts || []), ...(cfg.pwms || []), ...(cfg.dacs || []), ...(cfg.servos || [])].map(String);
    const roleColors = {};
    (cfg.dins || []).concat(cfg.adcs || []).forEach(p => { roleColors[String(p)] = '#FF9800'; });
    (cfg.douts || []).concat(cfg.pwms || []).concat(cfg.dacs || []).concat(cfg.servos || []).forEach(p => { roleColors[String(p)] = '#4CAF50'; });
    container.innerHTML = window.ESP32Pinout ? window.ESP32Pinout.render(highlighted, { roleColors }) : '<div class="empty-hint">引脚图组件未加载</div>';
    renderPinoutValues();
}

function getPinMeta(key) {
    const raw = pinValues[key];
    if (raw && typeof raw === 'object' && 'value' in raw) return raw;
    if (raw === undefined) return null;
    return { value: raw, sigType: 1 };
}

function setPinMeta(addr, pin, sigType, value) {
    pinValues[addr + ':' + pin] = { value, sigType: Number(sigType) };
}

function formatPinValue(valOrMeta, digitalOverride) {
    let val, sigType;
    if (valOrMeta && typeof valOrMeta === 'object' && 'value' in valOrMeta) {
        val = valOrMeta.value;
        sigType = valOrMeta.sigType;
    } else {
        val = valOrMeta;
        sigType = digitalOverride ? 1 : 2;
    }
    const isDigital = digitalOverride != null ? digitalOverride : (sigType === 1 || sigType === 0x21);
    if (val === undefined) return { display: '--', color: '#888' };
    if (isDigital) {
        const enabled = val === 'ON' || val === 1 || val === '1' || Number(val) > 0;
        return { display: enabled ? 'ON' : 'OFF', color: enabled ? '#4CAF50' : '#f44336' };
    }
    return { display: String(Math.round(Number(val))), color: '#00D9FF' };
}

function renderPinoutValues() {
    const container = $('pinout-container');
    if (!container || !selectedAddr) return;
    const cfg = getDeviceConfig(selectedAddr);
    if (!cfg) return;

    const dinPins = cfg.dins || [];
    const adcPins = cfg.adcs || [];
    const outputPins = [
        ...(cfg.douts || []).map(pin => ({ pin, label: 'GPIO' + pin, digital: true })),
        ...(cfg.pwms || []).map(pin => ({ pin, label: 'PWM' + pin })),
        ...(cfg.dacs || []).map(pin => ({ pin, label: 'DAC' + pin })),
        ...(cfg.servos || []).map(pin => ({ pin, label: '舵机' + pin }))
    ];
    if (!dinPins.length && !adcPins.length && !outputPins.length) return;

    container.querySelectorAll('.pin-label-val').forEach(el => {
        const pin = el.dataset.pin;
        const key = selectedAddr + ':' + pin;
        const meta = getPinMeta(key);
        const isAdc = (cfg.adcs || []).includes(Number(pin));
        const isDin = (cfg.dins || []).includes(Number(pin));
        const formatted = formatPinValue(meta, isDin && !isAdc ? true : (isAdc ? false : null));
        el.textContent = formatted.display;
        el.setAttribute('fill', formatted.color);
    });

    container.querySelectorAll('.pw-live-values').forEach(el => el.remove());

    let valHtml = '<div class="pw-live-values" style="margin-top:8px;font-size:11px;color:#ccc;border-top:1px solid #333;padding-top:8px">';
    valHtml += '<div style="color:#00D9FF;font-size:10px;margin-bottom:4px">实时值</div>';
    for (const pin of dinPins) {
        const formatted = formatPinValue(getPinMeta(selectedAddr + ':' + pin), true);
        valHtml += '<div style="display:flex;justify-content:space-between;padding:2px 4px"><span style="color:#FF9800">GPIO' + pin + ' DIN</span><span style="font-weight:bold;color:' + formatted.color + '">' + formatted.display + '</span></div>';
    }
    for (const pin of adcPins) {
        const formatted = formatPinValue(getPinMeta(selectedAddr + ':' + pin), false);
        valHtml += '<div style="display:flex;justify-content:space-between;padding:2px 4px"><span style="color:#FF9800">GPIO' + pin + ' ADC</span><span style="font-weight:bold;color:' + formatted.color + '">' + formatted.display + '</span></div>';
    }
    for (const output of outputPins) {
        const formatted = formatPinValue(getPinMeta(selectedAddr + ':' + output.pin), output.digital);
        valHtml += '<div style="display:flex;justify-content:space-between;padding:2px 4px"><span style="color:#81C784">' + output.label + '</span><span style="font-weight:bold;color:' + formatted.color + '">' + formatted.display + '</span></div>';
    }
    valHtml += '</div>';
    container.insertAdjacentHTML('beforeend', valHtml);
}

$('btn-scan')?.addEventListener('click', () => { scanning ? stopScan() : startScan(); });

// ==========================================================
// Device Config Panel
// ==========================================================

const DIN_PINS = [4, 5, 13, 14, 16, 17, 27];
const ADC_PINS = [32, 33, 34, 35, 36, 39];
const DOUT_PINS = [2, 4, 5, 13, 14, 16, 17, 27];
const PWM_PINS = [4, 5, 13, 14, 16, 17, 18, 19];
const DAC_PINS = [25, 26];
const SERVO_PINS = [4, 5, 13, 14, 16, 17, 18, 19];

function showConfigPanel() {
    if (!selectedAddr || !connectedAddrs.has(selectedAddr)) {
        $('config-empty').style.display = '';
        $('config-body').style.display = 'none';
        $('config-device-name').textContent = '';
        return;
    }
    const d = devices.find(x => x.address === selectedAddr);
    $('config-device-name').textContent = '\u2014 ' + getDisplayName(d || { address: selectedAddr });
    $('config-empty').style.display = 'none';
    $('config-body').style.display = 'block';
    loadConfigUI();
}

function loadConfigUI() {
    const cfg = getDeviceConfig(selectedAddr);
    $('cfg-role').value = cfg.role || 'output';
    configDirty = false;
    onRoleChange();
}

$('cfg-role')?.addEventListener('change', () => { configDirty = true; onRoleChange(); });

function onRoleChange() {
    const cfg = getDeviceConfig(selectedAddr);
    if (!cfg) return;
    cfg.role = $('cfg-role').value;
    $('cfg-input').style.display = cfg.role === 'input' ? 'block' : 'none';
    $('cfg-output').style.display = cfg.role === 'output' ? 'block' : 'none';
    if (cfg.role === 'input') {
        renderPinGrid('pins-din', DIN_PINS, cfg.dins, 'sel-in');
        renderPinGrid('pins-adc', ADC_PINS, cfg.adcs, 'sel-in');
    } else {
        renderPinGrid('pins-dout', DOUT_PINS, cfg.douts, 'sel-out');
        renderPinGrid('pins-pwm', PWM_PINS, cfg.pwms, 'sel-out');
        renderPinGrid('pins-dac', DAC_PINS, cfg.dacs, 'sel-out');
        renderPinGrid('pins-servo', SERVO_PINS, cfg.servos, 'sel-out');
    }
}

function renderPinGrid(containerId, pins, selected, cls) {
    const el = $(containerId);
    el.innerHTML = pins.map(p => '<span class="pin-chip ' + (selected.includes(p) ? cls : '') + '" data-pin="' + p + '">GPIO' + p + '</span>').join('');
    el.querySelectorAll('.pin-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const pin = Number(chip.dataset.pin);
            const idx = selected.indexOf(pin);
            if (idx >= 0) selected.splice(idx, 1); else selected.push(pin);
            chip.classList.toggle(cls);
            configDirty = true;
        });
    });
}

$('btn-save-config')?.addEventListener('click', async () => {
    configDirty = false;
    saveConfigs();
    updatePinout();
    renderCanvas();
    if (selectedAddr && connectedAddrs.has(selectedAddr)) {
        try {
            await pushPinConfig(selectedAddr);
            log('配置已保存并下发到设备');
        } catch (e) {
            log('配置已保存，下发失败: ' + e.message);
        }
    } else {
        log('配置已保存');
    }
});

// ==========================================================
// Rule Canvas: drag-drop, node rendering, connections
// ==========================================================

const canvas = $('rule-canvas');
const canvasSvg = $('canvas-svg');

canvas?.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; canvas?.classList.add('drag-over'); });
canvas?.addEventListener('dragleave', () => canvas?.classList.remove('drag-over'));
canvas?.addEventListener('drop', (e) => {
    e.preventDefault();
    canvas?.classList.remove('drag-over');
    const addr = e.dataTransfer.getData('text/plain');
    if (!addr) return;
    if (canvasNodes.find(n => n.address === addr)) { log('设备已在画布中'); return; }
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(10, Math.min(e.clientX - rect.left - 90, rect.width - 200));
    const y = Math.max(10, Math.min(e.clientY - rect.top - 30, rect.height - 100));
    const d = devices.find(dd => dd.address === addr);
    canvasNodes.push({ address: addr, x, y, type: d ? d.type : 'ctrl' });
    $('canvas-hint').style.display = 'none';
    saveRules();
    renderCanvas();
});

function getNodePins(node) {
    const addr = node.address;
    const d = devices.find(dd => dd.address === addr);
    const cfg = getDeviceConfig(addr);
    const pins = [];
    if (node.type === 'headband' || (d && d.type === 'headband')) {
        pins.push({ id: addr + ':eog', label: 'EOG', dir: 'input', flow: 'source', kind: 'signal' });
        pins.push({ id: addr + ':emg', label: 'EMG', dir: 'input', flow: 'source', kind: 'signal' });
        pins.push({ id: addr + ':focus', label: 'Focus', dir: 'input', flow: 'source', kind: 'signal' });
    } else {
        (cfg.dins || []).forEach(p => pins.push({ id: addr + ':din' + p, label: 'GPIO' + p + ' IN', dir: 'input', flow: 'source', kind: 'gpio' }));
        (cfg.adcs || []).forEach(p => pins.push({ id: addr + ':adc' + p, label: 'GPIO' + p + ' ADC', dir: 'input', flow: 'source', kind: 'adc' }));
        (cfg.douts || []).forEach(p => pins.push({ id: addr + ':dout' + p, label: 'GPIO' + p + ' OUT', dir: 'output', flow: 'sink', kind: 'gpio' }));
        (cfg.pwms || []).forEach(p => pins.push({ id: addr + ':pwm' + p, label: 'GPIO' + p + ' PWM', dir: 'output', flow: 'sink', kind: 'pwm' }));
        (cfg.dacs || []).forEach(p => pins.push({ id: addr + ':dac' + p, label: 'GPIO' + p + ' DAC', dir: 'output', flow: 'sink', kind: 'dac' }));
        (cfg.servos || []).forEach(p => pins.push({ id: addr + ':servo' + p, label: 'GPIO' + p + ' 舵机', dir: 'output', flow: 'sink', kind: 'servo' }));
        if (!pins.length) {
            pins.push({ id: addr + ':noconfig', label: '(未配置引脚)', dir: 'none', flow: 'none', kind: 'none' });
        }
    }
    return pins;
}

function portFlow(portId) {
    if (window.LogicBlocks && LogicBlocks.isLogicPortSource(portId, logicNodes)) return 'source';
    const idx = portId.lastIndexOf(':');
    const pinPart = idx >= 0 ? portId.substring(idx + 1) : portId;
    if (pinPart.startsWith('adc') || pinPart.startsWith('din') || pinPart === 'eog' || pinPart === 'emg' || pinPart === 'focus') return 'source';
    if (pinPart === 'noconfig') return 'none';
    return 'sink';
}

function renderLogicPalette() {
    const el = $('logic-palette');
    if (!el || !window.LogicBlocks) return;
    el.innerHTML = LogicBlocks.listBlocks().map(b =>
        '<button type="button" class="logic-palette-btn" data-block="' + b.type + '" title="' + (b.desc || '') + '">' + b.icon + ' ' + b.label + '</button>'
    ).join('');
    el.querySelectorAll('.logic-palette-btn').forEach(btn => {
        btn.addEventListener('click', () => addLogicBlock(btn.dataset.block));
    });
}

function addLogicBlock(blockType) {
    const def = LogicBlocks.getBlockDef(blockType);
    if (!def) return;
    const id = 'logic-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const rect = canvas.getBoundingClientRect();
    logicNodes.push({
        id, blockType, x: Math.max(20, rect.width / 2 - 60), y: Math.max(60, rect.height / 2 - 40),
        params: LogicBlocks.freshParams(blockType)
    });
    $('canvas-hint').style.display = 'none';
    saveRules();
    renderCanvas();
    log('已添加逻辑块: ' + def.label);
}

function removeLogicNode(li) {
    const id = logicNodes[li].id;
    logicNodes.splice(li, 1);
    canvasConnections = canvasConnections.filter(c => !c.from.startsWith(id + ':') && !c.to.startsWith(id + ':'));
    saveRules();
    renderCanvas();
}

function makeDraggableLogic(el, li) {
    let startX, startY, origX, origY;
    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.lg-pin') || e.target.closest('.lg-remove') || e.target.closest('.lg-params')) return;
        startX = e.clientX; startY = e.clientY;
        origX = logicNodes[li].x; origY = logicNodes[li].y;
        const onMove = (ev) => {
            logicNodes[li].x = Math.max(0, origX + ev.clientX - startX);
            logicNodes[li].y = Math.max(0, origY + ev.clientY - startY);
            el.style.left = logicNodes[li].x + 'px';
            el.style.top = logicNodes[li].y + 'px';
            drawConnections();
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); saveRules(); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function renderLogicParamField(node, li, p) {
    const val = (node.params || {})[p.key];
    if (p.type === 'select') {
        return '<label style="font-size:9px;color:#999">' + p.label + '</label><select data-li="' + li + '" data-pkey="' + p.key + '">'
            + (p.options || []).map(o => '<option value="' + o.value + '"' + (String(val) === String(o.value) ? ' selected' : '') + '>' + o.label + '</option>').join('')
            + '</select>';
    }
    if (p.type === 'code') {
        return '<label style="font-size:9px;color:#999">' + p.label + '</label><textarea data-li="' + li + '" data-pkey="' + p.key + '">' + (val || '') + '</textarea>';
    }
    return '<label style="font-size:9px;color:#999">' + p.label + '</label><input type="number" step="' + (p.step || 1) + '" data-li="' + li + '" data-pkey="' + p.key + '" value="' + (val != null ? val : '') + '" />';
}

function bindLogicParamEvents(el) {
    el.querySelectorAll('[data-pkey]').forEach(input => {
        const handler = () => {
            const li = Number(input.dataset.li);
            const key = input.dataset.pkey;
            if (!logicNodes[li]) return;
            if (!logicNodes[li].params) logicNodes[li].params = {};
            logicNodes[li].params[key] = input.tagName === 'SELECT' ? input.value : (input.type === 'number' ? Number(input.value) : input.value);
            saveRules();
        };
        input.addEventListener('change', handler);
        if (input.tagName === 'TEXTAREA') input.addEventListener('blur', handler);
    });
}

function renderLogicNodes() {
    canvas?.querySelectorAll('.canvas-logic').forEach(el => el.remove());
    logicNodes.forEach((node, li) => {
        const def = LogicBlocks.getBlockDef(node.blockType);
        if (!def) return;
        const el = document.createElement('div');
        el.className = 'canvas-logic';
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        el.style.borderColor = def.color || '#7c4dff';
        let pinsHtml = '';
        (def.inputs || []).forEach(p => {
            pinsHtml += '<div class="lg-pin sink" data-pid="' + node.id + ':' + p.id + '" data-flow="sink"><span class="pin-dot"></span>' + p.label + '</div>';
        });
        (def.outputs || []).forEach(p => {
            pinsHtml += '<div class="lg-pin source" data-pid="' + node.id + ':' + p.id + '" data-flow="source">' + p.label + '<span class="pin-dot"></span></div>';
        });
        let paramsHtml = '';
        if ((def.params || []).length) {
            paramsHtml = '<div class="lg-params">' + def.params.map(p => renderLogicParamField(node, li, p)).join('') + '</div>';
        }
        el.innerHTML = '<div class="lg-header"><span class="lg-name">' + def.icon + ' ' + def.label + '</span><span class="lg-remove" data-li="' + li + '">&times;</span></div>'
            + '<div class="lg-pins">' + pinsHtml + '</div>' + paramsHtml;
        makeDraggableLogic(el, li);
        el.querySelector('.lg-remove').addEventListener('click', () => removeLogicNode(li));
        el.querySelectorAll('.lg-pin').forEach(pinEl => {
            pinEl.addEventListener('mousedown', (e) => { e.stopPropagation(); startPinConnection(pinEl); });
        });
        bindLogicParamEvents(el);
        canvas.appendChild(el);
    });
}

function renderCanvas() {
    canvas?.querySelectorAll('.canvas-device').forEach(el => el.remove());
    if (!canvasNodes.length && !logicNodes.length) { $('canvas-hint').style.display = ''; }
    else { $('canvas-hint').style.display = 'none'; }

    canvasNodes.forEach((node, ni) => {
        const d = devices.find(dd => dd.address === node.address);
        const isLive = liveConnAddrs.has(node.address);
        const isConn = connectedAddrs.has(node.address);
        const displayName = d ? getDisplayName(d) : node.address;
        const pins = getNodePins(node);

        const el = document.createElement('div');
        el.className = 'canvas-device' + (!isConn ? ' offline' : '') + (node.type === 'headband' ? ' type-headband' : '');
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        el.dataset.ni = ni;

        let statusText = isLive ? '' : (isConn ? '已连接·离线' : '已断开');
        el.innerHTML = `<div class="cd-header"><span class="cd-name">${node.type === 'headband' ? '🧠' : '🎛️'} ${displayName}</span><span class="cd-status">${statusText}</span><span class="cd-remove" data-ni="${ni}">&times;</span></div>`
            + `<div class="cd-pins">${pins.map(p => `<div class="cd-pin ${p.dir} ${p.kind}" data-pid="${p.id}" data-dir="${p.dir}"><span class="pin-dot"></span>${p.label}</div>`).join('')}</div>`;

        makeDraggableNode(el, ni);
        el.querySelector('.cd-remove').addEventListener('click', () => { removeCanvasNode(ni); });
        el.querySelectorAll('.cd-pin').forEach(pinEl => {
            if (pinEl.dataset.dir === 'none') return;
            pinEl.addEventListener('mousedown', (e) => { e.stopPropagation(); startPinConnection(pinEl); });
        });
        canvas.appendChild(el);
    });
    renderLogicNodes();
    drawConnections();
}

function makeDraggableNode(el, ni) {
    let startX, startY, origX, origY;
    el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.cd-pin') || e.target.closest('.cd-remove')) return;
        startX = e.clientX; startY = e.clientY;
        origX = canvasNodes[ni].x; origY = canvasNodes[ni].y;
        const onMove = (ev) => {
            canvasNodes[ni].x = Math.max(0, origX + ev.clientX - startX);
            canvasNodes[ni].y = Math.max(0, origY + ev.clientY - startY);
            el.style.left = canvasNodes[ni].x + 'px';
            el.style.top = canvasNodes[ni].y + 'px';
            drawConnections();
        };
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); saveRules(); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function removeCanvasNode(ni) {
    const addr = canvasNodes[ni].address;
    canvasNodes.splice(ni, 1);
    canvasConnections = canvasConnections.filter(c => !c.from.startsWith(addr) && !c.to.startsWith(addr));
    saveRules();
    renderCanvas();
}

// ==========================================================
// Pin connections (drawing lines between pins)
// ==========================================================

function startPinConnection(pinEl) {
    const pid = pinEl.dataset.pid;
    draggingPin = { pid, el: pinEl };

    const onMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x2 = e.clientX - rect.left;
        const y2 = e.clientY - rect.top;
        const pinRect = pinEl.getBoundingClientRect();
        const x1 = pinRect.left + pinRect.width / 2 - rect.left;
        const y1 = pinRect.top + pinRect.height / 2 - rect.top;
        drawTempLine(x1, y1, x2, y2);
    };
    const onUp = (e) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        clearTempLine();
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const targetPin = target ? target.closest('.cd-pin, .lg-pin') : null;
        if (targetPin && targetPin !== pinEl) {
            tryConnect(pid, targetPin.dataset.pid);
        }
        draggingPin = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function tryConnect(fromId, toId) {
    const fromFlow = portFlow(fromId);
    const toFlow = portFlow(toId);
    if (fromFlow === 'none' || toFlow === 'none') return;
    if (fromFlow === toFlow) { log('请连接 源→汇（设备IN/逻辑OUT → 逻辑IN/设备OUT）'); return; }
    const srcId = fromFlow === 'source' ? fromId : toId;
    const sinkId = fromFlow === 'sink' ? fromId : toId;
    if (canvasConnections.find(c => c.from === srcId && c.to === sinkId)) { log('连接已存在'); return; }
    canvasConnections.push({ from: srcId, to: sinkId });
    saveRules();
    drawConnections();
    log('连接已建立');
}

function drawTempLine(x1, y1, x2, y2) {
    clearTempLine();
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#00D9FF'); line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '5,3'); line.setAttribute('opacity', '0.6');
    line.id = 'temp-line';
    canvasSvg.appendChild(line);
}
function clearTempLine() { const t = document.getElementById('temp-line'); if (t) t.remove(); }

function drawConnections() {
    canvasSvg.innerHTML = '';
    const rect = canvas.getBoundingClientRect();
    canvasSvg.setAttribute('width', rect.width);
    canvasSvg.setAttribute('height', rect.height);

    canvasConnections.forEach((conn, ci) => {
        const fromEl = canvas.querySelector(`[data-pid="${conn.from}"]`);
        const toEl = canvas.querySelector(`[data-pid="${conn.to}"]`);
        if (!fromEl || !toEl) return;
        const fr = fromEl.getBoundingClientRect();
        const tr = toEl.getBoundingClientRect();
        const x1 = fr.left + fr.width / 2 - rect.left;
        const y1 = fr.top + fr.height / 2 - rect.top;
        const x2 = tr.left + tr.width / 2 - rect.left;
        const y2 = tr.top + tr.height / 2 - rect.top;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const mx = (x1 + x2) / 2;
        path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
        path.setAttribute('class', 'canvas-line' + (conn.from.startsWith('logic-') || conn.to.startsWith('logic-') ? ' logic' : ''));
        path.style.pointerEvents = 'stroke';
        path.addEventListener('dblclick', () => { canvasConnections.splice(ci, 1); saveRules(); drawConnections(); log('连接已删除'); });
        canvasSvg.appendChild(path);
    });
}

function updateCanvasNodeStates() { renderCanvas(); }

// ==========================================================
// Rule set management (sidebar list)
// ==========================================================

$('btn-rule-new')?.addEventListener('click', async () => {
    const name = await pwPrompt('新规则集名称:', '规则集' + (Object.keys(ruleSets).length + 1));
    if (!name || !name.trim()) return;
    const key = name.trim();
    activeRuleSet = key;
    canvasNodes = []; logicNodes = []; canvasConnections = [];
    ruleSets[key] = { nodes: [], logicNodes: [], connections: [] };
    saveRules();
    renderCanvas();
    renderRuleSetList();
    log('已创建: ' + key);
});


$('btn-rule-apply')?.addEventListener('click', async () => {
    if (!canvasConnections.length) { log('没有连线可应用'); return; }
    try {
        const payload = {
            logic_nodes: logicNodes.map(n => ({ id: n.id, blockType: n.blockType, params: n.params || {} })),
            connections: canvasConnections.map(c => ({ from: c.from, to: c.to }))
        };
        const r = await api('/rules/apply-graph', { method: 'POST', body: JSON.stringify(payload) });
        log('规则已应用: ' + (r.logic_blocks || 0) + ' 逻辑块, ' + (r.connections || canvasConnections.length) + ' 连接');
    } catch (e) { log('应用失败: ' + e.message); }
});

$('btn-rule-stop')?.addEventListener('click', async () => {
    try {
        await api('/rules/stop', { method: 'POST' });
        log('\u89c4\u5219\u8f6c\u53d1\u5df2\u505c\u6b62');
    } catch (e) { log('\u505c\u6b62\u5931\u8d25: ' + e.message); }
});

function splitPinId(pid) {
    const idx = pid.lastIndexOf(':');
    if (idx < 0) return [null, null];
    return [pid.substring(0, idx), pid.substring(idx + 1)];
}

function parsePinNumber(pinId) {
    const m = pinId.match(/\d+/);
    return m ? parseInt(m[0]) : 0;
}

function guessSignalType(pinId) {
    if (pinId.startsWith('adc')) return 2;
    if (pinId === 'eog') return 16;
    if (pinId === 'emg') return 17;
    if (pinId === 'focus') return 18;
    return 1;
}

function guessAction(pinId) {
    if (pinId.startsWith('pwm')) return 4;
    if (pinId.startsWith('dac')) return 3;
    if (pinId.startsWith('servo')) return 6;
    return 1;
}

$('btn-rule-clear')?.addEventListener('click', () => {
    if (!confirm('清空当前规则集？')) return;
    canvasNodes = []; logicNodes = []; canvasConnections = [];
    saveRules();
    renderCanvas();
    log('已清空');
});

function renderRuleSetList() {
    const container = $('rl-tabs');
    const keys = Object.keys(ruleSets);
    if (!keys.length) { container.innerHTML = '<div class="empty-hint">暂无规则集</div>'; return; }
    container.innerHTML = keys.map(k => {
        const set = ruleSets[k];
        const nodeCount = (set.nodes || []).length;
        const connCount = (set.connections || []).length;
        const isActive = k === activeRuleSet;
        return `<div class="rl-tab ${isActive ? 'active' : ''}" data-key="${k}">` +
            `<div class="rl-name">${k}</div>` +
            `<div class="rl-meta">${nodeCount} 设备 · ${connCount} 连接</div>` +
            (isActive ? '' : `<span class="btn btn-danger btn-sm rl-del" data-key="${k}" style="margin-top:4px;font-size:10px;padding:2px 6px">删除</span>`) +
            `</div>`;
    }).join('');
    container.querySelectorAll('.rl-tab').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('rl-del')) return;
            switchRuleSet(item.dataset.key);
        });
    });
    container.querySelectorAll('.rl-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm('删除规则集 "' + btn.dataset.key + '"？')) return;
            delete ruleSets[btn.dataset.key];
            if (activeRuleSet === btn.dataset.key) {
                const remaining = Object.keys(ruleSets);
                activeRuleSet = remaining[0] || 'default';
                if (!ruleSets[activeRuleSet]) ruleSets[activeRuleSet] = { nodes: [], connections: [] };
            }
            loadActiveRuleSet();
            saveRules();
            renderCanvas();
            renderRuleSetList();
            log('规则集已删除');
        });
    });
}

function switchRuleSet(key) {
    if (key === activeRuleSet) return;
    saveRules();
    activeRuleSet = key;
    loadActiveRuleSet();
    renderCanvas();
    renderRuleSetList();
    log('已切换到: ' + key);
}

function loadActiveRuleSet() {
    const set = ruleSets[activeRuleSet] || { nodes: [], logicNodes: [], connections: [] };
    canvasNodes = set.nodes || [];
    logicNodes = set.logicNodes || [];
    canvasConnections = set.connections || [];
}

// ==========================================================
// Watchdog + Init
// ==========================================================


// === Real-time signal display ===
let signalWs = null;
const pinValues = {};
let signalPollBusy = false;

function applySignalPayload(sig) {
    if (!sig) return false;
    const addr = sig.address;
    const pin = sig.channel;
    const sigType = sig.signal_type;
    const value = sig.value;
    if (!addr || pin === undefined) return false;
    setPinMeta(addr, pin, sigType, value);
    return true;
}

function connectSignalWs() {
    const origin = getApiOrigin().replace(/\/$/, '');
    const wsUrl = (typeof window.ssvepOriginToWebSocketUrl === 'function'
        ? window.ssvepOriginToWebSocketUrl(origin, '/api/ctrl/signals/stream')
        : origin.replace(/^http/i, 'ws') + '/api/ctrl/signals/stream');
    if (signalWs && (signalWs.readyState === WebSocket.OPEN || signalWs.readyState === WebSocket.CONNECTING)) {
        return;
    }
    signalWs = new WebSocket(wsUrl);
    signalWs.onopen = () => { log('信号流已连接'); };
    signalWs.onmessage = (ev) => {
        try {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'heartbeat') return;
            if (applySignalPayload(msg)) renderPinoutValues();
        } catch (_) {}
    };
    signalWs.onclose = () => {
        signalWs = null;
        setTimeout(connectSignalWs, 3000);
    };
    signalWs.onerror = () => { signalWs?.close(); };
}

async function refreshSignalHistory() {
    if (signalPollBusy || !connectedAddrs.size) return;
    signalPollBusy = true;
    try {
        const r = await api('/signals?count=200');
        const signals = r.signals || [];
        let touched = false;
        for (const sig of signals) {
            if (!sig || !sig.address) continue;
            if (!connectedAddrs.has(sig.address) && sig.address !== selectedAddr) continue;
            touched = applySignalPayload(sig) || touched;
        }
        if (touched) renderPinoutValues();
    } catch (_) {
    } finally {
        signalPollBusy = false;
    }
}

function updatePinoutValues() {
    renderPinoutValues();
}

setInterval(async () => {
    if (connecting || !connectedAddrs.size) return;
    try {
        const r = await api('/status');
        const conns = r.connections || {};
        const liveAddrs = new Set();
        for (const [addr, info] of Object.entries(conns)) { if (info.connected) liveAddrs.add(addr); }
        let changed = false;
        for (const addr of connectedAddrs) {
            if (addr.startsWith('headband:')) continue;
            const wasLive = liveConnAddrs.has(addr);
            const nowLive = liveAddrs.has(addr);
            if (wasLive && !nowLive) { liveConnAddrs.delete(addr); changed = true; }
            else if (!wasLive && nowLive) { liveConnAddrs.add(addr); changed = true; }
        }
        if (changed) { renderDeviceList(); updateCanvasNodeStates(); }
    } catch (_) {}
}, 5000);

setInterval(refreshSignalHistory, 2500);

async function init() {
    loadConfigs();
    loadRemembered();
    loadRules();
    renderRuleSetList();
    checkHeadband();
    try {
        const r = await api('/status');
        const conns = r.connections || {};
        for (const [addr, info] of Object.entries(conns)) {
            if (info.connected) { connectedAddrs.add(addr); liveConnAddrs.add(addr); if (!selectedAddr) selectedAddr = addr; }
        }
        if (selectedAddr) updatePinout();
        log(connectedAddrs.size ? '已连接 ' + liveConnAddrs.size + ' 台设备' : '就绪');
        for (const addr of liveConnAddrs) {
            if (addr.startsWith('headband:')) continue;
            try { await pushPinConfig(addr); } catch (_) {}
        }
    } catch (e) { log('后端未连接: ' + e.message); }
    renderDeviceList();
    renderCanvas();
    renderLogicPalette();
    connectSignalWs();
    refreshSignalHistory();

}
function checkHeadband() {
    const gdm = window.globalDeviceManager;
    if (!gdm) return;
    const addr = 'headband:seekbci';
    const existing = devices.find(d => d.address === addr);
    if (gdm.isConnected && gdm.deviceInfo) {
        if (!existing) {
            devices.push({ address: addr, name: gdm.deviceInfo.name || 'SEEKBCI 头环', type: 'headband', _lastSeen: Date.now(), rssi: null });
        } else {
            existing._lastSeen = Date.now();
            existing.name = gdm.deviceInfo.name || existing.name;
        }
        connectedAddrs.add(addr);
        liveConnAddrs.add(addr);
    } else if (existing) {
        liveConnAddrs.delete(addr);
    }
}
setInterval(checkHeadband, 3000);

init();
window.addEventListener('resize', () => drawConnections());

})();
