/**
 * 运动通道条形图（emg-test / 刺激控制面板共用绘制）
 */
(function (global) {
    const CHANNEL_COLORS = [
        'rgba(59,130,246,0.9)',
        'rgba(239,68,68,0.9)',
        'rgba(34,197,94,0.9)',
        'rgba(234,179,8,0.9)'
    ];
    const OPENBCI_STROKE = 'rgba(31,69,110,0.75)';
    const NORM_GATE_STROKE = 'rgba(255,70,70,0.9)';
    const BAR_ROW_SLOT = 52;
    const BAR_HEIGHT_PX = 28;
    const PANEL_BAR_H = 50;
    const PANEL_ROW_STEP = PANEL_BAR_H + 6;
    const NORM_BAR_COLOR = 'rgba(59,130,246,0.95)';
    const NORM_BAR_DIM = 'rgba(59,130,246,0.35)';
    const COMPACT_NORM_W = 28;
    const COMPACT_TRIG_W = 14;

    function slotLabel(cfg) {
        const meta = global.SSVEP_MULTIMODAL_BY_ID && cfg.channel ? global.SSVEP_MULTIMODAL_BY_ID[cfg.channel] : null;
        const short = meta ? meta.short : cfg.channel || '?';
        const ch =
            cfg.physicalChannel != null && Number.isFinite(Number(cfg.physicalChannel))
                ? ` Ch${Number(cfg.physicalChannel) + 1}`
                : '';
        return `${short}${ch}`;
    }

    function resolvePhysicalChannel(cfg) {
        if (!cfg) return -1;
        if (cfg.physicalChannel != null && cfg.physicalChannel >= 0) return Number(cfg.physicalChannel);
        const CFG = global.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (CFG && cfg.channel && typeof CFG.getMultimodalPhysicalIndex === 'function') {
            const phys = CFG.getMultimodalPhysicalIndex(cfg.channel);
            if (phys != null && phys >= 0) return phys;
        }
        const meta = global.SSVEP_MULTIMODAL_BY_ID && cfg.channel ? global.SSVEP_MULTIMODAL_BY_ID[cfg.channel] : null;
        return meta && meta.fallbackIndex >= 0 ? meta.fallbackIndex : -1;
    }

    function cfgIsMotionChannel(cfg) {
        if (!cfg) return false;
        const DET = global.SSVEP_MULTIMODAL_DETECTOR;
        if (DET && typeof DET.isMotorConfig === 'function' && DET.isMotorConfig(cfg)) return true;
        const role =
            typeof global.ssvepGetModalityRoleForChannel === 'function' && cfg.channel
                ? global.ssvepGetModalityRoleForChannel(cfg.channel)
                : null;
        return role === 'motor_imagery';
    }

    function refreshMetricsForConfigs(configs, message) {
        const RUN = global.SSVEP_EMG_MOTION_RUNTIME;
        const list = [];
        if (!RUN || typeof RUN.refreshChannelDrive !== 'function') return list;

        for (const cfg of configs || []) {
            if (!cfgIsMotionChannel(cfg)) continue;
            const phys = resolvePhysicalChannel(cfg);
            if (phys < 0) continue;
            const out = RUN.refreshChannelDrive(phys, cfg, message);
            const thr =
                cfg.driveTriggerLevel != null
                    ? Number(cfg.driveTriggerLevel)
                    : global.SSVEP_EMG_DRIVE && global.SSVEP_EMG_DRIVE.DEFAULTS
                      ? global.SSVEP_EMG_DRIVE.DEFAULTS.driveTriggerLevel
                      : 0.85;
            list.push({
                cfg,
                physicalCh: phys,
                label: slotLabel(cfg),
                norm: out.norm || 0,
                drive: out.drive || 0,
                activity: out.activity || 0,
                ready: !!out.ready,
                peak2peak: out.peak2peak || 0,
                peak: out.peak || 0,
                valley: out.valley || 0,
                upper: out.upper || 0,
                lower: out.lower || 0,
                triggered: !!out.triggered,
                driveThreshold: thr,
                binsOk: out.binsOk,
                binsRequired: out.binsRequired,
                binsMinOk: out.binsMinOk,
                manualFixed: !!(cfg.manualNormThresholds)
            });
        }
        return list;
    }

    function layoutCanvas(canvas, ctx, rowCount, cssW, rowSlot) {
        const slot = rowSlot || BAR_ROW_SLOT;
        const n = Math.max(1, rowCount);
        const cssH = n * slot + 8;
        const dpr = Math.min(2, global.devicePixelRatio || 1);
        const pxW = Math.round(cssW * dpr);
        const pxH = Math.round(cssH * dpr);
        if (canvas.width !== pxW || canvas.height !== pxH) {
            canvas.width = pxW;
            canvas.height = pxH;
        }
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { w: cssW, h: cssH, rowSlot: slot };
    }

    function fillLevel(ctx, x, top, w, h, level, color, alpha) {
        const lv = Math.max(0, Math.min(1, level));
        if (lv <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha != null ? alpha : 1;
        ctx.fillStyle = color;
        ctx.fillRect(x, top + h - lv * h, w, lv * h);
        ctx.restore();
    }

    function drawCompactBars(ctx, rows, w, h, rowSlot, normGate) {
        const barH = BAR_HEIGHT_PX;
        rows.forEach((m, idx) => {
            const y0 = idx * rowSlot + 4;
            const barTop = y0 + 12;
            const barBottom = barTop + barH;
            const color = CHANNEL_COLORS[m.physicalCh % CHANNEL_COLORS.length];
            const normX = 88;
            const normW = COMPACT_NORM_W;
            const trigW = COMPACT_TRIG_W;

            ctx.fillStyle = '#888';
            ctx.font = '10px Segoe UI, sans-serif';
            ctx.fillText(m.label, 4, barTop + barH * 0.55);

            ctx.strokeStyle = OPENBCI_STROKE;
            ctx.strokeRect(normX, barTop, normW, barH);
            const normLv = Math.max(0, Math.min(1, m.norm));
            fillLevel(ctx, normX, barTop, normW, barH, normLv, color, m.ready ? 1 : 0.4);

            if (m.ready && m.upper > 0) {
                const uvLimit = 200;
                const upperY = barBottom - (Math.min(m.upper, uvLimit) / uvLimit) * barH;
                const lowerY = barBottom - (Math.min(m.lower, uvLimit) / uvLimit) * barH;
                ctx.strokeStyle = OPENBCI_STROKE;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(normX - 2, upperY);
                ctx.lineTo(normX + normW + trigW + 2, upperY);
                ctx.moveTo(normX - 2, lowerY);
                ctx.lineTo(normX + normW + trigW + 2, lowerY);
                ctx.stroke();
            }

            const gateY = barBottom - Math.max(0, Math.min(1, normGate)) * barH;
            ctx.strokeStyle = NORM_GATE_STROKE;
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.moveTo(normX - 2, gateY);
            ctx.lineTo(normX + normW + 2, gateY);
            ctx.stroke();
            ctx.setLineDash([]);

            const trigX = normX + normW + 4;
            ctx.strokeStyle = 'rgba(255,140,0,0.5)';
            ctx.strokeRect(trigX, barTop, trigW, barH);
            const barLevel = Math.max(m.norm || 0, m.drive || 0);
            fillLevel(
                ctx,
                trigX,
                barTop,
                trigW,
                barH,
                barLevel,
                barLevel > normGate ? 'rgba(255,140,0,0.92)' : 'rgba(255,140,0,0.15)',
                1
            );

            const thrY = barBottom - m.driveThreshold * barH;
            ctx.strokeStyle = 'rgba(255,80,80,0.85)';
            ctx.setLineDash([3, 2]);
            ctx.beginPath();
            ctx.moveTo(normX - 2, thrY);
            ctx.lineTo(trigX + trigW + 2, thrY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#777';
            ctx.font = '9px Consolas, monospace';
            ctx.fillText(`${m.drive.toFixed(2)}/${m.driveThreshold.toFixed(2)}`, normX + normW + trigW + 6, barTop + 12);
        });
    }

    function drawPanelBars(ctx, rows, w, h, rowSlot, normGate) {
        const labelW = 64;
        const padR = 6;
        const gap = 3;
        const barH = PANEL_BAR_H;
        const barAreaW = Math.max(60, Math.floor((w - labelW - padR) * 0.5));
        const normW = Math.max(14, Math.floor((barAreaW - gap) * 0.48));
        const driveW = Math.max(14, barAreaW - gap - normW);

        const rowStep = PANEL_ROW_STEP;

        rows.forEach((m, idx) => {
            const y0 = idx * rowStep + 2;
            const barTop = y0 + 2;
            const barBottom = barTop + barH;
            const normX = labelW;
            const driveX = normX + normW + gap;

            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = '600 9px Segoe UI, sans-serif';
            ctx.fillText(m.label, 4, barTop + barH * 0.58);

            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(normX, barTop, normW, barH);
            ctx.strokeStyle = 'rgba(59,130,246,0.45)';
            ctx.strokeRect(normX, barTop, normW, barH);
            const normLv = Math.max(0, Math.min(1, m.norm));
            if (normLv > 0.01) {
                fillLevel(
                    ctx,
                    normX,
                    barTop,
                    normW,
                    barH,
                    normLv,
                    NORM_BAR_COLOR,
                    m.ready ? 1 : 0.85
                );
            } else {
                fillLevel(ctx, normX, barTop, normW, barH, 0.04, NORM_BAR_DIM, 1);
            }

            const gateY = barBottom - Math.max(0, Math.min(1, normGate)) * barH;
            ctx.strokeStyle = NORM_GATE_STROKE;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(normX, gateY);
            ctx.lineTo(normX + normW, gateY);
            ctx.stroke();
            ctx.setLineDash([]);

            if (m.ready && m.upper > 0) {
                const uvLimit = 200;
                const upperY = barBottom - (Math.min(m.upper, uvLimit) / uvLimit) * barH;
                const lowerY = barBottom - (Math.min(m.lower, uvLimit) / uvLimit) * barH;
                ctx.strokeStyle = OPENBCI_STROKE;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(normX, upperY);
                ctx.lineTo(normX + normW, upperY);
                ctx.moveTo(normX, lowerY);
                ctx.lineTo(normX + normW, lowerY);
                ctx.stroke();
            }

            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(driveX, barTop, driveW, barH);
            ctx.strokeStyle = 'rgba(255,140,0,0.35)';
            ctx.strokeRect(driveX, barTop, driveW, barH);
            const drv = Math.max(m.norm || 0, m.drive || 0);
            const hot = drv > normGate || m.drive >= m.driveThreshold;
            fillLevel(
                ctx,
                driveX,
                barTop,
                driveW,
                barH,
                drv,
                hot ? 'rgba(255,160,60,0.95)' : 'rgba(255,140,0,0.2)',
                1
            );

            const thrY = barBottom - m.driveThreshold * barH;
            ctx.strokeStyle = 'rgba(255,90,90,0.9)';
            ctx.lineWidth = 1.25;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(normX, thrY);
            ctx.lineTo(driveX + driveW, thrY);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineWidth = 1;

            ctx.fillStyle = hot ? 'rgba(255,200,120,0.95)' : 'rgba(180,180,190,0.75)';
            ctx.font = '9px Consolas, monospace';
            const txt = `${m.drive.toFixed(2)}/${m.driveThreshold.toFixed(2)}`;
            ctx.fillText(txt, driveX + driveW - ctx.measureText(txt).width - 1, barTop - 2);
        });
    }

    function drawMotionBars(canvas, ctx, metrics, options) {
        if (!canvas || !ctx) return;
        const opts = options || {};
        const panel = !!opts.panel;
        const normGate = opts.normGate != null ? opts.normGate : 0.8;
        const rows = metrics && metrics.length ? metrics : [];
        const rowSlot = panel ? PANEL_ROW_STEP : BAR_ROW_SLOT;
        const cssW = opts.width || (panel ? 300 : 240);
        const { w, h } = layoutCanvas(canvas, ctx, rows.length || 1, cssW, rowSlot);

        if (panel) {
            const g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, 'rgba(22,26,34,0.98)');
            g.addColorStop(1, 'rgba(14,16,22,0.98)');
            ctx.fillStyle = g;
        } else {
            ctx.fillStyle = '#141418';
        }
        ctx.fillRect(0, 0, w, h);

        if (!rows.length) {
            ctx.fillStyle = panel ? 'rgba(160,170,185,0.7)' : '#666';
            ctx.font = panel ? '11px Segoe UI, sans-serif' : '11px Segoe UI, sans-serif';
            ctx.fillText('无运动通道配置', panel ? 12 : 8, panel ? 28 : 22);
            return;
        }

        if (panel) drawPanelBars(ctx, rows, w, h, rowSlot, normGate);
        else drawCompactBars(ctx, rows, w, h, rowSlot, normGate);
    }

    global.SSVEP_EMG_MOTION_BARS = {
        resolvePhysicalChannel,
        refreshMetricsForConfigs,
        drawMotionBars,
        BAR_ROW_SLOT,
        PANEL_ROW_STEP,
        PANEL_BAR_H
    };
})(typeof window !== 'undefined' ? window : globalThis);
