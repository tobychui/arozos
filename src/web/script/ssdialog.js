/*
    In-page dialogs, in place of the browser's own alert(), confirm() and
    prompt(), which stop the whole tab, ignore the theme and show the address of
    the page as their title.

    Unlike those, these do not stop the script. What comes next goes into the
    callback:

        ssAlert("The port is not valid");
        ssAlert({title: "Upload failed", text: reason}, function(){ ... });

        ssConfirm("Remove this task?", function(){ ... });
        ssConfirm({
            title: "Remove this task?",   //optional
            text: "This cannot be undone.",
            confirmLabel: "Remove",       //optional, OK by default
            cancelLabel: "Keep",          //optional, Cancel by default
            danger: true                  //red button, and it starts on Cancel
        }, function(){ ... });

        ssPrompt({title: "New path", value: "/media"}, function(value){ ... });

    The confirm and prompt callbacks only run if the user goes ahead. Text is
    shown as text, never as HTML, so a server message is safe to pass in.

    System Settings loads this for its pages. A page opened on its own includes
    it like any other script; the dialog needs nothing else, and follows the
    settings tokens and body.dark where they exist.
*/

(function () {
    'use strict';

    if (window.ssConfirm) {
        return;
    }

    var BUTTON_LABELS = {
        'zh-tw': { ok: '確定', cancel: '取消' },
        'zh-hk': { ok: '確定', cancel: '取消' },
        'zh-cn': { ok: '确定', cancel: '取消' },
        'ja': { ok: 'OK', cancel: 'キャンセル' },
        'ko': { ok: '확인', cancel: '취소' }
    };

    var STYLE = `
.ss-dialog-back {
    --ssd-surface: var(--ss-surface, #ffffff);
    --ssd-field: var(--ss-field, #ffffff);
    --ssd-border: var(--ss-border-strong, #dededd);
    --ssd-text: var(--ss-text, #1c1c1a);
    --ssd-text-2: var(--ss-text-2, #62625d);
    --ssd-hover: var(--ss-hover, rgba(28, 28, 26, 0.045));
    --ssd-accent: var(--ss-accent, #1f74bf);
    --ssd-danger: var(--ss-danger-solid, #c53637);
    position: fixed;
    inset: 0;
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.32);
}
body.dark .ss-dialog-back {
    --ssd-surface: var(--ss-surface, #282826);
    --ssd-field: var(--ss-field, #1f1f1e);
    --ssd-border: var(--ss-border-strong, #464644);
    --ssd-text: var(--ss-text, #ececea);
    --ssd-text-2: var(--ss-text-2, #a5a5a0);
    --ssd-hover: var(--ss-hover, rgba(255, 255, 255, 0.05));
}
.ss-dialog {
    box-sizing: border-box;
    width: min(400px, 100%);
    max-height: 100%;
    overflow-y: auto;
    padding: 18px 20px 16px;
    border: 1px solid var(--ssd-border);
    border-radius: 10px;
    background: var(--ssd-surface);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
    font-family: var(--ss-font, 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif);
    color: var(--ssd-text);
}
.ss-dialog-title { font-size: 14.5px; font-weight: 600; overflow-wrap: anywhere; }
.ss-dialog-text {
    font-size: 12.5px;
    line-height: 1.5;
    white-space: pre-line;
    overflow-wrap: anywhere;
    color: var(--ssd-text-2);
}
.ss-dialog-title + .ss-dialog-text { margin-top: 6px; }
.ss-dialog-text:first-child { font-size: 13px; color: var(--ssd-text); }
.ss-dialog-input {
    box-sizing: border-box;
    width: 100%;
    height: 32px;
    margin-top: 10px;
    padding: 0 9px;
    border: 1px solid var(--ssd-border);
    border-radius: 7px;
    outline: none;
    background: var(--ssd-field);
    font: inherit;
    font-size: 12.5px;
    color: var(--ssd-text);
}
.ss-dialog-input:focus { border-color: var(--ssd-accent); }
.ss-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.ss-dialog-btn {
    min-width: 64px;
    height: 30px;
    padding: 0 14px;
    border: 1px solid var(--ssd-border);
    border-radius: 7px;
    background: var(--ssd-surface);
    font: inherit;
    font-size: 12.5px;
    color: var(--ssd-text);
    cursor: pointer;
}
.ss-dialog-btn:hover { background: var(--ssd-hover); }
.ss-dialog-btn:focus-visible { outline: 2px solid var(--ssd-accent); outline-offset: 1px; }
.ss-dialog-btn.primary { border-color: var(--ssd-accent); background: var(--ssd-accent); color: #ffffff; }
.ss-dialog-btn.danger { border-color: var(--ssd-danger); background: var(--ssd-danger); color: #ffffff; }
.ss-dialog-btn.primary:hover,
.ss-dialog-btn.danger:hover { filter: brightness(0.92); }
`;

    var dialogCount = 0;

    function buttonLabels() {
        var lang = null;
        try {
            lang = localStorage.getItem('global_language');
        } catch (e) {
            //Storage can be blocked. The browser's language is fine then
        }
        if (!lang || lang === 'default') {
            lang = navigator.language || '';
        }
        lang = String(lang).toLowerCase();
        return BUTTON_LABELS[lang] || BUTTON_LABELS[lang.slice(0, 2)] || { ok: 'OK', cancel: 'Cancel' };
    }

    function injectStyle() {
        if (document.getElementById('ssDialogStyle')) {
            return;
        }
        var style = document.createElement('style');
        style.id = 'ssDialogStyle';
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    function create(tag, className, text) {
        var node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function asOptions(options) {
        if (options !== null && typeof options === 'object') {
            return options;
        }
        return { text: String(options) };
    }

    /*
        Shows one dialog. confirm runs on the main button and dismiss on every
        other way out; hasCancel adds the second button, withInput the text box.
    */
    function show(options, spec) {
        injectStyle();
        var labels = buttonLabels();
        var previousFocus = document.activeElement;
        var id = 'ssDialog' + (++dialogCount);

        var back = create('div', 'ss-dialog-back');
        var dialog = create('div', 'ss-dialog');
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');

        if (options.title) {
            var title = create('div', 'ss-dialog-title', options.title);
            title.id = id + 'Title';
            dialog.setAttribute('aria-labelledby', title.id);
            dialog.appendChild(title);
        }
        if (options.text !== undefined && options.text !== '') {
            var text = create('div', 'ss-dialog-text', options.text);
            text.id = id + 'Text';
            dialog.setAttribute('aria-describedby', text.id);
            dialog.appendChild(text);
        }

        var input = null;
        if (spec.withInput) {
            input = create('input', 'ss-dialog-input');
            input.type = 'text';
            input.value = options.value === undefined ? '' : options.value;
            input.placeholder = options.placeholder || '';
            input.setAttribute('aria-label', options.title || options.text || '');
            dialog.appendChild(input);
        }

        var actions = create('div', 'ss-dialog-actions');
        var cancelButton = null;
        if (spec.hasCancel) {
            cancelButton = create('button', 'ss-dialog-btn', options.cancelLabel || labels.cancel);
            cancelButton.type = 'button';
            actions.appendChild(cancelButton);
        }
        var okButton = create('button', 'ss-dialog-btn ' + (options.danger ? 'danger' : 'primary'), options.confirmLabel || labels.ok);
        okButton.type = 'button';
        actions.appendChild(okButton);
        dialog.appendChild(actions);
        back.appendChild(dialog);

        function close() {
            back.remove();
            if (previousFocus && document.contains(previousFocus) && previousFocus.focus) {
                previousFocus.focus();
            }
        }

        function confirm() {
            var value = input ? input.value : undefined;
            close();
            if (spec.confirm) {
                spec.confirm(value);
            }
        }

        function dismiss() {
            close();
            if (spec.dismiss) {
                spec.dismiss();
            }
        }

        okButton.addEventListener('click', confirm);
        if (cancelButton) {
            cancelButton.addEventListener('click', dismiss);
        }
        back.addEventListener('mousedown', function (event) {
            if (event.target === back) {
                dismiss();
            }
        });
        back.addEventListener('keydown', function (event) {
            //Kept from the page, whose own Escape would close what is behind this
            event.stopPropagation();
            if (event.key === 'Escape') {
                dismiss();
            } else if (event.key === 'Enter' && event.target === input) {
                event.preventDefault();
                confirm();
            } else if (event.key === 'Tab') {
                //Stay inside the dialog
                event.preventDefault();
                var stops = [input, cancelButton, okButton].filter(Boolean);
                var next = stops.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1);
                stops[(next + stops.length) % stops.length].focus();
            }
        });

        document.body.appendChild(back);
        if (input) {
            input.focus();
            input.select();
        } else if (options.danger && cancelButton) {
            //A stray Enter must not be what deletes something
            cancelButton.focus();
        } else {
            okButton.focus();
        }
    }

    window.ssAlert = function (options, onClose) {
        show(asOptions(options), { confirm: onClose, dismiss: onClose });
    };

    window.ssConfirm = function (options, onConfirm) {
        show(asOptions(options), { hasCancel: true, confirm: onConfirm });
    };

    window.ssPrompt = function (options, onConfirm) {
        show(asOptions(options), { hasCancel: true, withInput: true, confirm: onConfirm });
    };
})();
