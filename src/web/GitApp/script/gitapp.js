/*
    GitApp front-end

    Talks to the backend/*.agi scripts, which in turn drive the AGI git library.

    Authentication model
    --------------------
    No operation ever asks for credentials up front. A remote call is attempted
    with whatever the user already saved for that host; if the server rejects it
    the backend replies with authRequired, the sign-in dialog opens, and the
    original operation is retried with the entered credentials. Ticking
    "Remember" stores the token encrypted on the server, so it never comes back
    to the browser afterwards.
*/

var state = {
    username: "",
    identity: { name: "", email: "" },
    repos: [],
    repo: null,          //virtual path of the active repository
    status: null,        //latest RepoStatus payload
    selected: {},        //path -> true for the files ticked for the next commit
    activeFile: null,    //path shown in the diff pane
    tab: "changes",
    commits: [],
    activeCommit: null,
    commitFiles: [],     //files touched by the selected commit (History tab)
    activeCommitFile: null,
    busy: false
};

/* ── Backend plumbing ─────────────────────────────────────────────────── */

//call posts to one of the backend AGI scripts and hands back the parsed reply.
function call(script, data, callback) {
    ao_module_agirun("GitApp/backend/" + script, data, function(response) {
        var parsed = response;
        if (typeof parsed === "string") {
            try {
                parsed = JSON.parse(parsed);
            } catch (e) {
                setStatus("Unexpected reply from the server", true);
                console.error("GitApp: unparseable response from " + script, response);
                return;
            }
        }
        callback(parsed);
    }, function(xhr) {
        setStatus("Request failed: " + script, true);
        console.error("GitApp: request to " + script + " failed", xhr);
    });
}

function setStatus(message, isError) {
    var bar = $("#statusMessage");
    bar.text(message);
    $(".statusbar").toggleClass("error", isError === true).removeClass("busy");
}

function setBusy(message) {
    state.busy = true;
    $("#statusMessage").text(message);
    $(".statusbar").addClass("busy").removeClass("error");
}

function clearBusy(message) {
    state.busy = false;
    setStatus(message || "Ready");
}

/* ── Repository list ──────────────────────────────────────────────────── */

function loadRepos(selectPath) {
    call("repolist.agi", { opr: "list" }, function(reply) {
        if (!reply.success) {
            setStatus(reply.error, true);
            return;
        }

        state.repos = reply.repos;
        if (reply.username) {
            state.username = reply.username;
        }
        if (reply.identity) {
            state.identity = reply.identity;
        }
        renderIdentity();
        renderRepoList();

        if (state.repos.length === 0) {
            state.repo = null;
            renderEmptyState();
            return;
        }

        var target = selectPath || state.repo;
        var stillThere = false;
        for (var i = 0; i < state.repos.length; i++) {
            if (state.repos[i].path === target) {
                stillThere = true;
                break;
            }
        }
        if (!stillThere) {
            target = state.repos[0].path;
        }
        selectRepo(target);
    });
}

function renderRepoList() {
    var list = $("#repoList").empty();

    if (state.repos.length === 0) {
        list.append($("<div class='popoveritem'></div>").text("No repositories yet"));
        return;
    }

    state.repos.forEach(function(repo) {
        var item = $("<div class='popoveritem'></div>");
        if (repo.path === state.repo) {
            item.addClass("active");
        }
        if (!repo.valid) {
            item.addClass("invalid");
        }

        var text = $("<div class='maintext'></div>");
        text.append($("<div class='name'></div>").text(repo.name));
        text.append($("<div class='sub'></div>").text(repo.valid ? repo.path : (repo.error || "unavailable")));
        item.append($("<i class='book icon'></i>")).append(text);

        var remove = $("<i class='remove icon' title='Remove from list'></i>");
        remove.on("click", function(event) {
            event.stopPropagation();
            removeRepo(repo.path);
        });
        item.append(remove);

        item.on("click", function() {
            closePopovers();
            selectRepo(repo.path);
        });
        list.append(item);
    });
}

function selectRepo(path) {
    state.repo = path;
    state.selected = {};
    state.activeFile = null;
    state.activeCommit = null;

    var name = path.split("/").pop() || path;
    $("#repoName").text(name);
    renderRepoList();
    refreshStatus();
}

function removeRepo(path) {
    call("repolist.agi", { opr: "remove", path: path }, function(reply) {
        if (!reply.success) {
            setStatus(reply.error, true);
            return;
        }
        if (state.repo === path) {
            state.repo = null;
        }
        loadRepos();
    });
}

/* ── Status and the changes list ──────────────────────────────────────── */

function refreshStatus(afterwards) {
    if (!state.repo) {
        renderEmptyState();
        return;
    }

    setBusy("Reading repository…");
    call("status.agi", { opr: "status", repo: state.repo }, function(reply) {
        if (!reply.success) {
            clearBusy();
            setStatus(reply.error, true);
            renderRepoError(reply.error);
            return;
        }

        state.status = reply.status;
        clearBusy();
        renderStatus();

        if (typeof afterwards === "function") {
            afterwards();
        }
    });
}

function renderStatus() {
    var status = state.status;

    $("#branchName").text(status.branch || (status.detached ? "detached HEAD" : "—"));
    $("#commitBranch").text(status.branch || "HEAD");
    $("#changesCount").text(status.changes.length);
    $("#changedFilesLabel").text(
        status.changes.length === 1 ? "1 changed file" : status.changes.length + " changed files");

    renderRemoteAction();
    renderFileList();
    updateCommitButton();

    //Keep the diff pane in step with the list it belongs to
    if (state.tab === "changes") {
        if (state.activeFile && !findChange(state.activeFile)) {
            state.activeFile = null;
        }
        if (state.activeFile) {
            showWorktreeDiff(state.activeFile);
        } else if (status.changes.length > 0) {
            selectFile(status.changes[0].path);
        } else {
            renderNoChanges();
        }
    }
}

function findChange(path) {
    if (!state.status) {
        return null;
    }
    for (var i = 0; i < state.status.changes.length; i++) {
        if (state.status.changes[i].path === path) {
            return state.status.changes[i];
        }
    }
    return null;
}

function renderFileList() {
    var list = $("#fileList").empty();
    var changes = state.status.changes;

    if (changes.length === 0) {
        list.append($("<div class='empty' style='height:auto;padding:24px 12px;'></div>")
            .append($("<div class='sub'></div>").text("No local changes")));
        $("#selectAll").prop("checked", false).prop("indeterminate", false);
        return;
    }

    changes.forEach(function(change) {
        var row = $("<div class='filerow'></div>");
        if (change.path === state.activeFile) {
            row.addClass("active");
        }

        var box = $("<input type='checkbox'>");
        box.prop("checked", state.selected[change.path] === true);
        box.on("click", function(event) {
            event.stopPropagation();
            state.selected[change.path] = box.prop("checked");
            updateSelectAll();
            updateCommitButton();
        });

        //The path is rendered right-to-left so a long folder chain truncates on
        //the left and the file name always stays visible. A leading Left-to-Right
        //Mark keeps names that start with a neutral character (".gitignore") from
        //having that character reordered to the visual end by the RTL bidi rules.
        var label = $("<div class='fname'></div>")
            .attr("title", change.path)
            .text("‎" + change.path);

        row.append(box).append(label).append(statusMark(change));
        row.on("click", function() {
            selectFile(change.path);
        });

        //Right clicking also selects the row, so the menu always acts on the
        //file the user can see highlighted
        row.on("contextmenu", function(event) {
            event.preventDefault();
            selectFile(change.path);
            openFileContextMenu(change, event.clientX, event.clientY);
        });

        list.append(row);
    });

    updateSelectAll();
}

//statusMark draws the small coloured square shown at the end of each row.
function statusMark(change) {
    var kind = change.conflict ? "conflicted" : change.status;
    var glyph = {
        added: "<path d='M5 1v8M1 5h8'/>",
        untracked: "<path d='M5 1v8M1 5h8'/>",
        deleted: "<path d='M1 5h8'/>",
        modified: "<circle cx='5' cy='5' r='2' fill='#ffffff' stroke='none'/>",
        renamed: "<path d='M1 5h7M5.5 2.5L8 5l-2.5 2.5'/>",
        copied: "<path d='M1 5h7M5.5 2.5L8 5l-2.5 2.5'/>",
        conflicted: "<path d='M5 2v3M5 7.5v.5'/>"
    }[kind] || "<circle cx='5' cy='5' r='2' fill='#ffffff' stroke='none'/>";

    return $("<div class='statusmark'></div>")
        .addClass(kind)
        .attr("title", change.staged ? kind + " (staged)" : kind)
        .html("<svg viewBox='0 0 10 10'>" + glyph + "</svg>");
}

function updateSelectAll() {
    if (!state.status) {
        return;
    }

    var total = state.status.changes.length;
    var chosen = selectedFiles().length;

    $("#selectAll")
        .prop("checked", total > 0 && chosen === total)
        .prop("indeterminate", chosen > 0 && chosen < total);
}

function selectedFiles() {
    if (!state.status) {
        return [];
    }
    return state.status.changes
        .filter(function(change) { return state.selected[change.path] === true; })
        .map(function(change) { return change.path; });
}

function updateCommitButton() {
    var ready = selectedFiles().length > 0 && $("#commitSummary").val().trim() !== "";
    $("#commitButton").prop("disabled", !ready);
}

function selectFile(path) {
    state.activeFile = path;
    $(".filerow").removeClass("active");
    renderFileList();
    showWorktreeDiff(path);
}

/* ── Remote action button ─────────────────────────────────────────────── */

