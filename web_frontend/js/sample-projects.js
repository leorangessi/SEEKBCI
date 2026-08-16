/**
 * 内置示例 SSVEP 项目（含 Python 全局代码与动作）。
 * 由 project-manager.js 在首次打开时写入 localStorage。
 */
(function (global) {
    const MUSIC_GLOBAL = [
        'import winsound',
        'import time',
        'import json',
        'import os',
        'import random',
        '',
        "_STATE_PATH = os.path.join(os.path.expanduser('~'), '.ssvep_brain_music_box.json')",
        '',
        'def _load_box():',
        '    try:',
        "        with open(_STATE_PATH, encoding='utf-8') as f:",
        '            return json.load(f)',
        '    except Exception:',
        "        return {'plays': 0, 'recent': []}",
        '',
        'def _save_box(box):',
        "    with open(_STATE_PATH, 'w', encoding='utf-8') as f:",
        '        json.dump(box, f, ensure_ascii=False)',
        '',
        'MUSIC_BOX = _load_box()',
        '',
        'MELODY = {',
        "    'twinkle': [(523, 220), (523, 220), (784, 220), (784, 220), (880, 220), (880, 220), (784, 440)],",
        "    'happy': [(523, 160), (587, 160), (659, 160), (698, 160), (784, 320)],",
        "    'sos': [(770, 120), (770, 120), (770, 120), (0, 80), (880, 300), (880, 300), (880, 300), (0, 80), (770, 120), (770, 120), (770, 120)],",
        "    'fanfare': [(523, 120), (659, 120), (784, 120), (1046, 420)],",
        '}',
        '',
        'def play_melody(key):',
        '    global MUSIC_BOX',
        '    seq = MELODY.get(key, [(440, 200)])',
        '    for freq, dur in seq:',
        '        if freq > 0:',
        '            winsound.Beep(int(freq), int(dur))',
        '        else:',
        '            time.sleep(dur / 1000.0)',
        '        time.sleep(0.015)',
        "    MUSIC_BOX['plays'] += 1",
        "    MUSIC_BOX['recent'] = (MUSIC_BOX['recent'] + [key])[-5:]",
        '    _save_box(MUSIC_BOX)',
        '    print(f"[MusicBox] {key} | total={MUSIC_BOX[\'plays\']} | recent={MUSIC_BOX[\'recent\']}")',
        '',
        'def play_surprise():',
        '    key = random.choice(list(MELODY.keys()))',
        '    print(f"[MusicBox] surprise -> {key}")',
        '    play_melody(key)',
        '',
        'def reset_music_box():',
        '    global MUSIC_BOX',
        "    MUSIC_BOX = {'plays': 0, 'recent': []}",
        '    _save_box(MUSIC_BOX)',
        '    winsound.Beep(440, 120)',
        '    print("[MusicBox] stats reset")'
    ].join('\n');

    const DICE_GLOBAL = [
        'import random',
        'import winsound',
        'import time',
        '',
        'FORTUNE = [',
        "    '今天适合尝试新事物！',",
        "    '专注当下，好运自来。',",
        "    '退一步海阔天空。',",
        "    '勇敢迈出第一步。',",
        "    '休息也是生产力。',",
        "    '意想不到的惊喜在路上。',",
        ']',
        '',
        "DICE_STATS = {'rolls': 0, 'lucky_hits': 0, 'last': None}",
        '',
        'def roll_dice(n=2):',
        '    global DICE_STATS',
        '    faces = []',
        '    for _ in range(n):',
        '        v = random.randint(1, 6)',
        '        faces.append(v)',
        '        winsound.Beep(250 + v * 90, 90)',
        '        time.sleep(0.06)',
        '    total = sum(faces)',
        '    winsound.Beep(300 + total * 15, max(150, total * 25))',
        "    DICE_STATS['rolls'] += 1",
        "    DICE_STATS['last'] = faces",
        '    msg = f"Roll {faces} -> sum={total}"',
        '    if total >= 10:',
        "        DICE_STATS['lucky_hits'] += 1",
        "        msg += ' | LUCKY!'",
        '    print(f"[Dice] {msg} | rolls={DICE_STATS[\'rolls\']} lucky={DICE_STATS[\'lucky_hits\']}")',
        '    return faces',
        '',
        'def draw_fortune():',
        '    line = random.choice(FORTUNE)',
        '    winsound.Beep(660, 120)',
        '    time.sleep(0.05)',
        '    winsound.Beep(880, 180)',
        '    print(f"[Fortune] {line}")',
        '',
        'def show_stats():',
        '    print(f"[Dice] rolls={DICE_STATS[\'rolls\']} lucky={DICE_STATS[\'lucky_hits\']} last={DICE_STATS[\'last\']}")'
    ].join('\n');

    function pyAction(code) {
        return { type: 'python', content: code, targetPage: null, delayMs: 0 };
    }

    function ssvepBlock(id, opts) {
        return {
            id,
            shape: opts.shape || 'rectangle',
            x: opts.x,
            y: opts.y,
            width: opts.w,
            height: opts.h,
            label: opts.label,
            frequency: opts.freq,
            phase: opts.phase || 0,
            color: opts.color || '#00D9FF',
            rotation: 0,
            opaqueFlickerRegion: true,
            actions: [pyAction(opts.code)]
        };
    }

    /** 与 js/ssvep-keyboard-40.js 行序一致；固定相位便于复现实验 */
    const KB_KEY_IDS = [
        '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
        'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P',
        'Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L',
        'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Space', 'Backspace', 'Enter'
    ];

    function buildFixedKeyboardKeyPhases() {
        const phases = {};
        const PHI = 0.618033988749895;
        KB_KEY_IDS.forEach((id, i) => {
            phases[id] = Math.round(((i * PHI) % 1) * 10000) / 10000;
        });
        return phases;
    }

    function buildSsvepKeyboardTestBlock(id, layout) {
        const cw = (layout && layout.width) || 1200;
        const ch = (layout && layout.height) || 700;
        const w = Math.min(1040, Math.max(720, cw - 80));
        const h = Math.min(420, Math.max(300, Math.round(w * 0.38)));
        return {
            id,
            shape: 'ssvep_keyboard',
            x: Math.max(20, Math.round((cw - w) / 2)),
            y: Math.max(40, Math.round((ch - h) / 2) - 20),
            width: w,
            height: h,
            label: 'SSVEP 键盘 (40)',
            frequency: null,
            phase: 0,
            color: '#00D9FF',
            rotation: 0,
            keyboardLayout: 'qwerty40',
            keyboardKeyPhases: buildFixedKeyboardKeyPhases(),
            opaqueFlickerRegion: true,
            actions: [{ type: 'none', content: '', targetPage: null, delayMs: 0 }]
        };
    }

    const now = '2026-06-04T08:00:00.000Z';
    const layoutRef = { width: 1200, height: 700 };
    const defaultRunConfig = {
        eegEnabled: true,
        mode: 'threshold',
        windowSec: 2.0,
        cooldownSec: 1.5,
        pollMs: 320,
        intervalSec: 3,
        minProbability: 0.28,
        minMargin: 0.08,
        thresholdRequireStable: false,
        transparentBackground: false,
        startFullscreen: false,
        flickerHighBlank: false,
        flickerOnDutyPercent: 32,
        flickerBlockOpacityPercent: 58,
        speakOnDecode: false,
        ssvepMultimodalWaitSec: 1.0
    };

    const SAMPLE_PROJECTS = [
        {
            contractVersion: 1,
            id: 'sample_brain_music_box',
            sampleKey: 'brain_music_box_v1',
            name: '脑控音乐盒',
            description:
                '注视四个闪烁目标，触发不同旋律（小星星 / 生日快乐 / SOS / 凯旋）。Python 在后端播放 winsound 并累计播放记录。也可关闭 EEG 纯点击体验。',
            author: 'SSVEP 平台示例',
            version: '1.0.0',
            created_at: now,
            updated_at: now,
            thumbnail: '🎵',
            pages: [
                {
                    id: 0,
                    name: '音乐台',
                    stimulusLayoutRef: layoutRef,
                    blocks: [
                        ssvepBlock(0, {
                            label: '小星星',
                            shape: 'circle',
                            x: 120,
                            y: 160,
                            w: 200,
                            h: 200,
                            freq: 8.0,
                            phase: 0,
                            color: '#FF6B9D',
                            code: "play_melody('twinkle')"
                        }),
                        ssvepBlock(1, {
                            label: '生日快乐',
                            shape: 'hexagon',
                            x: 380,
                            y: 160,
                            w: 200,
                            h: 200,
                            freq: 10.0,
                            phase: 0.15,
                            color: '#FFD166',
                            code: "play_melody('happy')"
                        }),
                        ssvepBlock(2, {
                            label: 'SOS',
                            shape: 'triangle',
                            x: 640,
                            y: 160,
                            w: 200,
                            h: 200,
                            freq: 12.0,
                            phase: 0.3,
                            color: '#06D6A0',
                            code: "play_melody('sos')"
                        }),
                        ssvepBlock(3, {
                            label: '凯旋曲',
                            shape: 'diamond',
                            x: 900,
                            y: 160,
                            w: 200,
                            h: 200,
                            freq: 14.0,
                            phase: 0.45,
                            color: '#118AB2',
                            code: "play_melody('fanfare')"
                        }),
                        ssvepBlock(4, {
                            label: '随机一曲',
                            shape: 'pentagon',
                            x: 250,
                            y: 420,
                            w: 200,
                            h: 180,
                            freq: 9.0,
                            phase: 0.6,
                            color: '#EF476F',
                            code: 'play_surprise()'
                        }),
                        ssvepBlock(5, {
                            label: '重置统计',
                            shape: 'rectangle',
                            x: 750,
                            y: 420,
                            w: 200,
                            h: 180,
                            freq: 11.0,
                            phase: 0.75,
                            color: '#8338EC',
                            code: 'reset_music_box()'
                        })
                    ],
                    multimodalBlocks: []
                }
            ],
            frequencies: [],
            phases: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0],
            runConfig: defaultRunConfig,
            settings: {
                autoAssignFreqPhaseOnSave: false,
                pythonImports: [],
                pythonGlobalCode: MUSIC_GLOBAL,
                advancedFeaturesOpen: false
            },
            version_history: [{ version: '1.0.0', timestamp: now, changes: '示例项目创建' }]
        },
        {
            contractVersion: 1,
            id: 'sample_brain_dice_fortune',
            sampleKey: 'brain_dice_fortune_v1',
            name: '脑控骰子运势站',
            description:
                '用 SSVEP 掷骰子、抽运势、查看统计。每次触发 Python 随机逻辑 + 蜂鸣反馈，刺激页控制面板可查看 Python 执行日志。',
            author: 'SSVEP 平台示例',
            version: '1.0.0',
            created_at: now,
            updated_at: now,
            thumbnail: '🎲',
            pages: [
                {
                    id: 0,
                    name: '运势台',
                    stimulusLayoutRef: layoutRef,
                    blocks: [
                        ssvepBlock(0, {
                            label: '掷 1 骰',
                            shape: 'circle',
                            x: 140,
                            y: 180,
                            w: 220,
                            h: 220,
                            freq: 8.0,
                            phase: 0,
                            color: '#FFE066',
                            code: 'roll_dice(1)'
                        }),
                        ssvepBlock(1, {
                            label: '掷 2 骰',
                            shape: 'diamond',
                            x: 420,
                            y: 180,
                            w: 220,
                            h: 220,
                            freq: 10.0,
                            phase: 0.15,
                            color: '#FF6B6B',
                            code: 'roll_dice(2)'
                        }),
                        ssvepBlock(2, {
                            label: '今日运势',
                            shape: 'hexagon',
                            x: 700,
                            y: 180,
                            w: 220,
                            h: 220,
                            freq: 12.0,
                            phase: 0.3,
                            color: '#4ECDC4',
                            code: 'draw_fortune()'
                        }),
                        ssvepBlock(3, {
                            label: '查看统计',
                            shape: 'pentagon',
                            x: 980,
                            y: 180,
                            w: 200,
                            h: 220,
                            freq: 14.0,
                            phase: 0.45,
                            color: '#9B59B6',
                            code: 'show_stats()'
                        })
                    ],
                    multimodalBlocks: []
                }
            ],
            frequencies: [],
            phases: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0],
            runConfig: defaultRunConfig,
            settings: {
                autoAssignFreqPhaseOnSave: false,
                pythonImports: [],
                pythonGlobalCode: DICE_GLOBAL,
                advancedFeaturesOpen: false
            },
            version_history: [{ version: '1.0.0', timestamp: now, changes: '示例项目创建' }]
        },
        {
            contractVersion: 1,
            id: 'sample_ssvep_keyboard_test',
            sampleKey: 'ssvep_keyboard_test_v1',
            name: 'SSVEP 键盘测试',
            description:
                '40 目标 QWERTY 脑控键盘（8.0～15.8 Hz，0.2 Hz 步长，联合频率-相位）。识别后注入系统按键。用于打字准确率、窗长/阈值/相位与 ITR 等研究；请先连接 SEEKBCI 并开启系统选项。',
            author: 'SSVEP 平台示例',
            version: '1.0.0',
            created_at: '2026-07-19T12:00:00.000Z',
            updated_at: '2026-07-19T12:00:00.000Z',
            thumbnail: '⌨️',
            pages: [
                {
                    id: 0,
                    name: '键盘',
                    stimulusLayoutRef: layoutRef,
                    blocks: [buildSsvepKeyboardTestBlock(1, layoutRef)],
                    multimodalBlocks: []
                }
            ],
            frequencies: [],
            phases: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0],
            runConfig: {
                ...defaultRunConfig,
                // 40 类目标需要更长窗与更严一点的阈值门控
                windowSec: 3.0,
                cooldownSec: 2.0,
                pollMs: 400,
                minProbability: 0.22,
                minMargin: 0.06,
                flickerOnDutyPercent: 50,
                flickerBlockOpacityPercent: 100,
                speakOnDecode: true
            },
            settings: {
                autoAssignFreqPhaseOnSave: false,
                pythonImports: [],
                pythonGlobalCode: '',
                advancedFeaturesOpen: false,
                systemKeyboardBridge: true,
                cursorControl: {
                    enabled: false,
                    mapping: { sensitivity: 42, invertX: true, invertY: true, headMode: true },
                    clickMethod: 'none',
                    clickType: 'single',
                    dwellMs: 900,
                    dwellStillPx: 14,
                    dwellCooldownMs: 700
                },
                locomotionControl: {
                    enabled: false,
                    mode: 'lean',
                    accelForwardTh: 1.0,
                    accelStrafeTh: 1.0,
                    accelSensitivity: 2.5
                }
            },
            version_history: [
                {
                    version: '1.0.0',
                    timestamp: '2026-07-19T12:00:00.000Z',
                    changes: 'SSVEP 40 键键盘测试项目'
                }
            ]
        }
    ];

    global.SSVEP_SAMPLE_PROJECTS = SAMPLE_PROJECTS;
})(typeof window !== 'undefined' ? window : globalThis);
