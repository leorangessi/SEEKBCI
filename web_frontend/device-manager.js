// 设备管理 JavaScript - 集成全局状态管理和波形显示

// 全局变量
let currentTab = 'ble';
let waveformDisplay = null;
let packetCount = 0;

// 与 global-device-manager 一致（可在本页任一 script 标签前设置 window.SSVEP_API_ORIGIN）
const API_BASE =
    typeof window.ssvepGetDevicesApiBase === 'function'
        ? window.ssvepGetDevicesApiBase()
        : 'http://127.0.0.1:8000/api/devices';

// 通道标签
const CHANNEL_LABELS = ["PO7", "PO3", "O1", "POz", "Oz", "PO4", "O2", "PO8"];

async function refreshBackendStatusBanner() {
    const banner = document.getElementById('backend-status-banner');
    if (!banner) return;
    const origin =
        typeof window.ssvepResolveApiOrigin === 'function'
            ? window.ssvepResolveApiOrigin()
            : 'http://127.0.0.1:8000';
    try {
        const r = await fetch(`${origin}/health`);
        if (!r.ok) throw new Error(r.statusText || String(r.status));
        banner.style.display = 'none';
        banner.textContent = '';
    } catch (e) {
        banner.style.display = 'block';
        banner.innerHTML = `
<strong>后端未连通</strong>（浏览器报 Failed to fetch 多属此类）<br>
• 请先在本机启动 API，目标地址为：<code style="color:#FFB74D;">${origin}</code><br>
• 在目录 <code style="background:#2a2a2a;padding:2px 6px;border-radius:4px">python_backend</code> 执行示例：<br>
<code style="display:block;margin-top:6px;background:#2a2a2a;padding:8px;border-radius:4px;color:#aed581">python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000</code><br>
• 端口或机器不同时，先在页面最上方或其它 script 之前设置：<br>
<code style="background:#2a2a2a;padding:2px 6px;border-radius:4px">window.SSVEP_API_ORIGIN=\"http://你的IP:端口\"</code> 后<strong>刷新本页</strong>。
`;
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    refreshBackendStatusBanner();

    loadSavedConfig();
    initDeviceChannelMatrixUi();
    initWaveformAutoToggle();

    window.globalDeviceManager.addEventListener(handleDeviceEvent);

    checkAndRestoreConnection();
    switchTab('ble');
});

function onDeviceChannelRolesChange(roles) {
    const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
    const root = document.getElementById('dm-channel-matrix-root');
    if (!CFG || !root) return;

    const normalized = CFG.normalizeRolesArray(roles);
    const ssvepCount = normalized.filter((r) => r === 'ssvep').length;
    if (ssvepCount === 0) {
        alert('请至少一路通道设为 SSVEP（供 FBCCA 解码）。');
        const rollback = CFG.loadFullConfig().channelRoles;
        CFG.refreshDeviceChannelMatrixUi(rollback);
        CFG.updateMatrixSummary(rollback);
        return;
    }

    const saved = CFG.saveFullConfig({ channelRoles: normalized });
    CFG.refreshDeviceChannelMatrixUi(saved.channelRoles);
    CFG.updateMatrixSummary(saved.channelRoles);
}

function initDeviceChannelMatrixUi() {
    const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
    const root = document.getElementById('dm-channel-matrix-root');
    if (!CFG || !root) return;

    root._onRoleChange = onDeviceChannelRolesChange;
    const config = CFG.loadFullConfig();
    CFG.renderDeviceChannelMatrix(root, config.channelRoles, onDeviceChannelRolesChange);
    CFG.updateMatrixSummary(config.channelRoles);
}

function initWaveformAutoToggle() {
    const cb = document.getElementById('waveform-auto-y');
    if (!cb) return;
    cb.addEventListener('change', () => {
        if (waveformDisplay && typeof waveformDisplay.setAutoScale === 'function') {
            waveformDisplay.setAutoScale(cb.checked);
        }
    });
}

// 检查并恢复连接状态
async function checkAndRestoreConnection() {
    // 尝试从后端获取真实状态
    try {
        const response = await fetch(`${API_BASE}/status`);
        const data = await response.json();
        
        if (data.success && data.status.connected) {
            console.log('从后端检测到设备连接...');

            // 自动恢复：切页/返回主页不应影响后端连接状态
            window.globalDeviceManager.isConnected = true;
            window.globalDeviceManager.deviceInfo = data.status.device_info;
            window.globalDeviceManager.saveState();

            // 重新连接 WebSocket（仅用于前端实时显示）
            window.globalDeviceManager.connectWebSocket(true);

            // 显示连接状态
            onConnectionSuccess('Backend', data.status.device_info);
        } else {
            localStorage.removeItem('deviceState');
            window.globalDeviceManager.isConnected = false;
            window.globalDeviceManager.deviceInfo = null;
            console.log('后端无设备连接，已清除本地状态');
        }
    } catch (error) {
        console.error('检查设备状态失败:', error);
        localStorage.removeItem('deviceState');
        window.globalDeviceManager.isConnected = false;
        window.globalDeviceManager.deviceInfo = null;
    }
}