function renderRemoteAction() {
    var status = state.status;
    var title = "Publish branch";
    var sub = "Publish this branch to the remote";
    var icon = "cloud upload icon";
    var badge = "";

    if (status.remotes.length === 0) {
        title = "Add a remote";
        sub = "This repository has no remote";
        icon = "plug icon";
    } else if (status.behind > 0) {
        title = "Pull " + (status.upstream ? status.upstream.split("/")[0] : "origin");
        sub = "Last fetched just now";
        icon = "cloud download icon";
        badge = status.behind + " ↓";
    } else if (status.ahead > 0) {
        title = "Push " + (status.upstream ? status.upstream.split("/")[0] : "origin");
        sub = status.upstream ? "Push commits to the remote" : "Publish this branch to the remote";
        icon = "cloud upload icon";
        badge = status.ahead + " ↑";
    } else {
        title = "Fetch origin";
        sub = "Check the remote for new commits";
        icon = "sync icon";
    }

    $("#remoteActionTitle").text(title);
    $("#remoteActionSub").text(sub);
    $("#remoteActionIcon").attr("class", icon);
    $("#remoteActionBadge").text(badge);
}

function onRemoteAction() {
    if (!state.repo || !state.status) {
        return;
    }

    if (state.status.remotes.length === 0) {
        openRemoteDialog();
    } else if (state.status.behind > 0) {
        runTransport("pull", "Pulling…");
    } else if (state.status.ahead > 0) {
        runTransport("push", "Pushing…");
    } else {
        runTransport("fetch", "Fetching…");
    }
}

/*
    runTransport performs a remote operation, and on an authentication failure
    opens the sign-in dialog and repeats the very same call with the credentials
    the user typed.
*/
function runTransport(operation, busyMessage, credentials) {
    var payload = { opr: operation, repo: state.repo };
    if (credentials) {
        payload.username = credentials.username;
        payload.token = credentials.token;
        payload.remember = credentials.remember ? "true" : "false";
    }

    setBusy(busyMessage);
    call("transport.agi", payload, function(reply) {
        clearBusy();

        if (reply.success) {
            //The refresh that follows ends with its own "Ready", so the outcome
            //has to be reported once the refresh has settled.
            var outcome = reply.message || (operation + " finished");
            refreshStatus(function() {
                setStatus(outcome);
            });
            if (state.tab === "history") {
                loadHistory();
            }
            return;
        }

        if (reply.authRequired) {
            openCredentialDialog(remoteHostLabel(), function(entered) {
                runTransport(operation, busyMessage, entered);
            });
            return;
        }
        setStatus(reply.error, true);
    });
}

//remoteHostLabel returns the URL of the repository's first remote, used as the
//title of the sign-in dialog and as the credential key.
function remoteHostLabel() {
    if (state.status && state.status.remotes.length > 0 && state.status.remotes[0].urls.length > 0) {
        return state.status.remotes[0].urls[0];
    }
    return "";
}

//remoteUrlByName finds a named remote's URL, so a sign-in prompt raised by a
//branch operation names the remote it is actually talking to rather than
//whichever one happens to be first.
function remoteUrlByName(name) {
    if (!state.status || !state.status.remotes) {
        return "";
    }
    for (var i = 0; i < state.status.remotes.length; i++) {
        var remote = state.status.remotes[i];
        if (remote.name === name && remote.urls.length > 0) {
            return remote.urls[0];
        }
    }
    return remoteHostLabel();
}

/* ── Diff pane ────────────────────────────────────────────────────────── */

function showWorktreeDiff(path) {
    $("#diffPath").text(path);
    renderDiffActions(path);

    var change = findChange(path);
    if (change && change.preview) {
        //An image or PDF has no useful text diff; show the file itself instead
        showWorktreePreview(change);
        return;
    }

    call("diff.agi", { opr: "worktree", repo: state.repo, file: path }, function(reply) {
        if (!reply.success) {
            renderDiffMessage("Cannot show this diff", reply.error);
            return;
        }
        renderDiff(reply.diff);
    });
}

function showCommitDiff(hash, path, previewKind) {
    $("#diffPath").text(path);

    if (previewKind) {
        showCommitPreview(hash, path, previewKind);
        return;
    }

    call("diff.agi", { opr: "commit", repo: state.repo, hash: hash, file: path }, function(reply) {
        if (!reply.success) {
            renderDiffMessage("Cannot show this diff", reply.error);
            return;
        }
        renderDiff(reply.diff);
    });
}

/* ── Rich preview for images, PDFs and media ──────────────────────────── */

//Object URLs built for the committed side; revoked when the pane is replaced.
var previewObjectUrls = [];

function releasePreviewUrls() {
    previewObjectUrls.forEach(function(url) {
        URL.revokeObjectURL(url);
    });
    previewObjectUrls = [];
}

/*
    objectUrlFromBase64 turns the committed bytes into a blob URL.

    A data: URI would be simpler but browsers refuse to render one inside a
    frame, so a PDF preview would silently come up blank.
*/
function objectUrlFromBase64(base64, mime) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    previewObjectUrls.push(url);
    return url;
}

//workingTreeUrl serves the on-disk copy straight from the ArozOS media endpoint.
function workingTreeUrl(relativePath) {
    return ao_root + "media?file=" +
        encodeURIComponent(joinVirtualPath(state.repo, relativePath)) + "&t=" + Date.now();
}

//previewElement builds the right tag for the media kind.
function previewElement(kind, url) {
    switch (kind) {
        case "image":
            return $("<img class='previewmedia'>").attr("src", url);
        case "pdf":
            return $("<iframe class='previewmedia previewframe'></iframe>").attr("src", url);
        case "video":
            return $("<video class='previewmedia' controls></video>").attr("src", url);
        case "audio":
            return $("<audio class='previewaudio' controls></audio>").attr("src", url);
        default:
            return $("<div class='previewnote'></div>").text("This file cannot be previewed.");
    }
}

//previewPane wraps one side of the comparison with its caption.
function previewPane(caption, kind, url, note) {
    var pane = $("<div class='previewpane'></div>");
    pane.append($("<div class='previewcaption'></div>").text(caption));

    if (url) {
        pane.append($("<div class='previewbody'></div>").append(previewElement(kind, url)));
    } else {
        pane.append($("<div class='previewbody empty'></div>")
            .append($("<div class='previewnote'></div>").text(note || "Not present")));
    }
    return pane;
}

/*
    showWorktreePreview renders a changed media file.

    A new file is shown on its own; a modified one is shown as the committed
    version beside the working tree version, and a deleted one as the committed
    version alone.
*/
function showWorktreePreview(change) {
    releasePreviewUrls();

    var area = $("#diffArea").empty();
    var kind = change.preview;
    var isNew = change.status === "untracked" || change.status === "added";
    var isDeleted = change.status === "deleted";

    var layout = $("<div class='preview'></div>");
    area.append(layout);

    if (isNew) {
        //Nothing committed to compare against
        layout.addClass("single");
        layout.append(previewPane("New file", kind, workingTreeUrl(change.path)));
        return;
    }

    setBusy("Loading the previous version…");
    call("blob.agi", { repo: state.repo, file: change.path, revision: "HEAD" }, function(reply) {
        clearBusy();

        var beforeUrl = null;
        var beforeNote = "Not in the last commit";
        if (reply.success && reply.exists && reply.base64) {
            beforeUrl = objectUrlFromBase64(reply.base64, reply.mime || "application/octet-stream");
        } else if (!reply.success) {
            beforeNote = reply.error;
        }

        layout.empty();
        if (isDeleted) {
            layout.addClass("single");
            layout.append(previewPane("Deleted file (last committed version)", kind, beforeUrl, beforeNote));
            return;
        }

        layout.removeClass("single");
        layout.append(previewPane("Before (HEAD)", kind, beforeUrl, beforeNote));
        layout.append(previewPane("After (working tree)", kind, workingTreeUrl(change.path)));
    });
}

/*
    showCommitPreview compares a media file against its state in the parent
    commit, which is the History tab's equivalent of the working tree view.
*/
function showCommitPreview(hash, path, kind) {
    releasePreviewUrls();

    var area = $("#diffArea").empty();
    var layout = $("<div class='preview'></div>");
    area.append(layout);

    var commit = findCommit(hash);
    var parentHash = (commit && commit.parents && commit.parents.length > 0) ? commit.parents[0] : "";

    setBusy("Loading the file…");
    call("blob.agi", { repo: state.repo, file: path, revision: hash }, function(afterReply) {
        var afterUrl = null;
        if (afterReply.success && afterReply.exists && afterReply.base64) {
            afterUrl = objectUrlFromBase64(afterReply.base64, afterReply.mime || "application/octet-stream");
        }

        //The first commit in a repository has no parent to compare against
        if (parentHash === "") {
            clearBusy();
            layout.addClass("single").empty();
            layout.append(previewPane("Added in this commit", kind, afterUrl, "Cannot read this file"));
            return;
        }

        call("blob.agi", { repo: state.repo, file: path, revision: parentHash }, function(beforeReply) {
            clearBusy();

            var beforeUrl = null;
            if (beforeReply.success && beforeReply.exists && beforeReply.base64) {
                beforeUrl = objectUrlFromBase64(beforeReply.base64, beforeReply.mime || "application/octet-stream");
            }

            layout.empty();
            if (beforeUrl === null) {
                layout.addClass("single");
                layout.append(previewPane("Added in this commit", kind, afterUrl, "Cannot read this file"));
                return;
            }
            if (afterUrl === null) {
                layout.addClass("single");
                layout.append(previewPane("Deleted in this commit (previous version)", kind, beforeUrl));
                return;
            }

            layout.removeClass("single");
            layout.append(previewPane("Before (parent commit)", kind, beforeUrl));
            layout.append(previewPane("After (this commit)", kind, afterUrl));
        });
    });
}

