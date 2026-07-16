/**
 * 通用图片显示编辑器：完整显示 / 拉伸 / 框选裁剪（类 QQ）/ 还原默认
 *
 * 关键点：
 * - 裁剪框在「图在舞台内的实际绘制区域」上计算，避免 letterbox 错位
 * - 始终保留 sourceImage（原图）；确认时输出 baked displayImage，便于再次编辑仍拿原图
 * - 舞台宽高比与 output 一致，保证「所见即所得」
 *
 * window.SSVEP_IMAGE_DISPLAY_EDITOR.open(options)
 */
(function (global) {
    const MODES = {
        fit: { label: '完整显示', objectFit: 'contain' },
        stretch: { label: '拉伸铺满', objectFit: 'fill' },
        crop: { label: '框选区域', objectFit: 'contain' }
    };

    let overlayEl = null;
    let state = null;

    function ensureStyles() {
        if (document.getElementById('ssvep-ide-styles')) return;
        const style = document.createElement('style');
        style.id = 'ssvep-ide-styles';
        style.textContent = `
.ssvep-ide-overlay{position:fixed;inset:0;z-index:200000;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.ssvep-ide-card{background:#1e1e1e;border:1px solid #444;border-radius:14px;width:min(560px,100%);max-height:92vh;overflow:auto;box-shadow:0 18px 50px rgba(0,0,0,.5);padding:20px}
.ssvep-ide-card h3{margin:0 0 14px;color:#00d9ff;font-size:18px}
.ssvep-ide-stage{position:relative;width:100%;background:#111;border:1px solid #444;border-radius:10px;overflow:hidden;margin-bottom:14px;user-select:none;touch-action:none}
.ssvep-ide-stage img{width:100%;height:100%;display:block;pointer-events:none;background:#111}
.ssvep-ide-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#666;font-size:14px;text-align:center;padding:16px;line-height:1.5}
.ssvep-ide-crop{position:absolute;border:2px solid #00d9ff;box-shadow:0 0 0 9999px rgba(0,0,0,.45);cursor:move;box-sizing:border-box}
.ssvep-ide-crop::after{content:'';position:absolute;right:-5px;bottom:-5px;width:12px;height:12px;background:#00d9ff;border-radius:2px;cursor:nwse-resize}
.ssvep-ide-modes{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.ssvep-ide-modes button{flex:1;min-width:88px;padding:9px 10px;border-radius:8px;border:1px solid #555;background:#2a2a2a;color:#ddd;cursor:pointer;font-size:13px}
.ssvep-ide-modes button.active{border-color:#00d9ff;color:#00d9ff;background:#14303a}
.ssvep-ide-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.ssvep-ide-actions button,.ssvep-ide-footer button{padding:9px 14px;border-radius:8px;border:1px solid #555;background:#2a2a2a;color:#ddd;cursor:pointer;font-size:13px;font-weight:600}
.ssvep-ide-footer{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.ssvep-ide-footer .ok{background:#00d9ff;color:#111;border-color:#00d9ff}
.ssvep-ide-hint{font-size:12px;color:#888;line-height:1.5;margin:0 0 12px}
`;
        document.head.appendChild(style);
    }

    function normalizeMode(mode) {
        if (mode === 'cover') return 'stretch';
        return MODES[mode] ? mode : 'fit';
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = src;
        });
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    /** object-fit:contain 时，图片在舞台内的实际绘制矩形 */
    function getContainedImageRect(stageW, stageH, natW, natH) {
        if (!natW || !natH || !stageW || !stageH) {
            return { x: 0, y: 0, w: stageW || 1, h: stageH || 1 };
        }
        const scale = Math.min(stageW / natW, stageH / natH);
        const w = natW * scale;
        const h = natH * scale;
        return {
            x: (stageW - w) / 2,
            y: (stageH - h) / 2,
            w,
            h
        };
    }

    function bakeFitOrStretch(src, mode, outW, outH) {
        return loadImage(src).then((img) => {
            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, outW, outH);
            if (mode === 'stretch') {
                ctx.drawImage(img, 0, 0, outW, outH);
            } else {
                const scale = Math.min(outW / img.naturalWidth, outH / img.naturalHeight);
                const dw = img.naturalWidth * scale;
                const dh = img.naturalHeight * scale;
                ctx.drawImage(img, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
            }
            return canvas.toDataURL('image/jpeg', 0.9);
        });
    }

    function bakeCropFromPixels(src, sx, sy, sw, sh, outW, outH) {
        return loadImage(src).then((img) => {
            const x = clamp(Math.round(sx), 0, img.naturalWidth - 1);
            const y = clamp(Math.round(sy), 0, img.naturalHeight - 1);
            const w = clamp(Math.round(sw), 1, img.naturalWidth - x);
            const h = clamp(Math.round(sh), 1, img.naturalHeight - y);
            const canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, outW, outH);
            ctx.drawImage(img, x, y, w, h, 0, 0, outW, outH);
            return canvas.toDataURL('image/jpeg', 0.9);
        });
    }

    function defaultCropInBounds(bounds, aspect) {
        const maxW = bounds.w * 0.86;
        const maxH = bounds.h * 0.86;
        let w = maxW;
        let h = w / aspect;
        if (h > maxH) {
            h = maxH;
            w = h * aspect;
        }
        w = Math.max(24, w);
        h = Math.max(24 / aspect, h);
        return {
            x: bounds.x + (bounds.w - w) / 2,
            y: bounds.y + (bounds.h - h) / 2,
            w,
            h
        };
    }

    function stageSize() {
        return {
            w: state.stage.clientWidth || 1,
            h: state.stage.clientHeight || 1
        };
    }

    function currentImageBounds() {
        const { w: sw, h: sh } = stageSize();
        const natW = state.natW || sw;
        const natH = state.natH || sh;
        return getContainedImageRect(sw, sh, natW, natH);
    }

    function clampCropToImageBounds() {
        const b = currentImageBounds();
        const c = state.cropPx;
        c.w = clamp(c.w, 24, b.w);
        c.h = c.w / state.aspect;
        if (c.h > b.h) {
            c.h = b.h;
            c.w = c.h * state.aspect;
        }
        c.x = clamp(c.x, b.x, b.x + b.w - c.w);
        c.y = clamp(c.y, b.y, b.y + b.h - c.h);
    }

    function syncCropEl() {
        if (!state || !state.cropEl) return;
        const c = state.cropPx;
        state.cropEl.style.left = `${c.x}px`;
        state.cropEl.style.top = `${c.y}px`;
        state.cropEl.style.width = `${c.w}px`;
        state.cropEl.style.height = `${c.h}px`;
        state.cropEl.style.display = state.mode === 'crop' && state.sourceImage ? 'block' : 'none';
    }

    function applyPreviewFit() {
        if (!state || !state.imgEl) return;
        // 框选时必须 contain，否则裁剪框无法与像素对齐
        state.imgEl.style.objectFit = state.mode === 'stretch' ? 'fill' : 'contain';
    }

    function updateModeButtons() {
        if (!state) return;
        state.overlay.querySelectorAll('[data-ide-mode]').forEach((btn) => {
            btn.classList.toggle('active', btn.getAttribute('data-ide-mode') === state.mode);
        });
        applyPreviewFit();
        if (state.mode === 'crop' && state.sourceImage) {
            clampCropToImageBounds();
        }
        syncCropEl();
    }

    function resetCropToDefault() {
        state.cropPx = defaultCropInBounds(currentImageBounds(), state.aspect);
        syncCropEl();
    }

    function maybeDownscaleDataUrl(dataUrl, maxEdge, done) {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            if (!w || !h || Math.max(w, h) <= maxEdge) {
                done(dataUrl);
                return;
            }
            const scale = maxEdge / Math.max(w, h);
            const c = document.createElement('canvas');
            c.width = Math.round(w * scale);
            c.height = Math.round(h * scale);
            const ctx = c.getContext('2d');
            if (!ctx) {
                done(dataUrl);
                return;
            }
            ctx.drawImage(img, 0, 0, c.width, c.height);
            try {
                done(c.toDataURL('image/jpeg', 0.92));
            } catch (_) {
                done(dataUrl);
            }
        };
        img.onerror = () => done(dataUrl);
        img.src = dataUrl;
    }

    function setSourceImage(dataUrl, { markRestored } = {}) {
        state.sourceImage = dataUrl || null;
        state.cleared = false;
        if (!markRestored) state.restoredDefault = false;
        const empty = state.overlay.querySelector('.ssvep-ide-empty');
        if (state.sourceImage) {
            state.imgEl.onload = () => {
                state.natW = state.imgEl.naturalWidth || 0;
                state.natH = state.imgEl.naturalHeight || 0;
                if (state.mode === 'crop') resetCropToDefault();
                updateModeButtons();
            };
            state.imgEl.src = state.sourceImage;
            state.imgEl.style.display = 'block';
            if (empty) empty.style.display = 'none';
        } else {
            state.natW = 0;
            state.natH = 0;
            state.imgEl.removeAttribute('src');
            state.imgEl.style.display = 'none';
            if (empty) empty.style.display = 'flex';
            updateModeButtons();
        }
    }

    function bindCropDrag() {
        const crop = state.cropEl;
        let drag = null;

        const onMove = (ev) => {
            if (!drag) return;
            ev.preventDefault();
            const pt = ev.touches ? ev.touches[0] : ev;
            const dx = pt.clientX - drag.startX;
            const dy = pt.clientY - drag.startY;
            const b = currentImageBounds();
            if (drag.type === 'move') {
                state.cropPx.x = clamp(drag.ox + dx, b.x, b.x + b.w - state.cropPx.w);
                state.cropPx.y = clamp(drag.oy + dy, b.y, b.y + b.h - state.cropPx.h);
            } else {
                let w = clamp(drag.ow + dx, 24, b.x + b.w - state.cropPx.x);
                let h = w / state.aspect;
                if (state.cropPx.y + h > b.y + b.h) {
                    h = b.y + b.h - state.cropPx.y;
                    w = h * state.aspect;
                }
                state.cropPx.w = Math.max(24, w);
                state.cropPx.h = Math.max(24 / state.aspect, h);
            }
            syncCropEl();
        };

        const onUp = () => {
            drag = null;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onUp);
        };

        crop.onmousedown = (ev) => {
            if (state.mode !== 'crop') return;
            const br = crop.getBoundingClientRect();
            const nearCorner = ev.clientX > br.right - 18 && ev.clientY > br.bottom - 18;
            drag = {
                type: nearCorner ? 'resize' : 'move',
                startX: ev.clientX,
                startY: ev.clientY,
                ox: state.cropPx.x,
                oy: state.cropPx.y,
                ow: state.cropPx.w,
                oh: state.cropPx.h
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        };

        crop.ontouchstart = (ev) => {
            if (state.mode !== 'crop' || !ev.touches[0]) return;
            const t = ev.touches[0];
            const br = crop.getBoundingClientRect();
            const nearCorner = t.clientX > br.right - 22 && t.clientY > br.bottom - 22;
            drag = {
                type: nearCorner ? 'resize' : 'move',
                startX: t.clientX,
                startY: t.clientY,
                ox: state.cropPx.x,
                oy: state.cropPx.y,
                ow: state.cropPx.w,
                oh: state.cropPx.h
            };
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onUp);
        };
    }

    function close() {
        if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        overlayEl = null;
        state = null;
    }

    async function resolveDefaultImage(opt) {
        if (typeof opt.getDefaultImage === 'function') {
            return await opt.getDefaultImage();
        }
        return opt.defaultImage || null;
    }

    /** 将舞台上的裁剪框映射为原图像素矩形 */
    function cropPxToSourcePixels() {
        const b = currentImageBounds();
        const c = state.cropPx;
        const natW = state.natW || 1;
        const natH = state.natH || 1;
        const relX = (c.x - b.x) / b.w;
        const relY = (c.y - b.y) / b.h;
        const relW = c.w / b.w;
        const relH = c.h / b.h;
        return {
            sx: relX * natW,
            sy: relY * natH,
            sw: relW * natW,
            sh: relH * natH
        };
    }

    async function confirm() {
        if (!state) return;
        const opt = state.opt;
        const sourceImage = state.sourceImage;

        if (state.cleared || !sourceImage) {
            opt.onConfirm({
                image: null,
                originalImage: null,
                displayMode: 'fit',
                restored: true
            });
            close();
            return;
        }

        try {
            let displayImage;
            let displayMode = state.mode;
            // 画布默认缩略图已是目标尺寸，避免再次 fit 烘焙造成二次偏移
            if (state.restoredDefault) {
                displayImage = sourceImage;
                displayMode = 'stretch';
            } else if (state.mode === 'crop') {
                const p = cropPxToSourcePixels();
                displayImage = await bakeCropFromPixels(
                    sourceImage,
                    p.sx,
                    p.sy,
                    p.sw,
                    p.sh,
                    opt.outputWidth,
                    opt.outputHeight
                );
                displayMode = 'stretch';
            } else {
                displayImage = await bakeFitOrStretch(
                    sourceImage,
                    state.mode,
                    opt.outputWidth,
                    opt.outputHeight
                );
                displayMode = 'stretch';
            }

            opt.onConfirm({
                image: displayImage,
                originalImage: state.restoredDefault ? null : sourceImage,
                displayMode,
                editMode: state.mode,
                restored: !!state.restoredDefault
            });
            close();
        } catch (err) {
            alert(err.message || '处理图片失败');
        }
    }

    function open(options) {
        ensureStyles();
        if (overlayEl) close();

        const opt = Object.assign(
            {
                title: '编辑图片',
                /** 编辑用原图；没有则回退 image */
                originalImage: null,
                image: null,
                displayMode: 'fit',
                /** 打开时选中的编辑模式：fit | stretch | crop */
                editMode: null,
                aspectRatio: 16 / 9,
                outputWidth: 400,
                outputHeight: 225,
                stageHeight: null,
                defaultImage: null,
                getDefaultImage: null,
                emptyHint: '点击下方「上传图片」选择图片',
                /** false 时隐藏「还原默认」（如用户头像） */
                showRestore: true,
                onConfirm: function () {}
            },
            options || {}
        );

        const aspect = opt.aspectRatio > 0 ? opt.aspectRatio : 16 / 9;
        // 舞台按目标比例，宽度撑满卡片，高度由 aspect-ratio 决定
        const stageStyle = `aspect-ratio:${aspect};width:100%;height:auto;`;
        const restoreBtnHtml = opt.showRestore === false
            ? ''
            : '<button type="button" data-ide-act="restore">还原默认</button>';

        overlayEl = document.createElement('div');
        overlayEl.className = 'ssvep-ide-overlay';
        overlayEl.innerHTML = `
            <div class="ssvep-ide-card" role="dialog" aria-modal="true">
                <h3>${opt.title}</h3>
                <div class="ssvep-ide-stage" style="${stageStyle}">
                    <img alt="">
                    <div class="ssvep-ide-empty">${opt.emptyHint}</div>
                    <div class="ssvep-ide-crop" style="display:none"></div>
                </div>
                <div class="ssvep-ide-modes">
                    <button type="button" data-ide-mode="fit">完整显示</button>
                    <button type="button" data-ide-mode="stretch">拉伸铺满</button>
                    <button type="button" data-ide-mode="crop">框选区域</button>
                </div>
                <p class="ssvep-ide-hint">完整显示 / 拉伸铺满：按目标图标比例烘焙预览。框选区域：在原图上拖动蓝框（可缩放右下角）；确定后按框选内容生成图标。再次编辑仍使用原图。</p>
                <div class="ssvep-ide-actions">
                    <button type="button" data-ide-act="upload">上传图片</button>
                    ${restoreBtnHtml}
                </div>
                <input type="file" accept="image/*" style="display:none" data-ide-file>
                <div class="ssvep-ide-footer">
                    <button type="button" data-ide-act="cancel">取消</button>
                    <button type="button" class="ok" data-ide-act="ok">确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlayEl);

        const stage = overlayEl.querySelector('.ssvep-ide-stage');
        const imgEl = overlayEl.querySelector('img');
        const cropEl = overlayEl.querySelector('.ssvep-ide-crop');
        const fileInput = overlayEl.querySelector('[data-ide-file]');

        const initialSource = opt.originalImage || opt.image || null;
        const initialMode = normalizeMode(opt.editMode || (opt.displayMode === 'stretch' ? 'stretch' : 'fit'));

        state = {
            opt,
            overlay: overlayEl,
            stage,
            imgEl,
            cropEl,
            aspect,
            mode: initialMode,
            sourceImage: null,
            natW: 0,
            natH: 0,
            cleared: false,
            restoredDefault: false,
            cropPx: { x: 0, y: 0, w: 40, h: 40 / aspect }
        };

        bindCropDrag();
        setSourceImage(initialSource);

        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) close();
        });

        overlayEl.querySelectorAll('[data-ide-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.mode = btn.getAttribute('data-ide-mode');
                if (state.mode === 'crop' && state.sourceImage) resetCropToDefault();
                updateModeButtons();
            });
        });

        overlayEl.querySelector('[data-ide-act="upload"]').addEventListener('click', () => fileInput.click());
        overlayEl.querySelector('[data-ide-act="cancel"]').addEventListener('click', close);
        overlayEl.querySelector('[data-ide-act="ok"]').addEventListener('click', () => {
            confirm();
        });
        const restoreBtn = overlayEl.querySelector('[data-ide-act="restore"]');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', async () => {
                try {
                    const def = await resolveDefaultImage(opt);
                    state.restoredDefault = true;
                    state.mode = 'stretch';
                    if (def) {
                        setSourceImage(def, { markRestored: true });
                    } else {
                        state.cleared = true;
                        setSourceImage(null, { markRestored: true });
                    }
                } catch (err) {
                    alert(err.message || '无法还原默认图');
                }
            });
        }

        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                alert('请选择图片文件');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                state.mode = state.mode || 'fit';
                maybeDownscaleDataUrl(reader.result, 1600, (url) => {
                    setSourceImage(url);
                });
            };
            reader.onerror = () => alert('读取图片失败');
            reader.readAsDataURL(file);
        });

        updateModeButtons();
        requestAnimationFrame(() => {
            if (!state) return;
            if (state.mode === 'crop' && state.sourceImage) resetCropToDefault();
            updateModeButtons();
        });
    }

    global.SSVEP_IMAGE_DISPLAY_EDITOR = {
        open,
        close,
        MODE_OBJECT_FIT: {
            fit: 'contain',
            stretch: 'fill',
            crop: 'cover',
            cover: 'cover'
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
