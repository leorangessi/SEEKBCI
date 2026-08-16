/**
 * 全局设备状态管理
 * 跨页面保持设备连接状态
 */

/**
 * 未设置 SSVEP_API_ORIGIN 时推断 API 根地址：
 * - 默认端口 28765（避免与常见 8000 冲突）
 * - http(s) 与 API 同端口提供 /ui 时 → 使用当前页面同源（含端口）
 * - file:// → 读 localStorage 或默认 28765；启动后 discover 可自动纠正
 */
const SEEKBCi_DEFAULT_API_PORT = 28765;
const SEEKBCi_LEGACY_API_PORT = 8000;
const SEEKBCi_API_ORIGIN_KEY = 'seekbci_api_origin';
const SEEKBCi_API_PORT_KEY = 'seekbci_api_port';

function seekbciDefaultApiOrigin(port) {
    const p = port != null ? port : SEEKBCi_DEFAULT_API_PORT;
    return `http://127.0.0.1:${p}`;
}

function persistSeekbciApiOrigin(origin) {
    if (!origin || typeof origin !== 'string') return;
    const o = origin.trim().replace(/\/$/, '');
    try {
        localStorage.setItem(SEEKBCi_API_ORIGIN_KEY, o);
        const u = new URL(o);
        if (u.port) localStorage.setItem(SEEKBCi_API_PORT_KEY, u.port);
    } catch (_) {
        localStorage.setItem(SEEKBCi_API_ORIGIN_KEY, o);
    }
}

function readStoredSeekbciApiOrigin() {
    try {
        const o = localStorage.getItem(SEEKBCi_API_ORIGIN_KEY);
        if (o && o.trim()) return o.trim().replace(/\/$/, '');
        const p = localStorage.getItem(SEEKBCi_API_PORT_KEY);
        if (p && /^\d+$/.test(p)) return seekbciDefaultApiOrigin(parseInt(p, 10));
    } catch (_) {
        /* ignore */
    }
    return null;
}

function inferSsvepApiOrigin() {
    try {
        if (typeof window === 'undefined') return seekbciDefaultApiOrigin();
        const loc = window.location;
        if (loc.protocol === 'http:' || loc.protocol === 'https:') {
            let host = loc.hostname || '127.0.0.1';
            if (host === 'localhost' || host === '[::1]' || host === '::1') host = '127.0.0.1';
            if (loc.port) return `${loc.protocol}//${host}:${loc.port}`;
            return `${loc.protocol}//${host}`;
        }
        if (loc.protocol === 'file:') {
            return readStoredSeekbciApiOrigin() || seekbciDefaultApiOrigin();
        }
    } catch (_e) {
        /* use default */
    }
    return seekbciDefaultApiOrigin();
}

async function discoverSeekbciApiOrigin() {
    const candidates = [];
    const seen = new Set();
    const add = (o) => {
        if (!o || seen.has(o)) return;
        seen.add(o);
        candidates.push(o);
    };
    if (typeof window.SSVEP_API_ORIGIN === 'string') {
        add(window.SSVEP_API_ORIGIN.trim().replace(/\/$/, ''));
    }
    add(readStoredSeekbciApiOrigin());
    try {
        const loc = window.location;
        if (loc.protocol === 'http:' || loc.protocol === 'https:') {
            let host = loc.hostname || '127.0.0.1';
            if (host === 'localhost' || host === '[::1]' || host === '::1') host = '127.0.0.1';
            add(loc.port ? `${loc.protocol}//${host}:${loc.port}` : `${loc.protocol}//${host}`);
        }
    } catch (_) {
        /* ignore */
    }
    add(seekbciDefaultApiOrigin(SEEKBCi_DEFAULT_API_PORT));
    add(seekbciDefaultApiOrigin(SEEKBCi_LEGACY_API_PORT));

    for (const origin of candidates) {
        try {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), 900) : null;
            const res = await fetch(`${origin}/health`, {
                cache: 'no-store',
                signal: ctrl ? ctrl.signal : undefined
            });
            if (timer) clearTimeout(timer);
            if (res.ok) {
                persistSeekbciApiOrigin(origin);
                return origin;
            }
        } catch (_) {
            /* try next */
        }
    }
    return inferSsvepApiOrigin();
}

function ssvepResolveApiOrigin() {
    const raw =
        typeof window !== 'undefined' &&
        typeof window.SSVEP_API_ORIGIN === 'string' &&
        window.SSVEP_API_ORIGIN.trim();
    const o =
        typeof raw === 'string' && raw
            ? raw.trim().replace(/\/$/, '')
            : inferSsvepApiOrigin();
    return o;
}