function findCommit(hash) {
    for (var i = 0; i < state.commits.length; i++) {
        if (state.commits[i].hash === hash) {
            return state.commits[i];
        }
    }
    return null;
}

function renderDiffActions(path) {
    var actions = $("#diffActions").empty();

    var discard = $("<button class='danger'><i class='undo icon'></i>Discard changes</button>");
    discard.on("click", function() {
        discardFiles([path]);
    });
    actions.append(discard);
}

function renderDiff(diff) {
    releasePreviewUrls();
    var area = $("#diffArea").empty();

    if (diff.binary) {
        renderDiffMessage("Binary file", "This file has no text representation to compare.");
        return;
    }
    if (diff.tooLarge) {
        renderDiffMessage("File too large", "This file is too large to diff in the browser.");
        return;
    }
    if (diff.hunks.length === 0) {
        renderDiffMessage("No textual changes", "The file content is identical.");
        return;
    }

    var summary = $("<div class='diffstat'></div>");
    summary.append($("<span class='plus'></span>").text("+" + diff.additions));
    summary.append(document.createTextNode("  "));
    summary.append($("<span class='minus'></span>").text("−" + diff.deletions));
    if (diff.isNew) {
        summary.append(document.createTextNode("  ·  new file"));
    }
    if (diff.isDeleted) {
        summary.append(document.createTextNode("  ·  deleted file"));
    }
    area.append(summary);

    var table = $("<table class='difftable'></table>");
    var body = $("<tbody></tbody>");

    diff.hunks.forEach(function(hunk) {
        body.append($("<tr class='hunk'></tr>").append(
            $("<td colspan='3'></td>").text(hunk.header)));

        hunk.lines.forEach(function(line) {
            var row = $("<tr></tr>").addClass(line.type);
            row.append($("<td class='num'></td>").text(line.oldLine > 0 ? line.oldLine : ""));
            row.append($("<td class='num'></td>").text(line.newLine > 0 ? line.newLine : ""));

            var prefix = line.type === "add" ? "+" : (line.type === "del" ? "-" : " ");
            row.append($("<td class='code'></td>").text(prefix + line.content));
            body.append(row);
        });
    });

    table.append(body);
    area.append(table);
}

function renderDiffMessage(title, sub) {
    releasePreviewUrls();
    $("#diffArea").empty().append(
        $("<div class='empty'></div>")
            .append("<i class='file outline icon'></i>")
            .append($("<div class='title'></div>").text(title))
            .append($("<div class='sub'></div>").text(sub || "")));
}

function renderNoChanges() {
    releasePreviewUrls();
    $("#diffPath").text("No file selected");
    $("#diffActions").empty();
    $("#diffArea").empty().append(
        $("<div class='empty'></div>")
            .append("<i class='check circle outline icon'></i>")
            .append($("<div class='title'></div>").text("No local changes"))
            .append($("<div class='sub'></div>").text(
                "There are no uncommitted changes in this repository.")));
}

function renderRepoError(message) {
    $("#diffArea").empty().append(
        $("<div class='empty'></div>")
            .append("<i class='exclamation triangle icon'></i>")
            .append($("<div class='title'></div>").text("Cannot read this repository"))
            .append($("<div class='sub'></div>").text(message)));
}

function renderEmptyState() {
    $("#repoName").text("No repository");
    $("#branchName").text("—");
    $("#changesCount").text("0");
    $("#fileList").empty();
    $("#commitFileList").empty();
    $("#diffPath").text("No file selected");
    $("#diffActions").empty();

    $("#diffArea").empty().append(
        $("<div class='empty'></div>")
            .append("<i class='folder open outline icon'></i>")
            .append($("<div class='title'></div>").text("No local repositories"))
            .append($("<div class='sub'></div>").text(
                "Clone a repository from the internet, or add one that already exists on this system."))
            .append($("<div class='actions'></div>")
                .append($("<button class='primary'>Clone a repository</button>").on("click", openCloneDialog))
                .append($("<button>Add existing repository</button>").on("click", pickExistingRepo))));
}

/* ── History tab ──────────────────────────────────────────────────────── */

function loadHistory() {
    if (!state.repo) {
        return;
    }

    setBusy("Loading history…");
    call("status.agi", { opr: "log", repo: state.repo, limit: "100" }, function(reply) {
        clearBusy();
        if (!reply.success) {
            setStatus(reply.error, true);
            return;
        }

        state.commits = reply.commits;
        renderCommitList();

        if (state.commits.length > 0) {
            selectCommit(state.commits[0].hash);
        } else {
            renderCommitFiles([]);
            renderDiffMessage("No commits yet", "Make your first commit to see it here.");
        }
    });
}

function renderCommitList() {
    var list = $("#commitList").empty();

    if (state.commits.length === 0) {
        list.append($("<div class='empty' style='height:auto;padding:24px 12px;'></div>")
            .append($("<div class='sub'></div>").text("No commits yet")));
        return;
    }

    var headHash = (state.status && state.status.head) ? state.status.head.hash : null;

    state.commits.forEach(function(commit) {
        var entry = $("<div class='commitentry'></div>");
        if (commit.hash === state.activeCommit) {
            entry.addClass("active");
        }

        var subject = $("<div class='subject'></div>").text(commit.subject);
        //Tags on this commit are shown as small labels, like GitHub Desktop
        if (commit.tags && commit.tags.length > 0) {
            commit.tags.forEach(function(tag) {
                subject.prepend($("<span class='taglabel'></span>").text(tag));
            });
        }
        entry.append(subject);
        entry.append($("<div class='meta'></div>").text(
            commit.authorName + " · " + formatTime(commit.timestamp) + " · " + commit.shortHash));

        entry.on("click", function() {
            selectCommit(commit.hash);
        });
        entry.on("contextmenu", function(event) {
            event.preventDefault();
            selectCommit(commit.hash);
            openCommitContextMenu(commit, commit.hash === headHash, event.clientX, event.clientY);
        });
        list.append(entry);
    });
}

function selectCommit(hash) {
    state.activeCommit = hash;
    state.activeCommitFile = null;
    renderCommitList();

    call("status.agi", { opr: "commitfiles", repo: state.repo, hash: hash }, function(reply) {
        if (!reply.success) {
            renderCommitFiles([]);
            renderDiffMessage("Cannot read this commit", reply.error);
            return;
        }

        if (reply.files.length === 0) {
            renderCommitFiles([]);
            renderDiffMessage("Empty commit", "This commit does not touch any file.");
            return;
        }

        //Fill the middle column with the commit's files, then open the first one
        renderCommitFiles(reply.files);
        selectCommitFile(reply.files[0]);
    });
}

/*
    renderCommitFiles draws the middle column of the History tab. The rows reuse
    the Changes tab's .filerow look, minus the staging checkbox — a committed
    file has nothing left to stage.
*/
function renderCommitFiles(files) {
    state.commitFiles = files;
    $("#commitFilesLabel").text(
        files.length === 0 ? "No changed files" :
        files.length + " changed file" + (files.length === 1 ? "" : "s"));

    var list = $("#commitFileList").empty();
    if (files.length === 0) {
        return;
    }

    files.forEach(function(file) {
        var row = $("<div class='filerow'></div>");
        if (file.path === state.activeCommitFile) {
            row.addClass("active");
        }

        //Rendered right-to-left so a long folder chain truncates on the left and
        //the file name stays visible, as in the Changes tab.
        row.append($("<div class='fname'></div>")
            .attr("title", file.path)
            .text("‎" + file.path));
        row.append(statusMark(file));

        row.on("click", function() {
            selectCommitFile(file);
        });
        list.append(row);
    });
}

function selectCommitFile(file) {
    state.activeCommitFile = file.path;
    $("#commitFileList .filerow").removeClass("active");
    renderCommitFiles(state.commitFiles);
    $("#diffActions").empty();
    showCommitDiff(state.activeCommit, file.path, file.preview);
}

