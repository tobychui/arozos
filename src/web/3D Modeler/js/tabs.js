/*
    3D Modeler - document tabs

    The strip under the view, as in Inventor: one tab per open part,
    assembly or drawing, the shown one marked. Clicking a tab shows that
    document; the cross (or the middle button) closes it; the plus starts a
    new one. app.js keeps the documents themselves (switchTo, closeTab).

    render(list, activeId) redraws from
        [{ id, kind: "part" | "assembly" | "drawing", name, path, dirty }]

    handlers: onSelect(id), onClose(id), onNew()
*/

// The icon markup of ui.js, repeated so this file loads without a DOM (tests)
function icon(name) {
    return '<svg class="ic"><use href="#ic-' + name + '"/></svg>';
}

const KIND_ICONS = { part: 'part', assembly: 'assembly', drawing: 'drawing' };
const EXTENSIONS = { part: '.aopart', assembly: '.aoasm', drawing: '.aodrw' };

export function createTabBar(el, handlers) {
    function render(list, activeId) {
        el.innerHTML = '';
        list.forEach(function (tab) {
            const node = document.createElement('div');
            node.className = 'doctab' + (tab.id === activeId ? ' active' : '');
            node.setAttribute('role', 'tab');
            node.setAttribute('aria-selected', tab.id === activeId ? 'true' : 'false');
            node.title = (tab.path || tab.name + EXTENSIONS[tab.kind] + ' (not saved yet)') + (tab.dirty ? ' - changed since saved' : '');
            node.innerHTML = icon(KIND_ICONS[tab.kind] || 'part') + '<span class="doctab-name"></span>';
            node.querySelector('.doctab-name').textContent = tab.name + (tab.dirty ? ' *' : '');
            const close = document.createElement('button');
            close.className = 'doctab-close';
            close.title = 'Close ' + tab.name;
            close.innerHTML = icon('end');
            close.addEventListener('click', function (event) {
                event.stopPropagation();
                handlers.onClose(tab.id);
            });
            node.appendChild(close);
            node.addEventListener('click', function () {
                handlers.onSelect(tab.id);
            });
            // The middle button closes a tab, as in a web browser
            node.addEventListener('auxclick', function (event) {
                if (event.button === 1) {
                    event.preventDefault();
                    handlers.onClose(tab.id);
                }
            });
            node.addEventListener('mousedown', function (event) {
                if (event.button === 1) {
                    event.preventDefault(); // no auto-scroll
                }
            });
            el.appendChild(node);
        });
        const add = document.createElement('button');
        add.className = 'doctab-new';
        add.title = 'New part, assembly or drawing';
        add.innerHTML = icon('new');
        add.addEventListener('click', function () {
            handlers.onNew();
        });
        el.appendChild(add);
        const shown = el.querySelector('.doctab.active');
        if (shown && shown.scrollIntoView) {
            shown.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    return { render: render };
}

// A name not used by any open tab: "Part1", "Part2", ...
export function freeName(base, names) {
    let n = 1;
    while (names.indexOf(base + n) >= 0) {
        n++;
    }
    return base + n;
}