// 处理设备事件
function handleDeviceEvent(event, data) {
    console.log('Device event:', event, data);
    
    switch (event) {
        case 'connected':
            onConnectionSuccess('Device', data.device_info);
            break;
            
        case 'disconnected':
            onDisconnected();
            break;
            
        case 'data':
            handleRealtimeData(data);
            break;
            
        case 'statusChange':
            updateConnectionStatus(data);
            break;
            
        case 'wsConnected':
            console.log('WebSocket connected');
            break;
            
        case 'wsDisconnected':
            console.log('WebSocket disconnected');
            break;
            
        case 'error':
            console.error('Device error:', data);
            break;
    }
}

// 切换标签（仅 SEEKBCI BLE）
function switchTab(tab) {
    currentTab = tab || 'ble';

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        document.querySelectorAll('.tab').forEach(t => t.classList.add('active'));
    }

    document.querySelectorAll('.connection-content').forEach(c => c.style.display = 'none');
    const panel = document.getElementById('ble-content');
    if (panel) panel.style.display = 'block';

    document.getElementById('device-list').innerHTML = `
        <div class="info-text" style="text-align: center; padding: 20px; color: #666;">
            点击「扫描 SEEKBCI BLE」查找烧录了 SEEKBCI.ino 的设备
        </div>
    `;

    scanBLE();
}

// LSL扫描
async function scanLSL() {
    const deviceList = document.getElementById('device-list');
    deviceList.innerHTML = '<div class="info-text" style="text-align: center; padding: 20px;">正在扫描...</div>';
    
    try {
        const response = await fetch(`${API_BASE}/scan/lsl`);
        const result = await response.json();
        
        if (result.success && result.devices.length > 0) {
            deviceList.innerHTML = result.devices.map(device => `
                <div class="device-item" onclick="selectLSLDevice('${device.name}', '${device.type}')">
                    <div class="device-name">
                        <span class="device-status status-online"></span>
                        ${device.name}
                    </div>
                    <div class="device-info">
                        类型: ${device.type} | 通道: ${device.channel_count} | 采样率: ${device.sampling_rate} Hz
                    </div>
                </div>
            `).join('');
        } else {
            deviceList.innerHTML = `
                <div class="info-text" style="text-align: center; padding: 20px; color: #666;">
                    未找到LSL设备<br><br>
                    请确保：<br>
                    • 设备已开启<br>
                    • LSL服务正在运行<br>
                    • 防火墙允许LSL通信
                </div>
            `;
        }
    } catch (error) {
        console.error('扫描LSL设备失败:', error);
        deviceList.innerHTML = `
            <div class="info-text" style="text-align: center; padding: 20px; color: #F44336;">
                扫描失败: ${error.message}<br><br>
                请确保后端服务正在运行
            </div>
        `;
    }
}

// 串口扫描
async function scanSerial() {
    const deviceList = document.getElementById('device-list');
    deviceList.innerHTML = '<div class="info-text" style="text-align: center; padding: 20px;">正在扫描...</div>';
    
    try {
        const response = await fetch(`${API_BASE}/scan/serial`);
        const result = await response.json();
        
        const serialOk = result.serial_module_available !== false;

        if (result.success && result.devices.length > 0) {
            deviceList.innerHTML = result.devices.map(device => `
                <div class="device-item" onclick='selectSerialDevice(${JSON.stringify(device.port)})'>
                    <div class="device-name">
                        <span class="device-status status-online"></span>
                        ${escapeHtml(device.port)}
                    </div>
                    <div class="device-info">
                        ${escapeHtml(device.description || '')}
                    </div>
                </div>
            `).join('');
            
            // 更新串口选择框
            const serialSelect = document.getElementById('serial-port');
            const brainflowSelect = document.getElementById('brainflow-port');
            
            serialSelect.innerHTML =
                '<option value="">选择串口</option>' +
                result.devices.map(d => `<option value="${escapeAttr(d.port)}">${escapeHtml(d.port)} — ${escapeHtml(d.description || '')}</option>`).join('');
            
            brainflowSelect.innerHTML =
                '<option value="">自动检测</option>' +
                result.devices.map(d => `<option value="${escapeAttr(d.port)}">${escapeHtml(d.port)}</option>`).join('');
            
            applySavedPortsToDropdownsAfterScan();
            
        } else {
            resetSerialDropdownsPlaceholders(serialOk);

            let extra = '';
            if (!serialOk) {
                extra = '<br><br>后端未安装串口组件：请在 Python 环境中执行 <code style="color:#FFB74D;">pip install pyserial</code> 后重启服务。';
            } else if (typeof result.count === 'number' && result.count === 0) {
                extra = `<br><br>本机未发现串口：<br>
                    • USB 转串口需安装驱动，设备管理器中应出现端口<br>
                    • 端口可能已被占用，请关闭其他采集软件后再扫<br>
                    • 可直接在右侧「或手动输入端口」填写 COM 编号连接`;
            }

            deviceList.innerHTML = `
                <div class="info-text" style="text-align: center; padding: 20px; color: #666;">
                    未找到可用串口${extra}
                </div>
            `;
        }
    } catch (error) {
        console.error('扫描串口失败:', error);
        resetSerialDropdownsPlaceholders(undefined);
        deviceList.innerHTML = `
            <div class="info-text" style="text-align: center; padding: 20px; color: #F44336;">
                扫描失败: ${error.message}<br><br>
                请确认后端已启动。当前配置的 API 根地址为：<code style="color:#FFB74D;">${
                    typeof window.ssvepResolveApiOrigin === 'function'
                        ? window.ssvepResolveApiOrigin()
                        : 'http://127.0.0.1:8000'
                }</code><br>
                若与实际不符请设置 window.SSVEP_API_ORIGIN 后刷新页面。
            </div>
        `;
    }
}

function escapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;');
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function resetSerialDropdownsPlaceholders(serialModuleOk) {
    const serialSelect = document.getElementById('serial-port');
    const brainflowSelect = document.getElementById('brainflow-port');
    const hint =
        serialModuleOk === undefined
            ? '（请确认后端可用，或手动输入端口）'
            : serialModuleOk
              ? '（扫描无结果时可手动输入端口）'
              : '（pyserial 不可用）';
    serialSelect.innerHTML = `<option value="">选择串口 ${hint}</option>`;
    brainflowSelect.innerHTML = `<option value="">自动检测 ${hint}</option>`;
}

/** 扫描后若 localStorage 里保存过端口，尽量恢复选中项 */
function applySavedPortsToDropdownsAfterScan() {
    try {
        const saved = localStorage.getItem('device_config');
        if (!saved) return;
        const config = JSON.parse(saved);
        const sp = config.serial && config.serial.port;
        const bp = config.brainflow && config.brainflow.port;
        if (sp) {
            const sel = document.getElementById('serial-port');
            if ([...sel.options].some(o => o.value === sp)) sel.value = sp;
        }
        if (bp) {
            const sel = document.getElementById('brainflow-port');
            if ([...sel.options].some(o => o.value === bp)) sel.value = bp;
        }
    } catch (e) {
        /* ignore */
    }
}

// 选择LSL设备
function selectLSLDevice(name, type) {
    document.getElementById('lsl-stream-name').value = name;
    document.getElementById('lsl-stream-type').value = type;
    
    // 高亮选中
    document.querySelectorAll('.device-item').forEach(item => {
        item.classList.remove('connected');
    });
    event.currentTarget.classList.add('connected');
    
    // 自动保存配置
    saveConfig();
}

// 选择串口设备
function selectSerialDevice(port) {
    document.getElementById('serial-port').value = port;
    document.getElementById('brainflow-port').value = port;
    document.getElementById('serial-port-manual').value = '';
    document.getElementById('brainflow-port-manual').value = '';
    
    // 高亮选中
    document.querySelectorAll('.device-item').forEach(item => {
        item.classList.remove('connected');
    });
    event.currentTarget.classList.add('connected');
}

// SEEKBCI BLE
async function scanBLE() {
    const deviceList = document.getElementById('device-list');
    deviceList.innerHTML = '<div class="info-text" style="text-align: center; padding: 20px;">正在扫描 BLE…</div>';

    try {
        const response = await fetch(`${API_BASE}/scan/ble?timeout=6`);
        const result = await response.json();

        if (result.ble_available === false) {
            deviceList.innerHTML = `
                <div class="info-text" style="text-align: center; padding: 20px; color: #F44336;">
                    ${result.availability_detail || '后端未安装 bleak'}<br><br>
                    请执行 <code style="color:#FFB74D;">pip install bleak</code> 后重启后端
                </div>
            `;
            return;
        }

        if (result.success && result.devices && result.devices.length > 0) {
            deviceList.innerHTML = result.devices.map(device => {
                const name = (device.name || 'SEEKBCI').replace(/'/g, "\\'");
                const addr = (device.address || '').replace(/'/g, "\\'");
                const badge = device.match
                    ? (device.by_service ? 'SEEKBCI·UUID' : 'SEEKBCI')
                    : '附近';
                return `
                <div class="device-item" onclick="selectBLEDevice('${name}', '${addr}')">
                    <div class="device-name">
                        <span class="device-status status-online"></span>
                        ${device.name || '(unnamed)'}
                    </div>
                    <div class="device-info">
                        ${badge} | ${device.address || '无地址'}${device.rssi != null ? ` | RSSI ${device.rssi}` : ''}
                    </div>
                </div>`;
            }).join('');
        } else {
            deviceList.innerHTML = `
                <div class="info-text" style="text-align: center; padding: 20px; color: #666;">
                    未找到 SEEKBCI BLE 设备<br><br>
                    请确保：<br>
                    • 已烧录 reference/SEEKBCI/SEEKBCI.ino<br>
                    • 设备已上电并广播（Windows 上可能显示为无名，但仍可按服务 UUID 识别）<br>
                    • Windows 蓝牙已开启，且未在「蓝牙设置」里配对占用<br>
                    • 已重启后端（扫描逻辑已按服务 UUID 匹配）
                </div>
            `;
        }
    } catch (error) {
        console.error('扫描 BLE 失败:', error);
        deviceList.innerHTML = `
            <div class="info-text" style="text-align: center; padding: 20px; color: #F44336;">
                扫描失败: ${error.message}<br><br>
                请确保后端服务正在运行
            </div>
        `;
    }
}

function selectBLEDevice(name, address) {
    const clean = (name || '').trim();
    const useName =
        !clean || clean.startsWith('(') || clean.toLowerCase() === 'unnamed'
            ? 'SEEKBCI'
            : clean;
    document.getElementById('ble-device-name').value = useName;
    document.getElementById('ble-address').value = address || '';
    document.querySelectorAll('.device-item').forEach(item => item.classList.remove('connected'));
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('connected');
    }
}

async function connectBLE() {
    const deviceName = (document.getElementById('ble-device-name').value || 'SEEKBCI').trim();
    const address = (document.getElementById('ble-address').value || '').trim();

    const params = {
        device_name: deviceName || 'SEEKBCI',
        timeout: 18.0
    };
    if (address) params.address = address;

    try {
        const origin =
            typeof window.ssvepResolveApiOrigin === 'function'
                ? window.ssvepResolveApiOrigin()
                : window.globalDeviceManager?.apiOrigin || 'http://127.0.0.1:8000';
        const response = await fetch(`${origin}/api/devices/connect/ble`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            let detail = data.detail || data.message || `HTTP ${response.status}`;
            if (typeof detail !== 'string') detail = JSON.stringify(detail);
            throw new Error(detail);
        }
        // 同步前端全局状态与 WebSocket
        window.globalDeviceManager.isConnected = true;
        window.globalDeviceManager.deviceInfo = data.device_info;
        window.globalDeviceManager.saveState();
        window.globalDeviceManager.connectWebSocket(true);
        window.globalDeviceManager.notifyListeners('connected', data);
        alert('✅ SEEKBCI BLE 连接成功！');
    } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        alert(
            '❌ SEEKBCI BLE 连接失败\n\n' +
                msg +
                '\n\n排查：\n' +
                '• 设备已上电且广播名为 SEEKBCI\n' +
                '• 先点「扫描」再选中设备（带地址更稳）\n' +
                '• 关闭手机/其它程序占用的 BLE\n' +
                '• 后端已安装 bleak，必要时重启 API'
        );
    }
}

