/**
 * esp32-pinout.js
 * ESP32-WROOM simplified SVG pinout diagram with pin highlight.
 * Renders an inline SVG representing the board shape and pin positions.
 */
(function () {
'use strict';

const LEFT_PINS = [
    { num: 1, gpio: '3V3', label: '3V3', type: 'power' },
    { num: 2, gpio: 'EN', label: 'EN', type: 'ctrl' },
    { num: 3, gpio: '36', label: 'GPIO36', type: 'input' },
    { num: 4, gpio: '39', label: 'GPIO39', type: 'input' },
    { num: 5, gpio: '34', label: 'GPIO34', type: 'input' },
    { num: 6, gpio: '35', label: 'GPIO35', type: 'input' },
    { num: 7, gpio: '32', label: 'GPIO32', type: 'io' },
    { num: 8, gpio: '33', label: 'GPIO33', type: 'io' },
    { num: 9, gpio: '25', label: 'GPIO25', type: 'io' },
    { num: 10, gpio: '26', label: 'GPIO26', type: 'io' },
    { num: 11, gpio: '27', label: 'GPIO27', type: 'io' },
    { num: 12, gpio: '14', label: 'GPIO14', type: 'io' },
    { num: 13, gpio: '12', label: 'GPIO12', type: 'io' },
    { num: 14, gpio: 'GND', label: 'GND', type: 'gnd' },
    { num: 15, gpio: '13', label: 'GPIO13', type: 'io' },
    { num: 16, gpio: '9', label: 'GPIO9', type: 'io' },
    { num: 17, gpio: '10', label: 'GPIO10', type: 'io' },
    { num: 18, gpio: '11', label: 'GPIO11', type: 'io' },
    { num: 19, gpio: '5V', label: '5V', type: 'power' },
];

const RIGHT_PINS = [
    { num: 1, gpio: 'GND', label: 'GND', type: 'gnd' },
    { num: 2, gpio: '23', label: 'GPIO23', type: 'io' },
    { num: 3, gpio: '22', label: 'GPIO22', type: 'io' },
    { num: 4, gpio: '1', label: 'GPIO1', type: 'io' },
    { num: 5, gpio: '3', label: 'GPIO3', type: 'io' },
    { num: 6, gpio: '21', label: 'GPIO21', type: 'io' },
    { num: 7, gpio: 'GND', label: 'GND', type: 'gnd' },
    { num: 8, gpio: '19', label: 'GPIO19', type: 'io' },
    { num: 9, gpio: '18', label: 'GPIO18', type: 'io' },
    { num: 10, gpio: '5', label: 'GPIO5', type: 'io' },
    { num: 11, gpio: '17', label: 'GPIO17', type: 'io' },
    { num: 12, gpio: '16', label: 'GPIO16', type: 'io' },
    { num: 13, gpio: '4', label: 'GPIO4', type: 'io' },
    { num: 14, gpio: '0', label: 'GPIO0', type: 'io' },
    { num: 15, gpio: '2', label: 'GPIO2', type: 'io' },
    { num: 16, gpio: '15', label: 'GPIO15', type: 'io' },
    { num: 17, gpio: '8', label: 'GPIO8', type: 'io' },
    { num: 18, gpio: '7', label: 'GPIO7', type: 'io' },
    { num: 19, gpio: '6', label: 'GPIO6', type: 'io' },
];

const BOARD_W = 240;
const BOARD_H = 420;
const PIN_SPACING = 20;
const PIN_R = 5;
const PIN_OFFSET_Y = 24;
const CHIP_W = 80;
const CHIP_H = 80;

function buildSVG(highlightPins, options = {}) {
    const highlighted = new Set((highlightPins || []).map(String));
    const roleColors = options.roleColors || {};

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_W} ${BOARD_H}" class="esp32-pinout-svg">`;

    // Board body
    svg += `<rect x="60" y="8" width="120" height="${BOARD_H - 16}" rx="6" fill="#2d2d2d" stroke="#555" stroke-width="1.5"/>`;

    // USB connector
    svg += `<rect x="90" y="0" width="60" height="16" rx="3" fill="#666" stroke="#888" stroke-width="1"/>`;

    // Chip
    const chipX = (BOARD_W - CHIP_W) / 2;
    const chipY = 50;
    svg += `<rect x="${chipX}" y="${chipY}" width="${CHIP_W}" height="${CHIP_H}" rx="4" fill="#1a1a1a" stroke="#444" stroke-width="1"/>`;
    svg += `<text x="${BOARD_W / 2}" y="${chipY + CHIP_H / 2 + 4}" text-anchor="middle" fill="#888" font-size="9" font-family="monospace">ESP32</text>`;

    // Pins
    function drawPin(side, idx, pin) {
        const y = PIN_OFFSET_Y + idx * PIN_SPACING + 10;
        const isLeft = side === 'left';
        const pinX = isLeft ? 50 : BOARD_W - 50;
        const labelX = isLeft ? 44 : BOARD_W - 44;
        const textAnchor = isLeft ? 'end' : 'start';
        const connX = isLeft ? 60 : BOARD_W - 60;

        const gpioNum = pin.gpio;
        const isHighlighted = highlighted.has(gpioNum);
        const color = isHighlighted
            ? (roleColors[gpioNum] || '#00D9FF')
            : (pin.type === 'power' ? '#f44' : pin.type === 'gnd' ? '#888' : '#aaa');
        const radius = isHighlighted ? PIN_R + 2 : PIN_R;
        const glow = isHighlighted ? ` filter="url(#pin-glow)"` : '';

        // Connection line
        svg += `<line x1="${connX}" y1="${y}" x2="${pinX}" y2="${y}" stroke="${isHighlighted ? color : '#555'}" stroke-width="${isHighlighted ? 2 : 1}"/>`;

        // Pin circle
        svg += `<circle cx="${pinX}" cy="${y}" r="${radius}" fill="${color}"${glow} data-gpio="${gpioNum}" class="esp32-pin"/>`;

        // Label
        svg += `<text x="${labelX}" y="${y + 3.5}" text-anchor="${textAnchor}" fill="${isHighlighted ? color : '#999'}" font-size="${isHighlighted ? 9 : 8}" font-family="monospace" font-weight="${isHighlighted ? 'bold' : 'normal'}">${pin.label}</text>`;

        // Value label (for configured input pins with real-time data)
        if (isHighlighted && (pin.type === 'io' || pin.type === 'input')) {
            const valX = isLeft ? labelX - 50 : labelX + 50;
            svg += `<text x="${valX}" y="${y + 3.5}" text-anchor="${textAnchor}" fill="#fff" font-size="9" font-family="monospace" class="pin-label-val" data-pin="${gpioNum}"></text>`;
        }
    }

    // Glow filter
    svg += `<defs><filter id="pin-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;

    LEFT_PINS.forEach((p, i) => drawPin('left', i, p));
    RIGHT_PINS.forEach((p, i) => drawPin('right', i, p));

    svg += '</svg>';
    return svg;
}

window.ESP32Pinout = {
    render: buildSVG,
    LEFT_PINS,
    RIGHT_PINS,
    allGpioPins: function () {
        const all = [];
        LEFT_PINS.concat(RIGHT_PINS).forEach(p => {
            if (p.type === 'io' || p.type === 'input') all.push(p.gpio);
        });
        return [...new Set(all)];
    }
};

})();
