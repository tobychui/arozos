/*
    dragdrop.js

    HTML5 drag and drop, both inside the file list and from the OS.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

    //Make an div not draggable
    function disableDrag(event){
        event.preventDefault();
        event.stopPropagation();
    }

    //Make fileObject draggable
    function onFileObjectDragStart(object, event){
        if ((ctrlHold) &&  $(object).hasClass("selected") == false){
            $(object).addClass("selected");
        }else if ($(object).hasClass("selected") == false){
            $(".fileObject.selected").removeClass("selected");
            $(object).addClass("selected");
        }

        var fileList = [];
        $(".selected.fileObject").each(function(){
            var filename = $(this).attr('filename');
            var filepath = $(this).attr('filepath');
            var sourceSystemUUID = systemUUID;
            //Extra information is passed in due to the need for cross cluster communication in the future
            fileList.push({
                filename: filename,
                filepath: filepath,
                hostUUID: sourceSystemUUID
            });
        });
        
        event.dataTransfer.setData("filedata", JSON.stringify(fileList));
    }

    //Function for getting file objects in the same row
    //Handle drag drop upload
    function drop(event){
        event.preventDefault();
        //Check if this is file upload or file move / copy function
        let dt = event.dataTransfer
        let files = dt.files

        /*
            A special view is open, so there is no directory under the cursor to
            copy or upload into - pasting would send the files at a sentinel
            path and come back as "target path error".

            An in-app drag is handed to the view instead, which is how dropping
            onto the trash bin recycles whether the drop lands on the sidebar
            entry, the desktop icon, or the open bin itself. Files dragged in
            from the operating system have nowhere to go either way.
        */
        if (isSpecialViewPath(currentPath)){
            if (files.length > 0){
                msgbox("red remove", applocale.getString("message/specialview/noUpload",
                    "Files cannot be uploaded here"));
                return;
            }
            let payload = dt.getData("filedata");
            let handled = false;
            if (payload != undefined && payload != ""){
                try {
                    let dropped = JSON.parse(payload);
                    handled = runSpecialViewDrop(currentPath, dropped.map(function(file){
                        return file.filepath;
                    }));
                } catch (ex){
                    console.log(ex);
                }
            }
            if (!handled){
                msgbox("red remove", applocale.getString("message/specialview/noDrop",
                    "This view does not accept dropped files"));
            }
            return;
        }

        if (files.length > 0){
            //Upload file via dragdrop
            msgbox("upload",applocale.getString("message/upload/started", "Upload Started"));
            let items = event.dataTransfer.items;
            for (let i=0; i<items.length; i++) {
                let item = items[i].webkitGetAsEntry();
                if (item) {
                    recursiveScanFilesUpload(item);
                }
            }
            
        }else{
            //File transfer within system
            let filedata = event.dataTransfer.getData("filedata");
            if (filedata != ""){
                try{
                    let fileList = JSON.parse(filedata);
                    //Check if the file objects are from the same host
                    let localFiles = [];
                    let remoteFiles = [];
                    fileList.forEach(file => {
                        if (file.hostUUID == systemUUID){
                            //Local file
                            localFiles.push(file);
                        }else{
                            //Remote files
                            remoteFiles.push(file);
                        }
                    });

                    //Start processing the local files
                    let currentVroot = currentPath.split(":/").shift();
                    clipboard = [];

                    //Assume all files are from the same directory
                    if (localFiles.length > 0){
                        //Check if drag drop from the same directory
                        let currentDirname = currentPath.split("/")
                        currentDirname.pop();
                        currentDirname = currentDirname.join("/");
                        let firstFileDirname = localFiles[0].filepath.split("/")
                        firstFileDirname.pop();
                        firstFileDirname = firstFileDirname.join("/");
                        if (currentDirname == firstFileDirname){
                            //Drag start and drop location are the same directory
                            msgbox("red remove",applocale.getString("message/destIdentical", "Source and destination file names are the same"));
                            return;
                        }

                        let fileVroot = localFiles[0].filepath.split(":/").shift();
                        if (currentVroot == fileVroot){
                            //Same device same root. Move the file
                            cutMode = true;
                        }else{
                            //Same device differnet root. Copy the file
                            cutMode = false;
                        }

                        //Move all localFiles into clipboard
                        localFiles.forEach(file => {
                            clipboard.push(file.filepath);
                        });

                        if (useLocalstorage){
                            localStorage.setItem("ao/file_system/clipboard",JSON.stringify(clipboard));
                            if (cutMode){
                                localStorage.setItem("ao/file_system/cutmode","true");
                            }else{
                                localStorage.setItem("ao/file_system/cutmode","false");
                            }
                            
                        }

                        //Paste all the files to the current path
                        paste();
                    }
                    
                    

                }catch(ex){
                    console.log(ex);
                    msgbox("red remove",applocale.getString("message/decodeFilelistFail", "File drop failed. Unable to decode filelist."));
                }
            }
            
            
        }
        
    }


    function recursiveScanFilesUpload(item, rootpath="", base=""){
        var filesInside = [];
        if (item.isDirectory) {
            //This is a directory
            let directoryReader = item.createReader();
                directoryReader.readEntries(function(entries) {
                entries.forEach(function(entry) {
                    recursiveScanFilesUpload(entry, rootpath + item.name + "/", base);
                });
            });
        }else{
            //This is a file. Upload it
            item.file(function(fileObject){
                if (isChrome || isSafari){
                    //WebKits
                    console.log("Upload Target", fileObject, rootpath);
                    uploadFile(fileObject, undefined, currentPath + rootpath);
                }else{
                    uploadFile(fileObject, undefined, currentPath + base);
                }
                
            });
        }
        return filesInside;
    }

