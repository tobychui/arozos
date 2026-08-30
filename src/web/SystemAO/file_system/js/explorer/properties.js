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

/*
    POSIX permission string as a grid.

    "-rwxrwxrwx" is exact but asks the reader to count characters in threes to
    answer "can the group write?". The same information as a table is read at a
    glance. Anything that is not a recognisable 9 or 10 character mode string is
    shown verbatim rather than guessed at - remote file systems and Windows
    hosts do not all report this the same way.
*/
function renderPermissionTable(permission){
    let mode = (permission == undefined || permission == null) ? "" : String(permission).trim();
    //Drop the leading file type character when present
    let bits = mode.length == 10 ? mode.substring(1) : mode;
    if (bits.length != 9 || !/^[rwxsStTl-]{9}$/.test(bits)){
        return escapeHTMLText(mode);
    }

    let rows = [
        {label: applocale.getString("sidebar/properties/permOwner", "Owner"), offset: 0},
        {label: applocale.getString("sidebar/properties/permGroup", "Group"), offset: 3},
        {label: applocale.getString("sidebar/properties/permOthers", "Others"), offset: 6}
    ];
    let cols = [
        applocale.getString("sidebar/properties/permRead", "Read"),
        applocale.getString("sidebar/properties/permWrite", "Write"),
        applocale.getString("sidebar/properties/permExec", "Exec")
    ];

    let html = '<table class="fmPermTable"><tr><th></th>';
    for (let i = 0; i < cols.length; i++){
        html += '<th>' + escapeHTMLText(cols[i]) + '</th>';
    }
    html += '</tr>';
    rows.forEach(function(row){
        html += '<tr><td class="fmPermWho">' + escapeHTMLText(row.label) + '</td>';
        for (let i = 0; i < 3; i++){
            //Only '-' means not granted; setuid/sticky letters still imply it
            let granted = bits.charAt(row.offset + i) != "-";
            html += '<td class="' + (granted ? "fmPermOn" : "fmPermOff") + '">' +
                    (granted ? "✓" : "–") + '</td>';
        }
        html += '</tr>';
    });
    return html + '</table>';
}

//The mode string comes from the server, so escape before it goes into html
function escapeHTMLText(text){
    return String(text == undefined ? "" : text)
        .split("&").join("&amp;")
        .split("<").join("&lt;")
        .split(">").join("&gt;");
}

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
            
            /*
                Preview

                Hidden until a real thumbnail arrives. It used to fall back to
                the generic file type icon, which told the reader nothing the
                row they just clicked had not already shown them, and spent a
                third of the panel doing it.

                Hidden up front rather than only on failure, so the previously
                selected file's image does not sit there while this one loads.
            */
            $(previewSidebar).find(".preview").hide();
            fetch("../../system/file_system/loadThumbnail?vpath=" + encodeURIComponent(data.VirtualPath))
            .then((response) => response.json())
            .then((imageData) => {
                if (imageData.error !== undefined || imageData.trim() == ""){
                    //No thumbnail for this one - leave the preview hidden
                    $(previewSidebar).find(".preview img").removeAttr("src");
                    return;
                }
                $(previewSidebar).find(".preview img").attr('src',"data:image/jpg;base64," + imageData);
                $(previewSidebar).find(".preview").show();
            })
            .catch(() => {
                $(previewSidebar).find(".preview").hide();
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
                    ${renderPermissionTable(data.Permission)}
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
