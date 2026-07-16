/**
 * IMU 三维地球：真实贴图（白天/夜灯/云层/高光）+ 科幻轨道 HUD
 */
(function (global) {
    const ASSET_BASE = 'assets/earth/';
    const ASSETS = {
        day: ASSET_BASE + 'earth_day.jpg',
        night: ASSET_BASE + 'earth_night.jpg',
        clouds: ASSET_BASE + 'earth_clouds.jpg',
        specular: ASSET_BASE + 'earth_specular.jpg'
    };

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    function hash2(x, y) {
        const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return s - Math.floor(s);
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('load fail: ' + src));
            img.src = src;
        });
    }

    function imageToTex(img, maxW) {
        const scale = Math.min(1, maxW / img.naturalWidth);
        const w = Math.max(2, Math.round(img.naturalWidth * scale));
        const h = Math.max(2, Math.round(img.naturalHeight * scale));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        return { canvas: c, data, width: w, height: h };
    }

    function sampleRGBA(tex, u, v) {
        if (!tex) return [0, 0, 0, 0];
        const x = ((u % 1) + 1) % 1;
        const y = clamp(v, 0, 1);
        const ix = Math.min(tex.width - 1, (x * tex.width) | 0);
        const iy = Math.min(tex.height - 1, (y * (tex.height - 1)) | 0);
        const i = (iy * tex.width + ix) * 4;
        const d = tex.data;
        return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    }

    /** 双线性采样，球面放大时更平滑 */
    function sampleRGBAbilinear(tex, u, v) {
        if (!tex) return [0, 0, 0, 0];
        const x = (((u % 1) + 1) % 1) * tex.width - 0.5;
        const y = clamp(v, 0, 1) * (tex.height - 1);
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const wrapX = (ix) => ((ix % tex.width) + tex.width) % tex.width;
        const clampY = (iy) => clamp(iy, 0, tex.height - 1) | 0;

        const read = (ix, iy) => {
            const i = (clampY(iy) * tex.width + wrapX(ix)) * 4;
            const d = tex.data;
            return [d[i], d[i + 1], d[i + 2], d[i + 3]];
        };

        const a = read(x0, y0);
        const b = read(x0 + 1, y0);
        const c = read(x0, y0 + 1);
        const d = read(x0 + 1, y0 + 1);
        const out = [0, 0, 0, 0];
        for (let k = 0; k < 4; k++) {
            const top = a[k] * (1 - fx) + b[k] * fx;
            const bot = c[k] * (1 - fx) + d[k] * fx;
            out[k] = top * (1 - fy) + bot * fy;
        }
        return out;
    }

    function rotateNormal(nx, ny, nz, yaw, pitch) {
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const x1 = nx * cy + nz * sy;
        const z1 = -nx * sy + nz * cy;
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const y2 = ny * cp - z1 * sp;
        const z2 = ny * sp + z1 * cp;
        return [x1, y2, z2];
    }

    function makeStars(count, w, h) {
        const stars = [];
        for (let i = 0; i < count; i++) {
            stars.push({
                x: hash2(i * 1.7, 2.3) * w,
                y: hash2(i * 4.1, 9.9) * h,
                r: 0.35 + hash2(i, 7.7) * 1.5,
                a: 0.2 + hash2(i * 0.3, 1.1) * 0.8,
                tw: hash2(i * 2.2, 3.3) * Math.PI * 2
            });
        }
        return stars;
    }

    class ImuEarthRenderer {
        constructor() {
            this.ready = false;
            this.loading = false;
            this.loadError = '';
            this.day = null;
            this.night = null;
            this.clouds = null;
            this.specular = null;
            this.sphereBuf = null;
            this.stars = null;
            this.starW = 0;
            this.starH = 0;
            this._img = null;
            this._cachedYaw = null;
            this._cachedPitch = null;
            this._cachedTbucket = null;
            this._loadPromise = null;
            this.ensureLoad();
        }

        ensureLoad() {
            if (this.ready || this._loadPromise) return this._loadPromise;
            this.loading = true;
            this._loadPromise = Promise.all([
                loadImage(ASSETS.day),
                loadImage(ASSETS.night),
                loadImage(ASSETS.clouds),
                loadImage(ASSETS.specular)
            ])
                .then(([day, night, clouds, specular]) => {
                    // 控制贴图采样分辨率，兼顾清晰与帧率
                    this.day = imageToTex(day, 1536);
                    this.night = imageToTex(night, 1536);
                    this.clouds = imageToTex(clouds, 1024);
                    this.specular = imageToTex(specular, 1024);
                    this.ready = true;
                    this.loading = false;
                    this._cachedYaw = null;
                })
                .catch((err) => {
                    this.loading = false;
                    this.loadError = err.message || String(err);
                    console.error('[imu-earth]', err);
                });
            return this._loadPromise;
        }

        ensureBuffers(viewW, viewH) {
            if (!this.stars || this.starW !== viewW || this.starH !== viewH) {
                this.stars = makeStars(180, viewW, viewH);
                this.starW = viewW;
                this.starH = viewH;
            }
            // 显示端再放大，内部用较低分辨率绘球
            const side = Math.max(200, Math.min(360, Math.floor(Math.min(viewW, viewH) * 0.58)));
            if (!this.sphereBuf || this.sphereBuf.width !== side) {
                const c = document.createElement('canvas');
                c.width = side;
                c.height = side;
                this.sphereBuf = c;
                this._img = null;
                this._cachedYaw = null;
            }
        }

        renderSphere(yaw, pitch, t) {
            const buf = this.sphereBuf;
            const side = buf.width;
            const tbucket = (t * 1.8) | 0;
            if (
                this._img &&
                this._cachedYaw !== null &&
                Math.abs(yaw - this._cachedYaw) < 0.006 &&
                Math.abs(pitch - this._cachedPitch) < 0.006 &&
                tbucket === this._cachedTbucket
            ) {
                return buf;
            }

            const ctx = buf.getContext('2d');
            if (!this._img || this._img.width !== side) {
                this._img = ctx.createImageData(side, side);
            }
            const out = this._img.data;
            const R = side * 0.5;
            // 太阳方向（固定，营造真实日夜）
            const Lx = -0.62;
            const Ly = -0.18;
            const Lz = 0.76;
            const llen = Math.hypot(Lx, Ly, Lz);
            const lx = Lx / llen;
            const ly = Ly / llen;
            const lz = Lz / llen;
            const cloudDrift = t * 0.008;

            for (let py = 0; py < side; py++) {
                for (let px = 0; px < side; px++) {
                    const nx = (px + 0.5 - R) / R;
                    const ny = (py + 0.5 - R) / R;
                    const rr = nx * nx + ny * ny;
                    const i = (py * side + px) * 4;
                    if (rr > 1.002) {
                        out[i + 3] = 0;
                        continue;
                    }
                    // 边缘平滑淡出，减少锯齿
                    const edgeSoft = rr > 0.96 ? clamp((1 - Math.sqrt(rr)) / 0.04, 0, 1) : 1;
                    const nz = Math.sqrt(Math.max(0, 1 - rr));
                    const [wx, wy, wz] = rotateNormal(nx, ny, nz, yaw, pitch);

                    const lon = Math.atan2(wx, wz);
                    const lat = Math.asin(clamp(wy, -1, 1));
                    const u = (lon + Math.PI) / (Math.PI * 2);
                    const v = 0.5 - lat / Math.PI;

                    const day = sampleRGBAbilinear(this.day, u, v);
                    const night = sampleRGBAbilinear(this.night, u, v);
                    const specMap = sampleRGBA(this.specular, u, v);
                    const cu = (((u + cloudDrift) % 1) + 1) % 1;
                    const cloud = sampleRGBAbilinear(this.clouds, cu, v);
                    // 云图多为白底/灰度；透明度取亮度
                    const cloudA = clamp(Math.max(cloud[0], cloud[1], cloud[2]) / 255, 0, 1);
                    const cloudOpacity = Math.pow(cloudA, 1.15) * 0.88;

                    const ndotl = wx * lx + wy * ly + wz * lz;
                    const dayFactor = clamp(ndotl * 0.92 + 0.08, 0, 1);
                    const nightFactor = clamp(-ndotl * 1.35, 0, 1);
                    // 晨昏平滑混合
                    const dusk = clamp(1 - Math.abs(ndotl) * 2.8, 0, 1);

                    let r = day[0] * dayFactor + night[0] * nightFactor * 1.15;
                    let g = day[1] * dayFactor + night[1] * nightFactor * 0.95;
                    let b = day[2] * dayFactor + night[2] * nightFactor * 0.75;

                    // 云层覆盖
                    r = r * (1 - cloudOpacity) + 235 * cloudOpacity * (0.35 + dayFactor * 0.65);
                    g = g * (1 - cloudOpacity) + 240 * cloudOpacity * (0.35 + dayFactor * 0.65);
                    b = b * (1 - cloudOpacity) + 245 * cloudOpacity * (0.35 + dayFactor * 0.65);

                    // 晨昏暖色
                    r += dusk * 48;
                    g += dusk * 18;
                    b += dusk * 4;

                    // 海洋高光（specular 图：海洋亮、陆地暗）
                    const ocean = clamp((specMap[0] + specMap[1] + specMap[2]) / (3 * 255), 0, 1);
                    const hx = lx;
                    const hy = ly;
                    const hz = lz + 1.15;
                    const hlen = Math.hypot(hx, hy, hz) || 1;
                    const spec = Math.pow(clamp((wx * hx + wy * hy + wz * hz) / hlen, 0, 1), 60);
                    const specStrength = ocean * (1 - cloudOpacity * 0.7) * dayFactor;
                    r += spec * 210 * specStrength;
                    g += spec * 230 * specStrength;
                    b += spec * 255 * specStrength;

                    // 大气 Fresnel（蓝色边缘光）
                    const fresnel = Math.pow(1 - nz, 2.4);
                    r += fresnel * 35 * (0.4 + dayFactor * 0.6);
                    g += fresnel * 95 * (0.4 + dayFactor * 0.6);
                    b += fresnel * 170 * (0.5 + dayFactor * 0.5);

                    // 略微压暗背光体积感
                    const shade = 0.78 + nz * 0.22;
                    r *= shade;
                    g *= shade;
                    b *= shade;

                    out[i] = clamp(r, 0, 255) | 0;
                    out[i + 1] = clamp(g, 0, 255) | 0;
                    out[i + 2] = clamp(b, 0, 255) | 0;
                    out[i + 3] = (255 * edgeSoft) | 0;
                }
            }
            ctx.putImageData(this._img, 0, 0);
            this._cachedYaw = yaw;
            this._cachedPitch = pitch;
            this._cachedTbucket = tbucket;
            return buf;
        }

        drawLoading(ctx, w, h) {
            ctx.fillStyle = '#04060d';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = 'rgba(160,200,240,0.75)';
            ctx.font = '13px Consolas, monospace';
            ctx.fillText(this.loadError ? '地球贴图加载失败: ' + this.loadError : '加载地球贴图…', 24, h * 0.5);
        }

        draw(ctx, w, h, yaw, pitch) {
            this.ensureLoad();
            if (!this.ready) {
                this.drawLoading(ctx, w, h);
                return;
            }
            this.ensureBuffers(w, h);
            const t = performance.now() * 0.001;
            const cx = w * 0.5;
            const cy = h * 0.52;
            const R = Math.min(w, h) * 0.36;

            // 深空背景
            const sky = ctx.createRadialGradient(cx, cy * 0.42, 4, cx, cy, Math.max(w, h) * 0.85);
            sky.addColorStop(0, '#0c1834');
            sky.addColorStop(0.4, '#060b1a');
            sky.addColorStop(1, '#010205');
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, w, h);

            // 星场视差
            const px = Math.sin(yaw) * 14;
            const py = Math.sin(pitch) * 9;
            for (let i = 0; i < this.stars.length; i++) {
                const s = this.stars[i];
                const tw = 0.55 + 0.45 * Math.sin(t * 1.5 + s.tw);
                ctx.fillStyle = `rgba(210,225,255,${s.a * tw})`;
                ctx.beginPath();
                ctx.arc(s.x + px * (0.25 + s.r * 0.15), s.y + py * (0.25 + s.r * 0.15), s.r, 0, Math.PI * 2);
                ctx.fill();
            }

            // 远景星云
            const nebula = ctx.createRadialGradient(w * 0.8, h * 0.2, 5, w * 0.8, h * 0.2, h * 0.4);
            nebula.addColorStop(0, 'rgba(70,45,140,0.16)');
            nebula.addColorStop(0.55, 'rgba(25,50,110,0.05)');
            nebula.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = nebula;
            ctx.fillRect(0, 0, w, h);

            // 大气外晕（先画在球后面一点形成背光晕）
            const atmoOuter = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.42);
            atmoOuter.addColorStop(0, 'rgba(40,130,255,0)');
            atmoOuter.addColorStop(0.62, 'rgba(55,160,255,0.05)');
            atmoOuter.addColorStop(0.86, 'rgba(100,200,255,0.28)');
            atmoOuter.addColorStop(1, 'rgba(40,100,200,0)');
            ctx.fillStyle = atmoOuter;
            ctx.beginPath();
            ctx.arc(cx, cy, R * 1.42, 0, Math.PI * 2);
            ctx.fill();

            const sphere = this.renderSphere(yaw, pitch, t);
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(sphere, cx - R, cy - R, R * 2, R * 2);

            // 近处大气遮蔽层
            const limb = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.15, cx, cy, R);
            limb.addColorStop(0, 'rgba(255,255,255,0)');
            limb.addColorStop(0.75, 'rgba(255,255,255,0)');
            limb.addColorStop(0.93, 'rgba(130,200,255,0.1)');
            limb.addColorStop(1, 'rgba(70,150,240,0.28)');
            ctx.fillStyle = limb;
            ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
            ctx.restore();

            // 行星描边
            ctx.strokeStyle = 'rgba(150,210,255,0.2)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.stroke();

            // 科幻轨道环（克制）
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(pitch * 0.4);
            ctx.scale(1, 0.26 + Math.abs(Math.sin(pitch)) * 0.1);
            ctx.strokeStyle = 'rgba(130,210,255,0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(0, 0, R * 1.2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(90,170,255,0.1)';
            ctx.beginPath();
            ctx.arc(0, 0, R * 1.48, 0.2, Math.PI * 1.2);
            ctx.stroke();
            const node = t * 0.35;
            ctx.fillStyle = 'rgba(180,230,255,0.9)';
            ctx.shadowColor = 'rgba(100,200,255,0.8)';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(Math.cos(node) * R * 1.2, Math.sin(node) * R * 1.2, 2.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.restore();

            // 扫描弧
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(-t * 0.28 + yaw * 0.15);
            const scan = ctx.createLinearGradient(-R, 0, R, 0);
            scan.addColorStop(0, 'rgba(80,180,255,0)');
            scan.addColorStop(0.5, 'rgba(100,210,255,0.22)');
            scan.addColorStop(1, 'rgba(80,180,255,0)');
            ctx.strokeStyle = scan;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, R * 1.58, -0.35, 0.55);
            ctx.stroke();
            ctx.restore();

            // 读标注
            ctx.fillStyle = 'rgba(180,210,235,0.72)';
            ctx.font = '11px Consolas, "Segoe UI", monospace';
            ctx.fillText('SEEKBCI  ·  EARTH ORBITAL FEED', 16, 24);
            ctx.fillStyle = 'rgba(120,165,200,0.55)';
            ctx.fillText(`ATT  YAW ${yaw.toFixed(2)}   PITCH ${pitch.toFixed(2)}`, 16, 42);
        }
    }

    global.SSVEP_IMU_EARTH = { ImuEarthRenderer };
})(typeof window !== 'undefined' ? window : globalThis);