function dropToFolder(event){
    event.preventDefault();
    event.stopImmediatePropagation();
    console.log("Drop to folder detected");

    //Extract target folder path from object
    var targetPath = $(event.target).attr("filepath");
    if (targetPath == ""){
        return
    }
    
    //Check if this is upload or file move drag
    var files = event.dataTransfer.files;
    if (files.length > 0){
        //Upload mode. Extract the target folder basename from path
        if (targetPath.substr(targetPath.length -1,1) == "/"){
            targetPath = targetPath.substr(0, targetPath.length-1);
        }
        var folderBase = targetPath.split("/").pop() + "/";
        var items = event.dataTransfer.items;
        for (let i=0; i<items.length; i++) {
            let item = items[i].webkitGetAsEntry();
            if (item) {
                recursiveScanFilesUpload(item, folderBase, folderBase);
            }
        }
    }else if (event.dataTransfer.getData("filedata") != ""){
        var targetVroot = targetPath.split(":/").shift();
        //Get the source files
        var filelist = JSON.parse(event.dataTransfer.getData("filedata"));
        if (filelist.length > 0){
            var srcVroot = filelist[0].filepath.split(":/").shift();
            if (srcVroot == targetVroot){
                //Use move mode
                cutMode = true;
                
            }else{
                //Use copy mode
                cutMode = false;
            }

            //Parse the filelist
            clipboard = [];
            filelist.forEach(file=>{
                clipboard.push(file.filepath);
            });
            if (useLocalstorage){
                localStorage.setItem("ao/file_system/clipboard",JSON.stringify(clipboard));
                localStorage.setItem("ao/file_system/cutmode","true");
            }
            
            //Perform operations
            paste(targetPath, false)
        }
    }
}

/*
    A drop onto one of the sidebar's special views.

    Only files already inside ArozOS are accepted: an OS drag carries real
    files to upload, and there is nothing behind a sentinel path to upload
    them to. What the drop then means is the view's business - the trash bin
    recycles them.
*/
function dropToSpecialView(event, sentinelPath){
    event.preventDefault();
    event.stopImmediatePropagation();

    let payload = event.dataTransfer.getData("filedata");
    if (payload == undefined || payload == ""){
        return;
    }

    let filelist = [];
    try {
        filelist = JSON.parse(payload);
    } catch (e){
        return;
    }
    if (filelist.length == 0){
        return;
    }

    runSpecialViewDrop(sentinelPath, filelist.map(function(file){
        return file.filepath;
    }));
}

function allowDrop(event){
    event.preventDefault();
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.allowDrop = allowDrop;
window.dropToSpecialView = dropToSpecialView;
window.disableDrag = disableDrag;
window.drop = drop;
window.dropToFolder = dropToFolder;
window.onFileObjectDragStart = onFileObjectDragStart;
