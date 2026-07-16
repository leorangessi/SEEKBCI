/**
 * IMU 连接客户端：
 * 1) 优先本机后端 Bleak（与参考 Python 客户端相同，Windows 更稳）
 * 2) 回退 Web Bluetooth（Electron 需正确处理 select-bluetooth-device）
 */
(function (global) {
    const proto = global.SSVEP_IMU_PROTOCOL;
    if (!proto) {
        console.error('imu-ble-client: load imu-protocol.js first');
        return;
    }

    const { PROTOCOL, decodePayload } = proto;

    function resolveApiOrigin() {
        if (typeof global.ssvepResolveApiOrigin === 'function') {
            return global.ssvepResolveApiOrigin();
        }
        return global.SSVEP_API_ORIGIN || 'http://127.0.0.1:8765';
    }

    function toWsUrl(origin, path) {
        if (typeof global.ssvepOriginToWebSocketUrl === 'function') {
            return global.ssvepOriginToWebSocketUrl(origin, path);
        }
        const u = new URL(origin);
        u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
        u.pathname = path;
        u.search = '';
        u.hash = '';
        return u.toString();
    }

    class ImuBackendClient {
        constructor() {
            this.status = 'disconnected';
            this.lastRaw = '';
            this.lastError = '';
            this.onSample = null;
            this.onStatus = null;
            this.onError = null;
            this._ws = null;
            this.transport = 'backend';
        }

        _setStatus(status, detail) {
            this.status = status;
            if (typeof this.onStatus === 'function') {
                this.onStatus(status, detail || '');
            }
        }

        async connect(deviceName) {
            const origin = resolveApiOrigin();
            this._setStatus('scanning', `后端扫描 ${deviceName || PROTOCOL.deviceName}…`);

            const statusRes = await fetch(`${origin}/api/imu/status`);
            if (!statusRes.ok) {
                throw new Error(`无法访问 /api/imu/status（HTTP ${statusRes.status}），请重启 Electron`);
            }
            const statusJson = await statusRes.json();
            if (!statusJson.available) {
                throw new Error(
                    statusJson.availability_detail ||
                        '后端未安装 bleak。请执行: py -3.9 -m pip install bleak'
                );
            }

            const res = await fetch(`${origin}/api/imu/connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_name: deviceName || PROTOCOL.deviceName,
                    timeout: 12
                })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                const detail = body.detail;
                let msg = `连接失败 HTTP ${res.status}`;
                if (typeof detail === 'string') msg = detail;
                else if (Array.isArray(detail)) msg = detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
                throw new Error(msg);
            }

            await this._openSocket(origin);
            this._setStatus('connected', (body && body.detail) || PROTOCOL.deviceName);
        }

        async _openSocket(origin) {
            if (this._ws) {
                try {
                    this._ws.close();
                } catch (_) { /* ignore */ }
                this._ws = null;
            }
            const wsUrl = toWsUrl(origin, '/api/imu/stream');
            await new Promise((resolve, reject) => {
                const ws = new WebSocket(wsUrl);
                this._ws = ws;
                const timer = setTimeout(() => {
                    reject(new Error('WebSocket 连接超时'));
                    try {
                        ws.close();
                    } catch (_) { /* ignore */ }
                }, 8000);
                ws.onopen = () => {
                    clearTimeout(timer);
                    resolve();
                };
                ws.onerror = () => {
                    clearTimeout(timer);
                    reject(new Error('WebSocket 连接失败'));
                };
                ws.onmessage = (ev) => {
                    let msg;
                    try {
                        msg = JSON.parse(ev.data);
                    } catch (_) {
                        return;
                    }
                    if (msg.type === 'imu' && msg.kind === 'sample') {
                        this.lastRaw = msg.raw || '';
                        if (typeof this.onSample === 'function') this.onSample(msg);
                    } else if (msg.type === 'imu' && msg.kind === 'error') {
                        this.lastError = msg.raw || '';
                        if (typeof this.onError === 'function') this.onError(msg);
                    } else if (msg.type === 'status' || msg.type === 'hello' || msg.type === 'ping') {
                        if (msg.status && msg.status !== this.status) {
                            this._setStatus(msg.status, msg.detail || '');
                        }
                    }
                };
                ws.onclose = () => {
                    if (this.status === 'connected') {
                        this._setStatus('disconnected', '数据通道关闭');
                    }
                };
            });
        }

        async disconnect() {
            try {
                if (this._ws) {
                    this._ws.close();
                    this._ws = null;
                }
            } catch (_) { /* ignore */ }
            try {
                await fetch(`${resolveApiOrigin()}/api/imu/disconnect`, { method: 'POST' });
            } catch (_) { /* ignore */ }
            this._setStatus('disconnected', '已断开');
        }
    }

    class ImuBleClient {
        constructor() {
            this.device = null;
            this.server = null;
            this.characteristic = null;
            this.status = 'disconnected';
            this.lastRaw = '';
            this.lastError = '';
            this.onSample = null;
            this.onStatus = null;
            this.onError = null;
            this.transport = 'web-bluetooth';
            this._boundNotify = this._onNotify.bind(this);
        }

        _setStatus(status, detail) {
            this.status = status;
            if (typeof this.onStatus === 'function') {
                this.onStatus(status, detail || '');
            }
        }

        static isSupported() {
            return typeof navigator !== 'undefined' && !!navigator.bluetooth;
        }

        async connect() {
            if (!ImuBleClient.isSupported()) {
                throw new Error('当前环境不支持 Web Bluetooth');
            }
            this._setStatus('requesting', 'Web Bluetooth 选择设备…（最多约 20 秒）');
            let device;
            try {
                device = await navigator.bluetooth.requestDevice({
                    filters: [
                        { name: PROTOCOL.deviceName },
                        { namePrefix: 'ESP32_BMI270' },
                        { namePrefix: 'ESP32' },
                        { services: [PROTOCOL.serviceUuid] }
                    ],
                    optionalServices: [PROTOCOL.serviceUuid]
                });
            } catch (err) {
                // 名称过滤过严时再尝试 acceptAllDevices
                if (err && /not found|no.*device|cancel/i.test(String(err.message || err))) {
                    this._setStatus('requesting', '放宽过滤重试…');
                    device = await navigator.bluetooth.requestDevice({
                        acceptAllDevices: true,
                        optionalServices: [PROTOCOL.serviceUuid]
                    });
                } else {
                    throw err;
                }
            }
            this.device = device;
            device.addEventListener('gattserverdisconnected', () => {
                this.characteristic = null;
                this.server = null;
                this._setStatus('disconnected', 'GATT 断开');
            });

            this._setStatus('connecting', device.name || PROTOCOL.deviceName);
            const server = await device.gatt.connect();
            this.server = server;
            const service = await server.getPrimaryService(PROTOCOL.serviceUuid);
            const characteristic = await service.getCharacteristic(PROTOCOL.notifyCharUuid);
            this.characteristic = characteristic;
            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', this._boundNotify);
            this._setStatus('connected', device.name || PROTOCOL.deviceName);
        }

        async disconnect() {
            try {
                if (this.characteristic) {
                    this.characteristic.removeEventListener('characteristicvaluechanged', this._boundNotify);
                    try {
                        await this.characteristic.stopNotifications();
                    } catch (_) { /* ignore */ }
                }
            } finally {
                try {
                    if (this.device && this.device.gatt && this.device.gatt.connected) {
                        this.device.gatt.disconnect();
                    }
                } catch (_) { /* ignore */ }
                this.characteristic = null;
                this.server = null;
                this._setStatus('disconnected', '已断开');
            }
        }

        _onNotify(event) {
            const value = event.target.value;
            const decoded = decodePayload(value);
            if (decoded.kind === 'sample') {
                this.lastRaw = decoded.raw;
                if (typeof this.onSample === 'function') this.onSample(decoded);
                return;
            }
            if (decoded.kind === 'error') {
                this.lastError = decoded.raw;
                if (typeof this.onError === 'function') this.onError(decoded);
            }
        }
    }

    /**
     * 统一外壳：默认走后端 Bleak；可在失败时手动再试 WebBT（测试页按钮）。
     */
    class ImuClient {
        constructor() {
            this.backend = new ImuBackendClient();
            this.web = new ImuBleClient();
            this.active = this.backend;
            this.onSample = null;
            this.onStatus = null;
            this.onError = null;
            this._wire(this.backend);
            this._wire(this.web);
        }

        _wire(c) {
            c.onSample = (s) => {
                if (typeof this.onSample === 'function') this.onSample(s);
            };
            c.onStatus = (st, d) => {
                if (typeof this.onStatus === 'function') this.onStatus(st, d);
            };
            c.onError = (e) => {
                if (typeof this.onError === 'function') this.onError(e);
            };
        }

        get status() {
            return this.active.status;
        }

        get lastRaw() {
            return this.active.lastRaw;
        }

        get lastError() {
            return this.active.lastError;
        }

        get transport() {
            return this.active.transport;
        }

        async connect(prefer) {
            const mode = prefer || 'backend';
            if (mode === 'web') {
                this.active = this.web;
                await this.web.connect();
                return;
            }
            this.active = this.backend;
            await this.backend.connect();
        }

        async disconnect() {
            await this.active.disconnect();
        }
    }

    global.SSVEP_IMU_BLE = {
        ImuBleClient,
        ImuBackendClient,
        ImuClient,
        PROTOCOL
    };
})(typeof window !== 'undefined' ? window : globalThis);