async function connectLSL() {
    const streamName = document.getElementById('lsl-stream-name').value;
    const streamType = document.getElementById('lsl-stream-type').value;
    
    if (!streamName) {
        alert('请输入流名称');
        return;
    }
    
    const success = await window.globalDeviceManager.connectDevice('lsl', {
        stream_name: streamName,
        stream_type: streamType
    });
    
    if (success) {
        alert('✅ LSL设备连接成功！');
    } else {
        alert('❌ 连接失败\n\n请确保设备正在运行LSL服务');
    }
}

// 连接成功后的处理
function onConnectionSuccess(type, deviceInfo) {
    console.log('Connection success:', type, deviceInfo);
    
    // 隐藏连接表单
    document.querySelectorAll('.connection-content').forEach(c => c.style.display = 'none');
    
    // 显示数据可视化
    document.getElementById('data-viz').style.display = 'block';
    
    // 更新状态
    updateConnectionStatus({
        connected: true,
        device_info: deviceInfo
    });
    
    // 初始化通道
    initializeChannels(deviceInfo.channel_count || 8);
    
    // 初始化波形显示
    initializeWaveform(deviceInfo);
    
    // 重置收包统计显示（后端在新会话会重新累计）
    updatePacketStatsUi(null);
    updateBatteryUi(deviceInfo && deviceInfo.battery);
    scheduleBatteryRefresh();
}

// 断开连接
async function disconnectDevice() {
    if (!confirm('确定要断开设备连接吗？')) {
        return;
    }
    
    const success = await window.globalDeviceManager.disconnectDevice();
    
    if (success) {
        // 清除本地存储的状态
        localStorage.removeItem('deviceState');
        alert('设备已断开');
    }
}

// 断开连接后的处理
function onDisconnected() {
    // 停止波形显示
    if (waveformDisplay) {
        waveformDisplay.stop();
        waveformDisplay = null;
    }
    
    // 隐藏数据可视化
    document.getElementById('data-viz').style.display = 'none';
    
    // 显示连接表单
    document.getElementById(`${currentTab}-content`).style.display = 'block';
    
    // 更新状态
    updateConnectionStatus({
        connected: false,
        device_info: {}
    });
    
    packetCount = 0;
    updatePacketStatsUi(null);
}

// 更新连接状态
function updateConnectionStatus(status) {
    const dot = document.getElementById('connection-dot');
    const statusText = document.getElementById('connection-status');
    const samplingRate = document.getElementById('sampling-rate');
    
    if (status.connected) {
        dot.classList.add('status-connected');
        dot.classList.remove('status-disconnected');
        statusText.textContent = '已连接';
        
        if (status.device_info && status.device_info.sampling_rate) {
            samplingRate.textContent = status.device_info.sampling_rate + ' Hz';
        }
        if (status.packet_stats) {
            updatePacketStatsUi(status.packet_stats);
        }
        updateBatteryUi(status.battery || (status.device_info && status.device_info.battery));
    } else {
        dot.classList.remove('status-connected');
        dot.classList.add('status-disconnected');
        statusText.textContent = '已断开';
        updatePacketStatsUi(null);
        updateBatteryUi(null);
    }
}

