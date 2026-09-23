/*
    Code Studio — project search

    Runs backend/search.agi over the opened project folder and renders the
    hits grouped by file. Clicking a hit opens the file and jumps to the line.
*/

var csSearchOptions = { matchCase: false, wholeWord: false };
var csSearchRunning = false;

function toggleSearchOption(option, button){
    csSearchOptions[option] = !csSearchOptions[option];
    $(button).toggleClass("active", csSearchOptions[option]);
}

function clearSearchResults(){
    $("#searchKeyword").val("");
    $("#searchResults").html('<div class="emptyhint">Open a project folder, then search its file contents.</div>');
}

function startProjectSearch(){
    var keyword = $("#searchKeyword").val();

    if (!currentProjectFolder){
        $("#searchResults").html('<div class="emptyhint">No project folder is open. ' +
            'Use File &gt; Open Folder first.</div>');
        return;
    }
    if (!keyword || keyword.trim() == ""){
        clearSearchResults();
        return;
    }
    if (csSearchRunning) return;

    csSearchRunning = true;
    $("#searchResults").html('<div class="emptyhint"><i class="notched circle loading icon"></i> Searching&hellip;</div>');

    $.ajax({
        url: "../system/ajgi/interface?script=Code Studio/backend/search.agi",
        method: "POST",
        dataType: "json",
        data: {
            root: currentProjectFolder,
            keyword: keyword,
            include: $("#searchInclude").val(),
            matchCase: csSearchOptions.matchCase ? "true" : "false",
            wholeWord: csSearchOptions.wholeWord ? "true" : "false"
        },
        success: function(response){
            csSearchRunning = false;
            if (!response.success){
                $("#searchResults").html('<div class="emptyhint">' + escapeHTMLText(response.error) + '</div>');
                return;
            }
            renderSearchResults(response, keyword);
        },
        error: function(){
            csSearchRunning = false;
            $("#searchResults").html('<div class="emptyhint">The search backend is unreachable.</div>');
        }
    });
}

function renderSearchResults(response, keyword){
    if (response.results.length == 0){
        $("#searchResults").html('<div class="emptyhint">No results for "' +
            escapeHTMLText(keyword) + '".</div>');
        return;
    }

    var html = '<div class="emptyhint" style="padding:8px 18px;">' +
                    response.totalHits + ' result(s) in ' + response.results.length + ' file(s)' +
                    (response.truncated ? ' — showing the first matches only' : '') +
               '</div>';

    response.results.forEach(function(file){
        var encodedPath = encodeURIComponent(file.path);
        var ext = file.name.split(".").pop();

        html += '<div class="section">' +
                    '<div class="sectionhead" onclick="toggleSection(this);">' +
                        '<span class="caret"><i class="caret down icon"></i></span>' +
                        '<i class="' + ao_module_utils.getIconFromExt(ext) + ' icon ' + getFileIconClass(ext) + '"></i>' +
                        '<span class="label" title="' + escapeHTMLText(file.path) + '">' +
                            escapeHTMLText(file.relative) + '</span>' +
                        '<span class="sub">' + file.hits.length + '</span>' +
                    '</div>' +
                    '<div class="sectionbody">';

        file.hits.forEach(function(hit){
            html += '<div class="row hitline" title="Line ' + hit.line + '" ' +
                        'onclick="openSearchHit(decodeURIComponent(\'' + encodedPath + '\'), ' + hit.line + ');">' +
                        '<span class="name">' + highlightKeyword(hit.text.replace(/^\s+/, ""), keyword) + '</span>' +
                    '</div>';
        });

        html += '</div></div>';
    });

    $("#searchResults").html(html);
}

//Wrap every occurrence of the keyword in a <mark>, on already escaped text
function highlightKeyword(text, keyword){
    var escapedText = escapeHTMLText(text);
    var escapedKeyword = escapeHTMLText(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var flags = csSearchOptions.matchCase ? "g" : "gi";
    try {
        return escapedText.replace(new RegExp(escapedKeyword, flags), function(match){
            return "<mark>" + match + "</mark>";
        });
    } catch(e){
        return escapedText;
    }
}

function openSearchHit(filepath, lineNumber){
    openFile(filepath);

    //The file may still be loading — poll briefly for its model to appear
    var attempts = 0;
    var timer = setInterval(function(){
        attempts++;
        var editorObject = getFocusedEditorObject();
        var tabInfo = getFocusedTabInfo();

        if (editorObject && tabInfo && tabInfo.filepath == filepath){
            clearInterval(timer);
            editorObject.editor.revealLineInCenter(lineNumber);
            editorObject.editor.setPosition({ lineNumber: lineNumber, column: 1 });
            editorObject.editor.focus();
        } else if (attempts > 40){
            clearInterval(timer);
        }
    }, 50);
}