function formatTime(unixSeconds) {
    var date = new Date(unixSeconds * 1000);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ── Commit context menu (History tab) ────────────────────────────────── */

/*
    openCommitContextMenu builds the right-click menu for one commit, mirroring
    GitHub Desktop. isHead marks the tip of the current branch, which gates the
    actions that only make sense there (amend) and the ones that would be a
    no-op on it (reset/checkout to where you already are).

    "Reorder commit" needs an interactive rebase, which go-git cannot do, so it
    is shown disabled — exactly as it appears greyed in GitHub Desktop when it
    is unavailable.
*/
function openCommitContextMenu(commit, isHead, clientX, clientY) {
    var menu = $("#fileContextMenu").empty();
    var branchAttached = state.status && state.status.branch && !state.status.detached;

    menu.append(menuItem("Amend commit message…", function() {
        openAmendDialog(commit);
    }, {
        disabled: !(isHead && branchAttached),
        title: isHead ? "" : "Only the latest commit on a branch can be amended"
    }));

    menu.append(menuItem("Reset to commit…", function() {
        openResetDialog(commit);
    }, { disabled: !branchAttached, title: branchAttached ? "" : "Check out a branch first" }));

    menu.append(menuItem("Checkout commit", function() {
        commitAction("checkout", { hash: commit.hash }, "Checking out…");
    }, { disabled: isHead }));

    //Interactive rebase is not available through go-git
    menu.append(menuItem("Reorder commit", null, {
        disabled: true,
        title: "Reordering commits is not supported"
    }));

    menu.append(menuItem("Revert changes in commit", function() {
        confirmDialog("Revert this commit?",
            "A new commit will be created that undoes the changes in \"" + commit.subject + "\".",
            function() {
                commitAction("revert", { hash: commit.hash }, "Reverting…");
            });
    }));

    menu.append(menuDivider());

    menu.append(menuItem("Create branch from commit", function() {
        openBranchFromCommitDialog(commit);
    }));

    menu.append(menuItem("Create Tag…", function() {
        openCreateTagDialog(commit);
    }));

    menu.append(menuItem("Cherry-pick commit…", function() {
        confirmDialog("Cherry-pick this commit?",
            "The changes in \"" + commit.subject + "\" will be applied on top of your current branch.",
            function() {
                commitAction("cherrypick", { hash: commit.hash }, "Cherry-picking…");
            });
    }, { disabled: isHead, title: isHead ? "This commit is already the branch tip" : "" }));

    menu.append(menuDivider());

    menu.append(menuItem("Copy SHA", function() {
        copyToClipboard(commit.hash, "commit SHA");
    }, { title: commit.hash }));

    var tag = (commit.tags && commit.tags.length > 0) ? commit.tags[0] : "";
    menu.append(menuItem(tag ? "Copy tag (" + tag + ")" : "Copy tag", function() {
        copyToClipboard(tag, "tag name");
    }, { disabled: tag === "" }));

    var webUrl = commitWebUrl(commit.hash);
    menu.append(menuItem(webUrl ? "View on " + webUrl.host : "View on remote", function() {
        window.open(webUrl.url, "_blank", "noopener");
    }, { disabled: !webUrl, title: webUrl ? webUrl.url : "No web-viewable remote is configured" }));

    placeMenu(menu, clientX, clientY);
}

/* ── Commit action plumbing ───────────────────────────────────────────── */

//commitAction posts one commitaction.agi operation and refreshes on success.
function commitAction(operation, params, busyMessage, afterwards) {
    var payload = { opr: operation, repo: state.repo };
    for (var key in params) {
        if (params.hasOwnProperty(key)) {
            payload[key] = params[key];
        }
    }

    setBusy(busyMessage);
    call("commitaction.agi", payload, function(reply) {
        clearBusy();
        if (!reply.success) {
            setStatus(reply.error, true);
            return;
        }

        var outcome = reply.message || "Done";
        //A history action can move HEAD, change branch or rewrite commits, so
        //refresh both the working-tree status and the commit list.
        state.activeFile = null;
        refreshStatus(function() {
            loadHistory();
            setStatus(outcome);
        });

        if (typeof afterwards === "function") {
            afterwards(reply);
        }
    });
}

/*
    commitWebUrl turns the repository's first remote into a web URL for a commit,
    or null when there is no http/ssh remote to build one from. Host families
    that use a different commit path (GitLab) are handled explicitly; everything
    else falls back to the widespread "/commit/<sha>" convention.
*/
function commitWebUrl(hash) {
    if (!state.status || !state.status.remotes || state.status.remotes.length === 0) {
        return null;
    }
    var urls = state.status.remotes[0].urls;
    if (!urls || urls.length === 0) {
        return null;
    }

    var base = remoteToWebBase(urls[0]);
    if (!base) {
        return null;
    }

    var commitPath = base.host.indexOf("gitlab") !== -1 ? "/-/commit/" : "/commit/";
    return { host: base.host, url: base.url + commitPath + hash };
}

//remoteToWebBase normalises an https or scp-style git remote into a browsable
//https base URL and its host.
function remoteToWebBase(remoteUrl) {
    remoteUrl = (remoteUrl || "").trim();
    if (remoteUrl === "") {
        return null;
    }

    var host = "";
    var path = "";

    //Three remote forms: http(s) URL, ssh:// URL (may carry a :port before the
    //path), and scp-style git@host:path (the colon is the path separator, so it
    //has no port to strip).
    var httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/(.+)$/i);
    var sshUrlMatch = remoteUrl.match(/^ssh:\/\/(?:[^@]+@)?([^:/]+)(?::\d+)?\/(.+)$/i);
    var scpMatch = remoteUrl.match(/^(?:[^@]+@)?([^:/]+):(.+)$/i);

    if (httpsMatch) {
        host = httpsMatch[1].split("@").pop(); // drop any user:pass@ prefix
        path = httpsMatch[2];
    } else if (sshUrlMatch) {
        host = sshUrlMatch[1];
        path = sshUrlMatch[2];
    } else if (scpMatch) {
        host = scpMatch[1];
        path = scpMatch[2];
    } else {
        return null;
    }

    host = host.replace(/:\d+$/, "");                 // drop a port on http(s) hosts
    path = path.replace(/\.git$/i, "").replace(/\/+$/, "");
    return { host: host, url: "https://" + host + "/" + path };
}

/* ── Commit action dialogs ────────────────────────────────────────────── */

function openAmendDialog(commit) {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text("Amend commit message"));
    box.append($("<div class='desc'></div>").text(
        "This rewrites the latest commit's message. Its changes and author are kept."));

    var summary = $("<input type='text'>").val(commit.subject);
    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Message"))
        .append(summary));

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Amend</button>").on("click", function() {
        if (summary.val().trim() === "") {
            return;
        }
        closeModal();
        commitAction("amend", { message: summary.val().trim() }, "Amending…");
    }));
    box.append(actions);

    openModal(box);
    summary.trigger("focus");
}

function openResetDialog(commit) {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text("Reset to commit"));
    box.append($("<div class='desc'></div>").text(
        "Move the current branch back to \"" + commit.subject + "\" (" + commit.shortHash + ")."));

    //One radio group for the three reset modes, mixed selected by default
    var modes = [
        { value: "soft", label: "Soft — keep all changes staged" },
        { value: "mixed", label: "Mixed — keep changes, unstaged (default)" },
        { value: "hard", label: "Hard — discard all changes since this commit" }
    ];
    var group = $("<div class='field'></div>");
    modes.forEach(function(mode) {
        var id = "resetmode_" + mode.value;
        var row = $("<div class='field inline'></div>");
        var radio = $("<input type='radio' name='resetmode'>").attr("id", id).val(mode.value);
        if (mode.value === "mixed") {
            radio.prop("checked", true);
        }
        row.append(radio).append($("<label></label>").attr("for", id).text(mode.label));
        group.append(row);
    });
    box.append(group);

    var warning = $("<div class='modalerror hidden'></div>").text(
        "A hard reset permanently discards every change since the selected commit.");
    box.append(warning);
    group.find("input[type=radio]").on("change", function() {
        warning.toggleClass("hidden", $("input[name=resetmode]:checked").val() !== "hard");
    });

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Reset</button>").on("click", function() {
        var mode = $("input[name=resetmode]:checked").val();
        closeModal();
        commitAction("reset", { hash: commit.hash, mode: mode }, "Resetting…");
    }));
    box.append(actions);

    openModal(box);
}

function openBranchFromCommitDialog(commit) {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text("Create a branch"));
    box.append($("<div class='desc'></div>").text(
        "The new branch will start at \"" + commit.subject + "\" (" + commit.shortHash + ")."));

    var name = $("<input type='text' placeholder='feature/my-change'>");
    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Branch name"))
        .append(name));

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Create branch</button>").on("click", function() {
        if (name.val().trim() === "") {
            return;
        }
        closeModal();
        commitAction("branch", { branch: name.val().trim(), hash: commit.hash }, "Creating branch…");
    }));
    box.append(actions);

    openModal(box);
    name.trigger("focus");
}

function openCreateTagDialog(commit) {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text("Create a tag"));
    box.append($("<div class='desc'></div>").text(
        "Tag \"" + commit.subject + "\" (" + commit.shortHash + ")."));

    var name = $("<input type='text' placeholder='v1.0.0'>");
    var message = $("<input type='text' placeholder='Optional annotation'>");

    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Tag name"))
        .append(name));
    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Message"))
        .append(message)
        .append($("<div class='hint'></div>").text(
            "Leave empty for a lightweight tag; add a message for an annotated one.")));

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Create tag</button>").on("click", function() {
        if (name.val().trim() === "") {
            return;
        }
        closeModal();
        commitAction("tag", {
            tag: name.val().trim(),
            hash: commit.hash,
            message: message.val().trim()
        }, "Creating tag…");
    }));
    box.append(actions);

    openModal(box);
    name.trigger("focus");
}

/* ── Commit ───────────────────────────────────────────────────────────── */

function doCommit() {
    var files = selectedFiles();
    var summary = $("#commitSummary").val().trim();

    if (files.length === 0 || summary === "") {
        return;
    }

    setBusy("Committing…");
    call("commit.agi", {
        opr: "commit",
        repo: state.repo,
        files: JSON.stringify(files),
        message: summary,
        body: $("#commitBody").val(),
        name: state.identity.name,
        email: state.identity.email
    }, function(reply) {
        clearBusy();
        if (!reply.success) {
            setStatus(reply.error, true);
            return;
        }

        $("#commitSummary").val("");
        $("#commitBody").val("");
        state.selected = {};
        state.activeFile = null;

        var shortHash = (reply.hash || "").substring(0, 7);
        refreshStatus(function() {
            setStatus("Committed " + shortHash);
        });
    });
}

/* ── Branch switcher ──────────────────────────────────────────────────── */

function loadBranches() {
    call("status.agi", { opr: "branches", repo: state.repo }, function(reply) {
        var list = $("#branchList").empty();

        if (!reply.success) {
            list.append($("<div class='popoveritem'></div>").text(reply.error));
            return;
        }
        if (reply.branches.length === 0) {
            list.append($("<div class='popoveritem'></div>").text("No branches yet"));
            return;
        }

        reply.branches.forEach(function(branch) {
            var item = $("<div class='popoveritem'></div>");
            if (branch.isCurrent) {
                item.addClass("active");
            }

            item.append($("<i class='code branch icon'></i>"));
            item.append($("<div class='maintext'></div>")
                .append($("<div class='name'></div>").text(branch.name))
                .append($("<div class='sub'></div>").text(branch.isRemote ? "remote" : "local")));

            item.on("click", function() {
                closePopovers();
                checkoutBranch(branch.name, false);
            });
            item.on("contextmenu", function(event) {
                event.preventDefault();
                event.stopPropagation();
                openBranchContextMenu(branch, event.clientX, event.clientY);
            });
            list.append(item);
        });
    });
}

