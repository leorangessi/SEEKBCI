/**
 * SSVEP 40 目标 QWERTY 键盘（系统对象）
 * — 10 数字 + 26 字母 + Caps / Space / Backspace / Enter
 * — 频率 8.0～15.8 Hz，步长 0.2 Hz；各键独立相位（联合频率-相位 FBCCA 参考）
 */
(function (global) {
    const KB_SHAPE = 'ssvep_keyboard';
    const FREQ_BASE_HZ = 8.0;
    const FREQ_STEP_HZ = 0.2;
    const KEY_COUNT = 40;
    const FREQ_MAX_HZ = FREQ_BASE_HZ + (KEY_COUNT - 1) * FREQ_STEP_HZ;

    /** @type {Array<Array<{ id: string, flex?: number }>>} */
    const KB_ROWS = [
        [
            { id: '1' },
            { id: '2' },
            { id: '3' },
            { id: '4' },
            { id: '5' },
            { id: '6' },
            { id: '7' },
            { id: '8' },
            { id: '9' },
            { id: '0' }
        ],
        [
            { id: 'Q' },
            { id: 'W' },
            { id: 'E' },
            { id: 'R' },
            { id: 'T' },
            { id: 'Y' },
            { id: 'U' },
            { id: 'I' },
            { id: 'O' },
            { id: 'P' }
        ],
        [
            { id: 'Caps', flex: 1.5 },
            { id: 'A' },
            { id: 'S' },
            { id: 'D' },
            { id: 'F' },
            { id: 'G' },
            { id: 'H' },
            { id: 'J' },
            { id: 'K' },
            { id: 'L' }
        ],
        [
            { id: 'Z' },
            { id: 'X' },
            { id: 'C' },
            { id: 'V' },
            { id: 'B' },
            { id: 'N' },
            { id: 'M' },
            { id: 'Space', flex: 4.2 },
            { id: 'Backspace', flex: 1.85 },
            { id: 'Enter', flex: 1.85 }
        ]
    ];

    /** @type {Record<string, { display: string, code: string, mods?: string[] }>} */
    const KEY_META = {
        '1': { display: '1', code: 'Digit1' },
        '2': { display: '2', code: 'Digit2' },
        '3': { display: '3', code: 'Digit3' },
        '4': { display: '4', code: 'Digit4' },
        '5': { display: '5', code: 'Digit5' },
        '6': { display: '6', code: 'Digit6' },
        '7': { display: '7', code: 'Digit7' },
        '8': { display: '8', code: 'Digit8' },
        '9': { display: '9', code: 'Digit9' },
        '0': { display: '0', code: 'Digit0' },
        Q: { display: 'Q', code: 'KeyQ' },
        W: { display: 'W', code: 'KeyW' },
        E: { display: 'E', code: 'KeyE' },
        R: { display: 'R', code: 'KeyR' },
        T: { display: 'T', code: 'KeyT' },
        Y: { display: 'Y', code: 'KeyY' },
        U: { display: 'U', code: 'KeyU' },
        I: { display: 'I', code: 'KeyI' },
        O: { display: 'O', code: 'KeyO' },
        P: { display: 'P', code: 'KeyP' },
        Caps: { display: 'Caps', code: 'CapsLock' },
        A: { display: 'A', code: 'KeyA' },
        S: { display: 'S', code: 'KeyS' },
        D: { display: 'D', code: 'KeyD' },
        F: { display: 'F', code: 'KeyF' },
        G: { display: 'G', code: 'KeyG' },
        H: { display: 'H', code: 'KeyH' },
        J: { display: 'J', code: 'KeyJ' },
        K: { display: 'K', code: 'KeyK' },
        L: { display: 'L', code: 'KeyL' },
        Z: { display: 'Z', code: 'KeyZ' },
        X: { display: 'X', code: 'KeyX' },
        C: { display: 'C', code: 'KeyC' },
        V: { display: 'V', code: 'KeyV' },
        B: { display: 'B', code: 'KeyB' },
        N: { display: 'N', code: 'KeyN' },
        M: { display: 'M', code: 'KeyM' },
        Space: { display: 'Space', code: 'Space' },
        Backspace: { display: 'Bksp', code: 'Backspace' },
        Enter: { display: 'Enter', code: 'Enter' }
    };

    function isSsvepKeyboardBlock(block) {
        return !!(block && block.shape === KB_SHAPE);
    }

    function keyboardKeyFrequencyHz(index, block) {
        const baseRaw = block && block.keyboardFreqBase != null ? Number(block.keyboardFreqBase) : NaN;
        const stepRaw = block && block.keyboardFreqStep != null ? Number(block.keyboardFreqStep) : NaN;
        const base = Number.isFinite(baseRaw) ? baseRaw : FREQ_BASE_HZ;
        const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : FREQ_STEP_HZ;
        return base + Number(index) * step;
    }

    /** 为键盘块各键生成随机相位（0～1），写入 block.keyboardKeyPhases 后持久化到项目 */
    function assignRandomKeyboardKeyPhases(block) {
        const phases = {};
        for (const row of KB_ROWS) {
            for (const cell of row) {
                phases[cell.id] = Math.round(Math.random() * 10000) / 10000;
            }
        }
        block.keyboardKeyPhases = phases;
        return phases;
    }

    function ensureKeyboardKeyPhases(block) {
        if (!block || !isSsvepKeyboardBlock(block)) return {};
        if (
            block.keyboardKeyPhases &&
            typeof block.keyboardKeyPhases === 'object' &&
            Object.keys(block.keyboardKeyPhases).length >= KEY_COUNT
        ) {
            return block.keyboardKeyPhases;
        }
        return assignRandomKeyboardKeyPhases(block);
    }

    function keyboardKeyPhaseFor(block, keyId, index) {
        ensureKeyboardKeyPhases(block);
        if (block.keyboardKeyPhases && block.keyboardKeyPhases[keyId] != null) {
            return Number(block.keyboardKeyPhases[keyId]);
        }
        return (Number(index) * 0.618033988749895) % 1.0;
    }

    function defaultKeyboardKeyAction(keyId) {
        const meta = KEY_META[keyId];
        if (!meta) return { type: 'none', content: '', targetPage: null, delayMs: 0 };
        const chords = [{ mods: meta.mods ? meta.mods.slice() : [], code: meta.code }];
        const content =
            typeof global.serializeKeyboardBinding === 'function'
                ? global.serializeKeyboardBinding(chords)
                : JSON.stringify({ v: 1, chords });
        return { type: 'keyboard', content, targetPage: null, delayMs: 0 };
    }

    /** 扁平 40 键定义（顺序与频率索引一致）；block 提供各键随机相位 */
    function getSsvepKeyboard40KeyDefs(block) {
        if (block) ensureKeyboardKeyPhases(block);
        const out = [];
        let idx = 0;
        for (const row of KB_ROWS) {
            for (const cell of row) {
                const meta = KEY_META[cell.id];
                if (!meta) continue;
                out.push({
                    id: cell.id,
                    display: meta.display,
                    code: meta.code,
                    flex: cell.flex != null ? cell.flex : 1,
                    frequencyHz: keyboardKeyFrequencyHz(idx, block),
                    phase: block ? keyboardKeyPhaseFor(block, cell.id, idx) : 0,
                    index: idx
                });
                idx += 1;
            }
        }
        return out;
    }

    function buildKeyboardVirtualTargets(block) {
        if (!isSsvepKeyboardBlock(block)) return [];
        const defs = getSsvepKeyboard40KeyDefs(block);
        const overrides = block.keyboardKeyActions && typeof block.keyboardKeyActions === 'object'
            ? block.keyboardKeyActions
            : null;
        return defs.map((k) => {
            let actions;
            if (overrides && overrides[k.id]) {
                actions = Array.isArray(overrides[k.id]) ? overrides[k.id] : [overrides[k.id]];
            } else {
                actions = [defaultKeyboardKeyAction(k.id)];
            }
            return {
                id: `${block.id}_kb_${k.id}`,
                parentKeyboardId: block.id,
                keyId: k.id,
                shape: 'keyboard_key',
                label: k.display,
                frequency: k.frequencyHz,
                phase: k.phase,
                color: block.color || '#00D9FF',
                actions,
                action: actions[0]
            };
        });
    }

    function expandPageBlocksForDecode(blocks) {
        const out = [];
        for (const b of blocks || []) {
            if (isSsvepKeyboardBlock(b)) out.push(...buildKeyboardVirtualTargets(b));
            else out.push(b);
        }
        return out;
    }

    function collectPageFrequencyEntries(blocks) {
        const entries = [];
        for (const b of blocks || []) {
            if (isSsvepKeyboardBlock(b)) {
                for (const vt of buildKeyboardVirtualTargets(b)) {
                    entries.push({
                        label: `键盘·${vt.label}`,
                        hz: Number(vt.frequency),
                        block: b,
                        virtual: vt
                    });
                }
            } else if (b && b.frequency != null) {
                entries.push({
                    label: b.label || '对象',
                    hz: Number(b.frequency),
                    block: b,
                    virtual: null
                });
            }
        }
        return entries;
    }

    function countSsvepKeyboardsOnPage(blocks) {
        return (blocks || []).filter(isSsvepKeyboardBlock).length;
    }

    function countNonKeyboardSsvepBlocks(blocks) {
        return (blocks || []).filter((b) => b && !isSsvepKeyboardBlock(b)).length;
    }

    function createSsvepKeyboardBlockTemplate(id, canvasWidth, canvasHeight) {
        const w = Math.min(960, Math.max(640, (canvasWidth || 1200) - 80));
        const h = Math.min(400, Math.max(280, Math.round(w * 0.36)));
        const x = Math.max(20, Math.round(((canvasWidth || 1200) - w) / 2));
        const y = Math.max(20, Math.round(((canvasHeight || 700) - h) / 2));
        const block = {
            id,
            shape: KB_SHAPE,
            x,
            y,
            width: w,
            height: h,
            label: 'SSVEP 键盘 (40)',
            frequency: null,
            phase: 0,
            color: '#00D9FF',
            rotation: 0,
            keyboardLayout: 'qwerty40',
            keyboardKeyPhases: {},
            /** 透明背景运行时：键盘区域实心黑底闪烁，提高 SSVEP 对比度 */
            opaqueFlickerRegion: true,
            actions: [{ type: 'none', content: '', targetPage: null, delayMs: 0 }]
        };
        assignRandomKeyboardKeyPhases(block);
        return block;
    }

    global.SSVEP_KEYBOARD_40 = {
        SHAPE: KB_SHAPE,
        FREQ_BASE_HZ,
        FREQ_STEP_HZ,
        FREQ_MAX_HZ,
        KEY_COUNT,
        KB_ROWS,
        isSsvepKeyboardBlock,
        keyboardKeyFrequencyHz,
        getSsvepKeyboard40KeyDefs,
        buildKeyboardVirtualTargets,
        expandPageBlocksForDecode,
        collectPageFrequencyEntries,
        countSsvepKeyboardsOnPage,
        countNonKeyboardSsvepBlocks,
        createSsvepKeyboardBlockTemplate,
        assignRandomKeyboardKeyPhases,
        ensureKeyboardKeyPhases,
        defaultKeyboardKeyAction
    };
})(typeof window !== 'undefined' ? window : globalThis);
