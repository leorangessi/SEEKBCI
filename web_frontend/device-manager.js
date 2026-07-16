// 设备管理 JavaScript - 集成全局状态管理和波形显示

// 全局变量
let currentTab = 'lsl';
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

    // 加载保存的配置
    loadSavedConfig();
    initDeviceChannelMatrixUi();
    initWaveformAutoToggle();

    // 监听全局设备管理器事件
    window.globalDeviceManager.addEventListener(handleDeviceEvent);

    // 检查是否已经连接
    checkAndRestoreConnection();
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

// 切换标签
function switchTab(tab) {
    currentTab = tab;
    
    // 更新标签样式
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    // 切换内容
    document.querySelectorAll('.connection-content').forEach(c => c.style.display = 'none');
    document.getElementById(`${tab}-content`).style.display = 'block';
    
    // 清空设备列表
    document.getElementById('device-list').innerHTML = `
        <div class="info-text" style="text-align: center; padding: 20px; color: #666;">
            ${tab === 'serial' || tab === 'brainflow'
                ? '正在扫描串口…'
                : '点击对应标签页的「扫描」按钮查找设备'}
        </div>
    `;

    // 串口 / BrainFlow：进入页面即扫描，避免下拉框长期只有占位项
    if (tab === 'serial' || tab === 'brainflow') {
        scanSerial();
    }
}

/** 优先使用手动输入的端口（与下拉框互补） */
function getChosenRawSerialPort() {
    const manual = document.getElementById('serial-port-manual').value.trim();
    if (manual) return manual;
    return document.getElementById('serial-port').value;
}

function getChosenBrainflowSerialPort() {
    const manual = document.getElementById('brainflow-port-manual').value.trim();
    if (manual) return manual;
    return document.getElementById('brainflow-port').value;
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

// LSL连接
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

// 串口连接
async function connectSerial() {
    const port = getChosenRawSerialPort();
    const baudrate = document.getElementById('serial-baudrate').value;
    
    if (!port) {
        alert('请选择串口，或在「或手动输入端口」中填写 COM 号');
        return;
    }
    
    const success = await window.globalDeviceManager.connectDevice('serial', {
        port: port,
        baudrate: parseInt(baudrate)
    });
    
    if (success) {
        alert('✅ 串口设备连接成功！');
    } else {
        alert('❌ 连接失败\n\n请确保串口未被占用');
    }
}

// BrainFlow连接
async function connectBrainFlow() {
    const boardId = parseInt(document.getElementById('brainflow-board').value);
    const serialPort = getChosenBrainflowSerialPort();
    
    const params = { board_id: boardId };
    if (serialPort) {
        params.serial_port = serialPort;
    }
    
    const success = await window.globalDeviceManager.connectDevice('brainflow', params);
    
    if (success) {
        alert('✅ BrainFlow设备连接成功！');
    } else {
        alert('❌ 连接失败\n\n请检查设备连接和串口设置');
    }
}

// WiFi连接
async function connectWiFi() {
    const ip = document.getElementById('wifi-ip').value;
    const port = document.getElementById('wifi-port').value;
    const protocol = document.getElementById('wifi-protocol').value;
    
    if (!ip || !port) {
        alert('请输入IP地址和端口');
        return;
    }
    
    const success = await window.globalDeviceManager.connectDevice('wifi', {
        ip: ip,
        port: parseInt(port),
        protocol: protocol
    });
    
    if (success) {
        alert('✅ WiFi设备连接成功！');
    } else {
        alert('❌ 连接失败\n\n请检查网络连接');
    }
}

// WiFi测试
async function testWiFi() {
    const ip = document.getElementById('wifi-ip').value;
    const port = document.getElementById('wifi-port').value;
    const protocol = document.getElementById('wifi-protocol').value;
    
    if (!ip || !port) {
        alert('请输入IP地址和端口');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/test/wifi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ip, port: parseInt(port), protocol })
        });
        
        const result = await response.json();
        
        if (result.success && result.reachable) {
            alert('✅ 连接测试成功！');
        } else {
            alert('❌ 连接测试失败\n\n' + result.message);
        }
    } catch (error) {
        alert('❌ 测试失败\n\n' + error.message);
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
    
    // 重置计数
    packetCount = 0;
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
    } else {
        dot.classList.remove('status-connected');
        dot.classList.add('status-disconnected');
        statusText.textContent = '已断开';
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
    
    // 更新数据包计数
    packetCount++;
    document.getElementById('packet-count').textContent = packetCount;
}

// 保存配置
function saveConfig() {
    const config = {
        lsl: {
            streamName: document.getElementById('lsl-stream-name').value,
            streamType: document.getElementById('lsl-stream-type').value
        },
        serial: {
            port: document.getElementById('serial-port').value,
            portManual: document.getElementById('serial-port-manual').value,
            baudrate: document.getElementById('serial-baudrate').value
        },
        brainflow: {
            boardId: document.getElementById('brainflow-board').value,
            port: document.getElementById('brainflow-port').value,
            portManual: document.getElementById('brainflow-port-manual').value
        },
        wifi: {
            ip: document.getElementById('wifi-ip').value,
            port: document.getElementById('wifi-port').value,
            protocol: document.getElementById('wifi-protocol').value
        }
    };
    
    localStorage.setItem('device_config', JSON.stringify(config));
}

// 加载保存的配置
function loadSavedConfig() {
    const saved = localStorage.getItem('device_config');
    if (saved) {
        try {
            const config = JSON.parse(saved);
            
            if (config.lsl) {
                document.getElementById('lsl-stream-name').value = config.lsl.streamName || '';
                document.getElementById('lsl-stream-type').value = config.lsl.streamType || 'EEG';
            }
            
            if (config.serial) {
                document.getElementById('serial-port').value = config.serial.port || '';
                document.getElementById('serial-port-manual').value = config.serial.portManual || '';
                document.getElementById('serial-baudrate').value = config.serial.baudrate || '115200';
            }
            
            if (config.brainflow) {
                document.getElementById('brainflow-board').value = config.brainflow.boardId || '-1';
                document.getElementById('brainflow-port').value = config.brainflow.port || '';
                document.getElementById('brainflow-port-manual').value = config.brainflow.portManual || '';
            }
            
            if (config.wifi) {
                document.getElementById('wifi-ip').value = config.wifi.ip || '192.168.4.1';
                document.getElementById('wifi-port').value = config.wifi.port || '12345';
                document.getElementById('wifi-protocol').value = config.wifi.protocol || 'udp';
            }
        } catch (error) {
            console.error('加载配置失败:', error);
        }
    }
}

// 监听输入变化，自动保存
document.addEventListener('input', (e) => {
    if (e.target.classList.contains('form-input') || e.target.classList.contains('form-select')) {
        saveConfig();
    }
});

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
