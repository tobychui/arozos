/*
    Word wrapping of the Text tool (js/textwrap.js), measured with a fixed
    width per character so the expected breaks are exact.
    Run with: node tests/run.mjs textwrap
*/
import { wrapText } from '../js/textwrap.js';

let failed = 0;
const a = (c, m, x) => {
    if (!c) {
        failed++;
        console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x));
    }
};

// Every character is 1 unit wide
const mono = (s) => Array.from(s).length;

const cases = [
    { name: 'fits on one line', text: 'hello world', width: 20, want: ['hello world'] },
    { name: 'breaks at a space', text: 'hello world', width: 8, want: ['hello', 'world'] },
    { name: 'exact fit', text: 'hello', width: 5, want: ['hello'] },
    { name: 'several breaks', text: 'aa bb cc dd', width: 5, want: ['aa bb', 'cc dd'] },
    { name: 'newlines are kept', text: 'one\ntwo', width: 20, want: ['one', 'two'] },
    { name: 'empty lines are kept', text: 'a\n\nb', width: 20, want: ['a', '', 'b'] },
    { name: 'windows newlines', text: 'a\r\nb', width: 20, want: ['a', 'b'] },
    { name: 'long word is split', text: 'abcdefghij', width: 4, want: ['abcd', 'efgh', 'ij'] },
    { name: 'long word after a short one', text: 'ab cdefghij', width: 4, want: ['ab', 'cdef', 'ghij'] },
    { name: 'trailing spaces do not wrap', text: 'abc   ', width: 3, want: ['abc'] },
    { name: 'leading spaces are kept', text: '  ab', width: 10, want: ['  ab'] },
    { name: 'CJK breaks between characters', text: '你好世界和平', width: 4, want: ['你好世界', '和平'] },
    { name: 'mixed CJK and latin', text: 'Paint繪圖', width: 6, want: ['Paint繪', '圖'] },
    { name: 'empty text', text: '', width: 10, want: [''] }
];

for (const c of cases) {
    const got = wrapText(c.text, c.width, mono);
    a(JSON.stringify(got) === JSON.stringify(c.want), c.name, got);
}

// No line is ever wider than the box unless it is one character
{
    const text = 'The quick brown fox jumps over the lazy dog, again and again and again.';
    for (let w = 1; w <= 30; w++) {
        const lines = wrapText(text, w, mono);
        a(lines.every((l) => mono(l) <= w || mono(l) === 1), 'width ' + w + ' respected', lines);
        a(lines.join('').replace(/\s/g, '') === text.replace(/\s/g, ''), 'width ' + w + ' keeps every character');
    }
}

console.log(failed ? failed + ' checks failed' : 'textwrap: all checks passed');
process.exitCode = failed ? 1 : 0;