/* ── Branch context menu ──────────────────────────────────────────────── */

/*
    openBranchContextMenu builds the right-click menu for one row of the branch
    dropdown. A local branch can be renamed or deleted locally; a remote-tracking
    row acts on the branch as it exists on the server, which means a network push
    and therefore the same credential retry flow as push and pull.
*/
function openBranchContextMenu(branch, clientX, clientY) {
    var menu = $("#fileContextMenu").empty();
    //The branch name without any remote prefix; the backend never wants the prefix
    var shortName = branch.short || branch.name;

    if (branch.isRemote) {
        var remote = branch.remote || "origin";

        menu.append(menuItem("Rename branch on " + remote + "…", function() {
            openBranchRenameDialog(branch, shortName, true);
        }));

        menu.append(menuItem("Delete branch on " + remote + "…", function() {
            confirmDialog("Delete " + branch.name + " on the remote?",
                "The branch will be removed from " + remote +
                " for everyone. Your local branches are not affected.",
                function() {
                    deleteRemoteBranch(remote, shortName);
                });
        }));
    } else {
        menu.append(menuItem("Rename branch…", function() {
            openBranchRenameDialog(branch, shortName, false);
        }));

        menu.append(menuItem("Delete branch…", function() {
            confirmDialog("Delete branch " + shortName + "?",
                "The local branch will be removed. Any branch of the same name on a remote is not affected.",
                function() {
                    deleteLocalBranch(shortName, false);
                });
        }, {
            disabled: branch.isCurrent,
            title: branch.isCurrent ? "Switch to another branch before deleting this one" : ""
        }));
    }

    menu.append(menuDivider());

    menu.append(menuItem("Copy branch name", function() {
        copyToClipboard(branch.name, "branch name");
    }, { title: branch.name }));

    placeMenu(menu, clientX, clientY);
}

/*
    deleteLocalBranch removes a local branch, and when the branch still holds
    unmerged commits asks for confirmation before repeating the call with force —
    the same protection `git branch -d` gives over `-D`.
*/
function deleteLocalBranch(branch, force) {
    setBusy("Deleting branch…");
    call("branchaction.agi", {
        opr: "delete",
        repo: state.repo,
        branch: branch,
        force: force ? "true" : "false"
    }, function(reply) {
        clearBusy();

        if (reply.success) {
            afterBranchChange(reply.message || "Deleted branch " + branch);
            return;
        }

        if (reply.unmerged) {
            confirmDialog("Delete " + branch + " anyway?",
                "This branch has commits that are not merged into your current branch. " +
                "Deleting it will lose them.",
                function() {
                    deleteLocalBranch(branch, true);
                });
            return;
        }
        setStatus(reply.error, true);
    });
}

//deleteRemoteBranch removes a branch on the server, retrying with credentials
//when the remote asks for them.
function deleteRemoteBranch(remote, branch, credentials) {
    var payload = {
        opr: "deleteremote",
        repo: state.repo,
        remote: remote,
        branch: branch
    };
    applyCredentials(payload, credentials);

    setBusy("Deleting " + remote + "/" + branch + "…");
    call("branchaction.agi", payload, function(reply) {
        clearBusy();

        if (reply.success) {
            afterBranchChange(reply.message || "Deleted " + remote + "/" + branch);
            return;
        }
        if (reply.authRequired) {
            openCredentialDialog(remoteUrlByName(remote), function(entered) {
                deleteRemoteBranch(remote, branch, entered);
            });
            return;
        }
        setStatus(reply.error, true);
    });
}

function renameLocalBranch(oldName, newName) {
    setBusy("Renaming branch…");
    call("branchaction.agi", {
        opr: "rename",
        repo: state.repo,
        branch: oldName,
        newName: newName
    }, function(reply) {
        clearBusy();
        if (!reply.success) {
            setStatus(reply.error, true);
            return;
        }
        afterBranchChange(reply.message || "Renamed to " + newName);
    });
}

function renameRemoteBranch(remote, oldName, newName, credentials) {
    var payload = {
        opr: "renameremote",
        repo: state.repo,
        remote: remote,
        branch: oldName,
        newName: newName
    };
    applyCredentials(payload, credentials);

    setBusy("Renaming " + remote + "/" + oldName + "…");
    call("branchaction.agi", payload, function(reply) {
        clearBusy();

        if (reply.success) {
            afterBranchChange(reply.message || "Renamed to " + remote + "/" + newName);
            return;
        }
        if (reply.authRequired) {
            openCredentialDialog(remoteUrlByName(remote), function(entered) {
                renameRemoteBranch(remote, oldName, newName, entered);
            });
            return;
        }
        setStatus(reply.error, true);
    });
}

//applyCredentials copies the sign-in dialog's answer onto a request payload.
function applyCredentials(payload, credentials) {
    if (!credentials) {
        return;
    }
    payload.username = credentials.username;
    payload.token = credentials.token;
    payload.remember = credentials.remember ? "true" : "false";
}

/*
    afterBranchChange refreshes everything a branch change can affect. Renaming or
    deleting the checked-out branch moves HEAD, so the toolbar, the changes list
    and the history all need rereading, and the branch dropdown is rebuilt if it
    is still open.
*/
function afterBranchChange(message) {
    state.activeFile = null;
    refreshStatus(function() {
        if (state.tab === "history") {
            loadHistory();
        }
        if ($("#branchPopover").hasClass("open")) {
            loadBranches();
        }
        setStatus(message);
    });
}

function openBranchRenameDialog(branch, shortName, isRemote) {
    var remote = branch.remote || "origin";

    var box = $("<div></div>");
    box.append($("<h3></h3>").text(isRemote ? "Rename branch on " + remote : "Rename branch"));
    box.append($("<div class='desc'></div>").text(isRemote
        ? "The branch is pushed under the new name and the old name is then removed from " + remote + "."
        : "Renaming keeps the branch's commits and its upstream configuration."));

    var name = $("<input type='text'>").val(shortName);
    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("New name"))
        .append(name));

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Rename</button>").on("click", function() {
        var newName = name.val().trim();
        if (newName === "" || newName === shortName) {
            closeModal();
            return;
        }
        closeModal();

        if (isRemote) {
            renameRemoteBranch(remote, shortName, newName);
        } else {
            renameLocalBranch(shortName, newName);
        }
    }));
    box.append(actions);

    openModal(box);
    name.trigger("focus");
}

function checkoutBranch(branch, create) {
    setBusy("Switching branch…");
    call("branch.agi", {
        opr: create ? "create" : "checkout",
        repo: state.repo,
        branch: branch
    }, function(reply) {
        clearBusy();
        if (!reply.success) {
            setStatus(reply.error, true);
            return;
        }
        state.activeFile = null;
        refreshStatus(function() {
            setStatus("Now on " + branch);
        });
    });
}

/* ── Dialogs ──────────────────────────────────────────────────────────── */

function openModal(content) {
    $("#modalBox").empty().append(content);
    $("#modalMask").removeClass("hidden");
}

function closeModal() {
    $("#modalMask").addClass("hidden");
    $("#modalBox").empty();
}

function confirmDialog(title, message, onConfirm) {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text(title));
    box.append($("<div class='desc'></div>").text(message));

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Confirm</button>").on("click", function() {
        closeModal();
        onConfirm();
    }));
    box.append(actions);

    openModal(box);
}

/*
    openCredentialDialog asks for the HTTPS user name and token for a remote,
    then hands them back to whatever operation triggered the prompt.
*/
function openCredentialDialog(remoteURL, onSubmit) {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text("Sign in to the remote"));
    box.append($("<div class='desc'></div>").text(
        remoteURL ? "Authentication is required for " + remoteURL : "Authentication is required for this remote."));

    var user = $("<input type='text' autocomplete='username'>");
    var token = $("<input type='password' autocomplete='current-password'>");
    var remember = $("<input type='checkbox' id='rememberCredential'>");

    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Username"))
        .append(user));

    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Password or personal access token"))
        .append(token)
        .append($("<div class='hint'></div>").text(
            "Most hosts no longer accept account passwords over HTTPS — create a personal access token instead.")));

    box.append($("<div class='field inline'></div>")
        .append(remember)
        .append($("<label for='rememberCredential'></label>").text(
            "Remember this credential on the server (stored encrypted)")));

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));

    var submit = $("<button class='primary'>Sign in</button>").on("click", function() {
        if (token.val() === "") {
            return;
        }
        closeModal();
        onSubmit({
            username: user.val(),
            token: token.val(),
            remember: remember.prop("checked")
        });
    });
    actions.append(submit);
    box.append(actions);

    openModal(box);
    //Pre-fill the user name when a credential for this host is already stored
    if (remoteURL) {
        call("credentials.agi", { opr: "list" }, function(reply) {
            if (!reply.success) {
                return;
            }
            var host = hostOf(remoteURL);
            reply.credentials.forEach(function(credential) {
                if (credential.host === host && credential.username) {
                    user.val(credential.username);
                }
            });
        });
    }
    user.trigger("focus");
}

