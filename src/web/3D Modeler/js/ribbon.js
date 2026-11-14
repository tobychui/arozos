/*
    3D Modeler - ribbon

    The ribbon is data: RIBBON lists the tabs, their groups and their commands.
    A command is { id, label, icon } plus:
        big      large button (icon above the label)
        planned  the PROPOSAL.md milestone that implements it; until then the
                 button is greyed and only reports that milestone
        menu     [{ id, label, hint }] drop-down entries instead of one action
        toggle   the button shows an on/off state (set with setOn)
    A tab, a group or a command can carry mode: "part", "assembly" or
    "drawing", or a list of them; it is then only shown while that kind of
    document is open (setMode).

    app.js receives every click as onCommand(id).
*/

import { icon } from './ui.js';
import { LIGHTING } from './appearance.js';

export const RIBBON = [
    {
        id: 'file', label: 'File', groups: [
            { label: 'Document', items: [
                { id: 'file.new', label: 'New', icon: 'new', big: true },
                { id: 'file.open', label: 'Open', icon: 'open', big: true },
                { id: 'file.save', label: 'Save', icon: 'save', big: true },
                { id: 'file.saveas', label: 'Save As', icon: 'saveas', big: true }
            ] },
            { label: 'Exchange', items: [
                { id: 'file.import', label: 'Import', icon: 'import', big: true, mode: 'part', menu: [
                    { id: 'import.step', label: 'STEP solid', hint: '.step .stp' },
                    { id: 'import.stl', label: 'STL mesh', hint: '.stl', planned: 'a later stage' },
                    { id: 'import.obj', label: 'OBJ mesh', hint: '.obj', planned: 'a later stage' }
                ] },
                { id: 'file.export', label: 'Export', icon: 'export', big: true, mode: ['part', 'assembly'], menu: [
                    { id: 'export.step', label: 'STEP solid', hint: '.step' },
                    { id: 'export.stl', label: 'STL for 3D printing', hint: '.stl' },
                    { id: 'export.obj', label: 'OBJ mesh', hint: '.obj' },
                    { id: 'export.3mf', label: '3MF for 3D printing', hint: '.3mf' },
                    { id: 'export.brep', label: 'OpenCascade B-rep', hint: '.brep' }
                ] },
                { id: 'file.exportdrw', label: 'Export', icon: 'export', big: true, mode: 'drawing', menu: [
                    { id: 'dexport.pdf', label: 'PDF for printing', hint: '.pdf' },
                    { id: 'dexport.dxf', label: 'DXF for CAD (LibreCAD, FreeCAD, QCAD)', hint: '.dxf' },
                    { id: 'dexport.svg', label: 'SVG vector image', hint: '.svg' },
                    { id: 'dexport.png', label: 'PNG image at the sheet resolution', hint: '.png' }
                ] }
            ] },
            { label: 'Diagnostics', items: [
                { id: 'file.sample', label: 'Sample Part', icon: 'part', big: true },
                { id: 'file.sampleasm', label: 'Sample Assembly', icon: 'assembly', big: true },
                { id: 'file.sampledrw', label: 'Sample Drawing', icon: 'drawing', big: true },
                { id: 'diag.selftest', label: 'Kernel Self\u2011test', icon: 'test', big: true }
            ] }
        ]
    },
    {
        id: 'assemble', label: 'Assemble', mode: 'assembly', groups: [
            { label: 'Component', items: [
                { id: 'asm.place', label: 'Place', icon: 'place', big: true },
                { id: 'asm.refresh', label: 'Refresh Parts', icon: 'refresh' },
                { id: 'asm.openpart', label: 'Open Part', icon: 'open' },
                { id: 'asm.delete', label: 'Delete', icon: 'end' }
            ] },
            { label: 'Position', items: [
                { id: 'asm.freemove', label: 'Free Move', icon: 'freemove', big: true, toggle: true },
                { id: 'asm.freerotate', label: 'Free Rotate', icon: 'freerotate', big: true, toggle: true },
                { id: 'asm.transform', label: 'Move Rotate Scale', icon: 'transform', big: true, toggle: true },
                { id: 'asm.ground', label: 'Grounded', icon: 'ground', toggle: true },
                { id: 'asm.origin', label: 'Place at Origin', icon: 'home' },
                { id: 'asm.drop', label: 'Drop to Floor', icon: 'drop' }
            ] },
            { label: 'Relationships', items: [
                { id: 'asm.constrain', label: 'Constrain', icon: 'constrain', big: true, toggle: true },
                { id: 'asmc.mate', label: 'Mate', icon: 'mate' },
                { id: 'asmc.flush', label: 'Flush', icon: 'flush' },
                { id: 'asmc.angle', label: 'Angle', icon: 'angle' },
                { id: 'asmc.tangent', label: 'Tangent', icon: 'tangent' },
                { id: 'asmc.insert', label: 'Insert', icon: 'insert' }
            ] },
            { label: 'Visibility', items: [
                { id: 'asm.hide', label: 'Hide', icon: 'hide' },
                { id: 'asm.isolate', label: 'Isolate', icon: 'isolate' },
                { id: 'asm.showall', label: 'Show All', icon: 'show' }
            ] }
        ]
    },
    {
        id: 'drawviews', label: 'Place Views', mode: 'drawing', groups: [
            { label: 'Create', items: [
                { id: 'drw.base', label: 'Base View', icon: 'baseview', big: true },
                { id: 'drw.projected', label: 'Projected View', icon: 'projectedview', big: true, toggle: true },
                { id: 'drw.face', label: 'Face View', icon: 'faceview', big: true }
            ] },
            { label: 'Modify', items: [
                { id: 'drw.edit', label: 'Edit', icon: 'editview' },
                { id: 'drw.delete', label: 'Delete', icon: 'end' },
                { id: 'drw.refresh', label: 'Refresh Models', icon: 'refresh' }
            ] },
            { label: 'Sheet', items: [
                { id: 'drw.sheet', label: 'Sheet Setup', icon: 'sheet', big: true },
                { id: 'drw.style', label: 'Dimension Style', icon: 'dimstyle', big: true }
            ] },
            { label: 'Navigate', items: [
                { id: 'nav.zoomall', label: 'Zoom All', icon: 'zoomall', big: true },
                { id: 'drw.zoomin', label: 'Zoom In', icon: 'zoomin' },
                { id: 'drw.zoomout', label: 'Zoom Out', icon: 'zoomout' }
            ] }
        ]
    },
    {
        id: 'annotate', label: 'Annotate', mode: 'drawing', groups: [
            { label: 'Dimension', items: [
                { id: 'ann.dimension', label: 'Dimension', icon: 'dimension', big: true, toggle: true },
                { id: 'ann.radius', label: 'Radius', icon: 'radius', toggle: true },
                { id: 'ann.diameter', label: 'Diameter', icon: 'diameter', toggle: true },
                { id: 'ann.angle', label: 'Angle', icon: 'angle', toggle: true }
            ] },
            { label: 'Feature Notes', items: [
                { id: 'ann.hole', label: 'Hole Note', icon: 'holenote', big: true, toggle: true },
                { id: 'ann.center', label: 'Center Mark', icon: 'centermark', big: true, toggle: true }
            ] },
            { label: 'Text', items: [
                { id: 'ann.note', label: 'Leader Note', icon: 'leader', big: true, toggle: true },
                { id: 'ann.text', label: 'Text', icon: 'text', big: true, toggle: true }
            ] },
            { label: 'Format', items: [
                { id: 'drw.style2', label: 'Dimension Style', icon: 'dimstyle', big: true }
            ] }
        ]
    },
    {
        id: 'model', label: '3D Model', mode: 'part', groups: [
            { label: 'Sketch', items: [
                { id: 'sketch.start', label: 'Start 2D Sketch', icon: 'sketch', big: true, toggle: true }
            ] },
            { label: 'Create', items: [
                { id: 'feat.extrude', label: 'Extrude', icon: 'extrude', big: true, toggle: true },
                { id: 'feat.revolve', label: 'Revolve', icon: 'revolve', big: true, toggle: true }
            ] },
            { label: 'Modify', items: [
                { id: 'feat.hole', label: 'Hole', icon: 'hole', big: true, toggle: true },
                { id: 'feat.fillet', label: 'Fillet', icon: 'fillet', big: true, toggle: true },
                { id: 'feat.chamfer', label: 'Chamfer', icon: 'chamfer', toggle: true },
                { id: 'feat.shell', label: 'Shell', icon: 'shell', toggle: true }
            ] },
            { label: 'Work Features', items: [
                { id: 'work.plane', label: 'Plane', icon: 'plane', big: true, toggle: true },
                { id: 'work.axis', label: 'Axis', icon: 'axis', planned: 'Stage 2' },
                { id: 'work.point', label: 'Point', icon: 'point', planned: 'Stage 2' }
            ] },
            { label: 'Pattern', items: [
                { id: 'pat.rect', label: 'Rectangular', icon: 'rectpattern', toggle: true },
                { id: 'pat.circ', label: 'Circular', icon: 'circpattern', toggle: true },
                { id: 'pat.mirror', label: 'Mirror', icon: 'mirror', toggle: true }
            ] }
        ]
    },
    {
        id: 'sketch', label: 'Sketch', contextual: true, mode: 'part', groups: [
            { label: 'Create', items: [
                { id: 'sk.line', label: 'Line', icon: 'line', big: true, toggle: true },
                { id: 'sk.circle', label: 'Circle', icon: 'circle', big: true, toggle: true },
                { id: 'sk.arcs', label: 'Arc', icon: 'arc', big: true, toggle: true, menu: [
                    { id: 'sk.arc3', label: 'Three Point Arc' },
                    { id: 'sk.arctan', label: 'Tangent Arc' },
                    { id: 'sk.arc', label: 'Center Point Arc' }
                ] },
                { id: 'sk.rect', label: 'Rectangle', icon: 'rect', big: true, toggle: true },
                { id: 'sk.polygon', label: 'Polygon', icon: 'polygon', toggle: true },
                { id: 'sk.slot', label: 'Slot', icon: 'slot', toggle: true },
                { id: 'sk.fillet', label: 'Fillet', icon: 'fillet', toggle: true },
                { id: 'sk.chamfer', label: 'Chamfer', icon: 'chamfer', toggle: true },
                { id: 'sk.point', label: 'Point', icon: 'point', toggle: true },
                { id: 'sk.project', label: 'Project Geometry', icon: 'project', toggle: true },
                { id: 'sk.construction', label: 'Construction', icon: 'construction', toggle: true }
            ] },
            { label: 'Modify', items: [
                { id: 'sk.trim', label: 'Trim', icon: 'trim', toggle: true },
                { id: 'sk.extend', label: 'Extend', icon: 'extend', toggle: true },
                { id: 'sk.offset', label: 'Offset', icon: 'offset', planned: 'Stage 2' },
                { id: 'sk.mirror', label: 'Mirror', icon: 'mirror', toggle: true }
            ] },
            { label: 'Constrain', items: [
                { id: 'sk.dimension', label: 'Dimension', icon: 'dimension', big: true, toggle: true },
                { id: 'con.coincident', label: 'Coincident', icon: 'coincident', toggle: true },
                { id: 'con.concentric', label: 'Concentric', icon: 'concentric', toggle: true },
                { id: 'con.collinear', label: 'Collinear', icon: 'collinear', toggle: true },
                { id: 'con.horizontal', label: 'Horizontal', icon: 'horizontal', toggle: true },
                { id: 'con.vertical', label: 'Vertical', icon: 'vertical', toggle: true },
                { id: 'con.parallel', label: 'Parallel', icon: 'parallel', toggle: true },
                { id: 'con.perpendicular', label: 'Perpendicular', icon: 'perpendicular', toggle: true },
                { id: 'con.tangent', label: 'Tangent', icon: 'tangent', toggle: true },
                { id: 'con.equal', label: 'Equal', icon: 'equal', toggle: true },
                { id: 'con.fix', label: 'Fix', icon: 'fix', toggle: true },
                { id: 'con.midpoint', label: 'Midpoint', icon: 'midpoint', toggle: true },
                { id: 'con.symmetric', label: 'Symmetric', icon: 'mirror', toggle: true }
            ] },
            { label: 'Exit', items: [
                { id: 'sketch.finish', label: 'Finish Sketch', icon: 'finish', big: true, cls: 'finish' }
            ] }
        ]
    },
    {
        id: 'inspect', label: 'Inspect', mode: ['part', 'assembly'], groups: [
            { label: 'Measure', items: [
                { id: 'ins.measure', label: 'Measure', icon: 'measure', big: true, toggle: true },
                { id: 'ins.mass', label: 'Mass Properties', icon: 'mass', big: true }
            ] },
            { label: 'Interference', mode: 'assembly', items: [
                { id: 'asm.interference', label: 'Analyze Interference', icon: 'interference', big: true },
                { id: 'asm.dof', label: 'Degrees of Freedom', icon: 'dof', big: true, toggle: true }
            ] }
        ]
    },
    {
        id: 'appearance', label: 'Appearance', mode: ['part', 'assembly'], groups: [
            { label: 'Material', mode: 'part', items: [
                { id: 'app.appearance', label: 'Appearance', icon: 'palette', big: true, toggle: true },
                { id: 'app.paint', label: 'Paint Faces', icon: 'paintface', big: true, toggle: true }
            ] },
            { label: 'Scene', items: [
                { id: 'scene.lighting', label: 'Lighting', icon: 'light', big: true, menu: LIGHTING.map(function (l) {
                    return { id: 'light.' + l.id, label: l.label };
                }) },
                { id: 'scene.reflections', label: 'Reflections', icon: 'reflect', toggle: true },
                { id: 'scene.shadows', label: 'Shadows', icon: 'shadow', toggle: true },
                { id: 'scene.ground', label: 'Ground Plane', icon: 'ground', toggle: true }
            ] },
            { label: 'Textures', items: [
                { id: 'scene.textures', label: 'Textures On', icon: 'texture', big: true, toggle: true }
            ] }
        ]
    },
    {
        id: 'view', label: 'View', mode: ['part', 'assembly'], groups: [
            { label: 'Appearance', items: [
                { id: 'view.style', label: 'Visual Style', icon: 'style', big: true, menu: [
                    { id: 'style.shaded', label: 'Shaded' },
                    { id: 'style.shaded-edges', label: 'Shaded with Edges' },
                    { id: 'style.hidden-edges', label: 'Shaded with Hidden Edges' },
                    { id: 'style.wireframe', label: 'Wireframe' }
                ] },
                { id: 'view.projection', label: 'Orthographic', icon: 'ortho', menu: [
                    { id: 'proj.orthographic', label: 'Orthographic' },
                    { id: 'proj.perspective', label: 'Perspective' }
                ] },
                { id: 'view.section', label: 'Section View', icon: 'section', menu: [
                    { id: 'section.half', label: 'Half Section View', hint: 'set the plane' },
                    { id: 'section.quarter', label: 'Quarter Section View', hint: 'set the planes' },
                    { id: 'section.threequarter', label: 'Three Quarter Section View', hint: 'set the planes' },
                    { id: 'section.end', label: 'End Section View' }
                ] },
                { id: 'view.origin', label: 'Origin Planes', icon: 'plane', toggle: true }
            ] },
            { label: 'Navigate', items: [
                { id: 'nav.zoomall', label: 'Zoom All', icon: 'zoomall', big: true },
                { id: 'nav.home', label: 'Home View', icon: 'home', big: true },
                { id: 'nav.lookat', label: 'Look At', icon: 'lookat', toggle: true },
                { id: 'nav.pan', label: 'Pan', icon: 'pan', toggle: true },
                { id: 'nav.orbit', label: 'Orbit', icon: 'orbit', toggle: true }
            ] }
        ]
    }
];


