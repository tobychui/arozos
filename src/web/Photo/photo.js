/*
    Photo.js

    Author: tobychui
    This is a complete rewrite of the legacy Photo module for ArozOS

*/

let photoList = [];
let prePhoto = "";
let nextPhoto = "";
let currentModel = "";

function scrollbarVisable(){
    return $("body")[0].scrollHeight > $("body").height();
}

function getImageWidth(){
    let boxCount = 4;
    if (window.innerWidth < 500) {
        boxCount = 3;
    } else if (window.innerWidth < 800) {
        boxCount = 4;
    } else if (window.innerWidth < 1200) {
        boxCount = 6;
    }else if (window.innerWidth < 1600){
        boxCount = 8;
    } else {
        boxCount = 10;
    }

    let offsets = 2;
    if (scrollbarVisable()){
        offsets = offsets * 1.2;
    }

    return $("#viewbox").width() / boxCount - offsets;
}

function updateImageSizes(){
    let newImageWidth = getImageWidth();
    //Updates all the size of the images
    $(".imagecard").css({
        width: newImageWidth,
        height: newImageWidth
    });
}

function closeSideMenu(){
    $('#menu').toggle('fast', function(){
        updateImageSizes();
    });
    
}

function extractFolderName(folderpath){
    return folderpath.split("/").pop();
}

function initSelectedModelValue(){
    ao_module_agirun("Photo/backend/modelSelector.js",{

    }, function(data){
        currentModel = data;
        $("#selectedModel").dropdown("set selected", data);
    })
}

function updateSelectedModel(nnnm){
    if (nnnm != ""){
        ao_module_agirun("Photo/backend/modelSelector.js",{
            set: true,
            model: nnnm
        }, function(data){
           console.log("Update model status: ", data);
           $("#modelUpdated").slideDown("fast").delay(3000).slideUp('fast');
        })
    }
}

function settingObject(){
    return {
        excludeDirs: ["Manga","thumbnail"],

        init(){
            this.loadExcludeList();
            $('#newexc input').off("keypress").on("keypress",function (e) {
                if (e.which == 13) {
                    addDir($('#newexc input'));
                }
            });
            
            $(".ui.dropdown").dropdown();
            initSelectedModelValue();
        },

        addDir(element){
            var dir = $(element).parent().find("input").val();
            $("#newexc").removeClass("error");
            for (var i = 0; i < this.excludeDirs.length; i++){
                if (this.excludeDirs[i] == dir){
                    //Already exists
                    $("#newexc").addClass("error");
                    return;
                }
            }

            this.excludeDirs.push(dir);
            $('#newexc input').val("");
        },

        removeDir(filepath){
            //Pop the given filepath from list
            var newExcludeDirs = [];
            for ( var i = 0; i < this.excludeDirs.length; i++){
                var thisExcludeDir = this.excludeDirs[i];
                if (thisExcludeDir != filepath){
                    newExcludeDirs.push(thisExcludeDir);
                }
            }

            this.excludeDirs = newExcludeDirs;
        },

        loadExcludeList(){
            $("#noexcRecords").hide();
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/exclude.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    
                })
            }).then(resp => {
                resp.json().then(data => {
                    console.log(data);
                    this.excludeDirs = data;
                    if (data.length == 0){
                        $("#noexcRecords").show();
                    }
                })
            });
        },



        save(){
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/exclude.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "set":true,
                    "folders": this.excludeDirs
                })
            }).then(resp => {
                resp.json().then(data => {

                })
            });
        }
    }
}

function photoListObject() {
    return {
        // data
        pathWildcard: "user:/Photo/*",
        currentPath: "user:/Photo",
        renderSize: 200,
        vroots: [],
        images: [],
        folders: [],
        tags: [],
        
        // init
        init() {
            this.getFolderInfo();
            this.getRootInfo();
            this.renderSize = getImageWidth();
            updateImageSizes();
        },
        
        updateRenderingPath(newPath){
            this.currentPath = JSON.parse(JSON.stringify(newPath));
            this.pathWildcard = newPath + '/*';
            if (this.pathWildcard.split("/").length == 3){
                //Root path already
                $("#parentFolderButton").hide();
            }else{
                $("#parentFolderButton").show();
            }
            this.getFolderInfo();
        },

        parentFolder(){
            var parentPath = JSON.parse(JSON.stringify(this.currentPath));
            parentPath = parentPath.split("/");
            parentPath.pop();
            this.currentPath = parentPath.join("/");
            this.updateRenderingPath( this.currentPath);
        },

        getFolderInfo() {
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/listFolder.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "folder": this.pathWildcard
                })
            }).then(resp => {
                resp.json().then(data => {
                    console.log(data);
                    this.folders = data[0];
                    this.images = data[1];

                    if (this.images.length == 0){
                        $("#noimg").show();
                    }else{
                        $("#noimg").hide();
                    }

                    if (this.folders.length == 0){
                        $("#nosubfolder").show();
                    }else{
                        $("#nosubfolder").hide();
                    }
                    console.log(this.folders);

                    
                });
            });
            this.getTags();
        },

        getRootInfo() {
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/listRoots.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            }).then(resp => {
                resp.json().then(data => {
                    this.vroots = data;
                });
            })
        },

        getTags(){
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/listTags.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "vroot": this.currentPath
                })
            }).then(resp => {
                resp.json().then(data => {
                    this.tags = data;
                });
            });
        }
    }
}

function renderImageList(object){
    var fd = $(object).attr("filedata");
    fd = JSON.parse(decodeURIComponent(fd));
    console.log(fd);
    
}

function ShowModal(){
    $('.ui.modal.viewer').modal({
        onHide: function(){
            ao_module_setWindowTitle("Photo");
            setTimeout(function(){
                $("#fullImage").attr("src","img/loading.png");
            }, 300)
        }
    }).modal('show');
}

function showImage(object){
    var fd = JSON.parse(decodeURIComponent($(object).attr("filedata")));
    $("#fullImage").attr('src', "../media?file=" + fd.filepath);
    var nextCard = $(object).next(".imagecard");
    var prevCard = $(object).prev(".imagecard");
    if (nextCard.length > 0){
        nextPhoto = nextCard[0];
    }else{
        nextPhoto = null;
    }

    if (prevCard.length > 0){
        prePhoto = prevCard[0];
    }else{
        prePhoto = null;
    }

    ao_module_setWindowTitle("Photo - " + fd.filename);
}

$(document).on("keydown", function(e){
    if (e.keyCode == 37){
        //Left
        if (prePhoto != null){
            //$('.ui.modal').modal("hide");
            showImage(prePhoto);
        }
       
    }else if (e.keyCode == 39){
        //Right
        if (nextPhoto != null){
            //$('.ui.modal').modal("hide");
            showImage(nextPhoto);
        }
        
    }
})

function showSetting(){
    $('.ui.modal.setting').modal('show');
}

function rescan(object){
    var originalContent = $(object).html();
    $(object).addClass("disabled");
    $(object).html(`<i class="ui spinner loading icon"></i> Analysing`);
    ao_module_agirun("Photo/backend/classify.js", {

    }, function(data){
        //Done
        $(object).removeClass("disabled");
        $(object).html(`<i class="ui green checkmark icon"></i> Done`);
        setTimeout(function(){
            $(object).html(originalContent);
        }, 3000);
        
    });
}