//hostOf mirrors the server side host extraction so the pre-fill lookup matches.
function hostOf(remoteURL) {
    var withoutScheme = remoteURL.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
    var withoutUser = withoutScheme.substring(withoutScheme.indexOf("@") + 1);
    var host = withoutUser.split("/")[0].split(":")[0];
    return host.toLowerCase();
}

function openCloneDialog() {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text("Clone a repository"));
    box.append($("<div class='desc'></div>").text(
        "The repository is cloned into a new folder inside your ArozOS storage."));

    var errorBox = $("<div class='modalerror hidden'></div>");
    box.append(errorBox);

    var url = $("<input type='text' placeholder='https://github.com/owner/repository.git'>");
    var parent = $("<input type='text' placeholder='user:/Desktop' readonly>").val("user:/Desktop");
    var folder = $("<input type='text' placeholder='repository'>");

    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Repository URL"))
        .append(url));

    var browse = $("<button><i class='folder open icon'></i>Browse</button>").on("click", function() {
        ao_module_openFileSelector(function(files) {
            if (files && files.length > 0) {
                parent.val(files[0].filepath);
            }
        }, "user:/", "folder", false);
    });

    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Parent folder"))
        .append($("<div class='pathfield'></div>").append(parent).append(browse)));

    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Folder name"))
        .append(folder)
        .append($("<div class='hint'></div>").text("Leave empty to use the repository name from the URL.")));

    //Derive a sensible folder name as the user types the URL
    url.on("input", function() {
        if (folder.data("touched")) {
            return;
        }
        folder.val(repoNameFromURL(url.val()));
    });
    folder.on("input", function() {
        folder.data("touched", true);
    });

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Clone</button>").on("click", function() {
        var name = folder.val().trim() || repoNameFromURL(url.val());
        if (url.val().trim() === "" || name === "") {
            errorBox.text("A repository URL and a folder name are both required.").removeClass("hidden");
            return;
        }

        var destination = parent.val().replace(/\/+$/, "") + "/" + name;
        closeModal();
        performClone(url.val().trim(), destination);
    }));
    box.append(actions);

    openModal(box);
    url.trigger("focus");
}

//repoNameFromURL turns a remote URL into the folder name git itself would use.
function repoNameFromURL(remoteURL) {
    var trimmed = remoteURL.trim().replace(/\/+$/, "");
    if (trimmed === "") {
        return "";
    }
    var last = trimmed.split("/").pop();
    last = last.split(":").pop();
    return last.replace(/\.git$/i, "");
}

function performClone(url, destination, credentials) {
    var payload = { opr: "clone", url: url, repo: destination };
    if (credentials) {
        payload.username = credentials.username;
        payload.token = credentials.token;
        payload.remember = credentials.remember ? "true" : "false";
    }

    setBusy("Cloning " + url + "…");
    call("transport.agi", payload, function(reply) {
        clearBusy();

        if (reply.success) {
            setStatus("Cloned into " + destination);
            call("repolist.agi", { opr: "add", path: destination }, function(added) {
                if (!added.success) {
                    setStatus(added.error, true);
                    return;
                }
                loadRepos(added.path);
            });
            return;
        }

        if (reply.authRequired) {
            openCredentialDialog(url, function(entered) {
                performClone(url, destination, entered);
            });
            return;
        }
        setStatus(reply.error, true);
    });
}

function openRemoteDialog() {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text("Add a remote"));
    box.append($("<div class='desc'></div>").text(
        "Point this repository at a remote so it can be pushed and pulled."));

    var url = $("<input type='text' placeholder='https://github.com/owner/repository.git'>");
    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Remote URL (origin)"))
        .append(url));

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Add remote</button>").on("click", function() {
        if (url.val().trim() === "") {
            return;
        }
        closeModal();

        setBusy("Adding remote…");
        call("transport.agi", {
            opr: "addremote",
            repo: state.repo,
            remote: "origin",
            url: url.val().trim()
        }, function(reply) {
            clearBusy();
            if (!reply.success) {
                setStatus(reply.error, true);
                return;
            }
            refreshStatus(function() {
                setStatus("Remote added");
            });
        });
    }));
    box.append(actions);

    openModal(box);
    url.trigger("focus");
}

function renderIdentity() {
    var name = state.identity.name || state.username || "?";
    $("#commitAvatar")
        .text(name.substring(0, 1))
        .attr("title", "Committing as " + name + (state.identity.email ? " <" + state.identity.email + ">" : "") +
            " — click to change");
}

function openIdentityDialog() {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text("Commit author"));
    box.append($("<div class='desc'></div>").text(
        "This name and address are recorded in every commit you make from GitApp."));

    var name = $("<input type='text' placeholder='Your name'>").val(state.identity.name || state.username);
    var email = $("<input type='text' placeholder='you@example.com'>").val(state.identity.email);

    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Name"))
        .append(name));
    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Email address"))
        .append(email)
        .append($("<div class='hint'></div>").text(
            "Leave empty to use a local placeholder address.")));

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Save</button>").on("click", function() {
        if (name.val().trim() === "") {
            return;
        }
        closeModal();

        call("repolist.agi", {
            opr: "setidentity",
            name: name.val().trim(),
            email: email.val().trim()
        }, function(reply) {
            if (!reply.success) {
                setStatus(reply.error, true);
                return;
            }
            state.identity = reply.identity;
            renderIdentity();
            setStatus("Commit author updated");
        });
    }));
    box.append(actions);

    openModal(box);
    name.trigger("focus");
}

function openNewBranchDialog() {
    var box = $("<div></div>");
    box.append($("<h3></h3>").text("Create a branch"));
    box.append($("<div class='desc'></div>").text(
        "The new branch starts at the commit you currently have checked out."));

    var name = $("<input type='text' placeholder='feature/my-change'>");
    box.append($("<div class='field'></div>")
        .append($("<label></label>").text("Branch name"))
        .append(name));

    var actions = $("<div class='modalactions'></div>");
    actions.append($("<button>Cancel</button>").on("click", closeModal));
    actions.append($("<button class='primary'>Create branch</button>").on("click", function() {
        if (name.val().trim() === "") {
            return;
        }
        closeModal();
        checkoutBranch(name.val().trim(), true);
    }));
    box.append(actions);

    openModal(box);
    name.trigger("focus");
}

function pickExistingRepo() {
    closePopovers();
    ao_module_openFileSelector(function(files) {
        if (!files || files.length === 0) {
            return;
        }

        var chosen = files[0].filepath;
        call("repolist.agi", { opr: "add", path: chosen }, function(reply) {
            if (!reply.success) {
                setStatus(reply.error, true);
                return;
            }
            setStatus("Added " + reply.path);
            loadRepos(reply.path);
        });
    }, "user:/", "folder", false);
}

function initNewRepo() {
    closePopovers();
    ao_module_openFileSelector(function(files) {
        if (!files || files.length === 0) {
            return;
        }

        var chosen = files[0].filepath;
        setBusy("Creating repository…");
        call("branch.agi", { opr: "init", repo: chosen }, function(reply) {
            clearBusy();
            if (!reply.success) {
                setStatus(reply.error, true);
                return;
            }
            call("repolist.agi", { opr: "add", path: chosen }, function(added) {
                if (!added.success) {
                    setStatus(added.error, true);
                    return;
                }
                setStatus("Created a repository in " + chosen);
                loadRepos(added.path);
            });
        });
    }, "user:/", "folder", false);
}

/* ── Popovers and tabs ────────────────────────────────────────────────── */

function closePopovers() {
    $(".popover").removeClass("open");
}

/*
    togglePopover opens a dropdown aligned to the toolbar button that owns it.

    The position is measured when the popover opens rather than hardcoded,
    because the toolbar cells are flexible: they shrink on a narrow window, so
    any fixed offset drifts out of alignment.
*/
function togglePopover(selector, anchorSelector, beforeOpen) {
    var popover = $(selector);
    var wasOpen = popover.hasClass("open");
    closePopovers();

    if (wasOpen) {
        return;
    }

    if (typeof beforeOpen === "function") {
        beforeOpen();
    }

    var anchor = $(anchorSelector);
    var left = anchor.position().left;

    //Keep the whole popover on screen when its button sits near the right edge
    var overflow = left + popover.outerWidth() - $(window).width();
    if (overflow > 0) {
        left = Math.max(0, left - overflow);
    }

    popover.css({
        left: left + "px",
        top: anchor.outerHeight() + "px"
    }).addClass("open");
}

/* ── Pane splitters ───────────────────────────────────────────────────── */

var SIDEBAR_MIN_WIDTH = 220;
var SIDEBAR_DEFAULT_WIDTH = 300;
var SIDEBAR_WIDTH_KEY = "gitapp-sidebar-width";

var COMMITFILES_MIN_WIDTH = 160;
var COMMITFILES_DEFAULT_WIDTH = 260;
var COMMITFILES_WIDTH_KEY = "gitapp-commitfiles-width";

//clampPaneWidth keeps a pane usable and always leaves room for the diff.
function clampPaneWidth(width, minimumWidth) {
    var maximum = Math.max(minimumWidth, Math.round($(window).width() * 0.7));
    return Math.min(Math.max(Math.round(width), minimumWidth), maximum);
}

function applySidebarWidth(width) {
    $(".sidebar").css("flex-basis", clampPaneWidth(width, SIDEBAR_MIN_WIDTH) + "px");
}

function applyCommitFilesWidth(width) {
    $("#commitFilePane").css("flex-basis", clampPaneWidth(width, COMMITFILES_MIN_WIDTH) + "px");
}

