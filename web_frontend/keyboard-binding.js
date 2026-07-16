/**
 * 键盘快捷键绑定：结构化存储 + 显示名解析（编辑器录制 / 预览 / 校验共用）
 * action.content 存 JSON 字符串: { v: 1, chords: [{ mods: ['ctrl'], code: 'KeyC' }, ...] }
 * 兼容旧数据：任意非 JSON 字符串视为 legacy 原文展示
 */

(function (global) {
    const MOD_ORDER = ['ctrl', 'shift', 'alt', 'meta'];

    function parseKeyboardBinding(raw) {
        if (raw == null || raw === '') return null;
        const s = String(raw).trim();
        if (!s) return null;
        if (s.startsWith('{')) {
            try {
                const o = JSON.parse(s);
                if (o && o.v === 1 && Array.isArray(o.chords)) return o;
            } catch (_) { /* fallthrough */ }
        }
        return { v: 1, legacyText: s };
    }

    function hasKeyboardBinding(binding) {
        if (!binding) return false;
        if (binding.legacyText) return binding.legacyText.length > 0;
        return Array.isArray(binding.chords) && binding.chords.length > 0;
    }

    function modLabel(m) {
        if (m === 'ctrl') return 'Ctrl';
        if (m === 'shift') return 'Shift';
        if (m === 'alt') return 'Alt';
        if (m === 'meta') return 'Win';
        return m;
    }

    function codeToShortLabel(code) {
        if (!code) return '?';
        if (code.startsWith('Key') && code.length === 4) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
        const named = {
            Space: 'Space',
            Enter: 'Enter',
            Tab: 'Tab',
            Backspace: 'Backspace',
            Delete: 'Delete',
            Escape: 'Esc',
            Minus: '-',
            Equal: '=',
            BracketLeft: '[',
            BracketRight: ']',
            Backslash: '\\',
            Semicolon: ';',
            Quote: "'",
            Comma: ',',
            Period: '.',
            Slash: '/',
            IntlBackslash: '\\',
            ArrowUp: '↑',
            ArrowDown: '↓',
            ArrowLeft: '←',
            ArrowRight: '→',
            Home: 'Home',
            End: 'End',
            PageUp: 'PageUp',
            PageDown: 'PageDown',
            Insert: 'Insert',
            ContextMenu: 'Menu'
        };
        if (named[code]) return named[code];
        if (/^F\d{1,2}$/.test(code)) return code;
        return code;
    }

    function formatChord(chord) {
        if (!chord || !chord.code) return '';
        const parts = [];
        const mods = chord.mods || [];
        for (const m of MOD_ORDER) {
            if (mods.includes(m)) parts.push(modLabel(m));
        }
        parts.push(codeToShortLabel(chord.code));
        return parts.join('+');
    }

    function formatKeyboardBindingDisplay(binding) {
        if (!binding) return '（未绑定）';
        if (binding.legacyText) return binding.legacyText;
        if (!binding.chords || binding.chords.length === 0) return '（未绑定）';
        return binding.chords.map(formatChord).join(' → ');
    }

    function chordFromKeyboardEvent(e) {
        const mods = [];
        if (e.ctrlKey) mods.push('ctrl');
        if (e.shiftKey) mods.push('shift');
        if (e.altKey) mods.push('alt');
        if (e.metaKey) mods.push('meta');
        return { mods, code: e.code };
    }

    function isModifierKeyCode(code) {
        return (
            code === 'ControlLeft' ||
            code === 'ControlRight' ||
            code === 'ShiftLeft' ||
            code === 'ShiftRight' ||
            code === 'AltLeft' ||
            code === 'AltRight' ||
            code === 'MetaLeft' ||
            code === 'MetaRight'
        );
    }

    function serializeKeyboardBinding(chords) {
        return JSON.stringify({ v: 1, chords: chords || [] });
    }

    global.parseKeyboardBinding = parseKeyboardBinding;
    global.formatKeyboardBindingDisplay = formatKeyboardBindingDisplay;
    global.chordFromKeyboardEvent = chordFromKeyboardEvent;
    global.isModifierKeyCode = isModifierKeyCode;
    global.serializeKeyboardBinding = serializeKeyboardBinding;
    global.hasKeyboardBinding = hasKeyboardBinding;
})(typeof window !== 'undefined' ? window : globalThis);