function updateBatteryUi(battery) {
    const el = document.getElementById('battery-level');
    if (!el) return;
    if (!battery || battery.percent == null) {
        el.textContent = '—';
        el.style.color = '';
        el.title = '';
        return;
    }
    const pct = Math.max(0, Math.min(100, Number(battery.percent) || 0));
    const v = battery.voltage_v != null ? Number(battery.voltage_v) : null;
    const low = !!battery.low;
    el.textContent = v != null ? `${pct}% (${v.toFixed(2)}V)` : `${pct}%`;
    el.style.color = low || pct < 20 ? '#F44336' : pct <= 30 ? '#FF9800' : '#4CAF50';
    el.title = low || pct < 20 ? '低电量' : '电池';
}

function updatePacketStatsUi(stats) {
    const recvEl = document.getElementById('packet-count');
    const lostEl = document.getElementById('packet-lost');
    const rateEl = document.getElementById('packet-loss-rate');
    const seqEl = document.getElementById('packet-seq');
    if (!recvEl) return;

    if (!stats) {
        recvEl.textContent = '0';
        if (lostEl) lostEl.textContent = '0';
        if (rateEl) rateEl.textContent = '0%';
        if (seqEl) seqEl.textContent = '—';
        packetCount = 0;
        return;
    }

    const recv = stats.packets_received != null ? stats.packets_received : 0;
    const lost = stats.packets_lost != null ? stats.packets_lost : 0;
    const rate = stats.loss_rate_pct != null ? stats.loss_rate_pct : 0;
    packetCount = recv;
    recvEl.textContent = String(recv);
    if (lostEl) {
        lostEl.textContent = String(lost);
        lostEl.style.color = lost > 0 ? '#FF9800' : '';
    }
    if (rateEl) {
        rateEl.textContent = `${rate}%`;
        rateEl.style.color = rate > 1 ? '#F44336' : rate > 0 ? '#FF9800' : '';
    }
    if (seqEl) {
        seqEl.textContent = stats.last_seq != null ? String(stats.last_seq) : '—';
    }
}

// 初始化通道
function initializeChannels(channelCount = 8) {
    const channelGrid = document.getElementById('channel-grid');
    const labels = CHANNEL_LABELS.slice(0, channelCount);
    
    channelGrid.innerHTML = labels.map((label, index) => `
        <div class="channel-card active" id="channel-${index}">
            <div class="channel-label">${label}</div>
            <div class="channel-value" id="channel-value-${index}">0.0 μV</div>
        </div>
    `).join('');
}

// 初始化波形显示
function initializeWaveform(deviceInfo) {
    const channelCount = deviceInfo.channel_count || 8;
    const samplingRate = deviceInfo.sampling_rate || 250;
    
    const autoY = document.getElementById('waveform-auto-y');
    waveformDisplay = new WaveformDisplay('signal-canvas', {
        channelCount: channelCount,
        samplingRate: samplingRate,
        displayDuration: 5.0,
        autoScale: autoY ? autoY.checked : true
    });

    waveformDisplay.start();
}

// 处理实时数据
let lastChannelUpdateTime = 0;
const CHANNEL_UPDATE_INTERVAL = 500; // 0.5秒更新一次通道值

function handleRealtimeData(message) {
    if (!message.data || message.data.length === 0) return;

    // 后端 WebSocket：data 为原始采样；data_display 为带通+去趋势，仅用于波形与幅值显示
    const raw = message.data;
    const plot =
        Array.isArray(message.data_display) && message.data_display.length > 0
            ? message.data_display
            : raw;
    const currentTime = Date.now();
    
    const latestSample = plot[plot.length - 1];
    if (window.SSVEP_DEVICE_CHANNEL_CONFIG) {
        window.SSVEP_DEVICE_CHANNEL_CONFIG.updateChannelLiveValues(latestSample);
    }

    if (currentTime - lastChannelUpdateTime >= CHANNEL_UPDATE_INTERVAL) {
        latestSample.forEach((value, index) => {
            if (index < 8) {
                const valueElement = document.getElementById(`channel-value-${index}`);
                if (valueElement) {
                    valueElement.textContent = value.toFixed(1) + ' μV';
                }
            }
        });
        lastChannelUpdateTime = currentTime;
    }
    
    // 更新波形显示（实时，使用滤波后的 data_display）
    if (waveformDisplay) {
        waveformDisplay.addData(plot);
    }

    // 按头环 sample_number 的收包/丢包统计
    if (message.packet_stats) {
        updatePacketStatsUi(message.packet_stats);
    }
    if (message.battery) {
        updateBatteryUi(message.battery);
    }
}

let _batteryRefreshTimers = [];
function scheduleBatteryRefresh() {
    _batteryRefreshTimers.forEach((t) => clearTimeout(t));
    _batteryRefreshTimers = [800, 2500, 8000].map((ms) =>
        setTimeout(async () => {
            try {
                const response = await fetch(`${API_BASE}/status`);
                const data = await response.json();
                if (data.success && data.status) {
                    updateBatteryUi(data.status.battery || (data.status.device_info && data.status.device_info.battery));
                }
            } catch (_) { /* ignore */ }
        }, ms)
    );
}