/*
    setupPaneSplitter wires one drag handle to the pane on its left.

    Both the sidebar and the History tab's committed file column are resized the
    same way, so the behaviour — drag, double click to restore, remember the
    width — lives here once and is instantiated per handle.
*/
function setupPaneSplitter(options) {
    var handle = $(options.handle);
    var pane = $(options.pane);

    var stored = parseInt(localStorage.getItem(options.storageKey), 10);
    options.apply(isNaN(stored) ? options.defaultWidth : stored);

    var dragging = false;

    function moveTo(clientX) {
        //The pane may not start at x=0 once the window is scrolled or embedded,
        //so measure against its own left edge.
        options.apply(clientX - pane.offset().left);
    }

    function currentWidth() {
        return parseInt(pane.css("flex-basis"), 10);
    }

    handle.on("mousedown", function(event) {
        event.preventDefault();
        dragging = true;
        handle.addClass("dragging");
        $("body").addClass("resizing");
        closePopovers();
        closeContextMenu();
    });

    //Bound on the document so the drag survives the pointer outrunning the
    //1px handle.
    $(document).on("mousemove", function(event) {
        if (dragging) {
            moveTo(event.clientX);
        }
    });

    $(document).on("mouseup", function() {
        if (!dragging) {
            return;
        }
        dragging = false;
        handle.removeClass("dragging");
        $("body").removeClass("resizing");
        localStorage.setItem(options.storageKey, currentWidth());
    });

    //Double click restores the default, matching the usual splitter convention
    handle.on("dblclick", function() {
        options.apply(options.defaultWidth);
        localStorage.setItem(options.storageKey, options.defaultWidth);
    });

    //A window that shrank below the stored width must not hide the diff pane
    $(window).on("resize", function() {
        options.apply(currentWidth());
    });
}

function setupSplitter() {
    setupPaneSplitter({
        handle: "#splitter",
        pane: ".sidebar",
        storageKey: SIDEBAR_WIDTH_KEY,
        defaultWidth: SIDEBAR_DEFAULT_WIDTH,
        apply: applySidebarWidth
    });

    setupPaneSplitter({
        handle: "#commitFileSplitter",
        pane: "#commitFilePane",
        storageKey: COMMITFILES_WIDTH_KEY,
        defaultWidth: COMMITFILES_DEFAULT_WIDTH,
        apply: applyCommitFilesWidth
    });
}

function switchTab(tab) {
    state.tab = tab;
    $(".tabs .tab").removeClass("active");
    $(".tabs .tab[data-tab='" + tab + "']").addClass("active");

    $("#changesPane").toggleClass("hidden", tab !== "changes");
    $("#historyPane").toggleClass("hidden", tab !== "history");

    //The committed file column belongs to the History tab only; the Changes tab
    //already lists its files in the sidebar.
    $("#commitFilePane").toggleClass("hidden", tab !== "history");
    $("#commitFileSplitter").toggleClass("hidden", tab !== "history");

    if (tab === "history") {
        loadHistory();
    } else {
        state.activeCommit = null;
        state.activeCommitFile = null;
        renderCommitFiles([]);
        renderStatus();
    }
}

/* ── Changed file context menu ────────────────────────────────────────── */

/*
    Submenu open/close is deliberately delayed.

    Reaching a submenu means travelling diagonally across the rows below its
    parent, and closing on the first foreign hover would snatch the submenu away
    mid-journey. The close is therefore scheduled and cancelled again as soon as
    the pointer lands on either the parent row or the submenu itself.
*/
var submenuCloseTimer = null;
var submenuOwner = null;

function cancelSubmenuClose() {
    if (submenuCloseTimer !== null) {
        clearTimeout(submenuCloseTimer);
        submenuCloseTimer = null;
    }
}

function scheduleSubmenuClose() {
    cancelSubmenuClose();
    submenuCloseTimer = setTimeout(function() {
        submenuCloseTimer = null;
        submenuOwner = null;
        $("#fileContextSubmenu").removeClass("open").empty();
        $("#fileContextMenu .item").removeClass("hot");
    }, 320);
}

function closeContextMenu() {
    cancelSubmenuClose();
    submenuOwner = null;
    $("#fileContextMenu, #fileContextSubmenu").removeClass("open").empty();
}

//menuItem builds one row, optionally carrying a submenu chevron.
function menuItem(label, action, options) {
    options = options || {};

    var item = $("<div class='item'></div>");
    item.append($("<div class='label'></div>").text(label));
    if (options.title) {
        item.attr("title", options.title);
    }
    if (options.submenu) {
        item.append($("<div class='chevron'></div>"));
    }
    if (options.disabled) {
        item.addClass("disabled");
        //Even a dead row must call off a pending close, or crossing it on the
        //way to the submenu would still lose it.
        item.on("mouseenter", cancelSubmenuClose);
        return item;
    }

    if (options.submenu) {
        var openOwnSubmenu = function() {
            cancelSubmenuClose();
            $("#fileContextMenu .item").removeClass("hot");
            item.addClass("hot");

            //Re-entering the same parent must not rebuild what is already shown
            if (submenuOwner !== label) {
                submenuOwner = label;
                openContextSubmenu(item, options.submenu);
            }
        };

        item.on("mouseenter", openOwnSubmenu);
        //Clicking the parent opens it too, for anyone who does not hover
        item.on("click", function(event) {
            event.stopPropagation();
            openOwnSubmenu();
        });
    } else {
        item.on("mouseenter", function() {
            $("#fileContextMenu .item").removeClass("hot");
            if (submenuOwner !== null) {
                scheduleSubmenuClose();
            }
        });
        item.on("click", function() {
            closeContextMenu();
            action();
        });
    }
    return item;
}

function menuDivider() {
    return $("<div class='divider'></div>");
}

// placeMenu positions a menu at a point, flipping it when it would fall off screen.
function placeMenu(menu, left, top) {
    menu.addClass("open").css({ left: "0px", top: "0px" });

    var width = menu.outerWidth();
    var height = menu.outerHeight();

    if (left + width > $(window).width()) {
        left = Math.max(0, left - width);
    }
    if (top + height > $(window).height()) {
        top = Math.max(0, $(window).height() - height);
    }
    menu.css({ left: left + "px", top: top + "px" });
}

function openContextSubmenu(parentItem, entries) {
    var submenu = $("#fileContextSubmenu").empty();

    entries.forEach(function(entry) {
        var row = $("<div class='item'></div>")
            .append($("<div class='label'></div>").text(entry.label));
        if (entry.title) {
            row.attr("title", entry.title);
        }
        row.on("click", function() {
            closeContextMenu();
            entry.action();
        });
        submenu.append(row);
    });

    //The pointer living inside the submenu keeps it alive; leaving starts the
    //same grace period as leaving the parent row.
    submenu.off("mouseenter mouseleave")
        .on("mouseenter", cancelSubmenuClose)
        .on("mouseleave", scheduleSubmenuClose);

    var anchor = parentItem[0].getBoundingClientRect();
    var menu = $("#fileContextMenu")[0].getBoundingClientRect();

    //Open to the right of the parent menu, overlapping by a couple of pixels so
    //there is no dead gap to cross. If that would run off screen, flip to the
    //left of the whole menu rather than on top of it.
    submenu.addClass("open").css({ left: "0px", top: "0px" });

    var left = menu.right - 2;
    if (left + submenu.outerWidth() > $(window).width()) {
        left = Math.max(0, menu.left - submenu.outerWidth() + 2);
    }

    var top = anchor.top - 4;
    if (top + submenu.outerHeight() > $(window).height()) {
        top = Math.max(0, $(window).height() - submenu.outerHeight());
    }

    submenu.css({ left: left + "px", top: top + "px" });
}

/*
    openFileContextMenu builds the right click menu for one changed file.

    The entries mirror GitHub Desktop, with the three "open with" actions mapped
    onto their ArozOS equivalents: the File Manager stands in for the OS file
    browser, and Code Studio for a desktop editor.
*/
function openFileContextMenu(change, clientX, clientY) {
    var menu = $("#fileContextMenu").empty();
    var repoPath = state.repo;
    var relativePath = change.path;
    var fullPath = joinVirtualPath(repoPath, relativePath);

    menu.append(menuItem("Discard changes…", function() {
        discardFiles([relativePath]);
    }));

    menu.append(menuDivider());

    menu.append(menuItem("Ignore file (add to .gitignore)", function() {
        addIgnoreRules(["/" + relativePath]);
    }, { title: "/" + relativePath }));

    var folders = ancestorFolders(relativePath);
    menu.append(menuItem("Ignore folder (add to .gitignore)", null, {
        submenu: folders.map(function(folder) {
            return {
                label: folder,
                title: folder,
                action: function() {
                    addIgnoreRules([folder]);
                }
            };
        }),
        disabled: folders.length === 0
    }));

    var extension = fileExtension(relativePath);
    menu.append(menuItem(
        extension ? "Ignore all " + extension + " files (add to .gitignore)" : "Ignore all files of this type",
        function() {
            addIgnoreRules(["*" + extension]);
        },
        { disabled: extension === "" }));

    menu.append(menuDivider());

    menu.append(menuItem("Copy file path", function() {
        copyToClipboard(fullPath, "file path");
    }, { title: fullPath }));

    menu.append(menuItem("Copy relative file path", function() {
        copyToClipboard(relativePath, "relative file path");
    }, { title: relativePath }));

    menu.append(menuDivider());

    //A deleted file has nothing left on disk to open
    var missing = change.status === "deleted";

    menu.append(menuItem("Show in File Manager", function() {
        ao_module_openPath(parentVirtualPath(fullPath));
    }));

    menu.append(menuItem("Open in Code Studio", function() {
        openInCodeStudio(repoPath, fullPath);
    }, { disabled: missing }));

    menu.append(menuItem("Open with default program", function() {
        openWithDefaultProgram(fullPath);
    }, { disabled: missing }));

    placeMenu(menu, clientX, clientY);
}

