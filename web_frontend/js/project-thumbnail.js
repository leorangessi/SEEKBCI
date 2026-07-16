/**
 * 从项目第 1 页画布数据生成缩略图（不含编辑器侧栏/配置 UI）。
 */
(function (global) {
    const DEFAULT_LAYOUT_W = 1200;
    const DEFAULT_LAYOUT_H = 700;
    const OUT_W = 400;
    const OUT_H = 225;

    function pageLayoutSize(page) {
        const ref = page && page.stimulusLayoutRef;
        if (ref && Number(ref.width) > 0 && Number(ref.height) > 0) {
            return { w: Number(ref.width), h: Number(ref.height) };
        }
        // 无 layout 记录时，从对象外扩估算，并保留原点 (0,0) 作为画布左上角（与编辑器一致）
        let maxR = 0;
        let maxB = 0;
        const all = [].concat(page && page.blocks ? page.blocks : [], page && page.multimodalBlocks ? page.multimodalBlocks : []);
        for (const b of all) {
            if (!b) continue;
            maxR = Math.max(maxR, (Number(b.x) || 0) + (Number(b.width) || 80));
            maxB = Math.max(maxB, (Number(b.y) || 0) + (Number(b.height) || 60));
        }
        return {
            w: Math.max(DEFAULT_LAYOUT_W, Math.ceil(maxR + 24)),
            h: Math.max(DEFAULT_LAYOUT_H, Math.ceil(maxB + 24))
        };
    }

    /**
     * 尽量补全第 pageIndex 页的 stimulusLayoutRef（与编辑器画布同坐标系）。
     * 若项目管理里没有，则尝试从当前编辑缓存 ssvep_project 同 id 项目复制。
     */
    function ensurePageLayoutRef(project, pageIndex) {
        const pages = project && project.pages;
        if (!Array.isArray(pages) || !pages.length) return;
        const idx = pageIndex != null && pageIndex >= 0 ? pageIndex : 0;
        const page = pages[idx] || pages[0];
        if (!page) return;
        const ref = page.stimulusLayoutRef;
        if (ref && Number(ref.width) > 0 && Number(ref.height) > 0) return;
        try {
            const raw = global.localStorage && global.localStorage.getItem('ssvep_project');
            if (!raw) return;
            const cur = JSON.parse(raw);
            if (!cur || cur.id !== project.id || !Array.isArray(cur.pages)) return;
            const src = cur.pages[idx] || cur.pages[0];
            const sref = src && src.stimulusLayoutRef;
            if (sref && Number(sref.width) > 0 && Number(sref.height) > 0) {
                page.stimulusLayoutRef = {
                    width: Number(sref.width),
                    height: Number(sref.height)
                };
            }
        } catch (_) {
            /* ignore */
        }
    }

    function isKeyboardBlock(block) {
        return !!(block && block.shape === 'ssvep_keyboard');
    }

    function drawRoundedRect(ctx, x, y, w, h, r) {
        const rad = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rad, y);
        ctx.lineTo(x + w - rad, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
        ctx.lineTo(x + w, y + h - rad);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
        ctx.lineTo(x + rad, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
        ctx.lineTo(x, y + rad);
        ctx.quadraticCurveTo(x, y, x + rad, y);
        ctx.closePath();
    }

    function drawSsvepShape(ctx, block, x, y, w, h) {
        const color = block.color || '#00D9FF';
        ctx.fillStyle = color;
        const shape = block.shape || 'rectangle';
        ctx.beginPath();
        if (shape === 'circle') {
            ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        } else if (shape === 'triangle') {
            ctx.moveTo(x + w / 2, y);
            ctx.lineTo(x, y + h);
            ctx.lineTo(x + w, y + h);
            ctx.closePath();
        } else if (shape === 'diamond') {
            ctx.moveTo(x + w / 2, y);
            ctx.lineTo(x + w, y + h / 2);
            ctx.lineTo(x + w / 2, y + h);
            ctx.lineTo(x, y + h / 2);
            ctx.closePath();
        } else if (shape === 'hexagon') {
            ctx.moveTo(x + w * 0.25, y);
            ctx.lineTo(x + w * 0.75, y);
            ctx.lineTo(x + w, y + h / 2);
            ctx.lineTo(x + w * 0.75, y + h);
            ctx.lineTo(x + w * 0.25, y + h);
            ctx.lineTo(x, y + h / 2);
            ctx.closePath();
        } else if (shape === 'pentagon') {
            ctx.moveTo(x + w / 2, y);
            ctx.lineTo(x + w, y + h * 0.38);
            ctx.lineTo(x + w * 0.82, y + h);
            ctx.lineTo(x + w * 0.18, y + h);
            ctx.lineTo(x, y + h * 0.38);
            ctx.closePath();
        } else {
            drawRoundedRect(ctx, x, y, w, h, 6);
        }
        ctx.fill();

        const label = block.label != null ? String(block.label).trim() : '';
        if (label && w > 18 && h > 12) {
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.font = `600 ${Math.max(8, Math.min(13, w / 5))}px "Segoe UI", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const text = label.length > 14 ? `${label.slice(0, 13)}…` : label;
            ctx.fillText(text, x + w / 2, y + h / 2, w - 4);
        }
    }

    function drawKeyboardPreview(ctx, block, x, y, w, h) {
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.strokeStyle = block.color || '#00D9FF';
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, x, y, w, h, 4);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        for (let r = 1; r < 4; r++) {
            const yy = y + (h * r) / 4;
            ctx.beginPath();
            ctx.moveTo(x + 4, yy);
            ctx.lineTo(x + w - 4, yy);
            ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `600 ${Math.max(9, Math.min(12, w / 10))}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('40 键', x + w / 2, y + h / 2);
    }

    function drawMultimodalBlock(ctx, block, x, y, w, h) {
        ctx.fillStyle = 'rgba(201, 160, 255, 0.38)';
        ctx.strokeStyle = '#C9A0FF';
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, x, y, w, h, 4);
        ctx.fill();
        ctx.stroke();
        const meta =
            global.SSVEP_MULTIMODAL_BY_ID && block.channel
                ? global.SSVEP_MULTIMODAL_BY_ID[block.channel]
                : null;
        const short = meta ? meta.short : 'MM';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `600 ${Math.max(8, Math.min(11, w / 4))}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(short, x + w / 2, y + h / 2, w - 2);
    }

    function renderPageThumbnailDataUrl(page) {
        if (!page) return null;
        const { w: lw, h: lh } = pageLayoutSize(page);
        const canvas = document.createElement('canvas');
        canvas.width = OUT_W;
        canvas.height = OUT_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // 独立缩放：画布坐标比例映射到缩略图，中心→中心（避免 letterbox 后错位）
        const scaleX = OUT_W / lw;
        const scaleY = OUT_H / lh;

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, OUT_W, OUT_H);

        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        const step = 20;
        for (let gx = 0; gx <= lw; gx += step) {
            const x = gx * scaleX;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, OUT_H);
            ctx.stroke();
        }
        for (let gy = 0; gy <= lh; gy += step) {
            const y = gy * scaleY;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(OUT_W, y);
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.strokeRect(0.5, 0.5, OUT_W - 1, OUT_H - 1);

        for (const block of page.blocks || []) {
            if (!block) continue;
            const bx = (Number(block.x) || 0) * scaleX;
            const by = (Number(block.y) || 0) * scaleY;
            const bw = Math.max(4, (Number(block.width) || 80) * scaleX);
            const bh = Math.max(4, (Number(block.height) || 60) * scaleY);
            if (isKeyboardBlock(block)) drawKeyboardPreview(ctx, block, bx, by, bw, bh);
            else drawSsvepShape(ctx, block, bx, by, bw, bh);
        }

        for (const block of page.multimodalBlocks || []) {
            if (!block) continue;
            const bx = (Number(block.x) || 0) * scaleX;
            const by = (Number(block.y) || 0) * scaleY;
            const bw = Math.max(4, (Number(block.width) || 48) * scaleX);
            const bh = Math.max(4, (Number(block.height) || 48) * scaleY);
            drawMultimodalBlock(ctx, block, bx, by, bw, bh);
        }

        try {
            return canvas.toDataURL('image/jpeg', 0.82);
        } catch (e) {
            console.warn('[project-thumbnail]', e);
            return null;
        }
    }

    function renderProjectPageThumbnailDataUrl(project, pageIndex) {
        const pages = project && project.pages;
        if (!Array.isArray(pages) || !pages.length) return null;
        const idx = pageIndex != null && pageIndex >= 0 ? pageIndex : 0;
        ensurePageLayoutRef(project, idx);
        return renderPageThumbnailDataUrl(pages[idx] || pages[0]);
    }

    function refreshProjectThumbnailFromCanvas(project, pageIndex) {
        if (!project) return null;
        const url = renderProjectPageThumbnailDataUrl(project, pageIndex);
        if (url) {
            project.thumbnailImage = url;
            project.thumbnailSource = 'canvas';
        }
        return url;
    }

    global.SSVEP_PROJECT_THUMBNAIL = {
        renderPageThumbnailDataUrl,
        renderProjectPageThumbnailDataUrl,
        refreshProjectThumbnailFromCanvas
    };
})(typeof window !== 'undefined' ? window : globalThis);