// 保存配置
function saveConfig() {
    const nameEl = document.getElementById('ble-device-name');
    const addrEl = document.getElementById('ble-address');
    const config = {
        ble: {
            deviceName: nameEl ? nameEl.value : 'SEEKBCI',
            address: addrEl ? addrEl.value : ''
        }
    };
    localStorage.setItem('device_config', JSON.stringify(config));
}

// 加载保存的配置
function loadSavedConfig() {
    const saved = localStorage.getItem('device_config');
    if (!saved) return;
    try {
        const config = JSON.parse(saved);
        if (config.ble) {
            const nameEl = document.getElementById('ble-device-name');
            const addrEl = document.getElementById('ble-address');
            if (nameEl) nameEl.value = config.ble.deviceName || 'SEEKBCI';
            if (addrEl) addrEl.value = config.ble.address || '';
        }
    } catch (error) {
        console.error('加载配置失败:', error);
    }
}

// 监听输入变化，自动保存
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('form-input') || e.target.classList.contains('form-select')) {
        saveConfig();
    }
});

async function loadLatestFirmwareManifest() {
    const statusEl = document.getElementById('ota-status');
    const urlEl = document.getElementById('ota-firmware-url');
    const manifestUrl = `${window.location.origin}/firmware/seekbci/manifest.json`;
    try {
        setOtaStatus(`正在检查云端固件：${manifestUrl}`);
        const response = await fetch(manifestUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const manifest = await response.json();
        if (!manifest || !manifest.url) throw new Error('manifest 缺少 url 字段');
        urlEl.value = new URL(manifest.url, manifestUrl).toString();
        const version = manifest.version ? `版本 ${manifest.version}` : '发现固件';
        setOtaStatus(`${version}，已填入固件 URL。点击“开始 BLE OTA”升级。`);
    } catch (error) {
        const fallback = '未找到云端 manifest。当前可手动选择 .bin，或在 /firmware/seekbci/manifest.json 提供 {"version":"...","url":"...bin"}。';
        if (statusEl) statusEl.textContent = `${fallback} 错误：${error.message || error}`;
    }
}

function setOtaStatus(message, percent) {
    const statusEl = document.getElementById('ota-status');
    const barEl = document.getElementById('ota-progress-bar');
    if (statusEl) statusEl.textContent = message;
    if (barEl && percent != null) {
        const p = Math.max(0, Math.min(100, Number(percent) || 0));
        barEl.style.width = `${p}%`;
    }
}

async function resolveOtaFirmwareBlob() {
    const fileEl = document.getElementById('ota-firmware-file');
    if (fileEl && fileEl.files && fileEl.files[0]) {
        return {
            blob: fileEl.files[0],
            name: fileEl.files[0].name,
            source: 'file'
        };
    }

    const url = (document.getElementById('ota-firmware-url')?.value || '').trim();
    if (!url) {
        throw new Error('请先选择 .bin 固件文件，或填写云端固件 URL');
    }
    setOtaStatus('正在下载云端固件…', 0);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`下载固件失败 HTTP ${response.status}`);
    const blob = await response.blob();
    return {
        blob,
        name: url.split('/').pop() || 'SEEKBCI.bin',
        source: 'url'
    };
}

function decodeOtaStatus(event) {
    const value = event.target.value;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)).trim();
    if (!text.startsWith('OTA:')) return;
    const parts = text.split(':');
    const kind = parts[1] || '';
    const detail = parts.slice(2).join(':');
    if (kind === 'PROGRESS') {
        setOtaStatus(`设备写入中：${detail}%`, Number(detail));
    } else if (kind === 'READY') {
        setOtaStatus(`设备已进入 OTA，固件大小 ${detail} 字节。`, 0);
    } else if (kind === 'DONE') {
        setOtaStatus('OTA 完成，设备正在重启。', 100);
    } else if (kind === 'ERROR') {
        setOtaStatus(`设备返回 OTA 错误：${detail || 'unknown'}`);
    }
}

async function releaseCurrentBleConnectionForOta() {
    const connected = !!(window.globalDeviceManager && window.globalDeviceManager.isConnected);
    if (!connected) return;

    setOtaStatus('检测到当前采集连接，正在断开并准备进入 OTA…', 0);
    try {
        await window.globalDeviceManager.disconnectDevice();
    } catch (_) {
        try {
            await fetch(`${API_BASE}/disconnect`, { method: 'POST' });
        } catch (_2) { /* ignore */ }
    }

    localStorage.removeItem('deviceState');
    window.globalDeviceManager.isConnected = false;
    window.globalDeviceManager.deviceInfo = null;
    onDisconnected();
    await new Promise((resolve) => setTimeout(resolve, 4000));
}

