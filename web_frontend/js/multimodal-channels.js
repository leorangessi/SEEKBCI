/**
 * 多模态输入槽位（编辑器 + 运行端共用）
 * 每槽位（EOG-L/R、MOTION-L/R）在项目里绑定设备管理中已归类为眼电/运动的物理通道。
 * 运行端优先读 WebSocket message.multimodal[slotId]；否则按 physicalChannel 或设备管理映射取采样。
 */
(function () {
    const CHANNELS = [
        { id: 'eog_left', label: '眼电 左', short: 'EOG-L', role: 'eog', side: 'left', fallbackIndex: 0 },
        { id: 'eog_right', label: '眼电 右', short: 'EOG-R', role: 'eog', side: 'right', fallbackIndex: 1 },
        { id: 'motion_left', label: '运动 左', short: 'MOTION-L', role: 'motor_imagery', side: 'left', fallbackIndex: 2 },
        { id: 'motion_right', label: '运动 右', short: 'MOTION-R', role: 'motor_imagery', side: 'right', fallbackIndex: 3 }
    ];
    const LEGACY_ID_MAP = {
        masseter_left: 'motion_left',
        masseter_right: 'motion_right',
        acc_x: 'motion_left',
        acc_y: 'motion_left',
        acc_z: 'motion_left'
    };
    const IDS = CHANNELS.map((c) => c.id);
    const BY_ID = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));

    function migrateChannelId(id) {
        if (typeof id !== 'string') return id;
        return LEGACY_ID_MAP[id] || id;
    }

    function listPhysicalCandidatesForSlot(slotId) {
        const meta = BY_ID[migrateChannelId(slotId)];
        if (!meta) return [];
        const CFG = window.SSVEP_DEVICE_CHANNEL_CONFIG;
        if (!CFG || typeof CFG.getPhysicalChannelsForRole !== 'function') return [];
        return CFG.getPhysicalChannelsForRole(meta.role).map((index) => ({
            index,
            label: `Ch${index + 1}`
        }));
    }

    function defaultPhysicalChannelForSlot(slotId) {
        const cands = listPhysicalCandidatesForSlot(slotId);
        return cands.length ? cands[0].index : null;
    }

    function normalizeMultimodalBlock(block) {
        if (!block || typeof block !== 'object') return block;
        block.channel = migrateChannelId(block.channel);
        if (!BY_ID[block.channel]) {
            block.channel = 'eog_left';
        }
        const meta = BY_ID[block.channel];
        block.label = meta.short;
        if (block.triggerType !== 'hold' && block.triggerType !== 'edge') {
            block.triggerType = meta.role === 'motor_imagery' ? 'hold' : 'edge';
        }
        const pc = block.physicalChannel;
        if (pc == null || pc === '' || !Number.isFinite(Number(pc))) {
            block.physicalChannel = defaultPhysicalChannelForSlot(block.channel);
        } else {
            block.physicalChannel = Number(pc);
        }
        const cands = listPhysicalCandidatesForSlot(block.channel);
        if (
            block.physicalChannel != null &&
            cands.length &&
            !cands.some((c) => c.index === block.physicalChannel)
        ) {
            block.physicalChannel = cands[0].index;
        }
        if (typeof window.ssvepBlockHasConfirmSsvepAction === 'function' && window.ssvepBlockHasConfirmSsvepAction(block)) {
            block.actions = [{ type: 'confirm_ssvep', content: '', targetPage: null, delayMs: 0 }];
            if (block.confirmTimeoutMs == null) block.confirmTimeoutMs = 1000;
        } else if (typeof window.ssvepBlockHasCancelSsvepAction === 'function' && window.ssvepBlockHasCancelSsvepAction(block)) {
            block.actions = [{ type: 'cancel_ssvep', content: '', targetPage: null, delayMs: 0 }];
        }
        if (typeof window.ssvepNormalizeMultimodalDetectionFields === 'function') {
            window.ssvepNormalizeMultimodalDetectionFields(block);
        }
        return block;
    }

    window.SSVEP_MULTIMODAL_CHANNELS = CHANNELS;
    window.SSVEP_MULTIMODAL_CHANNEL_IDS = IDS;
    window.SSVEP_MULTIMODAL_BY_ID = BY_ID;

    window.ssvepIsMultimodalChannelId = function (id) {
        return typeof id === 'string' && BY_ID[migrateChannelId(id)] != null;
    };

    window.ssvepMigrateMultimodalChannelId = migrateChannelId;
    window.ssvepGetModalityRoleForChannel = function (id) {
        const meta = BY_ID[migrateChannelId(id)];
        return meta ? meta.role : null;
    };
    window.ssvepListPhysicalCandidatesForSlot = listPhysicalCandidatesForSlot;
    window.ssvepDefaultPhysicalChannelForSlot = defaultPhysicalChannelForSlot;
    window.ssvepNormalizeMultimodalBlock = normalizeMultimodalBlock;

    window.ssvepIsConfirmSsvepAction = function (action) {
        return !!(action && action.type === 'confirm_ssvep');
    };

    window.ssvepBlockHasConfirmSsvepAction = function (block) {
        if (!block) return false;
        const actions = Array.isArray(block.actions) ? block.actions : block.action ? [block.action] : [];
        return actions.some((a) => window.ssvepIsConfirmSsvepAction(a));
    };

    window.ssvepIsCancelSsvepAction = function (action) {
        return !!(action && action.type === 'cancel_ssvep');
    };

    window.ssvepBlockHasCancelSsvepAction = function (block) {
        if (!block) return false;
        const actions = Array.isArray(block.actions) ? block.actions : block.action ? [block.action] : [];
        return actions.some((a) => window.ssvepIsCancelSsvepAction(a));
    };
})();
