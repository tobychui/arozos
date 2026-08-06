/*
    properties.js

    Properties sidebar and the file/disk properties float windows.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

function showCurrentDirectoryProperties(){
var fileList = [currentPath];
var hashPassthrough = encodeURIComponent(JSON.stringify(fileList));
ao_module_newfw({
    url: "SystemAO/file_system/file_properties.html#" + hashPassthrough,
    width: 340,
    height: 480,
    appicon: "SystemAO/file_system/img/properties.png",
    title: "File Properties",
});
}

function showVrootProperties(){
var rootname = [$("#storageroot").find(".dir.item.active").attr("filepath")];
var hashPassthrough = encodeURIComponent(JSON.stringify(rootname));
ao_module_newfw({
    url: "SystemAO/disk/diskprop.html#" + hashPassthrough,
    width: 420,
    height: 580,
    appicon: "img/system/drive.svg",
    title: "Disk Properties",
});
}

function showSharesManager(){
var rootname = [$("#storageroot").find(".dir.item.active").attr("filepath")];
var hashPassthrough = encodeURIComponent(JSON.stringify(rootname));
ao_module_newfw({
    url: "SystemAO/file_system/sharelist.html#" + hashPassthrough,
    width: 420,
    height: 580,
    appicon: "img/system/share.svg",
    title: "Shares Manager"
});
}

function showFileProperties(){
//Show the file list of the selected files
if ($(".fileObject.selected").length > 0){
    //Build the filelist
    var fileList = [];
    $(".fileObject.selected").each(function(){
        var filepath = $(this).attr("filepath");
        fileList.push(filepath);
    });

    var hashPassthrough = encodeURIComponent(JSON.stringify(fileList));
    ao_module_newfw({
        url: "SystemAO/file_system/file_properties.html#" + hashPassthrough,
        width: 340,
        height: 480,
        appicon: "SystemAO/file_system/img/properties.png",
        title: "File Properties",
    });
}


}

/*
Properties Sidebar
*/

function loadFileProperties(filepath){
$.ajax({
    url: "../../system/file_system/getProperties",
    method: "POST",
    data: {path: filepath},
    success: function(data){
        if (data.error !== undefined){
            //Failed to load 

        }else{
            let previewSidebar = $("#propertiesView");
            //Check the extension. If the extension is image supported 
            //by web browser, enable full resolution button
            let enableFullResButton = false;
            if (!data.IsDirectory && data.Basename.indexOf(".") >= 0){
                let ext = data.Basename.split(".").pop().toLowerCase();
                if (ext == "jpeg" || ext == "jpg" || ext == "webp" || ext == "png" || ext == "gif"){
                    //Web preview-able formats

                }
            }
            
            //Load the preview 
            fetch("../../system/file_system/loadThumbnail?vpath=" + encodeURIComponent(data.VirtualPath))
            .then((response) => response.json())
            .then((imageData) => {
                if (imageData.error !== undefined || imageData.trim() == ""){
                    //Image load error.
                    if (data.IsDirectory){
                        //Load the folder image
                        $(previewSidebar).find(".preview img").attr("src", "../../img/system/folder.svg")
                    }else{
                        let icon = "file outline";
                        let ext = data.Basename.split(".").pop().toLowerCase();
                        if (ext != ""){
                            icon = ao_module_utils.getIconFromExt(ext);
                        }
                        let imagePath = "../../img/desktop/files_icon/default/" + icon + ".png";
                        $(previewSidebar).find(".preview img").attr("src", imagePath);
                    }
                    
                    return;
                }
                $(previewSidebar).find(".preview img").attr('src',"data:image/jpg;base64," + imageData);
            });

            //Render the remaining information
            $("#propertiesView").find(".filename").text(data.Basename);
            $("#propertiesView").find(".vpath").text(data.VirtualPath);

            let propTable = $("#propertiesView").find(".propertiesTable");
            let styleOverwrite = `min-width: 4em;`;
            $(propTable).html("");
            $(propTable).append(`<tr>
                <td style="${styleOverwrite}">
                    ${applocale.getString("sidebar/properties/filesize", "File Size")}
                </td>
                <td>
                    ${bytesToSize(data.Filesize)}
                </td>
            </tr><tr>
                <td style="${styleOverwrite}">
                    ${applocale.getString("sidebar/properties/modtime", "Last Modification")}
                </td>
                <td>
                    ${data.LastModTime}
                </td>
            </tr><tr>
                <td style="${styleOverwrite}">
                    ${applocale.getString("sidebar/properties/mimetype", "MIME Type")}
                </td>
                <td>
                    ${data.MimeType}
                </td>
            </tr><tr>
                <td style="${styleOverwrite}">
                    ${applocale.getString("sidebar/properties/owner", "Owner")}
                </td>
                <td>
                    ${data.Owner}
                </td>
            </tr><tr>
                <td style="${styleOverwrite}">
                    ${applocale.getString("sidebar/properties/permission", "Permission")}
                </td>
                <td>
                    ${data.Permission}
                </td>
            </tr><tr>
                <td style="${styleOverwrite}">
                    ${applocale.getString("sidebar/properties/storepath", "Storage Path")}
                </td>
                <td style="word-break: break-all;">
                    ${data.StoragePath}
                </td>
            </tr><tr>
                <td style="${styleOverwrite}">
                    ${applocale.getString("sidebar/properties/vpath", "Virtualized Path")}
                </td>
                <td style="word-break: break-all;">
                    ${data.VirtualPath}
                </td>
            </tr>`);

        }
    }
})
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.showCurrentDirectoryProperties = showCurrentDirectoryProperties;
window.showFileProperties = showFileProperties;
window.showSharesManager = showSharesManager;
window.showVrootProperties = showVrootProperties;