async function connectSeekbciOtaGatt(device, protocol) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            setOtaStatus(`正在连接设备…（第 ${attempt}/3 次）`, 0);
            if (device.gatt && device.gatt.connected) {
                try {
                    device.gatt.disconnect();
                } catch (_) { /* ignore */ }
                await new Promise((resolve) => setTimeout(resolve, 800));
            }

            const server = await device.gatt.connect();
            await new Promise((resolve) => setTimeout(resolve, 900));
            if (!device.gatt.connected) {
                throw new Error('GATT 连接建立后立即断开');
            }

            const service = await server.getPrimaryService(protocol.serviceUuid);
            const notifyChar = await service.getCharacteristic(protocol.notifyCharUuid);
            const otaChar = await service.getCharacteristic(protocol.otaCharUuid);
            return { server, notifyChar, otaChar };
        } catch (error) {
            lastError = error;
            const message = error && error.message ? error.message : String(error);
            setOtaStatus(`GATT 连接失败：${message}，准备重试…`);
            try {
                if (device.gatt && device.gatt.connected) device.gatt.disconnect();
            } catch (_) { /* ignore */ }
            await new Promise((resolve) => setTimeout(resolve, 1800 + attempt * 900));
        }
    }
    throw lastError || new Error('GATT 连接失败');
}

