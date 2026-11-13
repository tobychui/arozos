/*
    3D Modeler - the text of dimensions

    A dimension is measured in model millimetres and written in the units,
    precision, prefix and suffix of the drawing's dimension style, unless the
    dimension has its own (its `fmt` record):

        style (drawing wide): { units, precision, anglePrecision,
            trailingZeros, showUnits, prefix, suffix, textHeight, arrowSize }
        fmt (one dimension): { units, precision, prefix, suffix,
            tol: { type: "none" | "sym" | "dev", upper, lower }, height }

    A field left out of fmt falls back to the style. Radius and diameter
    dimensions start with the symbol of their kind (R, the diameter sign) as
    their prefix, which can be changed or removed like any other prefix.
*/

import { LENGTH_UNITS } from './sheet.js';

export const DIAMETER = '\u00d8';
export const DEGREE = '\u00b0';
export const PLUSMINUS = '\u00b1';

export function defaultStyle() {
    return {
        units: 'mm', precision: 2, anglePrecision: 1, trailingZeros: false, showUnits: false,
        prefix: '', suffix: '', textHeight: 3.5, arrowSize: 3
    };
}

// The prefix a kind of dimension starts with when it has none of its own
export function typePrefix(type) {
    return type === 'radius' ? 'R' : type === 'diameter' || type === 'hole' ? DIAMETER : '';
}

function pick(fmt, style, field) {
    return fmt && fmt[field] !== undefined && fmt[field] !== null && fmt[field] !== '' ? fmt[field] : style[field];
}

// A number with `precision` decimals, without trailing zeros unless asked
export function number(value, precision, trailingZeros) {
    let text = (Math.abs(value) < 0.5 * Math.pow(10, -precision) ? 0 : value).toFixed(Math.max(0, Math.min(6, precision)));
    if (!trailingZeros && text.indexOf('.') >= 0) {
        text = text.replace(/\.?0+$/, '');
    }
    return text === '-0' ? '0' : text;
}

export function unitsOf(fmt, style) {
    const u = pick(fmt, style, 'units');
    return LENGTH_UNITS[u] ? u : 'mm';
}

// The prefix a dimension shows
export function prefixOf(type, fmt, style) {
    if (fmt && typeof fmt.prefix === 'string') {
        return fmt.prefix;
    }
    return typePrefix(type) + (style.prefix || '');
}

export function suffixOf(fmt, style) {
    return fmt && typeof fmt.suffix === 'string' ? fmt.suffix : (style.suffix || '');
}

function tolerance(fmt, precision, style, convert) {
    const tol = fmt && fmt.tol;
    if (!tol || !tol.type || tol.type === 'none') {
        return '';
    }
    const up = number(convert(Math.abs(+tol.upper || 0)), precision, style.trailingZeros);
    if (tol.type === 'sym') {
        return ' ' + PLUSMINUS + up;
    }
    const low = number(convert(Math.abs(+tol.lower || 0)), precision, style.trailingZeros);
    return ' +' + up + '/-' + low;
}

// The text of a length dimension: valueMm is in model millimetres
export function formatLength(valueMm, type, fmt, style) {
    const units = unitsOf(fmt, style);
    const precision = +pick(fmt, style, 'precision');
    const convert = function (mm) {
        return mm * LENGTH_UNITS[units].perMm;
    };
    let text = number(convert(valueMm), precision, style.trailingZeros);
    if (style.showUnits) {
        text += ' ' + LENGTH_UNITS[units].label;
    }
    text += tolerance(fmt, precision, style, convert);
    return prefixOf(type, fmt, style) + text + suffixOf(fmt, style);
}

// The text of an angle dimension: degrees
export function formatAngle(degrees, fmt, style) {
    const precision = fmt && fmt.precision !== undefined && fmt.precision !== null && fmt.precision !== '' ? +fmt.precision : style.anglePrecision;
    let text = number(degrees, precision, style.trailingZeros) + DEGREE;
    const tol = fmt && fmt.tol;
    if (tol && tol.type === 'sym') {
        text += ' ' + PLUSMINUS + number(Math.abs(+tol.upper || 0), precision, style.trailingZeros) + DEGREE;
    } else if (tol && tol.type === 'dev') {
        text += ' +' + number(Math.abs(+tol.upper || 0), precision, style.trailingZeros) + DEGREE + '/-' + number(Math.abs(+tol.lower || 0), precision, style.trailingZeros) + DEGREE;
    }
    return (fmt && typeof fmt.prefix === 'string' ? fmt.prefix : '') + text + suffixOf(fmt, style);
}

// The text of a hole note: "4x " before the diameter when there are several
export function formatHole(diameterMm, count, fmt, style) {
    return (count > 1 ? count + 'x ' : '') + formatLength(diameterMm, 'hole', fmt, style);
}

export function heightOf(fmt, style) {
    const h = fmt && +fmt.height > 0 ? +fmt.height : +style.textHeight;
    return h > 0 ? h : 3.5;
}
