/**
 * 共享 IMU 采样：光标映射与倾斜行走共用一条后端连接。
 */
(function (global) {
    class ImuSampleHub {
        constructor() {
            this.client = null;
            this._refCount = 0;
            this._listeners = new Set();
            this._connecting = null;
            this._onSample = (sample) => {
                for (const fn of this._listeners) {
                    try {
                        fn(sample);
                    } catch (e) {
                        console.warn('[ImuSampleHub] listener error', e);
                    }
                }
            };
        }

        subscribe(fn) {
            if (typeof fn === 'function') this._listeners.add(fn);
            return () => this.unsubscribe(fn);
        }

        unsubscribe(fn) {
            this._listeners.delete(fn);
        }

        async acquire() {
            this._refCount += 1;
            if (this.client) return { ok: true, detail: '已复用 IMU 连接' };

            if (this._connecting) {
                await this._connecting;
                return { ok: true, detail: '已复用 IMU 连接' };
            }

            const ImuClient = global.SSVEP_IMU_BLE && global.SSVEP_IMU_BLE.ImuClient;
            if (!ImuClient) {
                this._refCount = Math.max(0, this._refCount - 1);
                return { ok: false, detail: '缺少 IMU 客户端脚本' };
            }

            this._connecting = (async () => {
                const client = new ImuClient();
                client.onSample = this._onSample;
                await client.connect('backend');
                this.client = client;
            })();

            try {
                await this._connecting;
                return { ok: true, detail: 'IMU 已连接' };
            } catch (e) {
                this._refCount = Math.max(0, this._refCount - 1);
                this.client = null;
                return { ok: false, detail: 'IMU 连接失败：' + (e.message || e) };
            } finally {
                this._connecting = null;
            }
        }

        async release() {
            this._refCount = Math.max(0, this._refCount - 1);
            if (this._refCount > 0) return;
            if (!this.client) return;
            try {
                this.client.onSample = null;
                await this.client.disconnect().catch(() => {});
            } catch (_) {
                /* ignore */
            }
            this.client = null;
        }
    }

    global.SSVEP_IMU_SAMPLE_HUB = {
        ImuSampleHub,
        shared: new ImuSampleHub()
    };
})(typeof window !== 'undefined' ? window : globalThis);
