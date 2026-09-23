/*
    Code Studio — source control

    Talks to backend/git.agi, which wraps the git AGI library (go-git —
    no git binary is needed on the host). The view mirrors the working
    tree of whatever project folder is open in the explorer.
*/

var csGitStatus = null;         //Last status snapshot, or null when not a repository
var csGitOuterRoot = "";        //Repository the project folder sits inside, if any
var csGitBusy = false;
var csGitAuthRetry = null;      //Operation to retry once the user has signed in

function gitcall(operation, data, callback){
    var payload = { opr: operation, repo: currentProjectFolder };
    for (var key in data){ payload[key] = data[key]; }

    $.ajax({
        url: "../system/ajgi/interface?script=Code Studio/backend/git.agi",
        method: "POST",
        data: payload,
        dataType: "json",
        success: function(response){ callback(response); },
        error: function(){ callback({ success: false, error: "Source control backend is unreachable" }); }
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Status
   ═══════════════════════════════════════════════════════════════════ */

function refreshGitStatus(){
    if (!currentProjectFolder){
        csGitStatus = null;
        $("#scmBadge").hide();
        $("#sbBranch").hide();
        $("#scmBody").html('<div class="emptyhint">Open a project folder to see its repository.</div>');
        return;
    }

    gitcall("status", {}, function(response){
        if (!response.success){
            csGitStatus = null;
            csGitOuterRoot = response.outerRoot || "";
            $("#scmBadge").hide();
            $("#sbBranch").hide();
            renderNoRepository(response.error);
            return;
        }
        csGitOuterRoot = "";
        csGitStatus = response.status;
        renderScmView(csGitStatus);
        applyGitDecorations(csGitStatus);
    });
}

//Called after a save or a file open — cheap enough to just re-read the status
function refreshGitDecorations(){
    if (!currentProjectFolder || !csGitStatus) return;
    gitcall("status", {}, function(response){
        if (!response.success) return;
        csGitStatus = response.status;
        renderScmView(csGitStatus);
        applyGitDecorations(csGitStatus);
    });
}

function renderNoRepository(errorText){
    var isMissingRepo = !errorText || errorText.toLowerCase().indexOf("not a") !== -1 ||
                        errorText.toLowerCase().indexOf("repository") !== -1;

    var body = isMissingRepo ? 'This folder is not a git repository yet.' : escapeHTMLText(errorText);

    /*
        The opened folder can sit inside someone else's checkout. Source control
        deliberately stops at the project folder rather than reaching up into
        that repository, so say where it is and offer to open it properly.
    */
    if (csGitOuterRoot != ""){
        var outerName = csGitOuterRoot.split("/").filter(Boolean).pop();
        body += '<br><br>It is inside the repository <b>' + escapeHTMLText(outerName) + '</b> ' +
                '(<span style="word-break:break-all;">' + escapeHTMLText(csGitOuterRoot) + '</span>), ' +
                'which is outside this project folder.' +
                '<button class="btn block" onclick="openOuterRepositoryAsProject();">' +
                    '<i class="folder open outline icon"></i> Open ' + escapeHTMLText(outerName) + ' as project</button>';
    }

    $("#scmBody").html(
        '<div class="emptyhint">' + body +
            '<button class="btn block" onclick="initRepository();">' +
                '<i class="git icon"></i> Initialise Repository Here</button>' +
        '</div>');
}

//Reopen the enclosing checkout as the project, so its history is in scope
function openOuterRepositoryAsProject(){
    if (csGitOuterRoot == "") return;
    openProjectFolder([{
        filename: csGitOuterRoot.split("/").filter(Boolean).pop(),
        filepath: csGitOuterRoot
    }]);
}

function initRepository(){
    if (!currentProjectFolder) return;

    //Creating a repository inside another one is legal but rarely intended
    if (csGitOuterRoot != "" &&
        !confirm("This folder is inside the repository at:\n" + csGitOuterRoot +
                 "\n\nCreating a repository here nests one inside the other. Continue?")){
        return;
    }

    gitcall("init", {}, function(response){
        if (!response.success){
            alert(response.error || "Unable to create the repository");
            return;
        }
        csGitOuterRoot = "";
        setStatusMessage("check", "Repository created");
        refreshGitStatus();
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════════════ */

var CS_GIT_BADGE = {
    modified:   "M",
    added:      "A",
    deleted:    "D",
    renamed:    "R",
    copied:     "C",
    untracked:  "U",
    conflicted: "!"
};

function gitChangeRow(change, staged){
    var filename = change.path.split("/").pop();
    var folder = change.path.split("/").slice(0, -1).join("/");
    var badge = CS_GIT_BADGE[change.status] || "?";
    var encodedPath = encodeURIComponent(change.path);

    var buttons =
        '<span class="rowbtn" title="Open changes" onclick="event.stopPropagation(); openGitDiff(decodeURIComponent(\'' + encodedPath + '\'));">' +
            '<i class="columns icon"></i></span>';

    if (staged){
        buttons += '<span class="rowbtn" title="Unstage" onclick="event.stopPropagation(); gitUnstage([decodeURIComponent(\'' + encodedPath + '\')]);">' +
                       '<i class="minus icon"></i></span>';
    } else {
        buttons += '<span class="rowbtn" title="Discard changes" onclick="event.stopPropagation(); gitDiscard([decodeURIComponent(\'' + encodedPath + '\')]);">' +
                       '<i class="undo icon"></i></span>' +
                   '<span class="rowbtn" title="Stage" onclick="event.stopPropagation(); gitStage([decodeURIComponent(\'' + encodedPath + '\')]);">' +
                       '<i class="plus icon"></i></span>';
    }

    return '<div class="row" title="' + escapeHTMLText(change.path) + '" ' +
                'onclick="openGitFile(decodeURIComponent(\'' + encodedPath + '\'));">' +
                '<span class="name">' + escapeHTMLText(filename) + '</span>' +
                '<span class="sub">' + escapeHTMLText(folder) + '</span>' +
                buttons +
                '<span class="gitbadge ' + escapeHTMLText(change.status) + '">' + badge + '</span>' +
           '</div>';
}

function renderScmView(status){
    var staged = [];
    var unstaged = [];

    (status.changes || []).forEach(function(change){
        if (change.staged) staged.push(change);
        else unstaged.push(change);
    });

    var aheadBehind = "";
    if (status.ahead > 0) aheadBehind += '<span title="Commits to push"><i class="arrow up icon"></i>' + status.ahead + '</span> ';
    if (status.behind > 0) aheadBehind += '<span title="Commits to pull"><i class="arrow down icon"></i>' + status.behind + '</span>';
    if (aheadBehind == "") aheadBehind = '<span>' + (status.clean ? "Working tree clean" : "Uncommitted changes") + '</span>';

    var html =
        '<div class="scmbox">' +
            '<textarea id="commitMessage" placeholder="Message (commit on ' +
                escapeHTMLText(status.branch || "HEAD") + ')"></textarea>' +
            '<button class="btn primary block" id="commitButton" onclick="commitStagedChanges();"' +
                (staged.length == 0 ? " disabled" : "") + '>' +
                '<i class="check icon"></i> Commit' + (staged.length > 0 ? " " + staged.length + " file(s)" : "") +
            '</button>' +
        '</div>' +
        '<div class="scmstatus">' +
            '<i class="code branch icon"></i>' +
            '<span style="flex:1;">' + escapeHTMLText(status.branch || "detached HEAD") +
                (status.upstream ? ' <span style="opacity:.6;">→ ' + escapeHTMLText(status.upstream) + '</span>' : '') +
            '</span>' + aheadBehind +
        '</div>';

    if (staged.length > 0){
        html += '<div class="section">' +
                    '<div class="sectionhead" onclick="toggleSection(this);">' +
                        '<span class="caret"><i class="caret down icon"></i></span>' +
                        '<span class="label">Staged Changes</span>' +
                        '<span class="actions">' +
                            '<span class="iconbtn" title="Unstage all" onclick="event.stopPropagation(); gitUnstageAll();">' +
                                '<i class="minus icon"></i></span>' +
                        '</span>' +
                    '</div>' +
                    '<div class="sectionbody">' + staged.map(function(c){ return gitChangeRow(c, true); }).join("") + '</div>' +
                '</div>';
    }

    html += '<div class="section">' +
                '<div class="sectionhead" onclick="toggleSection(this);">' +
                    '<span class="caret"><i class="caret down icon"></i></span>' +
                    '<span class="label">Changes</span>' +
                    '<span class="actions">' +
                        '<span class="iconbtn" title="Stage all changes" onclick="event.stopPropagation(); gitStageAll();">' +
                            '<i class="plus icon"></i></span>' +
                    '</span>' +
                '</div>' +
                '<div class="sectionbody">' +
                    (unstaged.length > 0 ?
                        unstaged.map(function(c){ return gitChangeRow(c, false); }).join("") :
                        '<div class="emptyhint">No local changes.</div>') +
                '</div>' +
            '</div>';

    $("#scmBody").html(html);

    //Activity bar badge and status bar branch indicator
    var changeCount = (status.changes || []).length;
    $("#scmBadge").text(changeCount).toggle(changeCount > 0);
    $("#sbBranchName").text((status.branch || "HEAD") +
        (status.ahead ? " ↑" + status.ahead : "") + (status.behind ? " ↓" + status.behind : ""));
    $("#sbBranch").show();
}

//Tint explorer rows the way VS Code does, so changed files stand out
function applyGitDecorations(status){
    $("#directoryExplorer .row").css("color", "");

    var repoRoot = currentProjectFolder;
    if (!repoRoot.endsWith("/")) repoRoot += "/";

    (status.changes || []).forEach(function(change){
        var colour = "var(--warn)";
        if (change.status == "untracked" || change.status == "added") colour = "var(--ok)";
        else if (change.status == "deleted") colour = "var(--err)";
        else if (change.status == "conflicted") colour = "var(--err)";

        $('#directoryExplorer .row[data-path="' + repoRoot + change.path + '"]').css("color", colour);
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════════════════ */

function gitStage(files){
    gitcall("stage", { files: JSON.stringify(files) }, function(response){
        if (!response.success){ alert(response.error); return; }
        refreshGitStatus();
    });
}

function gitStageAll(){
    gitcall("stageall", {}, function(response){
        if (!response.success){ alert(response.error); return; }
        refreshGitStatus();
    });
}

function gitUnstage(files){
    gitcall("unstage", { files: JSON.stringify(files) }, function(response){
        if (!response.success){ alert(response.error); return; }
        refreshGitStatus();
    });
}

function gitUnstageAll(){
    if (!csGitStatus) return;
    var staged = (csGitStatus.changes || []).filter(function(change){ return change.staged; })
                                            .map(function(change){ return change.path; });
    if (staged.length == 0) return;
    gitUnstage(staged);
}

function gitDiscard(files){
    if (!confirm("Discard local changes in:\n" + files.join("\n") + "\n\nThis cannot be undone.")) return;
    gitcall("discard", { files: JSON.stringify(files) }, function(response){
        if (!response.success){ alert(response.error); return; }
        setStatusMessage("undo", "Changes discarded");
        //Reload any editor showing one of those files
        files.forEach(function(path){ reloadOpenFile(currentProjectFolder + "/" + path); });
        refreshGitStatus();
    });
}

function commitStagedChanges(){
    var message = $("#commitMessage").val();
    if (!message || message.trim() == ""){
        alert("Enter a commit message first.");
        return;
    }

    gitcall("commit", { message: message }, function(response){
        if (!response.success){
            alert(response.error || "Commit failed");
            return;
        }
        $("#commitMessage").val("");
        setStatusMessage("check", "Committed");
        csLog("ok", "Commit: " + message.split("\n")[0]);
        refreshGitStatus();
    });
}

function gitTransport(operation){
    if (!currentProjectFolder || csGitBusy) return;

    csGitBusy = true;
    setStatusMessage("sync", operation.charAt(0).toUpperCase() + operation.slice(1) + "ing…");

    gitcall(operation, {}, function(response){
        csGitBusy = false;

        if (response.authRequired){
            csGitAuthRetry = operation;
            $("#gitAuthHost").text("The remote refused the stored credentials.");
            $("#gitAuthModal").modal("show");
            return;
        }
        if (!response.success){
            alert(response.error || (operation + " failed"));
            csLog("err", operation + " failed: " + (response.error || ""));
            return;
        }

        setStatusMessage("check", response.message || (operation + " complete"));
        csLog("ok", operation + ": " + (response.message || "done"));
        refreshGitStatus();
    });
}

function submitGitAuth(){
    var operation = csGitAuthRetry;
    if (!operation) return;

    var credentials = {
        username: $("#gitAuthUsername").val(),
        token: $("#gitAuthToken").val(),
        remember: $("#gitAuthRemember").is(":checked") ? "true" : "false"
    };

    $("#gitAuthModal").modal("hide");
    $("#gitAuthToken").val("");
    csGitAuthRetry = null;

    setStatusMessage("sync", operation + "ing…");
    gitcall(operation, credentials, function(response){
        if (!response.success){
            alert(response.error || (operation + " failed"));
            return;
        }
        setStatusMessage("check", response.message || (operation + " complete"));
        refreshGitStatus();
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Opening changed files and diffs
   ═══════════════════════════════════════════════════════════════════ */

function repoPathToVirtualPath(repoRelativePath){
    var root = currentProjectFolder;
    if (!root.endsWith("/")) root += "/";
    return root + repoRelativePath;
}

function openGitFile(repoRelativePath){
    openFile(repoPathToVirtualPath(repoRelativePath));
}

function openGitDiff(repoRelativePath){
    gitcall("diff", { file: repoRelativePath }, function(response){
        if (!response.success){
            alert(response.error || "Unable to read the diff");
            return;
        }

        var diff = response.diff;
        var text = (typeof diff === "string") ? diff : (diff.patch || diff.diff || JSON.stringify(diff, null, 2));
        if (!text || text.trim() == ""){
            setStatusMessage("info circle", "No textual changes in " + repoRelativePath);
            return;
        }

        openVirtualDocument(repoRelativePath.split("/").pop() + " (diff)", text, "diff");
    });
}

//Reload a file that changed on disk behind an open editor
function reloadOpenFile(filepath){
    var model = loadedModels[filepath];
    if (!model) return;
    ao_module_agirun("Code Studio/backend/read.agi", { file: filepath }, function(content){
        if (typeof content === "object" && content.error) return;
        model.setValue(content);
        editors.forEach(function(entry){
            entry.tabs.forEach(function(tab){
                if (tab.filepath == filepath){
                    tab.saveHash = content.hashCode();
                    markTabUnsaved(tab.tabUUID, false);
                }
            });
        });
    });
}