async function startSeekbciOta() {
    if (!confirm('确认开始 SEEKBCI BLE OTA？\n\n升级期间请保持供电、不要关闭页面。')) {
        return;
    }

    try {
        await startSeekbciBackendOta();
    } catch (error) {
        console.error('SEEKBCI backend OTA failed:', error);
        const msg = error && error.message ? error.message : String(error);
        setOtaStatus(`OTA 失败：${msg}`);
        alert(`OTA 失败：${msg}`);
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

async function pollSeekbciOtaProgress(origin, taskId) {
    while (true) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const response = await fetch(`${origin}/api/devices/ota/ble/${encodeURIComponent(taskId)}?t=${Date.now()}`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            let detail = data.detail || `HTTP ${response.status}`;
            if (typeof detail !== 'string') detail = JSON.stringify(detail);
            throw new Error(detail);
        }
        const backendPercent = Math.max(0, Math.min(100, Number(data.percent || 0)));
        const uiPercent = data.state === 'done' ? 100 : Math.max(10, Math.min(99, 10 + backendPercent * 0.89));
        const message = data.message || 'OTA 进行中…';
        setOtaStatus(`${message}（${backendPercent}%）`, uiPercent);
        if (data.state === 'done') {
            setOtaStatus(message || 'OTA 完成，设备正在重启。', 100);
            return data;
        }
        if (data.state === 'error') {
            throw new Error(data.error || message || 'OTA 失败');
        }
    }
}

function postSeekbciOtaTask(origin, payload) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${origin}/api/devices/ota/ble`, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.responseType = 'json';
        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) {
                setOtaStatus('正在上传固件到本地后端…', 5);
                return;
            }
            const uploadPercent = Math.floor((event.loaded * 100) / event.total);
            const uiPercent = Math.max(1, Math.min(10, uploadPercent / 10));
            setOtaStatus(`正在上传固件到本地后端：${uploadPercent}%`, uiPercent);
        };
        xhr.onload = () => {
            const data = xhr.response || (() => {
                try { return JSON.parse(xhr.responseText || '{}'); } catch (_) { return {}; }
            })();
            if (xhr.status < 200 || xhr.status >= 300 || !data.success) {
                let detail = data.detail || data.message || `HTTP ${xhr.status}`;
                if (typeof detail !== 'string') detail = JSON.stringify(detail);
                reject(new Error(detail));
                return;
            }
            resolve(data);
        };
        xhr.onerror = () => reject(new Error('OTA 请求发送失败'));
        xhr.ontimeout = () => reject(new Error('OTA 请求超时'));
        xhr.timeout = 30000;
        xhr.send(JSON.stringify(payload));
    });
}

async function startSeekbciBackendOta() {
    const firmware = await resolveOtaFirmwareBlob();
    const deviceName = (document.getElementById('ble-device-name')?.value || 'SEEKBCI').trim() || 'SEEKBCI';
    const address = (document.getElementById('ble-address')?.value || '').trim();

    setOtaStatus('正在准备后端 Bleak OTA…', 0);
    if (window.globalDeviceManager && window.globalDeviceManager.isConnected) {
        window.globalDeviceManager.isConnected = false;
        window.globalDeviceManager.deviceInfo = null;
        localStorage.removeItem('deviceState');
        try { onDisconnected(); } catch (_) { /* ignore */ }
    }

    setOtaStatus('正在读取固件文件…', 0);
    const firmwareBuffer = await firmware.blob.arrayBuffer();
    setOtaStatus('正在编码固件，准备上传到本地后端…', 1);
    const payload = {
        filename: firmware.name || 'SEEKBCI.bin',
        firmware_b64: arrayBufferToBase64(firmwareBuffer),
        device_name: deviceName,
        address: address || null,
        timeout: 24
    };

    const origin =
        typeof window.ssvepResolveApiOrigin === 'function'
            ? window.ssvepResolveApiOrigin()
            : window.globalDeviceManager?.apiOrigin || 'http://127.0.0.1:8000';

    setOtaStatus('正在上传固件到本地后端…', 1);
    const data = await postSeekbciOtaTask(origin, payload);
    if (!data.task_id) {
        throw new Error('后端未返回 OTA task_id');
    }
    setOtaStatus(data.message || 'OTA 已启动，正在等待进度…', Number(data.percent || 0));
    const finalState = await pollSeekbciOtaProgress(origin, data.task_id);
    alert(finalState.message || 'OTA 完成，设备正在重启。');
}

async function startSeekbciWebBluetoothOta() {
    if (!navigator.bluetooth) {
        alert('当前环境不支持 Web Bluetooth。请使用 Chrome/Edge 或支持 BLE 的 Electron 客户端。');
        return;
    }
    if (!confirm('确认开始 SEEKBCI BLE OTA？\n\n升级期间请保持供电、不要关闭页面。')) {
        return;
    }

    const protocol = window.SSVEP_IMU_PROTOCOL && window.SSVEP_IMU_PROTOCOL.PROTOCOL;
    if (!protocol || !protocol.serviceUuid || !protocol.notifyCharUuid || !protocol.otaCharUuid) {
        alert('缺少 SEEKBCI BLE OTA 协议常量，请刷新页面后重试。');
        return;
    }

    let device;
    let notifyChar;
    try {
        setOtaStatus('请选择要升级的 SEEKBCI 设备…', 0);
        device = await navigator.bluetooth.requestDevice({
            filters: [
                { name: protocol.deviceName },
                { services: [protocol.serviceUuid] }
            ],
            optionalServices: [protocol.serviceUuid]
        });

        await releaseCurrentBleConnectionForOta();
        const firmware = await resolveOtaFirmwareBlob();
        const firmwareBytes = new Uint8Array(await firmware.blob.arrayBuffer());
        if (!firmwareBytes.length) throw new Error('固件为空');

        setOtaStatus(`已选择设备 ${device.name || 'SEEKBCI'}，固件：${firmware.name}`, 0);

        const { notifyChar: connectedNotifyChar, otaChar } = await connectSeekbciOtaGatt(device, protocol);
        notifyChar = connectedNotifyChar;
        await notifyChar.startNotifications();
        notifyChar.addEventListener('characteristicvaluechanged', decodeOtaStatus);

        const chunkSize = 480;
        const encoder = new TextEncoder();
        await otaChar.writeValueWithResponse(encoder.encode(`OTA:BEGIN:${firmwareBytes.length}:`));
        await new Promise((resolve) => setTimeout(resolve, 350));

        for (let offset = 0; offset < firmwareBytes.length; offset += chunkSize) {
            const chunk = firmwareBytes.slice(offset, Math.min(offset + chunkSize, firmwareBytes.length));
            await otaChar.writeValueWithResponse(chunk);
            const percent = Math.floor((chunk.byteLength + offset) * 100 / firmwareBytes.length);
            setOtaStatus(`正在发送固件：${percent}%`, percent);
            await new Promise((resolve) => setTimeout(resolve, 8));
        }

        await otaChar.writeValueWithResponse(encoder.encode('OTA:END'));
        setOtaStatus('固件已发送完毕，等待设备校验并重启…', 100);
    } catch (error) {
        console.error('SEEKBCI OTA failed:', error);
        const rawMessage = error && error.message ? error.message : String(error);
        const friendlyMessage = /user cancelled|user canceled|cancelled|canceled|no device selected|notfounderror/i.test(rawMessage)
            ? '未选择 BLE 设备或 Electron 蓝牙选择器超时。请确认 SEEKBCI 已上电并处于广播状态，然后重新点击“开始 BLE OTA”。如果使用桌面客户端，请重启客户端以加载最新蓝牙选择逻辑。'
            : /gatt server is disconnected|cannot retrieve services|gatt.*disconnect/i.test(rawMessage)
              ? 'BLE GATT 刚连接就断开。通常是设备刚从采集连接释放、仍被系统蓝牙/其它程序占用，或信号不稳。请断开实时采集后等待 5 秒，必要时重启头环，再直接开始 OTA。'
              : rawMessage;
        setOtaStatus(`OTA 失败：${friendlyMessage}`);
        alert(`OTA 失败：${friendlyMessage}`);
    } finally {
        if (notifyChar) {
            try {
                notifyChar.removeEventListener('characteristicvaluechanged', decodeOtaStatus);
                await notifyChar.stopNotifications();
            } catch (_) { /* ignore */ }
        }
        try {
            if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
        } catch (_) { /* ignore */ }
    }
}

// 清除设备状态（用于调试）
function clearDeviceState() {
    if (confirm('确定要清除所有设备状态吗？\n\n这将：\n- 清除本地存储的连接状态\n- 断开当前连接\n- 刷新页面')) {
        // 清除本地存储
        localStorage.removeItem('deviceState');
        
        // 断开设备
        fetch(`${API_BASE}/disconnect`, { method: 'POST' })
            .then(() => {
                alert('设备状态已清除');
                // 刷新页面
                window.location.reload();
            })
            .catch(err => {
                console.error('断开设备失败:', err);
                alert('设备状态已清除（本地）');
                window.location.reload();
            });
    }
}
