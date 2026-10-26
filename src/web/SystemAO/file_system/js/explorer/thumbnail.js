/*
    thumbnail.js

    Thumbnail loading for the file listing. The actual streaming lives in
    shared/filethumb.js so the File Manager and the File Selector request and
    decode thumbnails the same way.

    Two behaviour notes versus the implementation this replaced:

      * includeFolders is true here. The server builds a layered folder preview
        from <folder>/.metadata/.cache, and the File Manager wants it. The old
        code got this only by accident: the WebSocket path received folder
        frames but the AJAX fallback explicitly skipped folders, so previews
        appeared or not depending on which transport happened to be used.

      * The returned handle is cancelled on navigation. The old stale guard
        compared currentPath inside the AJAX callback only, so a WebSocket frame
        arriving after a fast directory change could paint a thumbnail onto the
        wrong listing.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function startThumbnailLoader(){
    cancelThumbnailLoader();

    let targets = [];
    $("#folderView").find(".fileObject").each(function(){
        targets.push({
            filename: $(this).attr("filename"),
            filepath: $(this).attr("filepath"),
            isDir: $(this).attr("type") == "folder",
            dom: this
        });
    });

    if (targets.length == 0){
        return;
    }

    thumbLoader = FileThumb.loadThumbnails({
        root: "../../",
        folder: currentPath,
        targets: targets,
        includeFolders: true,
        onLoad: function(target, dataURL){
            let img = $(target.dom).find("img");
            if (img.length == 0){
                //List and details rows draw an icon font, not an <img>
                return;
            }
            img.attr("src", dataURL);
            $(target.dom).addClass("hasThumbnail");
        }
    });
}

//Called before listing another directory so late frames cannot paint onto it
function cancelThumbnailLoader(){
    if (thumbLoader != null){
        thumbLoader.cancel();
        thumbLoader = null;
    }
}