function ssvepOriginToWebSocketUrl(origin, path) {
    const ws =
        /^https:/i.test(origin) ? origin.replace(/^https/i, 'wss') : origin.replace(/^http/i, 'ws');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${ws}${p}`;
}

if (typeof window !== 'undefined') {
    window.SEEKBCi_DEFAULT_API_PORT = SEEKBCi_DEFAULT_API_PORT;
    window.persistSeekbciApiOrigin = persistSeekbciApiOrigin;
    window.discoverSeekbciApiOrigin = discoverSeekbciApiOrigin;
    window.ssvepResolveApiOrigin = ssvepResolveApiOrigin;
    window.ssvepOriginToWebSocketUrl = ssvepOriginToWebSocketUrl;
    window.ssvepGetDevicesApiBase = () => `${ssvepResolveApiOrigin()}/api/devices`;
    window.normalizeDeviceStreamSamples = normalizeDeviceStreamSamples;

    const bootDiscover = () => {
        discoverSeekbciApiOrigin().then((origin) => {
            try {
                document.dispatchEvent(
                    new CustomEvent('seekbci-api-origin-ready', { detail: { origin } })
                );
            } catch (_) {
                /* ignore */
            }
        });
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootDiscover);
    } else {
        bootDiscover();
    }
}

/**
 * WebSocket 负载为 (n_sample × n_channel) 的行列表；若误为 (n_channel × n_time) 则转置。
 */
function normalizeDeviceStreamSamples(message) {
    const rows = message.data;
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const ch = message.channel_count;
    if (
        typeof ch === 'number' &&
        ch > 0 &&
        rows.length === ch &&
        Array.isArray(rows[0]) &&
        rows[0].length > ch * 2
    ) {
        const C = rows.length;
        const T = rows[0].length;
        const out = [];
        for (let t = 0; t < T; t++) {
            const sample = [];
            for (let c = 0; c < C; c++) sample.push(Number(rows[c][t]) || 0);
            out.push(sample);
        }
        return out;
    }
    return rows.map((row) => {
        if (Array.isArray(row)) return row.map((x) => Number(x) || 0);
        return [Number(row) || 0];
    });
}

class GlobalDeviceManager {
    constructor() {
        this.apiOrigin = ssvepResolveApiOrigin();
        this.API_BASE = `${this.apiOrigin}/api/devices`;
        console.log('[SSVEP] API:', this.API_BASE);
        this.ws = null;
        this.isConnected = false;
        this.deviceInfo = null;
        this.listeners = [];
        this.dataBuffer = [];
        /** 带通+去趋势，供 EMG / 波形（对齐 OpenBCI dataProcessingFilteredBuffer） */
        this.dataDisplayBuffer = [];
        this.maxBufferSize = 5000; // 最多保存5秒数据 (250Hz * 5s * 8ch)
        /** @type {number[]|null} 参与 SSVEP/FBCCA 的设备通道（0-based）；null=用前 8 路 */
        this.ssvepChannelIndices = null;
        /** @type {string[]} 每路通道模态角色 */
        this.channelRoles = null;
        /** @type {Record<string, number|null>} 多模态逻辑通道 → 物理通道下标 */
        this.multimodalBindings = null;

        // 从 localStorage 恢复状态
        this.loadState();
        this.loadChannelConfig();
        if (typeof document !== 'undefined') {
            document.addEventListener('DOMContentLoaded', () => this.loadChannelConfig());
        }
        
        // 定期检查设备状态
        this.startStatusCheck();
    }

    _ingestStreamMessage(message) {
        if (!message || message.type !== 'data') return;
        const normalized = normalizeDeviceStreamSamples(message);
        if (!normalized.length) return;
        this.addToBuffer(normalized);

        let normalizedDisplay = [];
        if (Array.isArray(message.data_display) && message.data_display.length) {
            normalizedDisplay = normalizeDeviceStreamSamples({
                ...message,
                data: message.data_display
            });
            if (normalizedDisplay.length) {
                this.addToDisplayBuffer(normalizedDisplay);
            }
        }

        this.notifyListeners('data', {
            ...message,
            data: normalized,
            data_display: normalizedDisplay
        });
    }

    /**
     * 从 localStorage 加载状态
     */
    loadState() {
        try {
            const savedState = localStorage.getItem('deviceState');
            if (savedState) {
                const state = JSON.parse(savedState);
                this.isConnected = state.isConnected || false;
                this.deviceInfo = state.deviceInfo || null;
                
                console.log('Loaded device state:', state);
                // 不在此处自动连 WebSocket：设备未连时 WS 会每秒发「设备未连接」并误触发 disconnected
            }
        } catch (e) {
            console.error('Failed to load device state:', e);
        }
    }
    
    /**
     * 保存状态到 localStorage
     */
    saveState() {
        try {
            const state = {
                isConnected: this.isConnected,
                deviceInfo: this.deviceInfo,
                timestamp: Date.now()
            };
            localStorage.setItem('deviceState', JSON.stringify(state));
        } catch (e) {
            console.error('Failed to save device state:', e);
        }
    }
    
    /**
     * 定期检查设备状态
     */
    startStatusCheck() {
        setInterval(async () => {
            try {
                const response = await fetch(`${this.API_BASE}/status`);
                const data = await response.json();
                
                if (data.success) {
                    const wasConnected = this.isConnected;
                    this.isConnected = data.status.connected;
                    this.deviceInfo = data.status.device_info;
                    
                    // 状态变化时保存并通知
                    if (wasConnected !== this.isConnected) {
                        this.saveState();
                        this.notifyListeners('statusChange', data.status);
                    }
                    
                    // 如果连接但 WebSocket 未连接，重新连接
                    if (this.isConnected && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
                        this.connectWebSocket();
                    }
                }
            } catch (e) {
                console.error('Status check failed:', e);
            }
        }, 1000); // 轮询后端状态（兜底；LSL 断开主要靠 WS status）
    }
    
    /**
     * 连接 WebSocket
     * @param {boolean} [force] 为 true 时先关闭旧连接再建连（LSL/串口连接成功后应强制刷新）
     */
    connectWebSocket(force) {
        if (force && this.ws) {
            const old = this.ws;
            this.ws = null;
            old.onclose = null;
            try {
                old.close();
            } catch (_e) {
                /* ignore */
            }
        } else if (this.ws) {
            const rs = this.ws.readyState;
            if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) {
                return;
            }
            try {
                this.ws.close();
            } catch (_e) {
                /* ignore */
            }
            this.ws = null;
        }

        try {
            const wsUrl = ssvepOriginToWebSocketUrl(this.apiOrigin, '/api/devices/stream');
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected');
                this.notifyListeners('wsConnected');
            };
            
            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                
                if (message.type === 'data') {
                    this._ingestStreamMessage(message);
                } else if (message.type === 'status') {
                    const backendSaysOff = message.connected === false;
                    // 设备尚未连接时的周期性心跳，不应把前端已连接状态清掉
                    const benignIdle =
                        backendSaysOff &&
                        !message.last_error &&
                        message.message === '设备未连接';
                    if (backendSaysOff && !benignIdle) {
                        const wasConnected = this.isConnected;
                        this.isConnected = false;
                        this.deviceInfo = null;
                        if (wasConnected) {
                            this.clearBuffer();
                            this.saveState();
                            this.notifyListeners('statusChange', {
                                connected: false,
                                device_info: {},
                                last_error: message.last_error || message.message || '',
                            });
                            this.notifyListeners('disconnected');
                        }
                    }
                    this.notifyListeners('status', message);
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.notifyListeners('wsError', error);
            };
            
            this.ws.onclose = () => {
                console.log('WebSocket closed');
                this.notifyListeners('wsDisconnected');
                
                // 如果设备仍然连接，尝试重连
                if (this.isConnected) {
                    setTimeout(() => this.connectWebSocket(), 3000);
                }
            };
        } catch (e) {
            console.error('Failed to connect WebSocket:', e);
        }
    }
    
    /**
     * 添加数据到缓冲区
     */
    addToBuffer(data) {
        // data 是 [samples, channels] 的数组
        for (let sample of data) {
            this.dataBuffer.push(sample);
        }
        
        // 限制缓冲区大小
        if (this.dataBuffer.length > this.maxBufferSize) {
            this.dataBuffer = this.dataBuffer.slice(-this.maxBufferSize);
        }
    }

    addToDisplayBuffer(data) {
        for (const sample of data) {
            this.dataDisplayBuffer.push(sample);
        }
        if (this.dataDisplayBuffer.length > this.maxBufferSize) {
            this.dataDisplayBuffer = this.dataDisplayBuffer.slice(-this.maxBufferSize);
        }
    }
    
    /**
     * 获取最近的数据
     */
    getRecentData(duration = 5.0) {
        const samplingRate = this.deviceInfo?.sampling_rate || 250;
        const numSamples = Math.floor(samplingRate * duration);
        
        if (this.dataBuffer.length < numSamples) {
            return this.dataBuffer;
        }
        
        return this.dataBuffer.slice(-numSamples);
    }
    
    /**
     * 清空缓冲区
     */
    clearBuffer() {
        this.dataBuffer = [];
        this.dataDisplayBuffer = [];
    }
    
    /**
     * 添加事件监听器
     */
    addEventListener(callback) {
        this.listeners.push(callback);
    }
    
    /**
     * 移除事件监听器
     */
    removeEventListener(callback) {
        this.listeners = this.listeners.filter(l => l !== callback);
    }
    
    /**
     * 通知所有监听器
     */
    notifyListeners(event, data) {
        for (let listener of this.listeners) {
            try {
                listener(event, data);
            } catch (e) {
                console.error('Listener error:', e);
            }
        }
    }
    
    /**
     * 连接设备
     */
    async connectDevice(type, params) {
        try {
            const response = await fetch(`${this.API_BASE}/connect/${type}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            
            const data = await response.json().catch(() => ({}));
            
            if (response.ok && data.success) {
                this.isConnected = true;
                this.deviceInfo = data.device_info;
                this.saveState();
                this.connectWebSocket(true);
                this.notifyListeners('connected', data);
                return true;
            } else {
                const detail = data.detail || data.message || `HTTP ${response.status}`;
                throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
            }
        } catch (e) {
            console.error('Connect device failed:', e);
            this.notifyListeners('error', e);
            return false;
        }
    }
    
    /**
     * 断开设备
     */
    async disconnectDevice() {
        try {
            const response = await fetch(`${this.API_BASE}/disconnect`, {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.isConnected = false;
                this.deviceInfo = null;
                this.clearBuffer();
                this.saveState();
                
                if (this.ws) {
                    this.ws.close();
                    this.ws = null;
                }
                
                this.notifyListeners('disconnected');
                return true;
            }
        } catch (e) {
            console.error('Disconnect device failed:', e);
            return false;
        }
    }
    
    loadChannelConfig() {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (CFG && typeof CFG.loadFullConfig === 'function') {
            this.applyChannelConfig(CFG.loadFullConfig());
            return;
        }
        this.ssvepChannelIndices = null;
        this.channelRoles = null;
        this.multimodalBindings = null;
    }

    applyChannelConfig(payload) {
        if (!payload) return;
        this.channelRoles = Array.isArray(payload.channelRoles) ? payload.channelRoles.slice() : null;
        this.ssvepChannelIndices =
            payload.ssvepChannelIndices != null ? payload.ssvepChannelIndices : null;
        this.multimodalBindings = payload.multimodalBindings
            ? { ...payload.multimodalBindings }
            : null;
    }

    getChannelRoles() {
        return this.channelRoles;
    }

    getMultimodalBindings() {
        return this.multimodalBindings;
    }

    getSsvepChannelIndices() {
        return this.ssvepChannelIndices;
    }

    setChannelRoles(roles) {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (!CFG || typeof CFG.saveFullConfig !== 'function') return null;
        const saved = CFG.saveFullConfig({ channelRoles: roles });
        this.applyChannelConfig(saved);
        return saved;
    }

    /** @deprecated 兼容旧 API */
    setSsvepChannelIndices(indices) {
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (!CFG) return;
        const roles = CFG.defaultRoles ? CFG.defaultRoles() : Array(8).fill('ssvep');
        for (let i = 0; i < roles.length; i++) roles[i] = 'disabled';
        if (Array.isArray(indices)) {
            for (const x of indices) {
                const i = parseInt(String(x), 10);
                if (Number.isFinite(i) && i >= 0 && i < roles.length) roles[i] = 'ssvep';
            }
        }
        if (!indices || indices.length === 0) {
            for (let i = 0; i < roles.length; i++) roles[i] = 'ssvep';
        }
        this.setChannelRoles(roles);
    }

    /**
     * 获取设备状态
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            deviceInfo: this.deviceInfo,
            bufferSize: this.dataBuffer.length,
            displayBufferSize: this.dataDisplayBuffer.length,
            wsConnected: this.ws && this.ws.readyState === WebSocket.OPEN,
            ssvepChannelIndices: this.ssvepChannelIndices,
            channelRoles: this.channelRoles,
            multimodalBindings: this.multimodalBindings
        };
    }
}

// 创建全局实例
window.globalDeviceManager = new GlobalDeviceManager();

console.log('Global Device Manager initialized');