// Build the ribbon into the given elements. Returns { showTab, setOn, setLabel, find }.
export function createRibbon(els, onCommand) {
    const commands = {};
    const buttons = {};
    let activeTab = null;

    const moded = [];   // { el, mode } shown only in their mode

    RIBBON.forEach(function (tab) {
        const tabButton = document.createElement('button');
        tabButton.className = 'tab' + (tab.contextual ? ' contextual' : '');
        tabButton.textContent = tab.label;
        tabButton.dataset.tab = tab.id;
        tabButton.hidden = !!tab.contextual;
        tabButton.addEventListener('click', function () {
            showTab(tab.id);
        });
        els.tabs.appendChild(tabButton);

        const row = document.createElement('div');
        row.className = 'panelrow';
        row.dataset.tab = tab.id;
        if (tab.mode) {
            moded.push({ el: tabButton, mode: tab.mode, contextual: !!tab.contextual });
        }
        tab.groups.forEach(function (group) {
            const groupEl = document.createElement('div');
            groupEl.className = 'group';
            if (group.mode) {
                moded.push({ el: groupEl, mode: group.mode });
            }
            const body = document.createElement('div');
            body.className = 'group-body';
            let column = null;
            group.items.forEach(function (item) {
                commands[item.id] = item;
                (item.menu || []).forEach(function (entry) {
                    commands[entry.id] = Object.assign({ planned: item.planned, parent: item.id }, entry);
                });
                const button = document.createElement('button');
                button.className = 'rb' + (item.big ? ' big' : '') + (item.planned ? ' planned' : '') + (item.cls ? ' ' + item.cls : '');
                button.title = item.planned ? item.label + ' (planned: ' + item.planned + ')' : item.label;
                button.innerHTML = icon(item.icon) + '<span class="lbl">' + item.label + '</span>' + (item.menu ? icon('down', 'ic-down') : '');
                button.addEventListener('click', function () {
                    if (item.menu) {
                        els.openMenu(button, item.menu, onCommand);
                    } else {
                        onCommand(item.id);
                    }
                });
                buttons[item.id] = button;
                if (item.mode) {
                    moded.push({ el: button, mode: item.mode });
                }
                if (item.big) {
                    column = null;
                    body.appendChild(button);
                } else {
                    // Small buttons stack three to a column, like a desktop ribbon
                    if (!column || column.children.length >= 3) {
                        column = document.createElement('div');
                        column.className = 'col';
                        body.appendChild(column);
                    }
                    column.appendChild(button);
                }
            });
            const label = document.createElement('div');
            label.className = 'group-label';
            label.textContent = group.label;
            groupEl.appendChild(body);
            groupEl.appendChild(label);
            row.appendChild(groupEl);
        });
        els.panels.appendChild(row);
    });

    function showTab(id) {
        activeTab = id;
        els.tabs.querySelectorAll('.tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.tab === id);
        });
        els.panels.querySelectorAll('.panelrow').forEach(function (r) {
            r.classList.toggle('active', r.dataset.tab === id);
        });
    }

    return {
        showTab: showTab,
        activeTab: function () {
            return activeTab;
        },
        // Show what belongs to a part or to an assembly. Contextual tabs
        // of the other mode are hidden; those of this mode keep their state.
        setMode: function (mode) {
            moded.forEach(function (entry) {
                const shown = [].concat(entry.mode).indexOf(mode) >= 0;
                if (entry.contextual) {
                    if (!shown) {
                        entry.el.hidden = true;
                    }
                } else {
                    entry.el.hidden = !shown;
                }
            });
        },
        setTabVisible: function (id, visible) {
            els.tabs.querySelector('.tab[data-tab="' + id + '"]').hidden = !visible;
        },
        setOn: function (id, on) {
            buttons[id].classList.toggle('on', !!on);
        },
        setLabel: function (id, text) {
            buttons[id].querySelector('.lbl').textContent = text;
        },
        find: function (id) {
            return commands[id];
        }
    };
}