/* ── Context menu actions ─────────────────────────────────────────────── */

function discardFiles(files) {
    confirmDialog("Discard changes?",
        files.length === 1
            ? "The changes to " + files[0] + " will be lost. This cannot be undone."
            : "The changes to " + files.length + " files will be lost. This cannot be undone.",
        function() {
            setBusy("Discarding…");
            call("commit.agi", {
                opr: "discard",
                repo: state.repo,
                files: JSON.stringify(files)
            }, function(reply) {
                clearBusy();
                if (!reply.success) {
                    setStatus(reply.error, true);
                    return;
                }
                files.forEach(function(file) {
                    delete state.selected[file];
                });
                state.activeFile = null;
                refreshStatus(function() {
                    setStatus("Discarded changes to " + files.join(", "));
                });
            });
        });
}

function addIgnoreRules(patterns) {
    setBusy("Updating .gitignore…");
    call("ignore.agi", {
        repo: state.repo,
        patterns: JSON.stringify(patterns)
    }, function(reply) {
        clearBusy();
        if (!reply.success) {
            setStatus(reply.error, true);
            return;
        }

        //An ignored file leaves the changes list, so the selection may be stale
        patterns.forEach(function() {
            state.activeFile = null;
        });
        refreshStatus(function() {
            setStatus(reply.message || "Updated .gitignore");
        });
    });
}

/*
    copyToClipboard works on plain HTTP too.

    navigator.clipboard is only exposed in secure contexts, and ArozOS is
    routinely reached over http on a LAN, so the temporary textarea fallback is
    the path that actually runs for most users.
*/
function copyToClipboard(text, what) {
    function report(ok) {
        setStatus(ok ? "Copied the " + what : "Could not copy the " + what, !ok);
    }

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function() {
            report(true);
        }, function() {
            report(legacyCopy(text));
        });
        return;
    }
    report(legacyCopy(text));
}

/*
    legacyCopy copies through a throwaway textarea.

    It only succeeds while a user gesture is being handled, which is why it is
    always reached from a menu item's click handler. The textarea is marked
    readonly and parked off screen so mobile browsers neither scroll to it nor
    raise the on-screen keyboard.
*/
function legacyCopy(text) {
    var holder = $("<textarea readonly></textarea>")
        .val(text)
        .css({ position: "fixed", top: "-1000px", left: "-1000px", opacity: 0 })
        .appendTo("body");

    holder[0].select();
    //select() alone is ignored by iOS Safari
    if (holder[0].setSelectionRange) {
        holder[0].setSelectionRange(0, text.length);
    }

    var copied = false;
    try {
        copied = document.execCommand("copy");
    } catch (e) {
        copied = false;
    }
    holder.remove();
    return copied;
}

function openInCodeStudio(repoPath, filePath) {
    //Code Studio restores its workspace from a state object in the URL hash:
    //the repository opens as the project folder with the file already loaded.
    var launchState = encodeURIComponent(JSON.stringify({
        folder: repoPath,
        files: [filePath]
    }));

    if (ao_module_virtualDesktop) {
        parent.newFloatWindow({
            url: "Code Studio/index.html#" + launchState,
            width: 1024,
            height: 768,
            appicon: "Code Studio/img/module_icon.png",
            title: "Code Studio"
        });
    } else {
        window.open(ao_root + "Code Studio/index.html#" + launchState);
    }
}

/*
    openWithDefaultProgram asks the system which module handles this extension
    and launches it, falling back to the opener picker when nothing is assigned
    — the same flow the File Manager uses.
*/
function openWithDefaultProgram(filePath) {
    var descriptor = [{
        filepath: filePath,
        filename: filePath.split("/").pop()
    }];

    $.ajax({
        url: ao_root + "system/modules/getDefault",
        method: "GET",
        data: { opr: "launch", ext: fileExtension(filePath), mode: "launch" },
        success: function(module) {
            if (!module || module.error !== undefined) {
                launchWindow("SystemAO/file_system/defaultOpener.html",
                    encodeURIComponent(JSON.stringify(descriptor[0])),
                    "Select an opener", "SystemAO/file_system/img/opener.png", [320, 510]);
                return;
            }

            var url = module.StartDir;
            var size = [undefined, undefined];
            if (module.SupportFW === true && module.LaunchFWDir != "") {
                url = module.LaunchFWDir;
                if (module.InitFWSize !== null) {
                    size = module.InitFWSize;
                }
            }
            if (module.SupportEmb === true && module.LaunchEmb != "") {
                url = module.LaunchEmb;
                if (module.InitEmbSize !== null) {
                    size = module.InitEmbSize;
                }
            }

            launchWindow(url, encodeURIComponent(JSON.stringify(descriptor)),
                module.Name, module.IconPath || "img/system/favicon.png", size);
        },
        error: function() {
            setStatus("Cannot look up the default program for this file", true);
        }
    });
}

function launchWindow(url, hash, title, icon, size) {
    if (ao_module_virtualDesktop) {
        parent.newFloatWindow({
            url: url + "#" + hash,
            width: size[0],
            height: size[1],
            appicon: icon,
            title: title
        });
    } else {
        window.open(ao_root + url + "#" + hash);
    }
}

/* ── Path helpers ─────────────────────────────────────────────────────── */

//joinVirtualPath appends a repository relative path to the repository vpath.
function joinVirtualPath(repoPath, relativePath) {
    return repoPath.replace(/\/+$/, "") + "/" + relativePath.replace(/^\/+/, "");
}

//parentVirtualPath drops the last segment, e.g. for opening a file's folder.
function parentVirtualPath(vpath) {
    var segments = vpath.split("/");
    segments.pop();
    return segments.join("/");
}

/*
    ancestorFolders lists the folders a file sits in, deepest first, formatted as
    root anchored gitignore rules. "src/mod/agi/file.go" yields
    ["/src/mod/agi", "/src/mod", "/src"]; a file at the repository root has none.
*/
function ancestorFolders(relativePath) {
    var segments = relativePath.split("/");
    segments.pop();

    var folders = [];
    while (segments.length > 0) {
        folders.push("/" + segments.join("/"));
        segments.pop();
    }
    return folders;
}

//fileExtension returns the extension including the dot, or "" when there is none.
function fileExtension(path) {
    var name = path.split("/").pop();
    var dot = name.lastIndexOf(".");

    //A leading dot means a dotfile such as .gitignore, not an extension
    if (dot <= 0) {
        return "";
    }
    return name.substring(dot);
}

/* ── Theme ────────────────────────────────────────────────────────────── */

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
}

/* ── Startup ──────────────────────────────────────────────────────────── */

$(document).ready(function() {
    //Toolbar
    $("#repoPicker").on("click", function() {
        togglePopover("#repoPopover", "#repoPicker");
    });
    $("#branchPicker").on("click", function() {
        if (!state.repo) {
            return;
        }
        togglePopover("#branchPopover", "#branchPicker", loadBranches);
    });
    $("#remoteAction").on("click", onRemoteAction);
    $("#refreshButton").on("click", function() {
        if (state.tab === "history") {
            loadHistory();
        } else {
            refreshStatus();
        }
    });

    //Popover actions
    $("#cloneButton").on("click", function() {
        closePopovers();
        openCloneDialog();
    });
    $("#addRepoButton").on("click", pickExistingRepo);
    $("#initRepoButton").on("click", initNewRepo);
    $("#newBranchButton").on("click", function() {
        closePopovers();
        openNewBranchDialog();
    });
    $("#emptyCloneButton").on("click", openCloneDialog);
    $("#emptyAddButton").on("click", pickExistingRepo);

    //Tabs
    $(".tabs .tab").on("click", function() {
        switchTab($(this).attr("data-tab"));
    });

    //Changes list
    $("#selectAll").on("click", function() {
        var checked = $("#selectAll").prop("checked");
        if (state.status) {
            state.status.changes.forEach(function(change) {
                state.selected[change.path] = checked;
            });
        }
        renderFileList();
        updateCommitButton();
    });

    $("#commitSummary").on("input", updateCommitButton);
    $("#commitButton").on("click", doCommit);

    //Dismiss popovers and the context menu when clicking elsewhere
    $(document).on("click", function(event) {
        if ($(event.target).closest(".popover, #repoPicker, #branchPicker").length === 0) {
            closePopovers();
        }
        if ($(event.target).closest(".contextmenu").length === 0) {
            closeContextMenu();
        }
    });

    //A right click anywhere other than a file row dismisses the menu, and the
    //browser's own menu stays suppressed inside ours
    $(document).on("contextmenu", function(event) {
        if ($(event.target).closest(".contextmenu").length > 0) {
            event.preventDefault();
            return;
        }
        //The file rows and the commit entries open their own menus; a right
        //click anywhere else dismisses whatever is open.
        if ($(event.target).closest(".filerow, .commitentry").length === 0) {
            closeContextMenu();
        }
    });

    $("#fileList, #commitList, #branchList, #repoList").on("scroll", closeContextMenu);
    $(window).on("blur", closeContextMenu);
    $("#modalMask").on("click", function(event) {
        if (event.target === this) {
            closeModal();
        }
    });
    $(document).on("keydown", function(event) {
        if (event.key === "Escape") {
            closeModal();
            closePopovers();
            closeContextMenu();
        }
    });

    setupSplitter();

    //The avatar doubles as the entry point to the author identity settings
    $("#commitAvatar").on("click", openIdentityDialog);

    //Follow the ArozOS system theme
    ao_module_onThemeChanged(applyTheme);
    ao_module_getSystemThemeColor(function(theme) {
        applyTheme(theme === "darkTheme" ? "dark" : "light");
    });

    ao_module_setWindowTitle("GitApp");
    loadRepos();
});
