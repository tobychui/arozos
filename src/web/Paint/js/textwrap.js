/*
    Word wrapping for the Text tool. It follows what the text box on screen
    does (white-space: pre-wrap, overflow-wrap: anywhere) closely enough that
    the committed text breaks where the user saw it break: spaces are break
    points, every CJK character can break, and a word wider than the box is
    split between characters. measure(str) returns the width of a string.
*/

// CJK ideographs, kana, hangul and full-width forms break anywhere
const CJK = '⺀-鿿가-힯豈-﫿＀-￯';
const TOKEN = new RegExp('(\\s+|[' + CJK + ']|[^\\s' + CJK + ']+)', 'g');

export function wrapText(text, maxWidth, measure) {
    const out = [];
    const paragraphs = String(text).replace(/\r\n?/g, '\n').split('\n');
    for (const para of paragraphs) {
        const tokens = para.match(TOKEN) || [];
        if (tokens.length === 0) {
            out.push('');
            continue;
        }
        let line = '';
        let hanging = false;
        for (const tok of tokens) {
            const isSpace = /^\s+$/.test(tok);
            if (hanging) {
                if (isSpace) {
                    line += tok;
                    continue;
                }
                out.push(line.replace(/\s+$/, ''));
                line = '';
                hanging = false;
            }
            const candidate = line + tok;
            if (measure(candidate) <= maxWidth || line === '' && isSpace) {
                line = candidate;
                continue;
            }
            if (isSpace) {
                // Spaces at the end of a line hang off it, like the browser;
                // the next word starts the new line
                line = candidate;
                hanging = true;
                continue;
            }
            if (line.trim() !== '') {
                out.push(line.replace(/\s+$/, ''));
                line = '';
            } else {
                line = '';
            }
            if (measure(tok) <= maxWidth) {
                line = tok;
                continue;
            }
            // Split a word that does not fit on a line of its own
            let part = '';
            for (const ch of Array.from(tok)) {
                if (part !== '' && measure(part + ch) > maxWidth) {
                    out.push(part);
                    part = ch;
                } else {
                    part += ch;
                }
            }
            line = part;
        }
        out.push(line.replace(/\s+$/, ''));
    }
    return out;
}
