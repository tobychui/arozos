/*
    PDF Editor - tabs and ribbon

    Each tab is a list of groups; a control names a command of
    PE.commands (js/app.js), which decides what it does, whether it is
    enabled and whether it shows as active. When the ribbon does not fit
    it first tightens, then drops the button labels, then scrolls.
*/
window.PE = window.PE || {};

(function (PE) {
    'use strict';

    var R = PE.ribbon = { tab: 'home' };
    var T = PE.T;

    function big(cmd, icon, label, extra) {
        var c = { cmd: cmd, icon: icon, label: label, big: true };
        if (extra) {
            Object.keys(extra).forEach(function (k) {
                c[k] = extra[k];
            });
        }
        return c;
    }

    function small(cmd, icon, label, extra) {
        var c = big(cmd, icon, label, extra);
        c.big = false;
        return c;
    }

    function stack() {
        return { stack: Array.prototype.slice.call(arguments) };
    }

    R.tabs = function () {
        return [
            { id: 'file', label: T('tab/file', 'File'), menu: true },
            {
                id: 'home', label: T('tab/home', 'Home'), groups: [
                    {
                        label: T('grp/tools', 'Tools'), items: [
                            big('tool:hand', 'hand', T('rb/hand', 'Hand'), { tip: T('tip/hand', 'Move around the pages (hold Space in any tool)') }),
                            big('tool:select', 'select', T('rb/select', 'Select'), { tip: T('tip/select', 'Select, move and resize what you added') }),
                            big('tool:textsel', 'text', T('rb/text', 'Text'), { tip: T('tip/textsel', 'Select and copy the text of the PDF') }),
                            big('tool:snapshot', 'image', T('rb/image', 'Image'), { tip: T('tip/snapshot', 'Copy an area of a page as a picture') }),
                            big('tool:link', 'link', T('rb/link', 'Link'), { tip: T('tip/link', 'Make an area of a page open a web address or another page') })
                        ]
                    },
                    {
                        label: T('grp/editpdf', 'Edit PDF'), items: [
                            big('tool:editpdf', 'editpdf', T('rb/editpdf', 'Edit PDF'), { tip: T('tip/editpdf', 'Change the text that is already on the pages') }),
                            big('tool:redact', 'redact', T('rb/redact', 'Redact'), { tip: T('tip/redact', 'Permanently black out content') }),
                            big('tool:text', 'addtext', T('rb/addtext', 'Add Text'), { tip: T('tip/addtext', 'Click on a page to type new text') }),
                            big('addImage', 'addimage', T('rb/addimage', 'Add Image'), { tip: T('tip/addimage', 'Put a picture on the page') }),
                            big('headerFooter', 'headerfooter', T('rb/headerfooter', 'Header & Footer'), { menu: 'headerFooterMenu' }),
                            big('pageNumbers', 'pagenumber', T('rb/pagenumber', 'Page Number'), { tip: T('tip/pagenumber', 'Number the pages') })
                        ]
                    },
                    {
                        label: T('grp/organize', 'Organize Pages'), items: [
                            big('rotateRight', 'rotate', T('rb/rotate', 'Rotate'), { tip: T('tip/rotate', 'Turn the selected pages clockwise') }),
                            big('tool:crop', 'crop', T('rb/crop', 'Crop'), { tip: T('tip/crop', 'Keep only part of a page') }),
                            big('extract', 'extract', T('rb/extract', 'Extract'), { tip: T('tip/extract', 'Save pages as a new PDF') }),
                            big('split', 'split', T('rb/split', 'Split'), { tip: T('tip/split', 'Divide the document into several PDFs') })
                        ]
                    },
                    {
                        label: T('grp/design', 'Page Design'), items: [
                            big('watermark', 'watermark', T('rb/watermark', 'Watermark')),
                            big('background', 'background', T('rb/background', 'Background')),
                            big('more', 'more', T('rb/more', 'More'), { menu: 'moreMenu' })
                        ]
                    },
                    {
                        label: T('grp/convert', 'Convert'), items: [
                            big('toDocs', 'todocs', T('rb/todocs', 'PDF to Docs'), { cls: 'c-docs', tip: T('tip/todocs', 'Open an editable copy in Docs') }),
                            big('toSheets', 'tosheets', T('rb/tosheets', 'PDF to Sheets'), { cls: 'c-sheets', tip: T('tip/tosheets', 'Turn the tables of the PDF into a spreadsheet') }),
                            big('toSlides', 'toslides', T('rb/toslides', 'PDF to Slides'), { cls: 'c-slides', tip: T('tip/toslides', 'Turn every page into a slide') })
                        ]
                    },
                    {
                        label: T('grp/sign', 'Sign'), items: [
                            big('sign', 'sign', T('rb/sign', 'Sign'), { menu: 'signMenu' })
                        ]
                    }
                ]
            },
            {
                id: 'insert', label: T('tab/insert', 'Insert'), groups: [
                    {
                        label: T('grp/text', 'Text'), items: [
                            big('tool:text', 'addtext', T('rb/textbox', 'Text Box')),
                            big('stamp', 'stamp', T('rb/stamp', 'Stamp'), { menu: 'stampMenu' }),
                            big('dateStamp', 'date', T('rb/date', 'Date'))
                        ]
                    },
                    {
                        label: T('grp/pictures', 'Pictures'), items: [
                            big('addImage', 'addimage', T('rb/picture', 'Picture')),
                            big('sign', 'sign', T('rb/signature', 'Signature'), { menu: 'signMenu' })
                        ]
                    },
                    {
                        label: T('grp/shapes', 'Shapes'), items: [
                            stack(small('tool:rect', 'rect', T('rb/rect', 'Rectangle')), small('tool:ellipse', 'ellipse', T('rb/ellipse', 'Ellipse')),
                                small('tool:line', 'line', T('rb/line', 'Line'))),
                            stack(small('tool:arrow', 'arrow', T('rb/arrow', 'Arrow')), small('tool:draw', 'draw', T('rb/draw', 'Draw')),
                                small('tool:whiteout', 'whiteout', T('rb/whiteout', 'White-out')))
                        ]
                    },
                    {
                        label: T('grp/links', 'Links'), items: [
                            big('tool:link', 'link', T('rb/link', 'Link'))
                        ]
                    },
                    {
                        label: T('grp/pages', 'Pages'), items: [
                            big('blankPage', 'blankpage', T('rb/blank', 'Blank Page')),
                            big('insertPdf', 'insertpdf', T('rb/frompdf', 'From PDF')),
                            big('insertImages', 'images', T('rb/fromimages', 'From Images'))
                        ]
                    },
                    {
                        label: T('grp/attach', 'Attachments'), items: [
                            big('attachFile', 'attach', T('rb/attach', 'Attach File'))
                        ]
                    }
                ]
            },
            {
                id: 'edit', label: T('tab/edit', 'Edit'), groups: [
                    {
                        label: T('grp/history', 'History'), items: [
                            stack(small('undo', 'undo', T('rb/undo', 'Undo')), small('redo', 'redo', T('rb/redo', 'Redo')))
                        ]
                    },
                    {
                        label: T('grp/clipboard', 'Clipboard'), items: [
                            big('paste', 'paste', T('rb/paste', 'Paste')),
                            stack(small('cut', 'cut', T('rb/cut', 'Cut')), small('copy', 'copy', T('rb/copy', 'Copy')), small('duplicate', 'duplicate', T('rb/duplicate', 'Duplicate')))
                        ]
                    },
                    {
                        label: T('grp/content', 'Content'), items: [
                            big('tool:editpdf', 'editpdf', T('rb/editpdf', 'Edit PDF')),
                            big('tool:text', 'addtext', T('rb/addtext', 'Add Text')),
                            big('addImage', 'addimage', T('rb/addimage', 'Add Image')),
                            big('tool:whiteout', 'whiteout', T('rb/whiteout', 'White-out')),
                            big('tool:redact', 'redact', T('rb/redact', 'Redact'))
                        ]
                    },
                    {
                        label: T('grp/markup', 'Markup'), items: [
                            big('tool:highlight', 'highlight', T('rb/highlight', 'Highlight')),
                            stack(small('tool:underline', 'underline', T('rb/underline', 'Underline')), small('tool:strike', 'strike', T('rb/strike', 'Strikethrough')),
                                small('tool:draw', 'draw', T('rb/draw', 'Draw')))
                        ]
                    },
                    {
                        label: T('grp/arrange', 'Arrange'), items: [
                            stack(small('front', 'front', T('rb/front', 'Bring to Front')), small('back', 'back', T('rb/back', 'Send to Back')), small('delete', 'trash', T('rb/delete', 'Delete')))
                        ]
                    },
                    {
                        label: T('grp/find', 'Find'), items: [
                            big('find', 'search', T('rb/find', 'Find'))
                        ]
                    }
                ]
            },
            {
                id: 'view', label: T('tab/view', 'View'), groups: [
                    {
                        label: T('grp/zoom', 'Zoom'), items: [
                            big('zoomIn', 'zoomin', T('rb/zoomin', 'Zoom In')),
                            big('zoomOut', 'zoomout', T('rb/zoomout', 'Zoom Out')),
                            stack(small('actual', 'actual', T('rb/actual', 'Actual Size')), small('fitWidth', 'fitwidth', T('rb/fitwidth', 'Fit Width')),
                                small('fitPage', 'fitpage', T('rb/fitpage', 'Fit Page')))
                        ]
                    },
                    {
                        label: T('grp/layout', 'Page Layout'), items: [
                            big('mode:single', 'single', T('rb/single', 'Single Page')),
                            big('mode:continuous', 'continuous', T('rb/continuous', 'Continuous')),
                            big('mode:two', 'twopage', T('rb/twopage', 'Two Pages'))
                        ]
                    },
                    {
                        label: T('grp/panes', 'Panes'), items: [
                            big('panel:thumbs', 'thumbs', T('rb/thumbs', 'Thumbnails')),
                            big('panel:outline', 'bookmark', T('rb/bookmarks', 'Bookmarks')),
                            big('panel:props', 'panel', T('rb/props', 'Properties'))
                        ]
                    },
                    {
                        label: T('grp/theme', 'Theme'), items: [
                            big('theme', 'moon', T('rb/darkmode', 'Dark Mode'))
                        ]
                    }
                ]
            },
            {
                id: 'organize', label: T('tab/organize', 'Organize'), groups: [
                    {
                        label: T('grp/insertPages', 'Insert'), items: [
                            big('blankPage', 'blankpage', T('rb/blank', 'Blank Page')),
                            big('insertPdf', 'insertpdf', T('rb/frompdf', 'From PDF')),
                            big('insertImages', 'images', T('rb/fromimages', 'From Images'))
                        ]
                    },
                    {
                        label: T('grp/pagesGrp', 'Pages'), items: [
                            big('rotateLeft', 'rotateleft', T('rb/rotleft', 'Rotate Left')),
                            big('rotateRight', 'rotate', T('rb/rotright', 'Rotate Right')),
                            big('deletePages', 'trash', T('rb/delpages', 'Delete')),
                            big('duplicatePages', 'duplicate', T('rb/duppages', 'Duplicate'))
                        ]
                    },
                    {
                        label: T('grp/order', 'Order'), items: [
                            stack(small('moveUp', 'moveup', T('rb/moveup', 'Move Up')), small('moveDown', 'movedown', T('rb/movedown', 'Move Down')),
                                small('reverse', 'reverse', T('rb/reverse', 'Reverse Order')))
                        ]
                    },
                    {
                        label: T('grp/divide', 'Divide'), items: [
                            big('extract', 'extract', T('rb/extract', 'Extract')),
                            big('split', 'split', T('rb/split', 'Split')),
                            big('tool:crop', 'crop', T('rb/crop', 'Crop'))
                        ]
                    }
                ]
            },
            {
                id: 'convert', label: T('tab/convert', 'Convert'), groups: [
                    {
                        label: T('grp/office', 'ArozOS Office'), items: [
                            big('toDocs', 'todocs', T('rb/todocs', 'PDF to Docs'), { cls: 'c-docs' }),
                            big('toSheets', 'tosheets', T('rb/tosheets', 'PDF to Sheets'), { cls: 'c-sheets' }),
                            big('toSlides', 'toslides', T('rb/toslides', 'PDF to Slides'), { cls: 'c-slides' })
                        ]
                    },
                    {
                        label: T('grp/export', 'Export'), items: [
                            big('toImages', 'toimages', T('rb/toimages', 'PDF to Images'), { cls: 'c-images' }),
                            big('toText', 'totext', T('rb/totext', 'PDF to Text'))
                        ]
                    },
                    {
                        label: T('grp/create', 'Create'), items: [
                            big('imagesToPdf', 'images', T('rb/imagestopdf', 'Images to PDF')),
                            big('newBlank', 'newdoc', T('rb/newblank', 'Blank PDF'))
                        ]
                    }
                ]
            },
            {
                id: 'help', label: T('tab/help', 'Help'), groups: [
                    {
                        label: T('grp/help', 'Help'), items: [
                            big('shortcuts', 'keyboard', T('rb/shortcuts', 'Keyboard Shortcuts')),
                            big('about', 'info', T('rb/about', 'About'))
                        ]
                    }
                ]
            }
        ];
    };

    var ribbonEl, wrapEl, tabsEl;

    function control(c) {
        var b = PE.el('button', c.big ? 'rb-btn' : 'rb-sbtn');
        b.type = 'button';
        if (c.cls) {
            b.classList.add(c.cls);
        }
        b.dataset.cmd = c.cmd;
        var chev = c.menu ? '<svg class="ic chev" aria-hidden="true"><use href="#pe-i-chevdown"/></svg>' : '';
        if (c.big) {
            b.innerHTML = PE.icon(c.icon, 'lg') + '<span class="lbl">' + PE.esc(c.label) + chev + '</span>' +
                (c.menu ? '<svg class="ic chev-only" aria-hidden="true"><use href="#pe-i-chevdown"/></svg>' : '');
        } else {
            b.innerHTML = PE.icon(c.icon, 'sm') + '<span class="lbl">' + PE.esc(c.label) + '</span>';
        }
        b.title = c.tip ? c.label + ' - ' + c.tip : c.label;
        var kbd = PE.commands && PE.commands[c.cmd] && PE.commands[c.cmd].kbd;
        if (kbd) {
            b.title += ' (' + kbd + ')';
        }
        b.addEventListener('click', function () {
            if (c.menu) {
                PE.menu(b, PE.app.menus[c.menu]());
            } else {
                PE.run(c.cmd);
            }
        });
        return b;
    }

    R.render = function () {
        var tab = null;
        R.tabs().forEach(function (t) {
            if (t.id === R.tab) {
                tab = t;
            }
        });
        if (!tab) {
            return;
        }
        ribbonEl.innerHTML = '';
        tab.groups.forEach(function (g) {
            var ge = PE.el('div', 'rb-group');
            var items = PE.el('div', 'rb-items');
            g.items.forEach(function (it) {
                if (it.stack) {
                    var st = PE.el('div', 'rb-stack');
                    it.stack.forEach(function (c) {
                        st.appendChild(control(c));
                    });
                    items.appendChild(st);
                } else {
                    items.appendChild(control(it));
                }
            });
            ge.appendChild(items);
            ge.appendChild(PE.el('div', 'rb-label', PE.esc(g.label)));
            ribbonEl.appendChild(ge);
        });
        R.refresh();
        fit();
    };

    R.renderTabs = function () {
        tabsEl.innerHTML = '';
        R.tabs().forEach(function (t) {
            var b = PE.el('button', 'pe-tab' + (t.id === R.tab ? ' active' : '') + (t.menu ? ' pe-tab-file' : ''), PE.esc(t.label));
            b.type = 'button';
            b.dataset.tab = t.id;
            b.addEventListener('click', function () {
                if (t.menu) {
                    b.classList.add('open');
                    PE.menu(b, PE.app.menus.fileMenu(), {
                        minWidth: 250, onClose: function () {
                            b.classList.remove('open');
                        }
                    });
                    return;
                }
                if (R.tab === t.id && wrapEl.classList.contains('collapsed')) {
                    R.setCollapsed(false);
                }
                R.tab = t.id;
                Array.prototype.forEach.call(tabsEl.querySelectorAll('.pe-tab'), function (x) {
                    x.classList.toggle('active', x === b);
                });
                R.render();
                try {
                    localStorage.setItem('pdfeditor.tab', t.id);
                } catch (e) {
                    //private mode
                }
            });
            b.addEventListener('dblclick', function () {
                if (!t.menu) {
                    R.setCollapsed(!wrapEl.classList.contains('collapsed'));
                }
            });
            tabsEl.appendChild(b);
        });
    };

    R.setCollapsed = function (on) {
        wrapEl.classList.toggle('collapsed', on);
        var btn = PE.$('peRibbonToggle');
        if (btn) {
            btn.innerHTML = PE.icon(on ? 'ribbondown' : 'ribbonup', 'sm');
            btn.title = on ? PE.T('rb/expand', 'Show the ribbon') : PE.T('rb/collapse', 'Hide the ribbon');
        }
        try {
            localStorage.setItem('pdfeditor.ribbon', on ? 'collapsed' : '');
        } catch (e) {
            //private mode
        }
    };

    /* Enabled / active state of every control */
    R.refresh = function () {
        if (!ribbonEl) {
            return;
        }
        Array.prototype.forEach.call(ribbonEl.querySelectorAll('[data-cmd]'), function (b) {
            var c = PE.commands[b.dataset.cmd];
            if (!c) {
                b.disabled = true;
                return;
            }
            b.disabled = c.enabled ? !c.enabled() : false;
            b.classList.toggle('active', !!(c.active && c.active()));
            if (b.dataset.cmd === 'theme') {
                var dark = document.body.classList.contains('dark');
                b.querySelector('use').setAttribute('href', '#pe-i-' + (dark ? 'sun' : 'moon'));
                b.querySelector('.lbl').textContent = dark ? PE.T('rb/lightmode', 'Light Mode') : PE.T('rb/darkmode', 'Dark Mode');
            }
        });
    };

    function fit() {
        ribbonEl.classList.remove('lv1', 'lv2');
        if (ribbonEl.scrollWidth > ribbonEl.clientWidth + 1) {
            ribbonEl.classList.add('lv1');
            if (ribbonEl.scrollWidth > ribbonEl.clientWidth + 1) {
                ribbonEl.classList.add('lv2');
            }
        }
        scrollArrows();
    }

    function scrollArrows() {
        var l = PE.$('peRbLeft'), r = PE.$('peRbRight');
        var over = ribbonEl.scrollWidth > ribbonEl.clientWidth + 1;
        l.classList.toggle('show', over && ribbonEl.scrollLeft > 2);
        r.classList.toggle('show', over && ribbonEl.scrollLeft + ribbonEl.clientWidth < ribbonEl.scrollWidth - 2);
    }

    R.init = function () {
        ribbonEl = PE.$('peRibbon');
        wrapEl = PE.$('peRibbonWrap');
        tabsEl = PE.$('peTabs');
        try {
            var saved = localStorage.getItem('pdfeditor.tab');
            if (saved && saved !== 'file') {
                R.tab = saved;
            }
            if (localStorage.getItem('pdfeditor.ribbon') === 'collapsed') {
                wrapEl.classList.add('collapsed');
            }
        } catch (e) {
            //private mode
        }
        R.renderTabs();
        R.render();
        R.setCollapsed(wrapEl.classList.contains('collapsed'));
        ribbonEl.addEventListener('scroll', scrollArrows, { passive: true });
        ribbonEl.addEventListener('wheel', function (e) {
            if (ribbonEl.scrollWidth > ribbonEl.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                ribbonEl.scrollLeft += e.deltaY;
                e.preventDefault();
            }
        }, { passive: false });
        PE.$('peRbLeft').addEventListener('click', function () {
            ribbonEl.scrollBy({ left: -240, behavior: 'smooth' });
        });
        PE.$('peRbRight').addEventListener('click', function () {
            ribbonEl.scrollBy({ left: 240, behavior: 'smooth' });
        });
        PE.$('peRibbonToggle').addEventListener('click', function () {
            R.setCollapsed(!wrapEl.classList.contains('collapsed'));
        });
        if (window.ResizeObserver) {
            new ResizeObserver(fit).observe(ribbonEl);
        } else {
            window.addEventListener('resize', fit);
        }
    };
})(window.PE);
