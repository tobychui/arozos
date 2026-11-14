/*
    3D Modeler - the illustration card

    A small card beside a panel that shows, as a looping animation, what
    the chosen type does (illustrations.js has the scenes): the type of an
    assembly constraint, the Boolean of an extrusion or a revolution.
    Pointing at another type shows that one while the pointer is on it.

    The card is not inside the panel (the panel scrolls, which would cut
    it off): it sits in the stage and follows the panel every frame, on its
    right, or on its left when there is no room, or under it on a narrow
    window. A button in the panel's title shows or hides the cards; the
    choice is kept in the browser. With reduced motion the card shows the
    result without moving.

    createIllustration(panelElement) -> {
        attachSeg(segElement, family)  pointing at a button of that row previews it
        show(family, id)               the chosen type (null hides the card)
        preview(family, id | null)
        resume()                       the panel was shown again
        stop()                         the panel was hidden
    }
*/

import { sceneFor, progress, renderFrame, sceneBounds } from './illustrations.js';
import { icon } from '../ui.js';

const PREF = '3dmodeler.illustrations';
const PERIOD = 3400;    // ms: before, the change, after
const W = 244;          // drawing size in pixels (as illustrations.js draws)

function enabled() {
    try {
        return window.localStorage.getItem(PREF) !== 'off';
    } catch (e) {
        return true;
    }
}

function setEnabled(on) {
    try {
        window.localStorage.setItem(PREF, on ? 'on' : 'off');
    } catch (e) {
        // Not kept: it still applies until the window closes
    }
}

export function createIllustration(panelEl) {
    const stage = panelEl.parentElement;
    const card = document.createElement('div');
    card.className = 'illus';
    card.hidden = true;
    card.innerHTML = '<div class="illus-head"><span class="illus-title"></span>' +
        '<button class="illus-close" type="button" title="Hide these pictures; the i button in the panel title brings them back">' + icon('close') + '</button></div>' +
        '<svg class="illus-svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true"></svg><div class="illus-text"></div>';
    stage.appendChild(card);
    const svgEl = card.querySelector('.illus-svg');
    const titleEl = card.querySelector('.illus-title');
    const textEl = card.querySelector('.illus-text');

    // The button in the panel's title that shows or hides the cards
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'illus-toggle';
    toggle.title = 'Show or hide the picture of what each type does';
    toggle.innerHTML = icon('info');
    const title = panelEl.querySelector('.props-title');
    if (title) {
        title.appendChild(toggle);
    }
    // Not a drag of the panel
    toggle.addEventListener('pointerdown', function (event) {
        event.stopPropagation();
    });
    toggle.addEventListener('click', function () {
        setEnabled(!enabled());
        update();
    });
    card.querySelector('.illus-close').addEventListener('click', function () {
        setEnabled(false);
        update();
    });

    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bounds = new Map();   // scene -> its view box
    let chosen = null;          // the scene of the chosen type
    let hovered = null;         // the scene pointed at
    let shown = null;           // the scene on the card now
    let raf = 0;
    let t0 = 0;

    function current() {
        return hovered || chosen;
    }

    function place() {
        const sw = stage.clientWidth;
        const cw = card.offsetWidth || 262;
        let left = panelEl.offsetLeft + panelEl.offsetWidth + 8;
        let top = panelEl.offsetTop;
        if (left + cw > sw - 4) {
            left = panelEl.offsetLeft - cw - 8;
        }
        if (left < 4) {
            // No room either side: under the panel
            left = Math.max(4, Math.min(sw - cw - 4, panelEl.offsetLeft));
            top = panelEl.offsetTop + panelEl.offsetHeight + 8;
        }
        card.style.left = left + 'px';
        card.style.top = top + 'px';
    }

    function draw(now) {
        const scene = current();
        if (scene !== shown) {
            shown = scene;
            t0 = now;
            titleEl.textContent = scene.title;
            textEl.textContent = scene.text;
            if (!bounds.has(scene)) {
                bounds.set(scene, sceneBounds(scene));
            }
            const b = bounds.get(scene);
            svgEl.setAttribute('viewBox', [b.x, b.y, b.w, b.h].map(function (v) {
                return v.toFixed(2);
            }).join(' '));
        }
        const b = bounds.get(scene);
        const t = reduced ? 1 : progress((now - t0) / PERIOD);
        svgEl.innerHTML = renderFrame(scene.frame(t), b.w / W);
    }

    function frame(now) {
        raf = 0;
        if (panelEl.hidden || !panelEl.isConnected || !enabled() || !current()) {
            card.hidden = true;
            return;
        }
        card.hidden = false;
        place();
        draw(now);
        if (!reduced) {
            raf = requestAnimationFrame(frame);
        }
    }

    function update() {
        toggle.classList.toggle('on', enabled());
        const want = !panelEl.hidden && enabled() && !!current();
        if (!want) {
            card.hidden = true;
            if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
            return;
        }
        if (!raf) {
            raf = requestAnimationFrame(frame);
        }
    }

    return {
        attachSeg: function (segEl, family) {
            segEl.querySelectorAll('.seg-btn').forEach(function (button) {
                button.addEventListener('mouseenter', function () {
                    hovered = sceneFor(family, button.dataset.id);
                    update();
                });
                button.addEventListener('mouseleave', function () {
                    hovered = null;
                    update();
                });
            });
        },
        show: function (family, id) {
            chosen = family && id ? sceneFor(family, id) : null;
            update();
        },
        preview: function (family, id) {
            hovered = family && id ? sceneFor(family, id) : null;
            update();
        },
        resume: function () {
            shown = null; // start the animation from its beginning
            update();
        },
        stop: function () {
            hovered = null;
            update();
        }
    };
}
