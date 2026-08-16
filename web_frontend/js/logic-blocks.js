/**
 * logic-blocks.js — 规则画布逻辑块注册表（Grasshopper 式电池块）
 */
(function () {
'use strict';

const LOGIC_BLOCKS = {
    invert: {
        label: '反向 NOT',
        icon: '¬',
        color: '#7c4dff',
        inputs: [{ id: 'in0', label: 'IN', kind: 'digital' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [],
        desc: '数字取反：IN 高→OUT 低'
    },
    and: {
        label: '逻辑与 AND',
        icon: '&',
        color: '#5c6bc0',
        inputs: [
            { id: 'in0', label: 'A', kind: 'digital' },
            { id: 'in1', label: 'B', kind: 'digital' }
        ],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [],
        desc: '两路数字输入均为高时输出高'
    },
    or: {
        label: '逻辑或 OR',
        icon: '≥1',
        color: '#5c6bc0',
        inputs: [
            { id: 'in0', label: 'A', kind: 'digital' },
            { id: 'in1', label: 'B', kind: 'digital' }
        ],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [],
        desc: '任一路为高则输出高'
    },
    xor: {
        label: '异或 XOR',
        icon: '⊕',
        color: '#5c6bc0',
        inputs: [
            { id: 'in0', label: 'A', kind: 'digital' },
            { id: 'in1', label: 'B', kind: 'digital' }
        ],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [],
        desc: '两路不同时输出高'
    },
    nand: {
        label: '与非 NAND',
        icon: '⊼',
        color: '#5c6bc0',
        inputs: [
            { id: 'in0', label: 'A', kind: 'digital' },
            { id: 'in1', label: 'B', kind: 'digital' }
        ],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [],
        desc: 'AND 结果取反'
    },
    nor: {
        label: '或非 NOR',
        icon: '⊽',
        color: '#5c6bc0',
        inputs: [
            { id: 'in0', label: 'A', kind: 'digital' },
            { id: 'in1', label: 'B', kind: 'digital' }
        ],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [],
        desc: 'OR 结果取反'
    },
    threshold: {
        label: 'ADC 阈值',
        icon: '⌁',
        color: '#ff9800',
        inputs: [{ id: 'in0', label: 'ADC', kind: 'analog' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [
            { key: 'mode', label: '模式', type: 'select', options: [
                { value: 'gt', label: '大于阈值→ON' },
                { value: 'lt', label: '小于阈值→ON' }
            ], default: 'gt' },
            { key: 'threshold', label: '阈值', type: 'number', default: 2048, min: 0, max: 4095 }
        ],
        desc: 'ADC 与阈值比较，输出数字量'
    },
    hysteresis: {
        label: '迟滞比较',
        icon: '⧗',
        color: '#ff9800',
        inputs: [{ id: 'in0', label: 'ADC', kind: 'analog' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [
            { key: 'low', label: '低阈', type: 'number', default: 1800, min: 0, max: 4095 },
            { key: 'high', label: '高阈', type: 'number', default: 2200, min: 0, max: 4095 }
        ],
        desc: '双阈值防抖动，常用于 ADC'
    },
    scale: {
        label: '线性映射',
        icon: '↕',
        color: '#00bcd4',
        inputs: [{ id: 'in0', label: 'IN', kind: 'analog' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'analog' }],
        params: [
            { key: 'inMin', label: '输入下限', type: 'number', default: 0 },
            { key: 'inMax', label: '输入上限', type: 'number', default: 4095 },
            { key: 'outMin', label: '输出下限', type: 'number', default: 0 },
            { key: 'outMax', label: '输出上限', type: 'number', default: 255 }
        ],
        desc: 'ADC/PWM 线性缩放'
    },
    pid: {
        label: 'PID',
        icon: 'PID',
        color: '#009688',
        inputs: [{ id: 'in0', label: 'PV', kind: 'analog' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'analog' }],
        params: [
            { key: 'setpoint', label: '目标值 SP', type: 'number', default: 2048 },
            { key: 'kp', label: 'Kp', type: 'number', default: 0.05, step: 0.001 },
            { key: 'ki', label: 'Ki', type: 'number', default: 0.001, step: 0.0001 },
            { key: 'kd', label: 'Kd', type: 'number', default: 0.01, step: 0.001 },
            { key: 'outMin', label: '输出下限', type: 'number', default: 0 },
            { key: 'outMax', label: '输出上限', type: 'number', default: 255 }
        ],
        desc: 'PID 控制，输出可用于 PWM/DAC'
    },
    debounce: {
        label: '消抖',
        icon: '⏱',
        color: '#ff9800',
        inputs: [{ id: 'in0', label: 'IN', kind: 'digital' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [{ key: 'ms', label: '稳定时间(ms)', type: 'number', default: 50, min: 0, step: 1 }],
        desc: '输入稳定一段时间后才翻转输出'
    },
    edge: {
        label: '边沿',
        icon: '↥',
        color: '#ff7043',
        inputs: [{ id: 'in0', label: 'IN', kind: 'digital' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [{ key: 'mode', label: '模式', type: 'select', options: [
            { value: 'rise', label: '上升沿' },
            { value: 'fall', label: '下降沿' },
            { value: 'both', label: '双边沿' }
        ], default: 'rise' }],
        desc: '输入变化时输出一个脉冲'
    },
    delay: {
        label: '延时',
        icon: '⌛',
        color: '#26c6da',
        inputs: [{ id: 'in0', label: 'IN', kind: 'digital' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [{ key: 'ms', label: '延时(ms)', type: 'number', default: 200, min: 0, step: 1 }],
        desc: '输入翻转后延迟指定时间再输出'
    },
    latch: {
        label: '锁存',
        icon: 'S',
        color: '#ab47bc',
        inputs: [
            { id: 'set', label: 'SET', kind: 'digital' },
            { id: 'reset', label: 'RESET', kind: 'digital' }
        ],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [{ key: 'resetDominant', label: '复位优先', type: 'select', options: [
            { value: '1', label: '是' },
            { value: '0', label: '否' }
        ], default: '1' }],
        desc: 'SR 锁存器'
    },
    counter: {
        label: '计数',
        icon: '#',
        color: '#8d6e63',
        inputs: [{ id: 'in0', label: 'IN', kind: 'digital' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'analog' }],
        params: [
            { key: 'mode', label: '计数模式', type: 'select', options: [
                { value: 'pulse', label: '脉冲计数' },
                { value: 'hold', label: '保持计数' }
            ], default: 'pulse' },
            { key: 'resetAt', label: '重置阈值', type: 'number', default: 0, min: 0, step: 1 }
        ],
        desc: '可用作触发次数统计或节拍器'
    },
    debounce: {
        label: '消抖',
        icon: '⏱',
        color: '#ff9800',
        inputs: [{ id: 'in0', label: 'IN', kind: 'digital' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [{ key: 'ms', label: '稳定时间(ms)', type: 'number', default: 50, min: 0, step: 1 }],
        desc: '输入稳定一段时间后才翻转输出'
    },
    edge: {
        label: '边沿',
        icon: '↥',
        color: '#ff7043',
        inputs: [{ id: 'in0', label: 'IN', kind: 'digital' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [{ key: 'mode', label: '模式', type: 'select', options: [
            { value: 'rise', label: '上升沿' },
            { value: 'fall', label: '下降沿' },
            { value: 'both', label: '双边沿' }
        ], default: 'rise' }],
        desc: '输入变化时输出一个脉冲'
    },
    delay: {
        label: '延时',
        icon: '⌛',
        color: '#26c6da',
        inputs: [{ id: 'in0', label: 'IN', kind: 'digital' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [{ key: 'ms', label: '延时(ms)', type: 'number', default: 200, min: 0, step: 1 }],
        desc: '输入翻转后延迟指定时间再输出'
    },
    latch: {
        label: '锁存',
        icon: 'S',
        color: '#ab47bc',
        inputs: [
            { id: 'set', label: 'SET', kind: 'digital' },
            { id: 'reset', label: 'RESET', kind: 'digital' }
        ],
        outputs: [{ id: 'out', label: 'OUT', kind: 'digital' }],
        params: [{ key: 'resetDominant', label: '复位优先', type: 'select', options: [
            { value: '1', label: '是' },
            { value: '0', label: '否' }
        ], default: '1' }],
        desc: 'SR 锁存器'
    },
    counter: {
        label: '计数',
        icon: '#',
        color: '#8d6e63',
        inputs: [{ id: 'in0', label: 'IN', kind: 'digital' }],
        outputs: [{ id: 'out', label: 'OUT', kind: 'analog' }],
        params: [
            { key: 'mode', label: '计数模式', type: 'select', options: [
                { value: 'pulse', label: '脉冲计数' },
                { value: 'hold', label: '保持计数' }
            ], default: 'pulse' },
            { key: 'resetAt', label: '重置阈值', type: 'number', default: 0, min: 0, step: 1 }
        ],
        desc: '可用作触发次数统计或节拍器'
    },    script: {
        label: '脚本块',
        icon: '{}',
        color: '#e91e63',
        inputs: [
            { id: 'in0', label: 'IN0', kind: 'any' },
            { id: 'in1', label: 'IN1', kind: 'any' }
        ],
        outputs: [{ id: 'out', label: 'OUT', kind: 'any' }],
        params: [
            { key: 'outKind', label: '输出类型', type: 'select', options: [
                { value: '1', label: '数字 (ON/OFF)' },
                { value: '2', label: '模拟量' }
            ], default: '1' },
            { key: 'code', label: '代码', type: 'code', default:
                '# Python 脚本，可用 in0/in1/inputs\n' +
                '# 示例: result = 1 if in0 > 2048 else 0\n' +
                'result = 1 if in0 > 0.5 else 0\n'
            }
        ],
        desc: 'Python 高级逻辑（类 C 写法: result = 1 if in0 > 2048 else 0）'
    }
};

function freshParams(blockType) {
    const def = LOGIC_BLOCKS[blockType];
    if (!def) return {};
    const params = {};
    (def.params || []).forEach(p => {
        params[p.key] = p.default != null ? p.default : '';
    });
    return params;
}

function getBlockDef(blockType) {
    return LOGIC_BLOCKS[blockType] || null;
}

function listBlocks() {
    return Object.keys(LOGIC_BLOCKS).map(k => ({ type: k, ...LOGIC_BLOCKS[k] }));
}

function logicPortFlow(portId, blockType, portName) {
    const def = LOGIC_BLOCKS[blockType];
    if (!def) return 'source';
    if ((def.outputs || []).some(p => p.id === portName)) return 'source';
    return 'sink';
}

function isLogicPortSource(portId, logicNodes) {
    const idx = portId.lastIndexOf(':');
    if (idx < 0) return false;
    const nodeId = portId.substring(0, idx);
    const pin = portId.substring(idx + 1);
    const node = logicNodes.find(n => n.id === nodeId);
    if (!node) return false;
    return logicPortFlow(portId, node.blockType, pin) === 'source';
}

window.LogicBlocks = {
    LOGIC_BLOCKS,
    freshParams,
    getBlockDef,
    listBlocks,
    logicPortFlow,
    isLogicPortSource
};

})();
