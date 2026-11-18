/*
    3D Modeler - solid health tables

    The markup of the small tables Inspect > Check Geometry and the Repair
    panel show: what is wrong with each solid, in words a person who prints
    parts knows. Pure string building (no DOM), tested under Node.

    A check is the summary of heal.js:
        { valid, solids, open, multiple, unmeshed }   counts
*/

function cell(value, good, text) {
    return '<td class="' + (good ? 'h-ok' : 'h-bad') + '">' + text(value) + '</td>';
}

const ROWS = [
    { label: 'Closed solid', title: 'The faces close up into a solid with an inside', value: function (c) {
        return c.solids > 0 && c.valid;
    }, good: function (v) {
        return v;
    }, text: function (v) {
        return v ? 'Yes' : 'No';
    } },
    { label: 'Open edges', title: 'Edges with a face on one side only: a face is missing or a crack runs there', value: function (c) {
        return c.open;
    }, good: function (v) {
        return !v;
    }, text: function (v) {
        return v ? String(v) : 'None';
    } },
    { label: 'Zero thickness', title: 'Edges where the solid touches itself with no material between (non-manifold)', value: function (c) {
        return c.multiple;
    }, good: function (v) {
        return !v;
    }, text: function (v) {
        return v ? String(v) : 'None';
    } },
    { label: 'Unmeshed faces', title: 'Faces the mesher could not fill on its own', value: function (c) {
        return c.unmeshed || 0;
    }, good: function (v) {
        return !v;
    }, text: function (v) {
        return v ? String(v) : 'None';
    } }
];

// Is a check free of problems?
export function healthy(c) {
    return !!c && ROWS.every(function (row) {
        return row.good(row.value(c));
    });
}

// A table with one column per check: columns [{ title, check }]
export function healthTable(columns) {
    let html = '<table class="health"><tr><th></th>';
    columns.forEach(function (col) {
        html += '<th>' + col.title + '</th>';
    });
    html += '</tr>';
    ROWS.forEach(function (row) {
        html += '<tr><td title="' + row.title + '">' + row.label + '</td>';
        columns.forEach(function (col) {
            const v = row.value(col.check);
            html += cell(v, row.good(v), row.text);
        });
        html += '</tr>';
    });
    return html + '</table>';
}

// Inspect > Check Geometry's result for one solid of the "check" kernel
// operation, as a check summary plus the mesh verdict
export function bodyCheck(body) {
    return {
        valid: body.valid,
        solids: body.solids,
        open: body.openCount,
        multiple: body.multipleCount,
        unmeshed: (body.patched || []).length
    };
}

// One sentence on the mesh a slicer would get
export function meshVerdict(mesh) {
    if (!mesh) {
        return '';
    }
    if (mesh.watertight) {
        return 'The mesh for 3D printing is watertight (' + mesh.triangles + ' triangles).';
    }
    const parts = [];
    if (mesh.open) {
        parts.push(mesh.open + ' open ' + (mesh.open === 1 ? 'edge' : 'edges'));
    }
    if (mesh.multiple) {
        parts.push(mesh.multiple + ' non-manifold ' + (mesh.multiple === 1 ? 'edge' : 'edges'));
    }
    return 'The mesh for 3D printing has ' + parts.join(' and ') + '.';
}
