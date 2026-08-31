/*
    settings.js - session settings model and the Session Settings dialog

    The dialog mirrors the classic folder compare settings sheet: Specs,
    Comparison, Handling, Name Filters and Other Filters.
*/

var CmpSettings = (function () {

    var STORE_KEY = "codestudio_compare_settings_v1";

    function defaults() {
        return {
            //Specs
            specs: {
                leftReadOnly: false,
                rightReadOnly: false,
                followLinks: false
            },
            //Comparison - quick tests
            compareSize: true,
            compareTimestamp: false,
            timestampTolerance: 2,
            ignoreDST: false,
            ignoreTimezone: false,
            compareFilenameCase: false,
            alignDifferentExtensions: false,
            alignUnicodeForms: true,
            //Comparison - requires opening files
            compareContents: true,
            contentMode: "crc",          // crc | binary | rules
            skipIfQuickSame: false,
            overrideQuickTests: true,
            //Rules used by "rules based comparison" and by the text comparer
            rules: {
                ignoreOuterWhitespace: true,
                ignoreAllWhitespace: false,
                ignoreCase: false,
                ignoreLineEndings: true,
                ignoreBlankLines: false,
                unimportantPatterns: ""
            },
            //Handling
            handling: {
                deleteToRecycleBin: true,
                overwriteExisting: true,
                createMissingFolders: true,
                confirmDestructive: true
            },
            //Name filters
            nameFilters: {
                includeFiles: "*",
                excludeFiles: "",
                excludeFolders: ".git;node_modules"
            },
            //Other filters
            otherFilters: {
                recursive: true,
                maxDepth: 0,
                minSize: 0,
                maxSize: 0,
                changedWithinDays: 0,
                foldersOnlyStructure: false
            }
        };
    }

    //Merge a stored blob over the defaults so new options keep working when an
    //older settings object is loaded from local storage
    function mergeDeep(target, source) {
        if (!source || typeof source !== "object") {
            return target;
        }
        for (var key in source) {
            if (!Object.prototype.hasOwnProperty.call(source, key)) {
                continue;
            }
            if (target[key] && typeof target[key] === "object" && !Array.isArray(target[key]) &&
                source[key] && typeof source[key] === "object") {
                mergeDeep(target[key], source[key]);
            } else if (source[key] !== undefined) {
                target[key] = source[key];
            }
        }
        return target;
    }

    function clone(settings) {
        return JSON.parse(JSON.stringify(settings));
    }

    function loadDefaults() {
        var result = defaults();
        try {
            var raw = localStorage.getItem(STORE_KEY);
            if (raw) {
                mergeDeep(result, JSON.parse(raw));
            }
        } catch (e) {
            //Corrupted or unavailable storage just falls back to the defaults
        }
        return result;
    }

    function saveDefaults(settings) {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(settings));
        } catch (e) {
            //Storage is optional, ignore quota or privacy mode failures
        }
    }

    /* ------------------------------ dialog ------------------------------ */

    var dialogState = {
        working: null,
        onApply: null,
        activeTab: "comparison"
    };

    function chk(id, label, indent, disabled, hint) {
        return '<label class="chk' + (indent ? " indent" : "") + (disabled ? " disabled" : "") + '"' +
            (hint ? ' title="' + CmpUtil.escapeHtml(hint) + '"' : "") + '>' +
            '<input type="checkbox" id="' + id + '"' + (disabled ? " disabled" : "") + '>' +
            '<span>' + CmpUtil.escapeHtml(label) + '</span></label>';
    }

    function radio(id, group, label, indent) {
        return '<label class="chk' + (indent ? " indent" : "") + '">' +
            '<input type="radio" name="' + group + '" id="' + id + '">' +
            '<span>' + CmpUtil.escapeHtml(label) + '</span></label>';
    }

    function buildDialogHTML() {
        return '' +
        '<div class="dlgpage" data-page="specs">' +
            '<div class="fieldset"><div class="legendtitle">Base folders</div>' +
                '<div class="frow" style="margin-bottom:6px;">' +
                    '<span style="display:inline-block;width:40px;">Left</span>' +
                    '<input type="text" class="txtin" id="setLeftPath" style="width:calc(100% - 48px);">' +
                '</div>' +
                '<div class="frow">' +
                    '<span style="display:inline-block;width:40px;">Right</span>' +
                    '<input type="text" class="txtin" id="setRightPath" style="width:calc(100% - 48px);">' +
                '</div>' +
            '</div>' +
            '<div class="fieldset"><div class="legendtitle">Protection</div>' +
                chk("setLeftReadOnly", "Treat the left side as read only", false, false,
                    "Blocks copy, delete and save operations that would write to the left side") +
                chk("setRightReadOnly", "Treat the right side as read only", false, false,
                    "Blocks copy, delete and save operations that would write to the right side") +
            '</div>' +
            '<div class="note">Paths are ArozOS virtual paths, for example <b>user:/Desktop/site</b>. ' +
            'Use the folder buttons on the path bar to pick them visually.</div>' +
        '</div>' +

        '<div class="dlgpage" data-page="comparison">' +
            '<div class="twocol">' +
                '<div>' +
                    '<div class="fieldset"><div class="legendtitle">Quick tests</div>' +
                        chk("setCompareSize", "Compare file size") +
                        chk("setCompareTimestamp", "Compare timestamps") +
                        '<div class="chk indent"><input class="numin" type="number" min="0" step="1" id="setTolerance">' +
                            '<span>second tolerance</span></div>' +
                        chk("setIgnoreDST", "Ignore daylight saving difference (1 hour)", true) +
                        chk("setIgnoreTimezone", "Ignore timezone differences", true) +
                        '<div style="height:6px;"></div>' +
                        chk("setFilenameCase", "Compare filename case") +
                        chk("setAlignExt", "Align filenames with different extensions") +
                        chk("setAlignUnicode", "Align filenames with different Unicode normalization forms") +
                    '</div>' +
                '</div>' +
                '<div>' +
                    '<div class="fieldset"><div class="legendtitle">Compare file attributes</div>' +
                        chk("setAttrArchive", "Archive", false, true, "File attributes are not exposed by the ArozOS virtual file system") +
                        chk("setAttrSystem", "System", false, true, "File attributes are not exposed by the ArozOS virtual file system") +
                        chk("setAttrHidden", "Hidden", false, true, "Hidden entries are filtered out by the ArozOS file layer") +
                        chk("setAttrReadOnly", "Read-only", false, true, "File attributes are not exposed by the ArozOS virtual file system") +
                        '<div class="note">Attribute tests are unavailable because the ArozOS virtual file ' +
                        'system does not expose per file attributes across its storage backends.</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="fieldset"><div class="legendtitle">Requires opening files</div>' +
                chk("setCompareContents", "Compare contents:") +
                radio("setModeCRC", "cmpContentMode", "CRC comparison (MD5 digest, computed on the server)", true) +
                radio("setModeBinary", "cmpContentMode", "Binary comparison (byte for byte)", true) +
                radio("setModeRules", "cmpContentMode", "Rules-based comparison (text, ignoring unimportant differences)", true) +
                chk("setSkipQuickSame", "Skip if quick tests indicate the files are the same", true) +
                chk("setOverrideQuick", "Override quick test results") +
                '<div class="fieldset" style="margin:8px 0 0 20px;"><div class="legendtitle">Rules</div>' +
                    '<div class="twocol"><div>' +
                        chk("setRuleOuterWS", "Ignore leading and trailing whitespace") +
                        chk("setRuleAllWS", "Ignore all whitespace") +
                        chk("setRuleCase", "Ignore letter case") +
                    '</div><div>' +
                        chk("setRuleLineEnd", "Ignore line ending differences") +
                        chk("setRuleBlank", "Ignore blank lines") +
                    '</div></div>' +
                    '<div style="margin-top:6px;">Unimportant text (one regular expression per line)</div>' +
                    '<textarea class="txtin" id="setRulePatterns" spellcheck="false" ' +
                        'placeholder="^\\s*//.*$&#10;^\\s*#.*$"></textarea>' +
                    '<div class="note">Lines that only differ inside these patterns are reported as ' +
                    'minor differences and can be hidden with the Minor toolbar button.</div>' +
                '</div>' +
            '</div>' +
        '</div>' +

        '<div class="dlgpage" data-page="handling">' +
            '<div class="fieldset"><div class="legendtitle">Copy and delete</div>' +
                chk("setDeleteRecycle", "Send deleted items to the recycle bin") +
                chk("setOverwriteExisting", "Overwrite existing files when copying") +
                chk("setCreateFolders", "Create missing folders on the target side") +
                chk("setConfirmDestructive", "Confirm before overwriting or deleting") +
            '</div>' +
            '<div class="note">Copies are performed server side by the ArozOS file system, so binary ' +
            'files, large files and remote storage backends are all handled natively.</div>' +
        '</div>' +

        '<div class="dlgpage" data-page="namefilters">' +
            '<div class="fieldset"><div class="legendtitle">Include files</div>' +
                '<input type="text" class="txtin" id="setIncludeFiles" spellcheck="false" placeholder="*">' +
                '<div class="note">Semicolon separated masks, for example <b>*.php;*.txt</b>. ' +
                'Leave as <b>*</b> to include everything.</div>' +
            '</div>' +
            '<div class="fieldset"><div class="legendtitle">Exclude files</div>' +
                '<input type="text" class="txtin" id="setExcludeFiles" spellcheck="false" placeholder="*.tmp;*.bak">' +
            '</div>' +
            '<div class="fieldset"><div class="legendtitle">Exclude folders</div>' +
                '<input type="text" class="txtin" id="setExcludeFolders" spellcheck="false" placeholder=".git;node_modules">' +
                '<div class="note">Matching folders are skipped together with everything inside them.</div>' +
            '</div>' +
        '</div>' +

        '<div class="dlgpage" data-page="otherfilters">' +
            '<div class="fieldset"><div class="legendtitle">Scan depth</div>' +
                chk("setRecursive", "Include subfolders") +
                '<div class="chk indent"><input class="numin" type="number" min="0" step="1" id="setMaxDepth">' +
                    '<span>maximum depth (0 for unlimited)</span></div>' +
                chk("setFoldersOnly", "Compare folder structure only, ignore file contents") +
            '</div>' +
            '<div class="fieldset"><div class="legendtitle">Size and age</div>' +
                '<div class="chk"><input class="numin" type="number" min="0" step="1" id="setMinSize">' +
                    '<span>minimum file size in KB (0 for no limit)</span></div>' +
                '<div class="chk"><input class="numin" type="number" min="0" step="1" id="setMaxSize">' +
                    '<span>maximum file size in KB (0 for no limit)</span></div>' +
                '<div class="chk"><input class="numin" type="number" min="0" step="1" id="setChangedDays">' +
                    '<span>only files changed within N days (0 for any age)</span></div>' +
            '</div>' +
        '</div>';
    }

    function setChecked(id, value) {
        var el = document.getElementById(id);
        if (el) {
            el.checked = !!value;
        }
    }

    function getChecked(id) {
        var el = document.getElementById(id);
        return el ? !!el.checked : false;
    }

    function setValue(id, value) {
        var el = document.getElementById(id);
        if (el) {
            el.value = value === undefined || value === null ? "" : value;
        }
    }

    function getValue(id) {
        var el = document.getElementById(id);
        return el ? el.value : "";
    }

    function getNumber(id, fallback) {
        var parsed = parseInt(getValue(id), 10);
        return isNaN(parsed) ? (fallback || 0) : parsed;
    }

    function populate(settings, paths) {
        setValue("setLeftPath", paths ? paths.left : "");
        setValue("setRightPath", paths ? paths.right : "");
        setChecked("setLeftReadOnly", settings.specs.leftReadOnly);
        setChecked("setRightReadOnly", settings.specs.rightReadOnly);

        setChecked("setCompareSize", settings.compareSize);
        setChecked("setCompareTimestamp", settings.compareTimestamp);
        setValue("setTolerance", settings.timestampTolerance);
        setChecked("setIgnoreDST", settings.ignoreDST);
        setChecked("setIgnoreTimezone", settings.ignoreTimezone);
        setChecked("setFilenameCase", settings.compareFilenameCase);
        setChecked("setAlignExt", settings.alignDifferentExtensions);
        setChecked("setAlignUnicode", settings.alignUnicodeForms);

        setChecked("setCompareContents", settings.compareContents);
        setChecked("setModeCRC", settings.contentMode === "crc");
        setChecked("setModeBinary", settings.contentMode === "binary");
        setChecked("setModeRules", settings.contentMode === "rules");
        setChecked("setSkipQuickSame", settings.skipIfQuickSame);
        setChecked("setOverrideQuick", settings.overrideQuickTests);

        setChecked("setRuleOuterWS", settings.rules.ignoreOuterWhitespace);
        setChecked("setRuleAllWS", settings.rules.ignoreAllWhitespace);
        setChecked("setRuleCase", settings.rules.ignoreCase);
        setChecked("setRuleLineEnd", settings.rules.ignoreLineEndings);
        setChecked("setRuleBlank", settings.rules.ignoreBlankLines);
        setValue("setRulePatterns", settings.rules.unimportantPatterns);

        setChecked("setDeleteRecycle", settings.handling.deleteToRecycleBin);
        setChecked("setOverwriteExisting", settings.handling.overwriteExisting);
        setChecked("setCreateFolders", settings.handling.createMissingFolders);
        setChecked("setConfirmDestructive", settings.handling.confirmDestructive);

        setValue("setIncludeFiles", settings.nameFilters.includeFiles);
        setValue("setExcludeFiles", settings.nameFilters.excludeFiles);
        setValue("setExcludeFolders", settings.nameFilters.excludeFolders);

        setChecked("setRecursive", settings.otherFilters.recursive);
        setValue("setMaxDepth", settings.otherFilters.maxDepth);
        setChecked("setFoldersOnly", settings.otherFilters.foldersOnlyStructure);
        setValue("setMinSize", settings.otherFilters.minSize);
        setValue("setMaxSize", settings.otherFilters.maxSize);
        setValue("setChangedDays", settings.otherFilters.changedWithinDays);

        refreshEnabledState();
    }

    //Grey out dependent rows the way the original dialog does
    function refreshEnabledState() {
        var timestampOn = getChecked("setCompareTimestamp");
        ["setTolerance", "setIgnoreDST", "setIgnoreTimezone"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) {
                el.disabled = !timestampOn;
                if (el.parentElement && el.parentElement.classList.contains("chk")) {
                    el.parentElement.classList.toggle("disabled", !timestampOn);
                }
            }
        });

        var contentsOn = getChecked("setCompareContents");
        ["setModeCRC", "setModeBinary", "setModeRules", "setSkipQuickSame"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) {
                el.disabled = !contentsOn;
                if (el.parentElement && el.parentElement.classList.contains("chk")) {
                    el.parentElement.classList.toggle("disabled", !contentsOn);
                }
            }
        });

        var recursiveOn = getChecked("setRecursive");
        var depthEl = document.getElementById("setMaxDepth");
        if (depthEl) {
            depthEl.disabled = !recursiveOn;
        }
    }

    function harvest(settings) {
        var next = clone(settings);

        next.specs.leftReadOnly = getChecked("setLeftReadOnly");
        next.specs.rightReadOnly = getChecked("setRightReadOnly");

        next.compareSize = getChecked("setCompareSize");
        next.compareTimestamp = getChecked("setCompareTimestamp");
        next.timestampTolerance = getNumber("setTolerance", 2);
        next.ignoreDST = getChecked("setIgnoreDST");
        next.ignoreTimezone = getChecked("setIgnoreTimezone");
        next.compareFilenameCase = getChecked("setFilenameCase");
        next.alignDifferentExtensions = getChecked("setAlignExt");
        next.alignUnicodeForms = getChecked("setAlignUnicode");

        next.compareContents = getChecked("setCompareContents");
        next.contentMode = getChecked("setModeBinary") ? "binary" :
            (getChecked("setModeRules") ? "rules" : "crc");
        next.skipIfQuickSame = getChecked("setSkipQuickSame");
        next.overrideQuickTests = getChecked("setOverrideQuick");

        next.rules.ignoreOuterWhitespace = getChecked("setRuleOuterWS");
        next.rules.ignoreAllWhitespace = getChecked("setRuleAllWS");
        next.rules.ignoreCase = getChecked("setRuleCase");
        next.rules.ignoreLineEndings = getChecked("setRuleLineEnd");
        next.rules.ignoreBlankLines = getChecked("setRuleBlank");
        next.rules.unimportantPatterns = getValue("setRulePatterns");

        next.handling.deleteToRecycleBin = getChecked("setDeleteRecycle");
        next.handling.overwriteExisting = getChecked("setOverwriteExisting");
        next.handling.createMissingFolders = getChecked("setCreateFolders");
        next.handling.confirmDestructive = getChecked("setConfirmDestructive");

        next.nameFilters.includeFiles = getValue("setIncludeFiles") || "*";
        next.nameFilters.excludeFiles = getValue("setExcludeFiles");
        next.nameFilters.excludeFolders = getValue("setExcludeFolders");

        next.otherFilters.recursive = getChecked("setRecursive");
        next.otherFilters.maxDepth = getNumber("setMaxDepth", 0);
        next.otherFilters.foldersOnlyStructure = getChecked("setFoldersOnly");
        next.otherFilters.minSize = getNumber("setMinSize", 0);
        next.otherFilters.maxSize = getNumber("setMaxSize", 0);
        next.otherFilters.changedWithinDays = getNumber("setChangedDays", 0);

        return {
            settings: next,
            paths: {
                left: getValue("setLeftPath"),
                right: getValue("setRightPath")
            }
        };
    }

    function selectTab(name) {
        dialogState.activeTab = name;
        var tabs = document.querySelectorAll("#settingsDialog .dlgtabs .tab");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle("active", tabs[i].getAttribute("data-tab") === name);
        }
        var pages = document.querySelectorAll("#settingsDialog .dlgpage");
        for (var j = 0; j < pages.length; j++) {
            pages[j].classList.toggle("active", pages[j].getAttribute("data-page") === name);
        }
    }

    var dialogBuilt = false;

    function ensureDialog() {
        if (dialogBuilt) {
            return;
        }
        document.getElementById("settingsBody").innerHTML = buildDialogHTML();

        var tabs = document.querySelectorAll("#settingsDialog .dlgtabs .tab");
        for (var i = 0; i < tabs.length; i++) {
            (function (tab) {
                tab.addEventListener("click", function () {
                    selectTab(tab.getAttribute("data-tab"));
                });
            })(tabs[i]);
        }

        ["setCompareTimestamp", "setCompareContents", "setRecursive"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener("change", refreshEnabledState);
            }
        });

        document.getElementById("settingsCancel").addEventListener("click", close);
        document.getElementById("settingsClose").addEventListener("click", close);
        document.getElementById("settingsOK").addEventListener("click", function () {
            var harvested = harvest(dialogState.working);
            if (document.getElementById("settingsScope").value === "default") {
                saveDefaults(harvested.settings);
            }
            close();
            if (dialogState.onApply) {
                dialogState.onApply(harvested.settings, harvested.paths);
            }
        });

        dialogBuilt = true;
    }

    function open(settings, paths, tab, onApply) {
        ensureDialog();
        dialogState.working = clone(settings);
        dialogState.onApply = onApply;
        populate(dialogState.working, paths);
        selectTab(tab || "comparison");
        document.getElementById("settingsMask").classList.add("on");
    }

    function close() {
        document.getElementById("settingsMask").classList.remove("on");
    }

    /* --------------------------- rule helpers --------------------------- */

    function compileUnimportant(rules) {
        var patterns = [];
        var lines = String(rules.unimportantPatterns || "").split("\n");
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line === "") {
                continue;
            }
            try {
                patterns.push(new RegExp(line));
            } catch (e) {
                //An invalid expression is simply skipped rather than breaking
                //the whole comparison
            }
        }
        return patterns;
    }

    //Normalise a single line of text according to the active rules. Two lines
    //that normalise to the same string are an unimportant (minor) difference.
    function normalizeLine(line, rules, unimportant) {
        var text = line === undefined || line === null ? "" : String(line);
        if (unimportant && unimportant.length) {
            for (var i = 0; i < unimportant.length; i++) {
                text = text.replace(unimportant[i], "");
            }
        }
        if (rules.ignoreAllWhitespace) {
            text = text.replace(/\s+/g, "");
        } else if (rules.ignoreOuterWhitespace) {
            text = text.replace(/^\s+|\s+$/g, "");
        }
        if (rules.ignoreCase) {
            text = text.toLowerCase();
        }
        return text;
    }

    return {
        defaults: defaults,
        clone: clone,
        loadDefaults: loadDefaults,
        saveDefaults: saveDefaults,
        open: open,
        close: close,
        compileUnimportant: compileUnimportant,
        normalizeLine: normalizeLine
    };
})();
