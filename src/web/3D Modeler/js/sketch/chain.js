/*
    3D Modeler - curve chains

    The path of a sweep is a chain of sketch curves joined end to end. Pure
    functions on resolved sketch curves (sketch/model.js curves): no kernel,
    no DOM, so the panel (features/sweep.js), the kernel (kernel/occt.js
    pathWire) and the tests all use them.
*/

import { curves as sketchCurves } from './model.js';

const JOIN = 1e-6; // curves whose ends are this close join

function near2(p, q) {
    return Math.abs(p[0] - q[0]) < JOIN && Math.abs(p[1] - q[1]) < JOIN;
}

// The curves of a sweep path in the order they join end to end: the
// curves `ids` of the sketch, or all its curves that are not construction
// when no ids are given. Each curve gets `reversed` when the chain runs
// it from b to a. Throws a sentence when they do not form one chain (a
// full circle is a chain on its own). Pure: tested in Node.
export function chainCurves(sketch, ids) {
    const all = sketchCurves({ geometry: sketch.geometry || [], constraints: [] });
    const chosen = ids && ids.length ? ids.map(function (id) {
        return all.find(function (c) {
            return c.id === id;
        });
    }).filter(Boolean) : all.filter(function (c) {
        return !c.construction;
    });
    if (!chosen.length) {
        throw new Error('The path of this sweep no longer exists');
    }
    if (chosen.some(function (c) {
        return c.type === 'circle';
    })) {
        if (chosen.length > 1) {
            throw new Error('A circle is a closed path on its own: pick it alone, or lines and arcs that join end to end');
        }
        return chosen;
    }
    // Start at a free end (one no other curve meets) if there is one
    const touches = function (p, except) {
        return chosen.some(function (c) {
            return c !== except && (near2(c.a, p) || near2(c.b, p));
        });
    };
    const first = chosen.find(function (c) {
        return !touches(c.a, c) || !touches(c.b, c);
    }) || chosen[0];
    // leave the first curve by its other end (a closed loop: by b)
    let end = touches(first.a, first) && !touches(first.b, first) ? first.a : first.b;
    const left = chosen.filter(function (c) {
        return c !== first;
    });
    const order = [Object.assign({}, first, { reversed: end === first.a })];
    while (left.length) {
        const i = left.findIndex(function (c) {
            return near2(c.a, end) || near2(c.b, end);
        });
        if (i < 0) {
            throw new Error('The path curves must join end to end in one chain, without branches or gaps');
        }
        const next = left.splice(i, 1)[0];
        const forwards = near2(next.a, end);
        end = forwards ? next.b : next.a;
        order.push(Object.assign({}, next, { reversed: !forwards }));
    }
    return order;
}

// The same chain run the other way
export function reverseChain(order) {
    return order.slice().reverse().map(function (c) {
        return Object.assign({}, c, { reversed: !c.reversed });
    });
}

// The curves joined to `start` end to end, through any number of others
// (a circle is on its own). Pure: tested in Node.
export function connectedCurves(list, start) {
    const seed = list.find(function (c) {
        return c.id === start;
    });
    if (!seed || seed.type === 'circle') {
        return seed ? [seed.id] : [];
    }
    const out = [seed];
    for (let i = 0; i < out.length; i++) {
        const c = out[i];
        list.forEach(function (d) {
            if (d.type !== 'circle' && out.indexOf(d) < 0 &&
                (near2(c.a, d.a) || near2(c.a, d.b) || near2(c.b, d.a) || near2(c.b, d.b))) {
                out.push(d);
            }
        });
    }
    return out.map(function (c) {
        return c.id;
    });
}
