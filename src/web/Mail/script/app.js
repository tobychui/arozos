/*
    Mail — main window

    State, sidebar, message list, reading pane, actions, keyboard shortcuts,
    new-mail polling and the glue to the composer, wizard and settings.

    Views:
      {kind: "unified", key: "inbox" | "flagged" | "role:<role>"}  every account,
                                                                   or the account
                                                                   in the account filter
      {kind: "folder", accountId, folder}                          one mailbox
      {kind: "label", id}  {kind: "snoozed"}  {kind: "outbox"}     kept by ArozOS
*/

var Mail = window.Mail || {};
window.Mail = Mail;

Mail.app = (function () {
    "use strict";
    var util = Mail.util;
    var ui = Mail.ui;
    var api = Mail.api;
    var render = Mail.render;
    var compose = Mail.compose;
    var el = util.el;
    var icon = util.icon;

    var ROLE_META = {
        inbox: { label: "Inbox", icon: "inbox" },
        flagged: { label: "Starred", icon: "star outline" },
        drafts: { label: "Drafts", icon: "file outline" },
        sent: { label: "Sent", icon: "paper plane outline" },
        archive: { label: "Archive", icon: "archive" },
        all: { label: "All Mail", icon: "envelope open outline" },
        important: { label: "Important", icon: "bookmark outline" },
        junk: { label: "Junk", icon: "ban" },
        trash: { label: "Trash", icon: "trash alternate outline" }
    };

    var state = {
        user: { username: "", admin: false },
        settings: {},
        labels: [],
        accounts: [],
        folders: {},
        inboxStatus: {},
        outboxCount: 0,
        snoozedCount: 0,
        accountFilter: "",
        view: { kind: "unified", key: "inbox" },
        list: { messages: [], total: 0, page: 0, loading: false, done: false, token: 0, errors: [] },
        sort: "date",
        filter: "all",
        search: "",
        searchIn: "all",
        checked: {},
        lastCheckedIndex: -1,
        currentKey: null,
        message: null,
        messageToken: 0,
        moreOpen: false,
        frame: null,
        markTimer: null,
        pollTimer: null
    };

    var dom = {};

    /* ---------- Helpers ---------- */

    function account(id) {
        return state.accounts.filter(function (item) { return item.id === id; })[0] || null;
    }

    function foldersOf(accountId) {
        return state.folders[accountId] || [];
    }

    function folderByRole(accountId, role) {
        return foldersOf(accountId).filter(function (folder) { return folder.role === role && folder.selectable; })[0] || null;
    }

    function roleOfFolder(accountId, name) {
        if (String(name).toUpperCase() === "INBOX") {
            return "inbox";
        }
        var folder = foldersOf(accountId).filter(function (item) { return item.name === name; })[0];
        return folder ? folder.role : "";
    }

    //viewRole tells which special folder the current view shows
    function viewRole() {
        var view = state.view;
        if (view.kind === "unified") {
            return view.key.indexOf("role:") === 0 ? view.key.slice(5) : view.key;
        }
        if (view.kind === "folder") {
            return roleOfFolder(view.accountId, view.folder);
        }
        return "";
    }

    function defaultAccountId() {
        if (state.accountFilter) {
            return state.accountFilter;
        }
        if (state.settings.defaultAccount && account(state.settings.defaultAccount)) {
            return state.settings.defaultAccount;
        }
        return state.accounts.length > 0 ? state.accounts[0].id : "";
    }

    function messageByKey(key) {
        return state.list.messages.filter(function (message) { return util.messageKey(message) === key; })[0] || null;
    }

    function checkedMessages() {
        return state.list.messages.filter(function (message) { return state.checked[util.messageKey(message)]; });
    }

    //targets are the messages an action applies to: the checked rows, or the
    //open message
    function targets() {
        var checked = checkedMessages();
        if (checked.length > 0) {
            return checked;
        }
        var current = state.currentKey ? messageByKey(state.currentKey) : null;
        if (current) {
            return [current];
        }
        if (state.message) {
            return [state.message];
        }
        return [];
    }

    function groupByFolder(messages) {
        var groups = {};
        messages.forEach(function (message) {
            var key = message.accountId + "\u0000" + message.folder;
            if (!groups[key]) {
                groups[key] = { accountId: message.accountId, folder: message.folder, uids: [], messages: [] };
            }
            groups[key].uids.push(message.uid);
            groups[key].messages.push(message);
        });
        return Object.keys(groups).map(function (key) { return groups[key]; });
    }

    function isMobile() {
        return window.innerWidth <= 720;
    }

    /* ---------- Theme ---------- */

    var systemTheme = "light";

    function applyTheme() {
        var choice = state.settings.theme || "system";
        var theme = choice === "system" ? systemTheme : choice;
        document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
        dom.app.classList.toggle("density-compact", state.settings.density === "compact");
        dom.app.classList.toggle("hide-preview", state.settings.showPreview === false);
    }

    function watchSystemTheme() {
        if (window.matchMedia) {
            var query = window.matchMedia("(prefers-color-scheme: dark)");
            systemTheme = query.matches ? "dark" : "light";
        }
        if (typeof ao_module_getSystemThemeColor === "function") {
            try {
                ao_module_getSystemThemeColor(function (theme) {
                    if (theme === "darkTheme" || theme === "whiteTheme") {
                        systemTheme = theme === "darkTheme" ? "dark" : "light";
                        applyTheme();
                    }
                });
            } catch (e) { /* standalone */ }
        }
        if (typeof ao_module_onThemeChanged === "function") {
            ao_module_onThemeChanged(function (theme) {
                systemTheme = theme === "dark" ? "dark" : "light";
                applyTheme();
            });
        }
    }

    /* ---------- Sidebar ---------- */

    function unreadOf(accountId, role) {
        var folder = role === "inbox" ? (foldersOf(accountId).filter(function (item) { return item.role === "inbox"; })[0]) : folderByRole(accountId, role);
        if (role === "inbox" && state.inboxStatus[accountId]) {
            return state.inboxStatus[accountId].unread;
        }
        return folder && folder.unread > 0 ? folder.unread : 0;
    }

    function totalOf(accountId, role) {
        var folder = folderByRole(accountId, role);
        return folder && folder.total > 0 ? folder.total : 0;
    }

    function scopedAccounts() {
        return state.accountFilter ? state.accounts.filter(function (item) { return item.id === state.accountFilter; }) : state.accounts;
    }

    function roleCount(role) {
        var sum = 0;
        scopedAccounts().forEach(function (item) {
            sum += role === "drafts" ? totalOf(item.id, role) : unreadOf(item.id, role);
        });
        return sum;
    }

    function navItem(options) {
        var item = el("div", {
            class: "nav-item" + (options.active ? " active" : "") + (options.className ? " " + options.className : ""),
            role: "button", tabindex: "0", title: options.title || options.label,
            style: options.depth ? { "--depth": options.depth } : null
        });
        if (options.dot) {
            item.appendChild(el("span", { class: "dot", style: { background: options.dot } }));
        } else if (options.icon) {
            item.appendChild(icon(options.icon));
        }
        item.appendChild(el("span", { class: "label", text: options.label }));
        if (options.warn) {
            item.appendChild(el("i", { class: "exclamation circle icon warn", title: options.warn }));
        }
        if (options.count) {
            item.appendChild(el("span", { class: "count" + (options.strong ? " strong" : ""), text: options.count > 999 ? "999+" : String(options.count) }));
        }
        if (options.more) {
            var moreButton = el("button", { class: "iconbtn small more-btn", title: "More", type: "button" }, icon("ellipsis horizontal"));
            moreButton.addEventListener("click", function (event) {
                event.stopPropagation();
                options.more(moreButton);
            });
            item.appendChild(moreButton);
        }
        item.addEventListener("click", options.onClick);
        item.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                options.onClick(event);
            }
        });
        if (options.more) {
            item.addEventListener("contextmenu", function (event) {
                event.preventDefault();
                options.more({ x: event.clientX, y: event.clientY });
            });
        }
        if (options.drop) {
            item.addEventListener("dragover", function (event) {
                //types is an array in Chromium but a DOMStringList elsewhere
                if (Array.prototype.indexOf.call(event.dataTransfer.types || [], "application/x-aroz-mail") >= 0) {
                    event.preventDefault();
                    item.classList.add("drop-target");
                }
            });
            item.addEventListener("dragleave", function () { item.classList.remove("drop-target"); });
            item.addEventListener("drop", function (event) {
                event.preventDefault();
                item.classList.remove("drop-target");
                options.drop(draggedMessages());
            });
        }
        return item;
    }

    function isActiveView(view) {
        var current = state.view;
        if (current.kind !== view.kind) {
            return false;
        }
        switch (view.kind) {
            case "unified": return current.key === view.key;
            case "folder": return current.accountId === view.accountId && current.folder === view.folder;
            case "label": return current.id === view.id;
            default: return true;
        }
    }

    //roleView maps a sidebar mailbox to a view for the current account scope
    function roleView(role) {
        if (state.accountFilter) {
            if (role === "inbox") {
                return { kind: "folder", accountId: state.accountFilter, folder: "INBOX" };
            }
            if (role === "flagged") {
                return { kind: "unified", key: "flagged" };
            }
            var folder = folderByRole(state.accountFilter, role);
            if (folder) {
                return { kind: "folder", accountId: state.accountFilter, folder: folder.name };
            }
        }
        if (role === "inbox" || role === "flagged") {
            return { kind: "unified", key: role };
        }
        return { kind: "unified", key: "role:" + role };
    }

    function roleAvailable(role) {
        return scopedAccounts().some(function (item) { return folderByRole(item.id, role) !== null; });
    }

    function renderSidebar() {
        var nav = util.clear(dom.nav);

        //Mailboxes
        var mailboxes = el("div", { class: "nav-section" });
        var addRole = function (role, extra) {
            var meta = ROLE_META[role];
            var view = roleView(role);
            var count = extra && extra.count !== undefined ? extra.count : (role === "inbox" || role === "drafts" || role === "junk" ? roleCount(role) : 0);
            mailboxes.appendChild(navItem({
                label: meta.label, icon: meta.icon, count: count, strong: role === "inbox",
                active: isActiveView(view),
                onClick: function () { openView(roleView(role)); closeDrawer(); },
                drop: role === "inbox" || role === "archive" || role === "trash" || role === "junk" ? function (messages) {
                    if (role === "trash") {
                        deleteMessages(messages, false);
                    } else {
                        moveToRole(messages, role);
                    }
                } : (role === "flagged" ? function (messages) { setFlag(messages, "flagged", true); } : null),
                more: role === "trash" || role === "junk" ? function (anchor) { roleMenu(anchor, role); } : null
            }));
        };
        addRole("inbox");
        addRole("flagged", { count: 0 });
        mailboxes.appendChild(navItem({
            label: "Snoozed", icon: "clock outline", count: state.snoozedCount, active: state.view.kind === "snoozed",
            onClick: function () { openView({ kind: "snoozed" }); closeDrawer(); }
        }));
        addRole("sent", { count: 0 });
        addRole("drafts");
        if (state.outboxCount > 0) {
            mailboxes.appendChild(navItem({
                label: "Scheduled", icon: "hourglass half", count: state.outboxCount, active: state.view.kind === "outbox",
                onClick: function () { openView({ kind: "outbox" }); closeDrawer(); }
            }));
        }

        var moreToggle = navItem({
            label: state.moreOpen ? "Less" : "More", icon: state.moreOpen ? "angle up" : "angle down",
            onClick: function () { state.moreOpen = !state.moreOpen; renderSidebar(); }
        });
        mailboxes.appendChild(moreToggle);
        if (state.moreOpen) {
            ["archive", "all", "important", "junk", "trash"].forEach(function (role) {
                if (roleAvailable(role)) {
                    addRole(role, { count: role === "junk" ? roleCount("junk") : 0 });
                }
            });
            renderFolderTree(mailboxes);
        }
        nav.appendChild(mailboxes);

        //Accounts
        var accountsSection = el("div", { class: "nav-section" });
        var accountsHead = el("div", { class: "nav-heading" }, [
            el("span", { text: "Accounts" }),
            el("button", { class: "iconbtn small", title: "Add account", on: { click: addAccount } }, icon("plus"))
        ]);
        accountsSection.appendChild(accountsHead);
        if (state.accounts.length === 0) {
            accountsSection.appendChild(navItem({ label: "Add an account", icon: "plus circle", onClick: addAccount }));
        }
        state.accounts.forEach(function (item) {
            accountsSection.appendChild(navItem({
                label: item.email, dot: item.color || "#3b82f6", title: (item.displayName ? item.displayName + " — " : "") + item.email,
                count: unreadOf(item.id, "inbox"), active: state.accountFilter === item.id,
                warn: item.authError ? "Sign-in problem: " + item.authError : "",
                onClick: function () { setAccountFilter(state.accountFilter === item.id ? "" : item.id); closeDrawer(); },
                more: function (anchor) { accountMenu(anchor, item); }
            }));
        });
        nav.appendChild(accountsSection);

        //Labels
        var labelsSection = el("div", { class: "nav-section" });
        labelsSection.appendChild(el("div", { class: "nav-heading" }, [
            el("span", { text: "Labels" }),
            el("button", { class: "iconbtn small", title: "New label", on: { click: createLabel } }, icon("plus"))
        ]));
        var visibleLabels = state.labelsExpanded ? state.labels : state.labels.slice(0, 5);
        visibleLabels.forEach(function (label) {
            labelsSection.appendChild(navItem({
                label: label.name, dot: label.color, active: state.view.kind === "label" && state.view.id === label.id,
                onClick: function () { openView({ kind: "label", id: label.id }); closeDrawer(); },
                drop: function (messages) { toggleLabel(messages, label.id, true); },
                more: function (anchor) { labelMenu(anchor, label); }
            }));
        });
        if (state.labels.length > 5) {
            labelsSection.appendChild(navItem({
                label: state.labelsExpanded ? "Less" : "More", icon: state.labelsExpanded ? "angle up" : "angle down",
                onClick: function () { state.labelsExpanded = !state.labelsExpanded; renderSidebar(); }
            }));
        }
        nav.appendChild(labelsSection);
        updateTitle();
    }

    //renderFolderTree lists the user folders of the scoped accounts
    function renderFolderTree(container) {
        scopedAccounts().forEach(function (item) {
            var folders = foldersOf(item.id).filter(function (folder) { return folder.role === "" && folder.name.toUpperCase() !== "INBOX"; });
            if (folders.length === 0 && state.accountFilter !== item.id) {
                return;
            }
            container.appendChild(el("div", { class: "nav-heading", style: { marginTop: "10px" } }, [
                el("span", { class: "truncate", text: state.accounts.length > 1 ? "Folders · " + item.email : "Folders" }),
                el("button", { class: "iconbtn small", title: "New folder", on: { click: function () { createFolder(item.id, ""); } } }, icon("plus"))
            ]));
            //Hide containers like "[Gmail]" whose children are all special
            folders.forEach(function (folder) {
                if (!folder.selectable && !folders.some(function (other) { return other.parent === folder.name; })) {
                    return;
                }
                var view = { kind: "folder", accountId: item.id, folder: folder.name };
                container.appendChild(navItem({
                    label: folder.display, icon: folder.selectable ? "folder outline" : "folder open outline", className: "folder",
                    depth: Math.min(folder.depth, 4), count: folder.unread > 0 ? folder.unread : 0,
                    title: folder.name, active: isActiveView(view),
                    onClick: function () { if (folder.selectable) { openView(view); closeDrawer(); } },
                    drop: folder.selectable ? function (messages) { moveMessages(messages, item.id, folder.name); } : null,
                    more: function (anchor) { folderMenu(anchor, item.id, folder); }
                }));
            });
        });
    }

    function setAccountFilter(accountId) {
        state.accountFilter = accountId;
        util.store.set("accountFilter", accountId);
        var role = viewRole() || "inbox";
        if (state.view.kind === "label" || state.view.kind === "snoozed" || state.view.kind === "outbox") {
            renderSidebar();
            renderListHeader();
            renderList();
            return;
        }
        openView(roleView(ROLE_META[role] ? role : "inbox"));
    }

    function accountMenu(anchor, item) {
        ui.menu(anchor, [
            { title: item.email },
            { label: "Account settings", icon: "cog", onClick: function () { editAccount(item); } },
            item.authError ? { label: "Sign in again", icon: "key", onClick: function () { Mail.accounts.reconnect(item, accountSaved); } } : null,
            { label: "Refresh folders", icon: "sync", onClick: function () { loadFolders(item.id, true).then(renderSidebar); } },
            { label: "New folder", icon: "folder outline", onClick: function () { createFolder(item.id, ""); } },
            { label: "Mark inbox as read", icon: "check", onClick: function () { markFolderRead(item.id, "INBOX"); } },
            "-",
            { label: "Write from this account", icon: "edit outline", onClick: function () { compose.newMessage(item.id); } }
        ]);
    }

    function roleMenu(anchor, role) {
        var items = [];
        scopedAccounts().forEach(function (item) {
            var folder = folderByRole(item.id, role);
            if (folder) {
                items.push({
                    label: "Empty " + ROLE_META[role].label + (scopedAccounts().length > 1 ? " · " + item.email : ""), icon: "trash alternate outline", danger: true,
                    onClick: function () { emptyFolder(item.id, folder); }
                });
            }
        });
        if (items.length > 0) {
            ui.menu(anchor, items);
        }
    }

    function folderMenu(anchor, accountId, folder) {
        var items = [{ title: folder.name }];
        if (folder.selectable) {
            items.push({ label: "Mark all as read", icon: "check", onClick: function () { markFolderRead(accountId, folder.name); } });
        }
        items.push({ label: "New subfolder", icon: "folder outline", onClick: function () { createFolder(accountId, folder.name); } });
        if (folder.role === "") {
            items.push({ label: "Rename", icon: "pencil alternate", onClick: function () { renameFolder(accountId, folder); } });
            items.push("-");
            items.push({ label: "Delete folder", icon: "trash alternate outline", danger: true, onClick: function () { deleteFolder(accountId, folder); } });
        }
        ui.menu(anchor, items);
    }

    function labelMenu(anchor, label) {
        ui.menu(anchor, [
            { label: "Rename", icon: "pencil alternate", onClick: function () {
                ui.prompt("Rename label", "Name", label.name).then(function (name) {
                    if (!name) {
                        return;
                    }
                    saveLabels(state.labels.map(function (item) { return item.id === label.id ? { id: item.id, name: name, color: item.color } : item; }));
                });
            } },
            { title: "Colour" }
        ].concat(Mail.settings.LABEL_COLORS.map(function (color) {
            return {
                label: color, dot: color, checked: color === label.color, onClick: function () {
                    saveLabels(state.labels.map(function (item) { return item.id === label.id ? { id: item.id, name: item.name, color: color } : item; }));
                }
            };
        })).concat(["-", {
            label: "Delete label", icon: "trash alternate outline", danger: true, onClick: function () {
                ui.confirm("Delete \"" + label.name + "\"?", "The label is removed from all messages. The messages themselves are kept.", { okLabel: "Delete", danger: true }).then(function (ok) {
                    if (ok) {
                        if (state.view.kind === "label" && state.view.id === label.id) {
                            openView(roleView("inbox"));
                        }
                        saveLabels(state.labels.filter(function (item) { return item.id !== label.id; }));
                    }
                });
            }
        }]));
    }

    function createLabel() {
        ui.prompt("New label", "Name", "", { placeholder: "e.g. Clients", okLabel: "Create" }).then(function (name) {
            if (!name) {
                return;
            }
            var colors = Mail.settings.LABEL_COLORS;
            saveLabels(state.labels.concat([{ id: "", name: name, color: colors[state.labels.length % colors.length] }]));
        });
    }

    function saveLabels(labels) {
        return api.settings("saveLabels", { labels: labels }).then(function (saved) {
            state.labels = saved;
            renderSidebar();
            renderList();
        }).catch(function (error) { ui.errorToast(error); });
    }

    /* ---------- Folder operations ---------- */

    function loadFolders(accountId, refresh) {
        return api.mailbox("folders", { accountId: accountId, refresh: refresh === true }).then(function (folders) {
            state.folders[accountId] = folders || [];
            var item = account(accountId);
            if (item && item.authError) {
                item.authError = "";
            }
            return folders;
        }).catch(function (error) {
            var item = account(accountId);
            if (item && error.authFailed) {
                item.authError = error.message;
            }
            throw error;
        });
    }

    var refreshCountsSoon = util.debounce(function () {
        var ids = scopedAccounts().map(function (item) { return item.id; });
        Promise.all(ids.map(function (id) { return loadFolders(id, true).catch(function () { }); })).then(function () {
            renderSidebar();
        });
        refreshLocalCounts();
    }, 1200);

    function refreshLocalCounts() {
        api.mailbox("snoozed", {}).then(function (list) {
            state.snoozedCount = (list || []).length;
            renderSidebar();
        }).catch(function () { });
        api.mailbox("outbox", {}).then(function (list) {
            state.outboxCount = (list || []).length;
            renderSidebar();
        }).catch(function () { });
    }

    function createFolder(accountId, parent) {
        ui.prompt(parent ? "New folder in " + parent : "New folder", "Folder name", "", { okLabel: "Create" }).then(function (name) {
            if (!name) {
                return;
            }
            api.mailbox("createFolder", { accountId: accountId, parent: parent, name: name }).then(function () {
                ui.toast("Folder created");
                state.moreOpen = true;
                return loadFolders(accountId, true);
            }).then(renderSidebar).catch(function (error) { ui.errorToast(error, "Could not create the folder"); });
        });
    }

    function renameFolder(accountId, folder) {
        ui.prompt("Rename folder", "Folder name", folder.display, { okLabel: "Rename" }).then(function (name) {
            if (!name || name === folder.display) {
                return;
            }
            api.mailbox("renameFolder", { accountId: accountId, folder: folder.name, name: name }).then(function (newName) {
                if (state.view.kind === "folder" && state.view.folder === folder.name) {
                    state.view.folder = newName;
                }
                return loadFolders(accountId, true);
            }).then(renderSidebar).catch(function (error) { ui.errorToast(error, "Could not rename the folder"); });
        });
    }

    function deleteFolder(accountId, folder) {
        ui.confirm("Delete \"" + folder.display + "\"?", "The folder and every message in it are deleted from the server. This cannot be undone.", { okLabel: "Delete folder", danger: true }).then(function (ok) {
            if (!ok) {
                return;
            }
            api.mailbox("deleteFolder", { accountId: accountId, folder: folder.name }).then(function () {
                ui.toast("Folder deleted");
                if (state.view.kind === "folder" && state.view.folder === folder.name) {
                    openView(roleView("inbox"));
                }
                return loadFolders(accountId, true);
            }).then(renderSidebar).catch(function (error) { ui.errorToast(error, "Could not delete the folder"); });
        });
    }

    function emptyFolder(accountId, folder) {
        ui.confirm("Empty " + folder.display + "?", "All messages in this folder are permanently deleted.", { okLabel: "Empty folder", danger: true }).then(function (ok) {
            if (!ok) {
                return;
            }
            api.mailbox("emptyFolder", { accountId: accountId, folder: folder.name }).then(function (result) {
                ui.toast(util.plural(result.count, "message") + " deleted");
                reloadList();
                refreshCountsSoon();
            }).catch(function (error) { ui.errorToast(error); });
        });
    }

    function markFolderRead(accountId, folder) {
        api.mailbox("markAllRead", { accountId: accountId, folder: folder }).then(function (result) {
            ui.toast(result.count > 0 ? util.plural(result.count, "message") + " marked as read" : "Nothing to mark");
            state.list.messages.forEach(function (message) {
                if (message.accountId === accountId && message.folder === folder) {
                    message.seen = true;
                }
            });
            renderList();
            refreshCountsSoon();
        }).catch(function (error) { ui.errorToast(error); });
    }

    /* ---------- Views and the message list ---------- */

    function viewTitle() {
        var view = state.view;
        var scope = state.accountFilter && account(state.accountFilter) ? account(state.accountFilter).email : "";
        switch (view.kind) {
            case "unified": {
                var role = view.key.indexOf("role:") === 0 ? view.key.slice(5) : view.key;
                var label = ROLE_META[role] ? ROLE_META[role].label : role;
                if (!scope && role === "inbox") {
                    return "All Inboxes";
                }
                return scope ? label : "All " + label;
            }
            case "folder": {
                var folderRole = roleOfFolder(view.accountId, view.folder);
                if (folderRole && ROLE_META[folderRole]) {
                    return ROLE_META[folderRole].label;
                }
                var folder = foldersOf(view.accountId).filter(function (item) { return item.name === view.folder; })[0];
                return folder ? folder.display : view.folder;
            }
            case "label": {
                var labelItem = state.labels.filter(function (item) { return item.id === view.id; })[0];
                return labelItem ? labelItem.name : "Label";
            }
            case "snoozed": return "Snoozed";
            case "outbox": return "Scheduled";
        }
        return "";
    }

    function openView(view) {
        state.view = view;
        util.store.set("view", view);
        state.checked = {};
        state.lastCheckedIndex = -1;
        state.currentKey = null;
        state.message = null;
        renderSidebar();
        renderListHeader();
        showReaderEmpty();
        reloadList();
    }

    function reloadList() {
        state.list = { messages: [], total: 0, page: 0, loading: false, done: false, token: state.list.token + 1, errors: [] };
        renderList();
        loadPage(0);
    }

    function listQuery(page) {
        return {
            page: page, pageSize: state.settings.pageSize || 50, sort: state.sort, filter: state.filter,
            search: state.search, searchIn: state.searchIn, previews: state.settings.showPreview !== false
        };
    }

    function loadPage(page) {
        if (state.accounts.length === 0) {
            renderList();
            return;
        }
        var token = state.list.token;
        state.list.loading = true;
        renderListFooter();
        var view = state.view;
        var request;
        switch (view.kind) {
            case "unified":
                request = api.mailbox("unified", { view: view.key, query: listQuery(page), accounts: state.accountFilter ? [state.accountFilter] : [] });
                break;
            case "folder":
                var query = listQuery(page);
                query.folder = view.folder;
                request = api.mailbox("list", { accountId: view.accountId, query: query });
                break;
            case "label":
                request = api.mailbox("labelMessages", { labelId: view.id }).then(localList);
                break;
            case "snoozed":
                request = api.mailbox("snoozed", {}).then(function (list) {
                    state.snoozedCount = (list || []).length;
                    renderSidebar();
                    return localList(list);
                });
                break;
            case "outbox":
                request = api.mailbox("outbox", {}).then(function (items) {
                    state.outboxCount = (items || []).length;
                    renderSidebar();
                    return { total: items.length, messages: items.map(outboxRow), page: 0 };
                });
                break;
        }
        request.then(function (result) {
            if (token !== state.list.token) {
                return;
            }
            state.list.loading = false;
            var messages = result.messages || [];
            state.list.messages = page === 0 ? messages : state.list.messages.concat(messages);
            state.list.total = result.total || 0;
            state.list.page = page;
            state.list.done = view.kind === "label" || view.kind === "snoozed" || view.kind === "outbox" ||
                messages.length < (state.settings.pageSize || 50) || state.list.messages.length >= state.list.total;
            state.list.errors = result.errors || [];
            state.list.sortUnsupported = result.sortUnsupported === true;
            renderList();
            if (page === 0 && !isMobile() && !state.currentKey) {
                showReaderEmpty();
            }
        }).catch(function (error) {
            if (token !== state.list.token) {
                return;
            }
            state.list.loading = false;
            state.list.done = true;
            state.list.error = error;
            if (error.authFailed && view.kind === "folder") {
                var item = account(view.accountId);
                if (item) {
                    item.authError = error.message;
                    renderSidebar();
                }
            }
            renderList();
        });
    }

    //localList filters a label / snooze list to the account filter
    function localList(list) {
        list = (list || []).filter(function (message) {
            return !state.accountFilter || message.accountId === state.accountFilter;
        });
        if (state.search) {
            var query = state.search.toLowerCase();
            list = list.filter(function (message) {
                return (message.subject + " " + (message.from || []).map(util.addressFull).join(" ") + " " + message.preview).toLowerCase().indexOf(query) >= 0;
            });
        }
        return { total: list.length, messages: list, page: 0 };
    }

    function outboxRow(item) {
        return {
            accountId: item.accountId, folder: "", uid: 0, outbox: item, subject: item.subject,
            from: [], to: (item.to || []).map(function (value) { return util.parseAddress(value) || { name: "", email: value }; }),
            date: item.sendAt, received: item.sendAt, seen: true, preview: item.status === "failed" ? "Not sent: " + (item.error || "") : "Scheduled for " + util.formatFullDate(item.sendAt),
            labels: [], key: "outbox|" + item.id
        };
    }

    function renderListHeader() {
        util.clear(dom.listHeader);
        var scopeButton = el("button", { class: "dropdown-trigger", title: "Choose accounts" }, [
            el("span", { class: "truncate", text: viewTitle() }), icon("chevron down")
        ]);
        scopeButton.addEventListener("click", function () {
            var items = [{ label: "All accounts", icon: "inbox", checked: state.accountFilter === "", onClick: function () { setAccountFilter(""); } }];
            state.accounts.forEach(function (item) {
                items.push({ label: item.email, dot: item.color, checked: state.accountFilter === item.id, onClick: function () { setAccountFilter(item.id); } });
            });
            ui.menu(scopeButton, items);
        });
        var sortLabels = { date: "Date", date_asc: "Oldest first", from: "Sender", subject: "Subject", size: "Size" };
        var sortButton = el("button", { class: "dropdown-trigger subtle", title: "Sort and filter" }, [
            el("span", { text: "Sort by: " + sortLabels[state.sort] }), icon("chevron down")
        ]);
        sortButton.addEventListener("click", function () {
            var pick = function (key, value) {
                return function () {
                    state[key] = value;
                    util.store.set(key, value);
                    renderListHeader();
                    reloadList();
                };
            };
            var local = state.view.kind === "label" || state.view.kind === "snoozed" || state.view.kind === "outbox";
            ui.menu(sortButton, [
                { title: "Sort by" },
                { label: "Date (newest first)", checked: state.sort === "date", onClick: pick("sort", "date"), disabled: local },
                { label: "Date (oldest first)", checked: state.sort === "date_asc", onClick: pick("sort", "date_asc"), disabled: local },
                { label: "Sender", checked: state.sort === "from", onClick: pick("sort", "from"), disabled: local || state.view.kind !== "folder" },
                { label: "Subject", checked: state.sort === "subject", onClick: pick("sort", "subject"), disabled: local || state.view.kind !== "folder" },
                { label: "Size", checked: state.sort === "size", onClick: pick("sort", "size"), disabled: local || state.view.kind !== "folder" },
                { title: "Show" },
                { label: "All messages", checked: state.filter === "all", onClick: pick("filter", "all") },
                { label: "Unread", checked: state.filter === "unread", onClick: pick("filter", "unread"), disabled: local },
                { label: "Starred", checked: state.filter === "flagged", onClick: pick("filter", "flagged"), disabled: local },
                { label: "With attachments", checked: state.filter === "attachments", onClick: pick("filter", "attachments"), disabled: local },
                { label: "Not replied", checked: state.filter === "unanswered", onClick: pick("filter", "unanswered"), disabled: local }
            ], { alignRight: true });
        });
        var refreshButton = el("button", { class: "iconbtn small", title: "Refresh" }, icon("sync"));
        refreshButton.addEventListener("click", function () { reloadList(); refreshCountsSoon(); poll(); });
        dom.listHeader.appendChild(scopeButton);
        dom.listHeader.appendChild(el("div", { class: "spacer" }));
        dom.listHeader.appendChild(sortButton);
        dom.listHeader.appendChild(refreshButton);

        //Active filter / search chips
        util.clear(dom.filterChips);
        var chips = [];
        if (state.filter !== "all") {
            var filterNames = { unread: "Unread", flagged: "Starred", attachments: "With attachments", unanswered: "Not replied" };
            chips.push(el("span", { class: "chip active", on: { click: function () { state.filter = "all"; util.store.set("filter", "all"); renderListHeader(); reloadList(); } } }, [filterNames[state.filter], icon("close")]));
        }
        if (state.search) {
            chips.push(el("span", { class: "chip active", on: { click: clearSearch } }, ["Search: " + state.search, icon("close")]));
        }
        chips.forEach(function (chip) { dom.filterChips.appendChild(chip); });
        dom.filterChips.classList.toggle("hidden", chips.length === 0);
    }

    function isSentLike() {
        var role = viewRole();
        return role === "sent" || role === "drafts" || state.view.kind === "outbox";
    }

    function rowFor(message, index) {
        var key = message.key || util.messageKey(message);
        var sentLike = isSentLike();
        var people = sentLike ? (message.to || []) : (message.from || []);
        var person = people[0] || { name: "", email: "" };
        var row = el("div", {
            class: "msg-row" + (!message.seen ? " unread" : "") + (state.checked[key] ? " checked" : "") + (state.currentKey === key ? " current" : ""),
            draggable: message.outbox ? "false" : "true", dataset: { key: key }, role: "option"
        });
        if (!message.seen) {
            row.appendChild(el("span", { class: "unread-dot", title: "Unread" }));
        }
        var checkbox = el("input", { type: "checkbox", class: "check-box", title: "Select" });
        checkbox.checked = !!state.checked[key];
        checkbox.addEventListener("click", function (event) {
            event.stopPropagation();
            toggleCheck(key, index, event.shiftKey);
        });
        row.appendChild(checkbox);
        row.appendChild(util.avatar(person));

        var main = el("div", { class: "msg-main" });
        var fromText = sentLike ? "To: " + (people.map(util.addressName).join(", ") || "(no recipients)") : (util.addressName(person) || "(unknown sender)");
        var line1 = el("div", { class: "msg-line" });
        if (!state.accountFilter && state.accounts.length > 1) {
            var owner = account(message.accountId);
            if (owner) {
                line1.appendChild(el("span", { class: "account-mark", style: { background: owner.color }, title: owner.email }));
            }
        }
        if (message.draft && viewRole() === "drafts") {
            line1.appendChild(el("span", { class: "draft-tag", text: "Draft" }));
        }
        line1.appendChild(el("span", { class: "msg-from", text: fromText }));
        line1.appendChild(el("span", { class: "msg-date", text: message.outbox ? util.formatListDate(message.date) : util.formatListDate(message.received || message.date), title: util.formatFullDate(message.date) }));
        main.appendChild(line1);

        var line2 = el("div", { class: "msg-line" });
        line2.appendChild(el("span", { class: "msg-subject", text: message.subject || "(no subject)" }));
        var icons = el("span", { class: "msg-icons" });
        if (message.priority === 1) {
            icons.appendChild(el("i", { class: "exclamation icon high", title: "High priority" }));
        }
        if (message.answered) {
            icons.appendChild(el("i", { class: "reply icon", title: "Replied" }));
        }
        if (message.forwarded) {
            icons.appendChild(el("i", { class: "share icon", title: "Forwarded" }));
        }
        if (message.hasAttachments) {
            icons.appendChild(el("i", { class: "paperclip icon", title: "Has attachments" }));
        }
        if (message.snoozedUntil) {
            icons.appendChild(el("i", { class: "clock outline icon", title: "Snoozed until " + util.formatFullDate(message.snoozedUntil) }));
        }
        if (message.outbox) {
            icons.appendChild(el("i", { class: (message.outbox.status === "failed" ? "exclamation triangle" : "hourglass half") + " icon", title: message.outbox.status }));
        } else {
            var star = el("i", {
                class: (message.flagged ? "star icon flagged" : "star outline icon") + " star-toggle" + (message.flagged ? " on" : ""),
                title: message.flagged ? "Unstar" : "Star"
            });
            star.addEventListener("click", function (event) {
                event.stopPropagation();
                setFlag([message], "flagged", !message.flagged);
            });
            icons.appendChild(star);
        }
        line2.appendChild(icons);
        main.appendChild(line2);

        if (message.preview) {
            main.appendChild(el("div", { class: "msg-preview", text: message.preview }));
        }
        if (message.labels && message.labels.length > 0) {
            var pills = el("div", { class: "msg-labels" });
            message.labels.forEach(function (id) {
                var label = state.labels.filter(function (item) { return item.id === id; })[0];
                if (label) {
                    pills.appendChild(el("span", { class: "label-pill", style: { "--pill": label.color }, text: label.name }));
                }
            });
            main.appendChild(pills);
        }
        row.appendChild(main);

        row.addEventListener("click", function (event) {
            if (event.ctrlKey || event.metaKey) {
                toggleCheck(key, index, false);
            } else if (event.shiftKey) {
                toggleCheck(key, index, true);
            } else {
                openMessage(message);
            }
        });
        row.addEventListener("contextmenu", function (event) {
            event.preventDefault();
            if (!state.checked[key]) {
                state.checked = {};
                renderList();
            }
            messageMenu({ x: event.clientX, y: event.clientY }, state.checked[key] ? checkedMessages() : [message]);
        });
        row.addEventListener("dragstart", function (event) {
            var keys = state.checked[key] ? Object.keys(state.checked) : [key];
            event.dataTransfer.setData("application/x-aroz-mail", JSON.stringify(keys));
            event.dataTransfer.effectAllowed = "move";
        });
        return row;
    }

    function draggedMessages() {
        //The keys travel through dataTransfer; read them back from the list
        return state.dragKeys ? state.dragKeys.map(messageByKey).filter(Boolean) : [];
    }

    function renderList() {
        var list = dom.list;
        var scroll = list.scrollTop;
        util.clear(list);
        var now = Date.now();
        var hideSnoozed = state.view.kind !== "snoozed";
        var messages = state.list.messages.filter(function (message) {
            return !(hideSnoozed && message.snoozedUntil && message.snoozedUntil > now);
        });

        //Account problems in unified views
        (state.list.errors || []).forEach(function (problem) {
            var notice = el("div", { class: "notice " + (problem.authFailed ? "danger" : "warning"), style: { margin: "10px 12px", fontSize: "12.5px" } }, [
                icon(problem.authFailed ? "key" : "exclamation triangle"),
                el("div", { class: "grow" }, [
                    el("div", { text: problem.email + ": " + problem.error }),
                    problem.authFailed ? el("div", { class: "actions" }, el("button", {
                        class: "btn small", text: "Sign in again", on: { click: function () { var item = account(problem.accountId); if (item) { Mail.accounts.reconnect(item, accountSaved); } } }
                    })) : null
                ])
            ]);
            list.appendChild(notice);
        });

        if (state.accounts.length === 0) {
            list.appendChild(el("div", { class: "list-status" }, [
                icon("envelope outline"),
                el("div", { class: "title", text: "No mail accounts yet" }),
                el("div", { text: "Add your Gmail, Outlook, Yahoo, iCloud or other mailbox to get started." }),
                el("button", { class: "btn primary", on: { click: addAccount } }, [icon("plus"), "Add account"])
            ]));
            return;
        }

        if (state.list.error && messages.length === 0) {
            var error = state.list.error;
            list.appendChild(el("div", { class: "list-status" }, [
                icon(error.authFailed ? "key" : "exclamation triangle"),
                el("div", { class: "title", text: error.authFailed ? "Sign-in failed" : "Could not load messages" }),
                el("div", { text: error.message + (error.hint ? " " + error.hint : "") }),
                el("div", { style: { display: "flex", gap: "8px" } }, [
                    el("button", { class: "btn", text: "Try again", on: { click: function () { state.list.error = null; reloadList(); } } }),
                    error.authFailed && state.view.kind === "folder" ? el("button", {
                        class: "btn primary", text: "Sign in again", on: { click: function () { var item = account(state.view.accountId); if (item) { Mail.accounts.reconnect(item, accountSaved, error); } } }
                    }) : null
                ])
            ]));
            return;
        }
        state.list.error = null;

        if (messages.length === 0) {
            if (state.list.loading) {
                for (var i = 0; i < 7; i++) {
                    list.appendChild(el("div", { class: "skeleton-row" }, [
                        el("div", { class: "skeleton", style: { width: "40px", height: "40px", borderRadius: "50%", flex: "none" } }),
                        el("div", { style: { flex: "1", display: "flex", flexDirection: "column", gap: "8px" } }, [
                            el("div", { class: "skeleton", style: { height: "12px", width: (50 + (i * 13) % 35) + "%" } }),
                            el("div", { class: "skeleton", style: { height: "12px", width: (70 + (i * 7) % 25) + "%" } }),
                            el("div", { class: "skeleton", style: { height: "10px", width: (40 + (i * 11) % 45) + "%" } })
                        ])
                    ]));
                }
                return;
            }
            var emptyText = state.search ? "No messages match your search." : (state.view.kind === "snoozed" ? "Snoozed messages show up here until it's time." : (state.view.kind === "label" ? "Messages you label appear here." : "Nothing in this folder."));
            list.appendChild(el("div", { class: "list-status" }, [
                icon(state.search ? "search" : "inbox"),
                el("div", { class: "title", text: state.search ? "No results" : "All clear" }),
                el("div", { text: emptyText })
            ]));
            return;
        }

        if (state.list.sortUnsupported) {
            list.appendChild(el("div", { class: "notice warning", style: { margin: "10px 12px", fontSize: "12.5px" } }, [icon("info circle"), el("div", { text: "This mailbox is too large to sort that way; showing newest first." })]));
        }

        var fragment = document.createDocumentFragment();
        messages.forEach(function (message, index) {
            fragment.appendChild(rowFor(message, index));
        });
        list.appendChild(fragment);
        list.classList.toggle("selecting", Object.keys(state.checked).length > 0);
        renderListFooter();
        list.scrollTop = scroll;
        renderBulkbar();
    }

    function renderListFooter() {
        var footer = dom.list.querySelector(".list-footer");
        if (footer) {
            footer.remove();
        }
        if (state.list.messages.length === 0) {
            return;
        }
        var text = "";
        if (state.list.loading) {
            footer = el("div", { class: "list-footer" }, el("div", { class: "spinner", style: { margin: "0 auto" } }));
        } else {
            text = state.list.done ? util.plural(state.list.total, "message") : "";
            footer = el("div", { class: "list-footer", text: text });
        }
        dom.list.appendChild(footer);
    }

    function maybeLoadMore() {
        var list = dom.list;
        if (state.list.loading || state.list.done) {
            return;
        }
        if (list.scrollTop + list.clientHeight > list.scrollHeight - 300) {
            loadPage(state.list.page + 1);
        }
    }

    /* ---------- Selection ---------- */

    function toggleCheck(key, index, range) {
        var visible = state.list.messages;
        if (range && state.lastCheckedIndex >= 0) {
            var start = Math.min(state.lastCheckedIndex, index);
            var end = Math.max(state.lastCheckedIndex, index);
            for (var i = start; i <= end; i++) {
                if (visible[i]) {
                    state.checked[visible[i].key || util.messageKey(visible[i])] = true;
                }
            }
        } else if (state.checked[key]) {
            delete state.checked[key];
        } else {
            state.checked[key] = true;
        }
        state.lastCheckedIndex = index;
        renderList();
        var count = Object.keys(state.checked).length;
        if (count > 1) {
            showMultiSelect(count);
        } else if (count === 0 && !state.message) {
            showReaderEmpty();
        }
    }

    function clearChecks() {
        state.checked = {};
        renderList();
    }

    function selectAll() {
        state.list.messages.forEach(function (message) {
            state.checked[message.key || util.messageKey(message)] = true;
        });
        renderList();
        showMultiSelect(Object.keys(state.checked).length);
    }

    function renderBulkbar() {
        var count = Object.keys(state.checked).length;
        dom.bulkbar.classList.toggle("show", count > 0);
        if (count === 0) {
            return;
        }
        util.clear(dom.bulkbar);
        dom.bulkbar.appendChild(el("span", { class: "count", text: count + " selected" }));
        var button = function (iconName, title, fn) {
            dom.bulkbar.appendChild(el("button", { class: "iconbtn small", title: title, on: { click: fn } }, icon(iconName)));
        };
        button("check square outline", "Select all", selectAll);
        button("envelope open outline", "Mark as read", function () { setFlag(checkedMessages(), "seen", true); });
        button("envelope outline", "Mark as unread", function () { setFlag(checkedMessages(), "seen", false); });
        button("star outline", "Star", function () { setFlag(checkedMessages(), "flagged", true); });
        button("archive", "Archive", function () { moveToRole(checkedMessages(), "archive"); });
        button("trash alternate outline", "Delete", function () { deleteMessages(checkedMessages(), false); });
        dom.bulkbar.appendChild(el("button", { class: "iconbtn small", title: "More", on: { click: function (event) { messageMenu(event.currentTarget, checkedMessages()); } } }, icon("ellipsis horizontal")));
        button("close", "Clear selection", clearChecks);
    }

    /* ---------- Reading pane ---------- */

    function destroyFrame() {
        if (state.frame && state.frame.destroy) {
            state.frame.destroy();
        }
        state.frame = null;
        clearTimeout(state.markTimer);
    }

    function showReaderEmpty() {
        destroyFrame();
        util.clear(dom.reader);
        dom.app.classList.remove("reading");
        var art = el("img", { class: "art", src: "img/empty.svg", alt: "" });
        dom.reader.appendChild(el("div", { class: "reader-empty" }, [
            art,
            el("div", { class: "title", text: state.accounts.length === 0 ? "Welcome to Mail" : "Select a message to read" }),
            el("div", { text: state.accounts.length === 0 ? "Connect a mailbox to start reading and sending mail from ArozOS." : "Nothing is selected." }),
            state.accounts.length === 0 ? el("button", { class: "btn primary large", on: { click: addAccount } }, [icon("plus"), "Add account"]) : null
        ]));
        updateToolbar();
    }

    function showMultiSelect(count) {
        destroyFrame();
        util.clear(dom.reader);
        dom.reader.appendChild(el("div", { class: "multi-select-view" }, [
            el("div", { class: "big", text: String(count) }),
            el("div", { text: "messages selected" }),
            el("div", { class: "acts" }, [
                el("button", { class: "btn", on: { click: function () { setFlag(checkedMessages(), "seen", true); } } }, [icon("envelope open outline"), "Mark read"]),
                el("button", { class: "btn", on: { click: function () { moveToRole(checkedMessages(), "archive"); } } }, [icon("archive"), "Archive"]),
                el("button", { class: "btn", on: { click: function () { deleteMessages(checkedMessages(), false); } } }, [icon("trash alternate outline"), "Delete"]),
                el("button", { class: "btn ghost", text: "Clear selection", on: { click: function () { clearChecks(); showReaderEmpty(); } } })
            ])
        ]));
        updateToolbar();
    }

    function openMessage(summary) {
        if (summary.outbox) {
            showOutboxItem(summary);
            return;
        }
        var key = util.messageKey(summary);
        if (Object.keys(state.checked).length > 0) {
            state.checked = {};
        }
        state.currentKey = key;
        renderList();
        if (viewRole() === "drafts" && summary.draft) {
            //Drafts open straight in the composer
            loadMessage(summary, { allowRemote: true }).then(function (message) {
                if (message) {
                    compose.editDraft(message);
                }
            });
            return;
        }
        dom.app.classList.add("reading");
        destroyFrame();
        util.clear(dom.reader);
        dom.reader.appendChild(el("div", { class: "reader-loading" }, el("div", { class: "spinner large" })));
        var markNow = state.settings.markReadDelay === 0;
        loadMessage(summary, { markSeen: markNow }).then(function (message) {
            if (!message || state.currentKey !== key) {
                return;
            }
            showMessage(message);
            if (!summary.seen) {
                if (markNow) {
                    noteSeen(summary, true);
                } else if (state.settings.markReadDelay > 0) {
                    state.markTimer = setTimeout(function () {
                        if (state.currentKey === key) {
                            setFlag([summary], "seen", true);
                        }
                    }, state.settings.markReadDelay * 1000);
                }
            }
        });
    }

    //loadMessage fetches a message, relocating labelled / snoozed mail that
    //moved to another folder since it was recorded
    function loadMessage(summary, options) {
        var token = ++state.messageToken;
        var request = function (folder, uid) {
            return api.message("get", { accountId: summary.accountId, folder: folder, uid: uid, options: options || {} });
        };
        return request(summary.folder, summary.uid).catch(function (error) {
            if (error.code === "notfound" && summary.messageId && (state.view.kind === "label" || state.view.kind === "snoozed")) {
                return api.message("locate", { accountId: summary.accountId, messageId: summary.messageId, hint: summary.folder }).then(function (located) {
                    summary.folder = located.folder;
                    summary.uid = located.uid;
                    return request(located.folder, located.uid);
                });
            }
            throw error;
        }).then(function (message) {
            return token === state.messageToken ? message : null;
        }).catch(function (error) {
            if (token !== state.messageToken) {
                return null;
            }
            util.clear(dom.reader);
            dom.reader.appendChild(el("div", { class: "reader-empty" }, [
                icon(error.authFailed ? "key" : "exclamation triangle"),
                el("div", { class: "title", text: error.code === "notfound" ? "This message is no longer here" : "Could not open the message" }),
                el("div", { text: error.message }),
                el("button", { class: "btn", text: "Refresh list", on: { click: reloadList } })
            ]));
            return null;
        });
    }

    function noteSeen(summary, seen) {
        if (summary.seen === seen) {
            return;
        }
        summary.seen = seen;
        var status = state.inboxStatus[summary.accountId];
        if (status && roleOfFolder(summary.accountId, summary.folder) === "inbox") {
            status.unread = Math.max(0, status.unread + (seen ? -1 : 1));
        }
        foldersOf(summary.accountId).forEach(function (folder) {
            if (folder.name === summary.folder && folder.unread >= 0) {
                folder.unread = Math.max(0, folder.unread + (seen ? -1 : 1));
            }
        });
        renderList();
        renderSidebar();
    }

    function showMessage(message) {
        state.message = message;
        destroyFrame();
        var reader = util.clear(dom.reader);
        var scroller = el("div", { class: "reader-scroll scroll" });
        reader.appendChild(scroller);

        if (isMobile()) {
            scroller.appendChild(el("button", { class: "btn ghost small mobile-back", style: { marginBottom: "10px" }, on: { click: closeReaderMobile } }, [icon("arrow left"), "Back"]));
        }

        //Subject and labels
        var subject = el("div", { class: "reader-subject" }, [el("h1", { text: message.subject || "(no subject)" })]);
        if (message.labels && message.labels.length > 0) {
            var pills = el("div", { class: "msg-labels" });
            message.labels.forEach(function (id) {
                var label = state.labels.filter(function (item) { return item.id === id; })[0];
                if (label) {
                    pills.appendChild(el("span", { class: "label-pill", style: { "--pill": label.color }, text: label.name }));
                }
            });
            subject.appendChild(pills);
        }
        scroller.appendChild(subject);

        //Header with quick actions
        var star = el("button", { class: "iconbtn small star" + (message.flagged ? " on" : ""), title: message.flagged ? "Unstar" : "Star" }, icon(message.flagged ? "star" : "star outline"));
        star.addEventListener("click", function () { setFlag([message], "flagged", !message.flagged); });
        var replyButton = el("button", { class: "iconbtn small", title: "Reply" }, icon("reply"));
        replyButton.addEventListener("click", function () { compose.reply(message, false); });
        var moreButton = el("button", { class: "iconbtn small", title: "More actions" }, icon("ellipsis horizontal"));
        moreButton.addEventListener("click", function () { messageMenu(moreButton, [message]); });
        var acts = el("div", { class: "acts" }, [star, replyButton, moreButton]);
        if (message.listUnsubscribe) {
            acts.insertBefore(el("button", { class: "btn small ghost", title: "Unsubscribe from this mailing list", on: { click: function () { unsubscribe(message); } } }, "Unsubscribe"), star);
        }
        scroller.appendChild(render.header(message, {
            actions: acts,
            onAddress: function (address) { addressMenu(address); }
        }));

        var notices = render.notices(message, {
            loadRemote: function () { reloadMessage(message, true); },
            trustSender: function (sender) {
                api.settings("trust", { sender: sender }).then(function () {
                    state.settings.trustedSenders = (state.settings.trustedSenders || []).concat([sender.toLowerCase()]);
                    ui.toast("Images from " + sender + " will always load");
                    reloadMessage(message, true);
                }).catch(function (error) { ui.errorToast(error); });
            }
        });
        if (notices) {
            scroller.appendChild(notices);
        }

        var bodyWrap = el("div", { class: "reader-body" });
        scroller.appendChild(bodyWrap);
        state.frame = render.body(bodyWrap, message, {
            onMailto: function (href) { compose.mailto(href, message.accountId); }
        });

        var attachments = render.attachments(message.attachments, {
            open: function (attachment) { openAttachment(message, attachment); },
            save: function (attachment) { saveAttachment(message, attachment); },
            download: function (attachment) { downloadAttachment(message, attachment); },
            saveAll: function (list) { saveAllAttachments(message, list); }
        });
        if (attachments) {
            scroller.appendChild(attachments);
        }

        var actions = el("div", { class: "reader-actions" });
        if (message.draft || viewRole() === "drafts") {
            actions.appendChild(el("button", { class: "btn primary", on: { click: function () { compose.editDraft(message); } } }, [icon("edit outline"), "Edit draft"]));
        }
        actions.appendChild(el("button", { class: "btn", on: { click: function () { compose.reply(message, false); } } }, [icon("reply"), "Reply"]));
        actions.appendChild(el("button", { class: "btn", on: { click: function () { compose.reply(message, true); } } }, [icon("reply all"), "Reply All"]));
        actions.appendChild(el("button", { class: "btn", on: { click: function () { compose.forward(message, false); } } }, [icon("share"), "Forward"]));
        scroller.appendChild(actions);
        updateToolbar();
    }

    function reloadMessage(message, allowRemote) {
        loadMessage(message, { allowRemote: allowRemote }).then(function (loaded) {
            if (loaded) {
                showMessage(loaded);
            }
        });
    }

    function closeReaderMobile() {
        dom.app.classList.remove("reading");
        state.currentKey = null;
        state.message = null;
        renderList();
    }

    function showOutboxItem(row) {
        var item = row.outbox;
        destroyFrame();
        state.currentKey = row.key;
        renderList();
        dom.app.classList.add("reading");
        var reader = util.clear(dom.reader);
        var scroller = el("div", { class: "reader-scroll scroll" });
        if (isMobile()) {
            scroller.appendChild(el("button", { class: "btn ghost small mobile-back", style: { marginBottom: "10px" }, on: { click: closeReaderMobile } }, [icon("arrow left"), "Back"]));
        }
        scroller.appendChild(el("div", { class: "reader-subject" }, el("h1", { text: item.subject || "(no subject)" })));
        scroller.appendChild(el("p", { class: "muted", text: "To: " + (item.to || []).join(", ") }));
        if (item.status === "failed") {
            scroller.appendChild(el("div", { class: "notice danger" }, [icon("exclamation triangle"), el("div", { text: "This message could not be delivered after " + util.plural(item.attempts, "attempt") + ": " + (item.error || "unknown error") })]));
        } else {
            scroller.appendChild(el("div", { class: "notice" }, [icon("hourglass half"), el("div", { text: "Scheduled to be sent " + util.formatFullDate(item.sendAt) + "." + (item.error ? " Last attempt failed: " + item.error : "") })]));
        }
        scroller.appendChild(el("div", { class: "reader-actions" }, [
            el("button", {
                class: "btn primary", on: {
                    click: function () {
                        api.compose("outboxSendNow", { id: item.id }).then(function () {
                            ui.toast("Sending now");
                            setTimeout(reloadList, 6000);
                        }).catch(function (error) { ui.errorToast(error); });
                    }
                }
            }, [icon("paper plane outline"), "Send now"]),
            el("button", {
                class: "btn", on: {
                    click: function () {
                        api.compose("outboxCancel", { id: item.id, toDrafts: true }).then(function () {
                            ui.toast("Moved to Drafts");
                            reloadList();
                            refreshLocalCounts();
                            showReaderEmpty();
                        }).catch(function (error) { ui.errorToast(error); });
                    }
                }
            }, [icon("edit outline"), "Cancel and edit"])
        ]));
        reader.appendChild(scroller);
    }

    function unsubscribe(message) {
        var target = message.listUnsubscribe;
        if (/^mailto:/i.test(target)) {
            compose.mailto(target, message.accountId);
        } else {
            ui.confirm("Unsubscribe?", "This opens the sender's unsubscribe page: " + target, { okLabel: "Open page" }).then(function (ok) {
                if (ok) {
                    window.open(target, "_blank", "noopener,noreferrer");
                }
            });
        }
    }

    function addressMenu(address) {
        var anchor = { x: window.innerWidth / 2, y: 140 };
        if (window.event && window.event.clientX !== undefined) {
            anchor = { x: window.event.clientX, y: window.event.clientY };
        }
        ui.menu(anchor, [
            { title: util.addressFull(address) },
            { label: "Write to " + (address.name || address.email), icon: "edit outline", onClick: function () { compose.open({ accountId: defaultAccountId(), to: [util.formatAddressForInput(address)], focus: "body" }); } },
            { label: "Add to address book", icon: "address book outline", onClick: function () { Mail.settings.contactDialog({ name: address.name, email: address.email }, function () { ui.toast("Contact saved"); }); } },
            {
                label: "Copy address", icon: "copy outline", onClick: function () {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(address.email).then(function () { ui.toast("Copied"); });
                    }
                }
            },
            { label: "Search mail from this sender", icon: "search", onClick: function () { setSearch(address.email, "from"); } }
        ]);
    }

    /* ---------- Attachments ---------- */

    function attachmentRequest(message, attachment, dest) {
        return api.files("saveAttachment", { accountId: message.accountId, folder: message.folder, uid: message.uid, partId: attachment.id, dest: dest });
    }

    function tempDownloads() {
        return api.files("tempFolder", { purpose: "downloads" });
    }

    function openAttachment(message, attachment) {
        var progress = ui.toast("Opening " + attachment.filename + "…", { duration: 0 });
        tempDownloads().then(function (folder) {
            return attachmentRequest(message, attachment, folder);
        }).then(function (saved) {
            progress.close();
            openWithDefaultApp(saved.path);
        }).catch(function (error) {
            progress.close();
            ui.errorToast(error, "Could not open the attachment");
        });
    }

    function pickFolder(callback) {
        if (typeof ao_module_openFileSelector !== "function") {
            ui.toast("The ArozOS folder picker is not available", { error: true });
            return;
        }
        ao_module_openFileSelector(function (files) {
            if (files && files.length > 0) {
                callback(files[0].filepath);
            }
        }, "user:/Desktop", "folder", false, { path_memory_key: "mail-save" });
    }

    function savedToast(path) {
        var dir = path.substring(0, path.lastIndexOf("/"));
        var name = path.substring(path.lastIndexOf("/") + 1);
        ui.toast("Saved to " + path, {
            action: typeof ao_module_openPath === "function" ? { label: "Show", fn: function () { ao_module_openPath(dir, name); } } : null
        });
    }

    function saveAttachment(message, attachment) {
        pickFolder(function (dir) {
            attachmentRequest(message, attachment, dir).then(function (saved) {
                savedToast(saved.path);
            }).catch(function (error) { ui.errorToast(error, "Could not save"); });
        });
    }

    function saveAllAttachments(message, list) {
        pickFolder(function (dir) {
            var progress = ui.toast("Saving " + util.plural(list.length, "attachment") + "…", { duration: 0 });
            api.files("saveAll", {
                accountId: message.accountId, folder: message.folder, uid: message.uid,
                partIds: list.map(function (item) { return item.id; }), dest: dir
            }).then(function (result) {
                progress.close();
                ui.toast(util.plural(result.paths.length, "file") + " saved to " + dir, {
                    action: typeof ao_module_openPath === "function" ? { label: "Show", fn: function () { ao_module_openPath(dir); } } : null
                });
            }).catch(function (error) {
                progress.close();
                ui.errorToast(error, "Could not save");
            });
        });
    }

    function downloadPath(path) {
        var root = (typeof ao_root === "string" && ao_root) ? ao_root : "../";
        var link = el("a", { href: root + "media/?file=" + encodeURIComponent(path) + "&download=true", download: path.split("/").pop() });
        document.body.appendChild(link);
        link.click();
        setTimeout(function () { link.remove(); }, 1000);
    }

    function downloadAttachment(message, attachment) {
        tempDownloads().then(function (folder) {
            return attachmentRequest(message, attachment, folder);
        }).then(function (saved) {
            downloadPath(saved.path);
        }).catch(function (error) { ui.errorToast(error, "Download failed"); });
    }

    //openWithDefaultApp opens a file with the WebApp registered for its type
    function openWithDefaultApp(path) {
        var filename = path.split("/").pop();
        var ext = "." + filename.split(".").pop().toLowerCase();
        var root = (typeof ao_root === "string" && ao_root) ? ao_root : "../";
        $.ajax({
            url: root + "system/modules/getDefault",
            method: "GET",
            data: { opr: "launch", ext: ext, mode: "launch" },
            success: function (data) {
                if (!data || data.error !== undefined) {
                    ao_module_newfw({
                        url: "SystemAO/file_system/defaultOpener.html#" + encodeURIComponent(JSON.stringify({ filepath: path, filename: filename })),
                        width: 380, height: 560, appicon: "SystemAO/file_system/img/opener.png", title: "Open with"
                    });
                    return;
                }
                var url = data.StartDir;
                var size = [undefined, undefined];
                if (data.SupportFW && data.LaunchFWDir) {
                    url = data.LaunchFWDir;
                    size = data.InitFWSize || size;
                }
                if (data.SupportEmb && data.LaunchEmb) {
                    url = data.LaunchEmb;
                    size = data.InitEmbSize || size;
                }
                ao_module_newfw({
                    url: url + "#" + encodeURIComponent(JSON.stringify([{ filepath: path, filename: filename }])),
                    width: size[0], height: size[1], appicon: data.IconPath || "Mail/img/icon.svg", title: data.Name
                });
            },
            error: function () {
                downloadPath(path);
            }
        });
    }

    /* ---------- Message actions ---------- */

    function runGroups(messages, operation, payload) {
        return Promise.all(groupByFolder(messages).map(function (group) {
            var data = { accountId: group.accountId, folder: group.folder, uids: group.uids };
            Object.keys(payload || {}).forEach(function (key) { data[key] = payload[key]; });
            return api.message(operation, data);
        }));
    }

    function setFlag(messages, flag, value) {
        messages = messages.filter(function (message) { return !message.outbox; });
        if (messages.length === 0) {
            return;
        }
        var changed = messages.filter(function (message) {
            return flag === "seen" ? message.seen !== value : (flag === "flagged" ? message.flagged !== value : true);
        });
        changed.forEach(function (message) {
            if (flag === "seen") {
                noteSeen(message, value);
            } else if (flag === "flagged") {
                message.flagged = value;
            }
            var listed = messageByKey(util.messageKey(message));
            if (listed && listed !== message) {
                if (flag === "flagged") {
                    listed.flagged = value;
                } else if (flag === "seen") {
                    listed.seen = value;
                }
            }
        });
        if (state.message && changed.some(function (message) { return util.messageKey(message) === util.messageKey(state.message); })) {
            if (flag === "flagged") {
                state.message.flagged = value;
                var star = dom.reader.querySelector(".reader-head .star");
                if (star) {
                    star.classList.toggle("on", value);
                    star.firstChild.className = (value ? "star" : "star outline") + " icon";
                }
            } else if (flag === "seen") {
                state.message.seen = value;
            }
        }
        renderList();
        runGroups(changed.length > 0 ? changed : messages, "flag", { flag: flag, value: value }).then(function () {
            if (flag === "seen") {
                refreshCountsSoon();
            }
        }).catch(function (error) {
            ui.errorToast(error);
            reloadList();
        });
    }

    //removeFromList drops moved / deleted messages and opens the next one
    function removeFromList(messages) {
        var keys = {};
        messages.forEach(function (message) { keys[util.messageKey(message)] = true; });
        var index = state.list.messages.findIndex(function (message) { return keys[util.messageKey(message)]; });
        state.list.messages = state.list.messages.filter(function (message) { return !keys[util.messageKey(message)]; });
        state.list.total = Math.max(0, state.list.total - messages.length);
        Object.keys(keys).forEach(function (key) { delete state.checked[key]; });
        var wasCurrent = state.currentKey && keys[state.currentKey];
        renderList();
        if (wasCurrent) {
            state.currentKey = null;
            state.message = null;
            var next = state.list.messages[Math.min(index, state.list.messages.length - 1)];
            if (next && !isMobile()) {
                openMessage(next);
            } else {
                showReaderEmpty();
            }
        } else if (Object.keys(state.checked).length === 0 && !state.message) {
            showReaderEmpty();
        }
    }

    function deleteMessages(messages, permanent) {
        messages = messages.filter(function (message) { return !message.outbox; });
        if (messages.length === 0) {
            return;
        }
        var proceed = (state.settings.confirmDelete || permanent) ?
            ui.confirm(permanent ? "Delete permanently?" : "Delete " + util.plural(messages.length, "message") + "?",
                permanent ? "These messages will be deleted and cannot be recovered." : "The messages will be moved to Trash.",
                { okLabel: "Delete", danger: true }) : Promise.resolve(true);
        proceed.then(function (ok) {
            if (!ok) {
                return;
            }
            removeFromList(messages);
            runGroups(messages, "remove", { permanent: permanent }).then(function (results) {
                var permanentNow = results.some(function (result) { return result && result.permanent; });
                ui.toast(util.plural(messages.length, "message") + (permanentNow ? " deleted" : " moved to Trash"));
                refreshCountsSoon();
            }).catch(function (error) {
                ui.errorToast(error, "Could not delete");
                reloadList();
            });
        });
    }

    function moveToRole(messages, role) {
        messages = messages.filter(function (message) { return !message.outbox; });
        if (messages.length === 0) {
            return;
        }
        removeFromList(messages);
        runGroups(messages, "moveToRole", { role: role }).then(function () {
            var names = { archive: "Archived", junk: "Moved to Junk", inbox: "Moved to Inbox", trash: "Moved to Trash" };
            ui.toast(util.plural(messages.length, "message") + " · " + (names[role] || "Moved"));
            refreshCountsSoon();
        }).catch(function (error) {
            ui.errorToast(error);
            reloadList();
        });
    }

    function moveMessages(messages, accountId, destination) {
        messages = messages.filter(function (message) { return !message.outbox; });
        var foreign = messages.filter(function (message) { return message.accountId !== accountId; });
        if (foreign.length > 0) {
            ui.toast("Messages can only be moved between folders of the same account", { error: true });
            return;
        }
        var same = messages.filter(function (message) { return message.folder === destination; });
        messages = messages.filter(function (message) { return message.folder !== destination; });
        if (messages.length === 0) {
            if (same.length > 0) {
                ui.toast("Already in that folder");
            }
            return;
        }
        removeFromList(messages);
        runGroups(messages, "move", { destination: destination }).then(function () {
            ui.toast(util.plural(messages.length, "message") + " moved");
            refreshCountsSoon();
        }).catch(function (error) {
            ui.errorToast(error);
            reloadList();
        });
    }

    function chooseFolder(messages) {
        var accountIds = {};
        messages.forEach(function (message) { accountIds[message.accountId] = true; });
        var ids = Object.keys(accountIds);
        if (ids.length !== 1) {
            ui.toast("Select messages from one account to move them to a folder", { error: true });
            return;
        }
        var accountId = ids[0];
        var body = el("div");
        var search = el("input", { class: "input", type: "search", placeholder: "Find a folder", autofocus: true });
        var list = el("div", { style: { marginTop: "10px", maxHeight: "50vh", overflowY: "auto" } });
        body.appendChild(search);
        body.appendChild(list);
        var dialog = ui.modal({ title: "Move " + util.plural(messages.length, "message"), body: body, buttons: [{ label: "Cancel" }] });
        var renderFolders = function () {
            util.clear(list);
            var query = search.value.trim().toLowerCase();
            foldersOf(accountId).filter(function (folder) {
                return folder.selectable && (!query || folder.name.toLowerCase().indexOf(query) >= 0);
            }).forEach(function (folder) {
                var meta = ROLE_META[folder.role];
                list.appendChild(navItem({
                    label: meta ? meta.label : folder.name, icon: meta ? meta.icon : "folder outline",
                    onClick: function () { dialog.close(); moveMessages(messages, accountId, folder.name); }
                }));
            });
            list.appendChild(navItem({
                label: "New folder…", icon: "plus", onClick: function () {
                    dialog.close();
                    ui.prompt("New folder", "Folder name", "", { okLabel: "Create and move" }).then(function (name) {
                        if (!name) {
                            return;
                        }
                        api.mailbox("createFolder", { accountId: accountId, parent: "", name: name }).then(function (created) {
                            return loadFolders(accountId, true).then(function () {
                                renderSidebar();
                                moveMessages(messages, accountId, created);
                            });
                        }).catch(function (error) { ui.errorToast(error); });
                    });
                }
            }));
        };
        search.addEventListener("input", renderFolders);
        if (foldersOf(accountId).length === 0) {
            loadFolders(accountId, false).then(renderFolders).catch(function (error) { ui.errorToast(error); });
        } else {
            renderFolders();
        }
    }

    function toggleLabel(messages, labelId, value) {
        messages.filter(function (message) { return !message.outbox; }).forEach(function (message) {
            var labels = (message.labels || []).filter(function (id) { return id !== labelId; });
            if (value) {
                labels.push(labelId);
            }
            message.labels = labels;
            var listed = messageByKey(util.messageKey(message));
            if (listed && listed !== message) {
                listed.labels = labels;
            }
            var summary = JSON.parse(JSON.stringify(listed || message));
            ["html", "text", "attachments"].forEach(function (key) { delete summary[key]; });
            api.message("setLabels", { message: summary, labels: labels }).catch(function (error) { ui.errorToast(error); });
        });
        renderList();
        if (state.message && messages.some(function (message) { return util.messageKey(message) === util.messageKey(state.message); })) {
            showMessage(state.message);
        }
        if (state.view.kind === "label" && state.view.id === labelId && !value) {
            removeFromList(messages);
        }
    }

    function snoozeMessages(messages, until) {
        messages = messages.filter(function (message) { return !message.outbox; });
        Promise.all(messages.map(function (message) {
            var summary = JSON.parse(JSON.stringify(messageByKey(util.messageKey(message)) || message));
            ["html", "text", "attachments"].forEach(function (key) { delete summary[key]; });
            return api.message("snooze", { message: summary, until: until });
        })).then(function () {
            removeFromList(messages);
            ui.toast(util.plural(messages.length, "message") + " snoozed until " + util.formatFullDate(until));
            refreshLocalCounts();
        }).catch(function (error) { ui.errorToast(error); });
    }

    function unsnoozeMessages(messages) {
        Promise.all(messages.map(function (message) {
            return api.message("unsnooze", { message: message });
        })).then(function () {
            if (state.view.kind === "snoozed") {
                removeFromList(messages);
            }
            ui.toast("Back in your inbox");
            refreshLocalCounts();
        }).catch(function (error) { ui.errorToast(error); });
    }

    function saveAsEML(message) {
        pickFolder(function (dir) {
            api.files("saveMessage", { accountId: message.accountId, folder: message.folder, uid: message.uid, dest: dir }).then(function (saved) {
                savedToast(saved.path);
            }).catch(function (error) { ui.errorToast(error, "Could not save"); });
        });
    }

    function downloadEML(message) {
        tempDownloads().then(function (folder) {
            return api.files("saveMessage", { accountId: message.accountId, folder: message.folder, uid: message.uid, dest: folder });
        }).then(function (saved) {
            downloadPath(saved.path);
        }).catch(function (error) { ui.errorToast(error, "Download failed"); });
    }

    function viewSource(message) {
        var pre = el("pre", { style: { whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "var(--mono)", fontSize: "12px", margin: "0", maxHeight: "65vh", overflow: "auto" }, text: "Loading…" });
        ui.modal({ title: "Message source", subtitle: message.subject || "", xwide: true, body: pre, buttons: [{ label: "Close", primary: true }] });
        api.message("raw", { accountId: message.accountId, folder: message.folder, uid: message.uid }).then(function (result) {
            pre.textContent = result.source + (result.truncated ? "\n\n[… source truncated, " + util.formatSize(result.size) + " in total]" : "");
        }).catch(function (error) {
            pre.textContent = error.message;
        });
    }

    function printMessage(message) {
        var popup = window.open("", "_blank", "width=860,height=900");
        if (!popup) {
            ui.toast("Allow pop-ups to print", { error: true });
            return;
        }
        var from = (message.from && message.from[0]) || {};
        var header = '<div style="font-family:sans-serif;border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:14px">' +
            "<h2 style=\"margin:0 0 8px\">" + util.escapeHTML(message.subject || "(no subject)") + "</h2>" +
            "<div><b>From:</b> " + util.escapeHTML(util.addressFull(from)) + "</div>" +
            "<div><b>To:</b> " + util.escapeHTML((message.to || []).map(util.addressFull).join(", ")) + "</div>" +
            (message.cc && message.cc.length ? "<div><b>Cc:</b> " + util.escapeHTML(message.cc.map(util.addressFull).join(", ")) + "</div>" : "") +
            "<div><b>Date:</b> " + util.escapeHTML(util.formatFullDate(message.date)) + "</div></div>";
        var content = message.html ? new DOMParser().parseFromString(message.html, "text/html").body.innerHTML :
            '<pre style="white-space:pre-wrap;font-family:sans-serif">' + util.escapeHTML(message.text || "") + "</pre>";
        var csp = "default-src 'none'; img-src data:" + (message.remoteAllowed ? " https: http:" : "") + "; style-src 'unsafe-inline'";
        popup.document.open();
        popup.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><title>' +
            util.escapeHTML(message.subject || "Message") + "</title></head><body>" + header + content + "</body></html>");
        popup.document.close();
        popup.focus();
        setTimeout(function () { popup.print(); }, 400);
    }

    function messageMenu(anchor, messages) {
        messages = messages.filter(Boolean);
        if (messages.length === 0) {
            return;
        }
        var single = messages.length === 1 ? (state.message && util.messageKey(state.message) === util.messageKey(messages[0]) ? state.message : messages[0]) : null;
        if (messages[0].outbox) {
            return;
        }
        var role = viewRole();
        var anyUnread = messages.some(function (message) { return !message.seen; });
        var anyStarred = messages.some(function (message) { return message.flagged; });
        var items = [];
        if (single && single.html !== undefined) {
            items.push({ label: "Reply all", icon: "reply all", hint: "A", onClick: function () { compose.reply(single, true); } });
            items.push({ label: "Forward", icon: "share", hint: "F", onClick: function () { compose.forward(single, false); } });
            items.push({ label: "Forward as attachment", icon: "paperclip", onClick: function () { compose.forward(single, true); } });
            items.push("-");
        }
        items.push({ label: anyUnread ? "Mark as read" : "Mark as unread", icon: anyUnread ? "envelope open outline" : "envelope outline", hint: anyUnread ? "Shift+I" : "U", onClick: function () { setFlag(messages, "seen", anyUnread); } });
        items.push({ label: anyStarred ? "Remove star" : "Star", icon: anyStarred ? "star" : "star outline", hint: "S", onClick: function () { setFlag(messages, "flagged", !anyStarred); } });
        items.push({ label: "Labels…", icon: "tags", onClick: function () { labelPicker(anchor, messages); } });
        if (state.view.kind === "snoozed") {
            items.push({ label: "Unsnooze", icon: "clock outline", onClick: function () { unsnoozeMessages(messages); } });
        } else {
            items.push({ label: "Snooze…", icon: "clock outline", onClick: function () { snoozePicker(anchor, messages); } });
        }
        items.push("-");
        if (role !== "archive" && role !== "all") {
            items.push({ label: "Archive", icon: "archive", hint: "E", onClick: function () { moveToRole(messages, "archive"); } });
        }
        if (role === "junk") {
            items.push({ label: "Not junk", icon: "check circle outline", onClick: function () { moveToRole(messages, "inbox"); } });
        } else {
            items.push({ label: "Mark as junk", icon: "ban", onClick: function () { moveToRole(messages, "junk"); } });
        }
        if (role === "trash" || role === "archive") {
            items.push({ label: "Move to Inbox", icon: "inbox", onClick: function () { moveToRole(messages, "inbox"); } });
        }
        items.push({ label: "Move to…", icon: "folder open outline", onClick: function () { chooseFolder(messages); } });
        items.push({ label: role === "trash" ? "Delete permanently" : "Delete", icon: "trash alternate outline", hint: "Del", danger: true, onClick: function () { deleteMessages(messages, role === "trash"); } });
        if (single) {
            items.push("-");
            items.push({ label: "Save to ArozOS (.eml)…", icon: "save outline", onClick: function () { saveAsEML(single); } });
            items.push({ label: "Download (.eml)", icon: "download", onClick: function () { downloadEML(single); } });
            if (single.html !== undefined) {
                items.push({ label: "Print", icon: "print", onClick: function () { printMessage(single); } });
            }
            items.push({ label: "View source", icon: "code", onClick: function () { viewSource(single); } });
            var sender = (single.from || [])[0];
            if (sender && sender.email) {
                items.push({ label: "Add sender to address book", icon: "address book outline", onClick: function () { Mail.settings.contactDialog({ name: sender.name, email: sender.email }, function () { ui.toast("Contact saved"); }); } });
            }
        }
        ui.menu(anchor, items);
    }

    function labelPicker(anchor, messages) {
        var render = function () {
            var items = [{ title: "Labels" }];
            state.labels.forEach(function (label) {
                var all = messages.every(function (message) { return (message.labels || []).indexOf(label.id) >= 0; });
                items.push({
                    label: label.name, dot: label.color, checked: all, keepOpen: false,
                    onClick: function () { toggleLabel(messages, label.id, !all); }
                });
            });
            items.push("-");
            items.push({ label: "New label…", icon: "plus", onClick: createLabel });
            return items;
        };
        setTimeout(function () { ui.menu(anchor, render()); }, 0);
    }

    function snoozePicker(anchor, messages) {
        var items = [{ title: "Snooze until" }];
        ui.presetTimes().forEach(function (preset) {
            items.push({ label: preset.label, hint: preset.hint, icon: "clock outline", onClick: function () { snoozeMessages(messages, preset.value); } });
        });
        items.push({
            label: "Pick date and time…", icon: "calendar alternate outline", onClick: function () {
                ui.pickDateTime("Snooze until", null, "Snooze").then(function (value) {
                    if (value) {
                        snoozeMessages(messages, value);
                    }
                });
            }
        });
        setTimeout(function () { ui.menu(anchor, items); }, 0);
    }

    /* ---------- Toolbar ---------- */

    function updateToolbar() {
        var hasTarget = targets().length > 0;
        ["markButton", "deleteButton", "replyButton", "moreButton"].forEach(function (name) {
            if (dom[name]) {
                dom[name].disabled = !hasTarget;
            }
        });
        if (dom.markButton) {
            var anyUnread = targets().some(function (message) { return !message.seen; });
            dom.markButton.title = anyUnread ? "Mark as read" : "Mark as unread";
            dom.markButton.firstChild.className = (anyUnread ? "envelope open outline" : "envelope outline") + " icon";
        }
    }

    function updateTitle() {
        var unread = 0;
        state.accounts.forEach(function (item) { unread += unreadOf(item.id, "inbox"); });
        var title = unread > 0 ? "Mail (" + unread + ")" : "Mail";
        if (typeof ao_module_setWindowTitle === "function") {
            try {
                ao_module_setWindowTitle(title);
            } catch (e) {
                document.title = title;
            }
        } else {
            document.title = title;
        }
    }

    /* ---------- Search ---------- */

    function setSearch(text, searchIn) {
        dom.searchInput.value = text;
        if (searchIn) {
            dom.searchIn.value = searchIn;
            state.searchIn = searchIn;
        }
        applySearch();
    }

    function applySearch() {
        var value = dom.searchInput.value.trim();
        dom.search.classList.toggle("has-text", value !== "");
        if (value === state.search && dom.searchIn.value === state.searchIn) {
            return;
        }
        state.search = value;
        state.searchIn = dom.searchIn.value;
        renderListHeader();
        reloadList();
    }

    function clearSearch() {
        dom.searchInput.value = "";
        applySearch();
    }

    /* ---------- Accounts ---------- */

    function addAccount() {
        Mail.accounts.openWizard(function (info) {
            loadAccounts().then(function () {
                loadFolders(info.id, true).catch(function () { }).then(function () {
                    renderSidebar();
                    if (state.accounts.length === 1) {
                        openView(roleView("inbox"));
                    } else {
                        reloadList();
                    }
                    poll();
                });
            });
        });
    }

    function editAccount(item) {
        Mail.accounts.openSettings(item, {
            onSaved: accountSaved,
            onRemoved: function (removed) {
                state.accounts = state.accounts.filter(function (other) { return other.id !== removed.id; });
                delete state.folders[removed.id];
                delete state.inboxStatus[removed.id];
                if (state.accountFilter === removed.id) {
                    state.accountFilter = "";
                }
                openView(roleView("inbox"));
            }
        });
    }

    function accountSaved(saved) {
        state.accounts = state.accounts.map(function (item) { return item.id === saved.id ? saved : item; });
        loadFolders(saved.id, true).catch(function () { }).then(function () {
            renderSidebar();
            reloadList();
        });
    }

    function loadAccounts() {
        return api.accounts("list", {}).then(function (accounts) {
            state.accounts = accounts || [];
            if (state.accountFilter && !account(state.accountFilter)) {
                state.accountFilter = "";
            }
            return state.accounts;
        });
    }

    /* ---------- New mail ---------- */

    function poll() {
        if (state.accounts.length === 0) {
            return;
        }
        api.mailbox("check", {}).then(function (statuses) {
            var arrivals = [];
            (statuses || []).forEach(function (status) {
                var previous = state.inboxStatus[status.accountId];
                var item = account(status.accountId);
                if (status.error) {
                    if (item && status.authFailed) {
                        item.authError = status.error;
                    }
                    return;
                }
                if (item && item.authError) {
                    item.authError = "";
                }
                var known = util.store.get("uidNext:" + status.accountId, 0);
                if (previous && status.uidNext > previous.uidNext) {
                    arrivals.push({ accountId: status.accountId, since: previous.uidNext });
                } else if (!previous && known && status.uidNext > known) {
                    arrivals.push({ accountId: status.accountId, since: known });
                }
                state.inboxStatus[status.accountId] = status;
                util.store.set("uidNext:" + status.accountId, status.uidNext);
            });
            renderSidebar();
            if (arrivals.length > 0) {
                newMailArrived(arrivals);
            }
        }).catch(function () { /* offline: try again next tick */ });
    }

    function newMailArrived(arrivals) {
        var viewingInbox = (state.view.kind === "unified" && state.view.key === "inbox") ||
            (state.view.kind === "folder" && state.view.folder.toUpperCase() === "INBOX");
        if (viewingInbox && !state.search && dom.list.scrollTop < 200 && Object.keys(state.checked).length === 0) {
            refreshTopOfList();
        }
        if (!state.settings.notify) {
            return;
        }
        arrivals.forEach(function (arrival) {
            api.mailbox("newSince", { accountId: arrival.accountId, uidNext: arrival.since, limit: 3, notify: document.hidden || !document.hasFocus() }).then(function (messages) {
                (messages || []).slice(0, 3).forEach(function (message) {
                    var from = util.addressName((message.from || [])[0]) || "New mail";
                    ui.toast(from + ": " + (message.subject || "(no subject)"), {
                        duration: 7000,
                        action: { label: "Open", fn: function () { openMessage(message); } }
                    });
                });
            }).catch(function () { });
        });
    }

    //refreshTopOfList reloads the first page quietly, keeping the open message
    function refreshTopOfList() {
        var token = ++state.list.token;
        var view = state.view;
        var request;
        if (view.kind === "unified") {
            request = api.mailbox("unified", { view: view.key, query: listQuery(0), accounts: state.accountFilter ? [state.accountFilter] : [] });
        } else if (view.kind === "folder") {
            var query = listQuery(0);
            query.folder = view.folder;
            request = api.mailbox("list", { accountId: view.accountId, query: query });
        } else {
            return;
        }
        request.then(function (result) {
            if (token !== state.list.token) {
                return;
            }
            state.list.messages = result.messages || [];
            state.list.total = result.total || 0;
            state.list.page = 0;
            state.list.done = state.list.messages.length >= state.list.total;
            state.list.errors = result.errors || [];
            renderList();
        }).catch(function () { });
    }

    function startPolling() {
        clearInterval(state.pollTimer);
        var minutes = Math.max(1, state.settings.pollMinutes || 2);
        state.pollTimer = setInterval(poll, minutes * 60 * 1000);
    }

    /* ---------- Keyboard ---------- */

    function typingTarget(event) {
        var target = event.target;
        return target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
    }

    function moveCursor(step) {
        var messages = state.list.messages;
        if (messages.length === 0) {
            return;
        }
        var index = messages.findIndex(function (message) { return (message.key || util.messageKey(message)) === state.currentKey; });
        var next = index < 0 ? 0 : Math.min(messages.length - 1, Math.max(0, index + step));
        openMessage(messages[next]);
        var row = dom.list.querySelector('.msg-row[data-key="' + CSS.escape(messages[next].key || util.messageKey(messages[next])) + '"]');
        if (row) {
            row.scrollIntoView({ block: "nearest" });
        }
        if (next >= messages.length - 3) {
            maybeLoadMore();
        }
    }

    function handleKeys(event) {
        if (ui.hasOpenModal() || ui.isMenuOpen() || typingTarget(event) || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        var message = state.message;
        var key = event.key;
        var handled = true;
        switch (key) {
            case "c": compose.newMessage(defaultAccountId()); break;
            case "r": if (message) { compose.reply(message, false); } break;
            case "a": if (message) { compose.reply(message, true); } break;
            case "f": if (message) { compose.forward(message, false); } break;
            case "e": moveToRole(targets(), "archive"); break;
            case "#": case "Delete": deleteMessages(targets(), false); break;
            case "s": setFlag(targets(), "flagged", !targets().every(function (item) { return item.flagged; })); break;
            case "u": setFlag(targets(), "seen", false); break;
            case "I": if (event.shiftKey) { setFlag(targets(), "seen", true); } break;
            case "j": case "ArrowDown": moveCursor(1); break;
            case "k": case "ArrowUp": moveCursor(-1); break;
            case "x": if (state.currentKey) { var index = state.list.messages.findIndex(function (item) { return util.messageKey(item) === state.currentKey; }); toggleCheck(state.currentKey, index, false); } break;
            case "/": dom.searchInput.focus(); break;
            case "?": Mail.settings.shortcuts(); break;
            case "Escape":
                if (Object.keys(state.checked).length > 0) {
                    clearChecks();
                    showReaderEmpty();
                } else if (isMobile() && dom.app.classList.contains("reading")) {
                    closeReaderMobile();
                } else {
                    handled = false;
                }
                break;
            default: handled = false;
        }
        if (handled) {
            event.preventDefault();
        }
    }

    /* ---------- Layout ---------- */

    function closeDrawer() {
        dom.app.classList.remove("sidebar-open");
    }

    function setupSplitter() {
        var saved = util.store.get("listWidth", 0);
        if (saved >= 300) {
            document.documentElement.style.setProperty("--list-w", saved + "px");
        }
        var dragging = false;
        dom.splitter.addEventListener("mousedown", function (event) {
            dragging = true;
            dom.splitter.classList.add("dragging");
            event.preventDefault();
        });
        window.addEventListener("mousemove", function (event) {
            if (!dragging) {
                return;
            }
            var left = dom.listpane.getBoundingClientRect().left;
            var width = Math.max(300, Math.min(event.clientX - left, window.innerWidth * 0.55));
            document.documentElement.style.setProperty("--list-w", width + "px");
        });
        window.addEventListener("mouseup", function () {
            if (!dragging) {
                return;
            }
            dragging = false;
            dom.splitter.classList.remove("dragging");
            util.store.set("listWidth", Math.round(dom.listpane.getBoundingClientRect().width));
        });
    }

    function buildLayout() {
        dom.app = document.getElementById("app");
        dom.nav = document.getElementById("nav");
        dom.list = document.getElementById("messageList");
        dom.listpane = document.getElementById("listpane");
        dom.listHeader = document.getElementById("listHeader");
        dom.filterChips = document.getElementById("filterChips");
        dom.bulkbar = document.getElementById("bulkbar");
        dom.reader = document.getElementById("reader");
        dom.splitter = document.getElementById("splitter");
        dom.search = document.getElementById("search");
        dom.searchInput = document.getElementById("searchInput");
        dom.searchIn = document.getElementById("searchIn");
        dom.markButton = document.getElementById("markButton");
        dom.deleteButton = document.getElementById("deleteButton");
        dom.replyButton = document.getElementById("replyButton");
        dom.moreButton = document.getElementById("moreButton");

        document.getElementById("composeButton").addEventListener("click", function () { compose.newMessage(defaultAccountId()); closeDrawer(); });
        document.getElementById("toolbarCompose").addEventListener("click", function () { compose.newMessage(defaultAccountId()); });
        document.getElementById("menuToggle").addEventListener("click", function () { dom.app.classList.toggle("sidebar-open"); });
        dom.markButton.addEventListener("click", function () {
            var list = targets();
            setFlag(list, "seen", list.some(function (message) { return !message.seen; }));
        });
        dom.deleteButton.addEventListener("click", function () { deleteMessages(targets(), viewRole() === "trash"); });
        dom.replyButton.addEventListener("click", function () { if (state.message) { compose.reply(state.message, false); } });
        dom.moreButton.addEventListener("click", function () { messageMenu(dom.moreButton, targets()); });
        document.getElementById("settingsButton").addEventListener("click", function () { openSettings(); });
        document.getElementById("avatarButton").addEventListener("click", function (event) {
            ui.menu(event.currentTarget, [
                { title: state.user.username },
                { label: "Mail settings", icon: "cog", onClick: function () { openSettings(); } },
                { label: "Address book", icon: "address book outline", onClick: function () { openSettings("contacts"); } },
                { label: "Add account", icon: "plus", onClick: addAccount },
                { label: "Keyboard shortcuts", icon: "keyboard outline", onClick: Mail.settings.shortcuts }
            ], { alignRight: true });
        });

        var searchDebounced = util.debounce(applySearch, 600);
        dom.searchInput.addEventListener("input", function () {
            dom.search.classList.toggle("has-text", dom.searchInput.value !== "");
            searchDebounced();
        });
        dom.searchInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                applySearch();
            } else if (event.key === "Escape") {
                clearSearch();
                dom.searchInput.blur();
            }
        });
        dom.searchIn.addEventListener("change", function () {
            if (dom.searchInput.value.trim() !== "") {
                applySearch();
            }
        });
        document.getElementById("searchClear").addEventListener("click", clearSearch);

        dom.list.addEventListener("scroll", maybeLoadMore);
        dom.list.addEventListener("dragstart", function (event) {
            var data = event.dataTransfer.getData("application/x-aroz-mail");
            try {
                state.dragKeys = JSON.parse(data);
            } catch (e) {
                state.dragKeys = [];
            }
        });
        document.addEventListener("keydown", handleKeys);
        window.addEventListener("resize", util.debounce(function () {
            if (!isMobile()) {
                dom.app.classList.remove("reading");
            }
        }, 200));
        setupSplitter();
    }

    function openSettings(tab) {
        Mail.settings.open({
            settings: state.settings, labels: state.labels, accounts: state.accounts, isAdmin: state.user.admin,
            onSettings: function (saved) {
                var pollChanged = saved.pollMinutes !== state.settings.pollMinutes;
                var listChanged = saved.pageSize !== state.settings.pageSize || saved.showPreview !== state.settings.showPreview;
                state.settings = saved;
                applyTheme();
                if (pollChanged) {
                    startPolling();
                }
                if (listChanged) {
                    reloadList();
                }
            },
            onLabels: function (labels) {
                state.labels = labels;
                renderSidebar();
                renderList();
            },
            onWrite: function (contact) {
                compose.open({ accountId: defaultAccountId(), to: [util.formatAddressForInput(contact)], focus: "body" });
            }
        }, tab);
    }

    /* ---------- Start ---------- */

    function handleLaunchHash() {
        var hash = decodeURIComponent((window.location.hash || "").replace(/^#/, ""));
        if (!hash) {
            return;
        }
        if (hash.indexOf("compose=") === 0) {
            try {
                var options = JSON.parse(hash.slice(8));
                compose.open(options);
            } catch (e) { /* malformed */ }
        } else if (hash.indexOf("handoff=") === 0) {
            //A composer prepared by the .eml viewer, passed through storage
            //because a quoted message can be too large for a URL
            var storageKey = "aroz-mail:" + hash.slice(8);
            try {
                var prepared = localStorage.getItem(storageKey);
                localStorage.removeItem(storageKey);
                if (prepared) {
                    compose.open(JSON.parse(prepared));
                }
            } catch (e) { /* storage unavailable */ }
        } else if (/^mailto:/i.test(hash)) {
            compose.mailto(hash, defaultAccountId());
        }
        try {
            history.replaceState(null, "", window.location.pathname + window.location.search);
        } catch (e) { /* ignore */ }
    }

    function start() {
        buildLayout();
        watchSystemTheme();
        compose.init({
            host: document.getElementById("workspace"),
            context: {
                accounts: function () { return state.accounts; },
                settings: function () { return state.settings; },
                defaultAccountId: defaultAccountId,
                onSent: function () {
                    refreshLocalCounts();
                    if (viewRole() === "sent" || viewRole() === "drafts") {
                        setTimeout(reloadList, 1500);
                    }
                    refreshCountsSoon();
                },
                onDraftChanged: function () {
                    if (viewRole() === "drafts") {
                        reloadList();
                    }
                    refreshCountsSoon();
                },
                onAuthFailed: function (accountId, error) {
                    var item = account(accountId);
                    if (item) {
                        Mail.accounts.reconnect(item, accountSaved, error);
                    }
                }
            }
        });

        if (!api.available) {
            showReaderEmpty();
            util.clear(dom.list);
            dom.list.appendChild(el("div", { class: "list-status" }, [icon("plug"), el("div", { class: "title", text: "Not connected" }), el("div", { text: "Open Mail from the ArozOS desktop." })]));
            return;
        }

        state.list.loading = true;
        renderList();
        api.settings("whoami", {}).then(function (user) {
            state.user = user;
            util.store.setUser(user.username);
            if (user.icon && /^data:image\//.test(user.icon)) {
                var avatar = document.getElementById("avatarButton");
                util.clear(avatar).appendChild(el("img", { src: user.icon, alt: "" }));
            } else {
                document.getElementById("avatarButton").textContent = (user.username || "?").charAt(0).toUpperCase();
            }
            return Promise.all([
                api.settings("get", {}),
                api.settings("labels", {}),
                loadAccounts()
            ]);
        }).then(function (results) {
            state.settings = results[0] || {};
            state.labels = results[1] || [];
            applyTheme();
            state.accountFilter = util.store.get("accountFilter", "");
            if (state.accountFilter && !account(state.accountFilter)) {
                state.accountFilter = "";
            }
            state.sort = util.store.get("sort", "date");
            state.filter = util.store.get("filter", "all");
            var savedView = util.store.get("view", null);
            if (savedView && (savedView.kind === "unified" || (savedView.kind === "folder" && account(savedView.accountId)) || savedView.kind === "snoozed" ||
                (savedView.kind === "label" && state.labels.some(function (label) { return label.id === savedView.id; })))) {
                state.view = savedView;
            }
            renderSidebar();
            renderListHeader();
            showReaderEmpty();
            if (state.accounts.length === 0) {
                state.list.loading = false;
                renderList();
                addAccount();
            } else {
                reloadList();
                //Fresh counts on start: the server caches folder lists for a
                //few minutes, which is right for actions but not for badges
                Promise.all(state.accounts.map(function (item) { return loadFolders(item.id, true).catch(function () { }); })).then(function () {
                    renderSidebar();
                    renderListHeader();
                });
                poll();
                refreshLocalCounts();
            }
            startPolling();
            handleLaunchHash();
        }).catch(function (error) {
            state.list.loading = false;
            state.list.error = error;
            renderList();
            ui.errorToast(error);
        });
    }

    return { start: start, state: state, openView: openView };
})();

document.addEventListener("DOMContentLoaded", function () {
    Mail.app.start();
});
