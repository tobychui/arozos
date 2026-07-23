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
        //the left and the file name always stays visible.
        var label = $("<div class='fname'></div>").attr("title", change.path).text(change.path);

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

    state.commits.forEach(function(commit) {
        var entry = $("<div class='commitentry'></div>");
        if (commit.hash === state.activeCommit) {
            entry.addClass("active");
        }

        entry.append($("<div class='subject'></div>").text(commit.subject));
        entry.append($("<div class='meta'></div>").text(
            commit.authorName + " · " + formatTime(commit.timestamp) + " · " + commit.shortHash));

        entry.on("click", function() {
            selectCommit(commit.hash);
        });
        list.append(entry);
    });
}

function selectCommit(hash) {
    state.activeCommit = hash;
    renderCommitList();

    call("status.agi", { opr: "commitfiles", repo: state.repo, hash: hash }, function(reply) {
        if (!reply.success) {
            renderDiffMessage("Cannot read this commit", reply.error);
            return;
        }

        if (reply.files.length === 0) {
            renderDiffMessage("Empty commit", "This commit does not touch any file.");
            return;
        }

        //Show the commit's file list, then open the first file's diff
        $("#diffPath").text(reply.files.length + " changed file" + (reply.files.length === 1 ? "" : "s"));
        var actions = $("#diffActions").empty();
        reply.files.forEach(function(file) {
            var button = $("<button></button>").text(file.path.split("/").pop()).attr("title", file.path);
            button.on("click", function() {
                showCommitDiff(hash, file.path, file.preview);
            });
            actions.append(button);
        });

        showCommitDiff(hash, reply.files[0].path, reply.files[0].preview);
    });
}

function formatTime(unixSeconds) {
    var date = new Date(unixSeconds * 1000);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
            list.append(item);
        });
    });
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

/* ── Sidebar splitter ─────────────────────────────────────────────────── */

var SIDEBAR_MIN_WIDTH = 220;
var SIDEBAR_DEFAULT_WIDTH = 300;
var SIDEBAR_WIDTH_KEY = "gitapp-sidebar-width";

//clampSidebarWidth keeps the sidebar usable and always leaves room for the diff.
function clampSidebarWidth(width) {
    var maximum = Math.max(SIDEBAR_MIN_WIDTH, Math.round($(window).width() * 0.7));
    return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), maximum);
}

function applySidebarWidth(width) {
    $(".sidebar").css("flex-basis", clampSidebarWidth(width) + "px");
}

function setupSplitter() {
    var stored = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
    applySidebarWidth(isNaN(stored) ? SIDEBAR_DEFAULT_WIDTH : stored);

    var dragging = false;

    function moveTo(clientX) {
        //The workspace may not start at x=0 once the window is scrolled or
        //embedded, so measure against its own left edge.
        var origin = $(".workspace").offset().left;
        applySidebarWidth(clientX - origin);
    }

    $("#splitter").on("mousedown", function(event) {
        event.preventDefault();
        dragging = true;
        $("#splitter").addClass("dragging");
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
        $("#splitter").removeClass("dragging");
        $("body").removeClass("resizing");
        localStorage.setItem(SIDEBAR_WIDTH_KEY, parseInt($(".sidebar").css("flex-basis"), 10));
    });

    //Double click restores the default, matching the usual splitter convention
    $("#splitter").on("dblclick", function() {
        applySidebarWidth(SIDEBAR_DEFAULT_WIDTH);
        localStorage.setItem(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH);
    });

    //A window that shrank below the stored width must not hide the diff pane
    $(window).on("resize", function() {
        applySidebarWidth(parseInt($(".sidebar").css("flex-basis"), 10));
    });
}

function switchTab(tab) {
    state.tab = tab;
    $(".tabs .tab").removeClass("active");
    $(".tabs .tab[data-tab='" + tab + "']").addClass("active");

    $("#changesPane").toggleClass("hidden", tab !== "changes");
    $("#historyPane").toggleClass("hidden", tab !== "history");

    if (tab === "history") {
        loadHistory();
    } else {
        state.activeCommit = null;
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
        if ($(event.target).closest(".filerow").length === 0) {
            closeContextMenu();
        }
    });

    $("#fileList").on("scroll", closeContextMenu);
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
