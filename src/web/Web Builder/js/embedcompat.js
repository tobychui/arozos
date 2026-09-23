/*
    embedcompat.js

    Compatibility shim for the case where the Site Builder is embedded as an
    iframe inside another ArozOS app (the Productivity hub does this).

    In that situation ao_module_virtualDesktop is false, because the host app -
    not this window - is the one attached to the desktop. Without this patch
    ao_module_openFileSelector would try to open its own selector window and
    never get a callback. The shim routes the selector through the real desktop
    (parent.parent) and registers the callback proxy on the host app window,
    which is where the desktop resolves callback names.
*/

(function () {
    try {
        if (ao_module_virtualDesktop || !parent.ao_module_virtualDesktop) { return; }

        ao_module_openFileSelector = function (callback, root, type, allowMultiple, options) {
            root = (root != null) ? root : "user:/";
            type = type || "file";
            allowMultiple = allowMultiple || false;

            var callbackname;
            if (typeof callback === "string") {
                callbackname = callback;
            } else if (typeof callback === "function" && callback.name) {
                callbackname = callback.name;
            } else {
                callbackname = "_aoFs_" + Date.now();
            }
            if (options && options.fnameOverride) {
                callbackname = options.fnameOverride;
            }

            var memKey = (options && options.path_memory_key) || ao_module_pathMemoryDefaultAction;

            /* the desktop resolves callbacks on the host app window */
            parent[callbackname] = function (files) {
                try {
                    if (!(options && options.disable_path_memory === true) &&
                        Array.isArray(files) && files.length > 0) {
                        var usedDir = ao_module_pathMemoryDirOf(files[0].filepath, type);
                        if (usedDir != "") { ao_module_setLastUsedPath(usedDir, memKey); }
                    }
                    var fn = (typeof callback === "string") ? window[callback] : callback;
                    if (fn) { fn(files); }
                } finally {
                    delete parent[callbackname];
                }
            };

            var initInfo = {
                root: root,
                fallbackRoot: root,
                type: type,
                allowMultiple: allowMultiple,
                listenerUUID: "",
                options: options
            };

            if (!(options && options.disable_path_memory === true)) {
                var remembered = (options && options.force_path_overwrite === true)
                    ? ao_module_getLastUsedPath(false)
                    : ao_module_getLastUsedPath(memKey);
                if (remembered != "") { initInfo.root = remembered; }
            }

            parent.parent.newFloatWindow({
                url: "SystemAO/file_system/file_selector.html#" + encodeURIComponent(JSON.stringify(initInfo)),
                width: 960,
                height: 620,
                appicon: "SystemAO/file_system/img/selector.png",
                title: "Open",
                parent: parent.ao_module_windowID,
                callback: callbackname
            });
        };
    } catch (e) {
        /* cross-origin or not nested - leave ao_module_openFileSelector alone */
    }
})();
