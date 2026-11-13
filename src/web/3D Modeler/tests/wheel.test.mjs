/*
    The mouse wheel over a size box (wheelStep in js/ui.js).
    Run with: node tests/run.mjs wheel
*/
// ui.js listens on the document when it loads; a stand in is enough here
globalThis.document = globalThis.document || { addEventListener() {}, getElementById() { return null; } };
const { wheelStep } = await import('../js/ui.js');

let failed = 0;
const a = (c, m, x) => { if (!c) { failed++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };

// A stand in for an <input>: an event target with a value
function box(value, options) {
    const input = new EventTarget();
    input.value = value;
    input.disabled = false;
    input.readOnly = false;
    input.hidden = false;
    input.typed = 0;
    input.addEventListener('input', function () {
        input.typed++;
    });
    wheelStep(input, options);
    return input;
}

function wheel(input, notches) {
    for (let i = 0; i < Math.abs(notches); i++) {
        const event = new Event('wheel', { cancelable: true });
        Object.defineProperty(event, 'deltaY', { value: notches > 0 ? -100 : 100 });
        input.dispatchEvent(event);
    }
    return input.value;
}

const positive = { min: 0, above: true };
a(wheel(box('2', positive), 1) === '2.5', 'up one notch adds 0.5');
a(wheel(box('2', positive), -2) === '1', 'down two notches takes 1');
a(wheel(box('2.3', positive), 1) === '2.5', 'an odd value goes up to the next whole step');
a(wheel(box('2.3', positive), -1) === '2', 'an odd value goes down to the step below');
a(wheel(box('35/2', positive), 1) === '18', 'a formula is worked out first');
a(wheel(box('1', positive), -5) === '0.5', 'a radius never reaches zero');
a(wheel(box('0.3', positive), -1) === '0.3', 'below the first step the value stays');
a(wheel(box('179', { min: 0, above: true, max: 179.5 }), 3) === '179.5', 'the maximum is not passed');
a(wheel(box('10', { step: 2 }), -6) === '-2', 'a box without limits goes negative, in its own step');
const bad = box('abc', positive);
a(wheel(bad, 1) === 'abc' && bad.typed === 0, 'text that is not a number is left alone');
const counted = box('3', positive);
wheel(counted, 2);
a(counted.typed === 2, 'every notch reports an input, as typing would', counted.typed);
const off = box('3', positive);
off.disabled = true;
a(wheel(off, 1) === '3', 'a disabled box does not change');

console.log(failed ? failed + ' FAILED' : 'all wheel tests passed');
process.exitCode = failed ? 1 : 0;
