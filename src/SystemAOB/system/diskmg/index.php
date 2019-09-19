<?php
include_once("../../../auth.php");

?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <script src="../../../script/ao_module.js"></script>
        <title>Diskmg</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
        <style>
            .customFitted.item{
                padding-top:5px !important;
                padding-bottom:5px !important;
            }
            #diskListTable{
                max-height:300px !important;
            }
            #diskVisualization{
                overflow-y:auto;
            }
            .diskPartTable{
                width:100%;
                border-bottom:1px solid #9c9c9c;
                overflow-x:hidden;
            }
            .sideblock{
                background-color:#e8e8e8;
                height:100px;
                width:100px;
                padding:8px;
                border-right:1px solid #9c9c9c;
                font-size:90%;
                display:inline-block;
            }
            .partitionRepresentation{
                border:4px solid #e8e8e8;
                display:inline-block;
                height:100px;
                vertical-align: top;
                overflow:hidden;
                border-left:1px solid #6e6e6e;
                cursor:pointer;
            }
            .partitionTopBar{
                background-color:#224ce3;
                width:100%;
                height:15px;
                margin-bottom:3px;
            }
            .partitionTopBar.unallocate{
                 background-color:#1f1f1f;
            }
            .partitionTopBar.unmounted{
                 background-color:#ab8a29;
            }
            .partitionDescription{
                padding-left:8px;
                padding:3px;
            }
            #rightClickMenu{
                position:absolute;
            }
            .selectable:hover{
                background-color:#f0f0f0;
            }
            .focusedPart{
              background-image: linear-gradient(45deg, #e6e6e6 16.67%, #ffffff 16.67%, #ffffff 50%, #e6e6e6 50%, #e6e6e6 66.67%, #ffffff 66.67%, #ffffff 100%);
background-size: 12.73px 12.73px;
            }
            .disabled{
                background-color:#e6e6e6;
                color:#787878 !important;
                cursor:no-drop !important;
            }
            .funcmenu{
                position:fixed;
                top:10%;
                right:20%;
                left:20%;
                bottom:10%;
                overflow-y:auto;
                z-index:100;
                background-color:#f7f7f7;
                padding:12px;
                display:none;
                border: 1px solid #9c9c9c;
            }
            .functMenuDimmer{
                z-index:90;
                position:absolute;
                width:100%;
                height:100%;
                left:0px;
                top:0px;
                background:rgba(48,48,48,0.5);
                display:none;
            }
            .funcmenuBottom{
                position:absolute;
                width:100%;
                bottom:0px;
                left:0px;
                padding:12px;
            }
        </style>
    </head>
    <body>
        <div id="diskListTable">
            <table class="ts celled striped attached table" style="padding-left:3px;padding-right:3px;">
                <thead>
                    <tr>
                        <th>
                            Volume
                        </th>
                        <?php
                        $mode = "linux";
                        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
                            echo '  <th>
                                        Volume_Label
                                    </th>
                                    <th>
                                        Type
                                    </th>';
                                    $mode = "window";
                        } else {
                            echo '  <th>
                                        MountPt
                                    </th>';
                        }
                                        
                        ?>
                       
                        <th>
                            File_System
                        </th>
                        <th>
                            Capacity
                        </th>
                        <th>
                            Free_Space
                        </th>
                        <th>
                            %_Free
                        </th>
                    </tr>
                </thead>
                <tbody id="diskInfoTable">
                    <tr>
                        <td class="collapsing">
                            <i class="disk outline icon"></i>/dev/sda1
                        </td>
                        <td class="collapsing">/media/storage1</td>
                        <td class="right aligned collapsing">NTFS</td>
                        <td class="right aligned collapsing">64 GB</td>
                        <td class="right aligned collapsing">12.5 GB</td>
                        <td class="right aligned collapsing">19.7%</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div id="diskVisualization">
            <div class="diskPartTable">
                <div class="sideblock">
                    <i class="disk outline icon" style="margin-right:0px;font-weight: bold;"></i>
                    <b style="font-weight: bold;">Drive 0</b><br>
                    N/A
                </div><div class="partitionRepresentation" style="width:calc(100% - 150px);">
                    <div class="partitionTopBar"></div>
                    <div class="partitionDescription">
                       Connecting to Virtual Disk Services
                    </div>
                </div>
            </div>
        </div>
    <div id="rightClickMenu" class="ts contextmenu">
        <div id="openbtn" class="item disabled selectable" onClick="openInFileExplorer(this);">
            <i class="folder open icon"></i> Open
        </div>
        <div id="formatDisk" class="item selectable" onClick="toggleFormatInterface(this);">
            <i class="disk outline icon"></i> Format Disk
        </div>
        <div id="mtbtn" class="item selectable" onClick="toggleMount(this);">
            <i class="usb icon"></i> Mount
        </div>
    </div>
    <!-- Sections for functional menus-->
    <div id="formatOptions" class="funcmenu">
        <div class="ts header">
            Disk Format
            <div class="sub header" style="font-weight:120%;color:red;">Warning! The format process will wipe all data from the selected partition.</div>
        </div>
        <div class="ts inverted negative segment">
            <p style="font-size:120%;">Danger Zone</p>
            <p>Format on any drive or partition will wipe all data within that drive or partition. Please make sure you have backup all necessary files and your drive / partition selection is correct.</p>
        </div>
        <div class="ts header">
            <i class="disk outline icon"></i>
            <div id="selectedDiskDisplay" class="content">
                /dev/sda1 (120 GB)
            </div>
        </div>
        <div class="ts form">
            <div class="field">
                <label>Target File System Format</label>
                <div class="ts checkboxes">
                    <div class="ts radio checkbox">
                        <input id="ntfs" type="radio" name="format" checked>
                        <label for="ntfs">NTFS</label>
                    </div>
                    <div class="ts radio checkbox">
                        <input id="vfat" type="radio" name="format">
                        <label for="vfat">VFAT</label>
                    </div>
                </div>
            </div>
        </div>
        <div class="funcmenuBottom" align="right">
            <button class="ts tiny negative button" onClick="formatThisDev();">Format</button>
            <button class="ts tiny button" onClick="hideAllFuncMenu();">Close</button>
        </div>
    </div>
    <div id="mountOptions" class="funcmenu">
        <div class="ts header">
            Disk Mount
            <div class="sub header">Select a mount point for this device</div>
        </div>
        <div class="ts segmented list" style="max-height:300px;overflow-y:auto;">
            <?php
            if ($mode == "window"){
                
            }else{
                $mntpt = glob("/media/*");
                foreach ($mntpt as $pt){
                    echo '<div class="mountpt selectable item" style="cursor:pointer;" ondblclick="mountThisDev(this)">' . $pt . '</div>';
                }
            }
            ?>
            <div class="mountpt item userdefine">
                <p>User defined mount point</p>
                <div class="ts fluid mini input">
                    <input id="userDefinedMountPoint" type="text" placeholder="/">
                </div>
            </div>
        </div>
        
        <div class="funcmenuBottom" align="right">
            <button class="ts tiny button" onClick="mountThisDev();">Mount</button>
            <button class="ts tiny button" onClick="hideAllFuncMenu();">Close</button>
        </div>
    </div>
    
    <!-- dimmers-->
     <div id="loaderUI" class="ts active inverted  dimmer" style="display:none;">
        <div class="ts text loader">Waiting for System Response</div>
    </div>
    <div class="functMenuDimmer" onClick="hideAllFuncMenu();">
        
    </div>
    <div style="display:none;">
        <div id="data_searchMode"><?php echo $mode; ?></div>
    </div>
    <script>
        var mode = $("#data_searchMode").text().trim();
        var viewMode = "human"; //Accept {human / raw}
        var diskInformation; //Tmp variable for holding disk return results
        var displayScaleRatio = 0.2; //Maxium differential ratio, default 0.3, it means the minium disk will show as 70% screen width
        var fwmode = false;
        var formatPendingDevInfo;
        
        //Init floatWindow events
        if (ao_module_virtualDesktop && !parent.underNaviEnv){
            ao_module_setWindowIcon("disk outline");
            ao_module_setWindowTitle("Disk Manager");
            fwmode = true;
        }else{
            
        }
        
        //Init Window only events
        if (mode == "window"){
            $("#formatOptions").remove();
            $("#mountOptions").remove();
        }
        
        //Init data loading process
        initView();
        initPartitionTable();
        
        //Mount pt selection interface
        $(".mountpt").on('click',function(e){
            $(".selected").removeClass("selected");
            $(this).addClass("selected");
        });
        
        function hideAllFuncMenu(){
            $(".funcmenu").fadeOut('fast');
            $(".functMenuDimmer").fadeOut('fast');
        }
        
        function formatThisDev(){
            var targetFormat = $("input[name='format']:checked").attr("id");
            var targetDisk = formatPendingDevInfo;
            if(targetFormat){
                $("#loaderUI").show();
                if (confirm("THIS OPERATION WILL WIPE ALL DATA ON /dev/" + targetDisk[0] + ". ARE YOU SURE?")){
                    $("#formatOptions").fadeOut('fast');
                    $(".functMenuDimmer").fadeOut('fast');
                    $.get("formatTool.php?dev=" + targetDisk[0] + "&format=" + targetFormat,function(e){
                        if (e.includes("ERROR")){
                            alert(e);
                        }
                        initView();
                        initPartitionTable();
                        $("#loaderUI").hide();
                    });
                }else{
                    $("#loaderUI").hide();
                }
            }
        }
        
        function toggleFormatInterface(btnObject){
            if ($(btnObject).hasClass("disabled") == true){
                return;
            }
            $("#formatOptions").fadeIn('fast');
            $(".functMenuDimmer").fadeIn('fast');
            hideRightclickMenu();
            var diskInfo = $(".focusedPart").attr("metadata");
            diskInfo = ao_module_utils.attrToObject(diskInfo);
            formatPendingDevInfo = diskInfo;
            $("#selectedDiskDisplay").text(diskInfo[0] + " (" + bytesToSize(parseInt(diskInfo[5])) + ") ");
        }
        
        function mountThisDev(object=null){
            if (object !== null && !$(object).hasClass(".selected.item")){
                $(".selected").removeClass("selected");
                $(object).addClass("selected");
            }
            var selectedMpt = $(".selected.item");
            var mountPoint = $(selectedMpt).text().trim();
            if (selectedMpt.hasClass("userdefine")){
                var mountPoint = $("#userDefinedMountPoint").val();
            }
             $("#loaderUI").show();
             var diskInfo = $(".focusedPart").attr("metadata");
             diskInfo = ao_module_utils.attrToObject(diskInfo);
             $.get("mountTool.php?dev=" + diskInfo[0] + "&format=" + diskInfo[2] + "&mnt=" + mountPoint,function(data){
                if (data.includes("ERROR")){
                    alert(data);
                    $("#loaderUI").hide();
                    return;
                }
                //Reload the UI
                initView();
                initPartitionTable();
                $("#loaderUI").hide();
                $("#mountOptions").fadeOut('fast');
                $(".functMenuDimmer").fadeOut('fast');
            });
        }
        
        function toggleMount(btnObject){
            if ($(btnObject).hasClass("disabled") == true){
                return;
            }
            var diskInfo = $(".focusedPart").attr("metadata");
            diskInfo = ao_module_utils.attrToObject(diskInfo);
            if (diskInfo[3] == false){
                //Mount disk
                $("#mountOptions").fadeIn('fast');
                $(".functMenuDimmer").fadeIn('fast');
                
            }else{
                //Unmount disk
                var dev = diskInfo[0];
                var mnt = diskInfo[1];
                var format = diskInfo[2];
                hideRightclickMenu();
                $("#loaderUI").show();
                $.get("mountTool.php?dev=" + dev + "&format=" + format + "&mnt=" + mnt + "&unmount",function(data){
                    console.log(data);
                    //Reload the UI
                     initView();
                     initPartitionTable();
                     $("#loaderUI").hide();
                });
            }
            hideRightclickMenu();
        }
        
        function hideRightclickMenu(){
            $("#rightClickMenu").hide();
        }
        function openInFileExplorer(btnObject){
            if ($(btnObject).hasClass('disabled')){
                return;
            }
            var diskInfo = $(".focusedPart").attr("metadata");
            diskInfo = ao_module_utils.attrToObject(diskInfo);
            if (diskInfo[3] == true){
                //This disk is mounted
                var uid = Date.now();
                if (fwmode){
                    ao_module_newfw("SystemAOB/functions/file_system/index.php?controlLv=2&dir=" + diskInfo[1],"Loading", "folder open outline",uid,1080,580,undefined,undefined,true,true);
                }else if (parent.underNaviEnv){
                    var uid = Date.now();
		            parent.parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&dir=" + diskInfo[1], "Loading", "folder open outline",uid,1080,580,undefined,undefined,true,true);
                }else{
                    window.open("../../functions/file_system/index.php?controlLv=2&dir=" + diskInfo[1]);
                }
            }
            hideRightclickMenu();
        }
        
        function createEventHooks(){
            $(".partitionRepresentation").contextmenu(function(e){
                if (mode == "window"){
                    //Switch back to normal menu when under window mode
                    return true;
                }
                var px = e.pageX;
                var py = e.pageY;
                $("#rightClickMenu").css({"left": px + "px", "top": py + "px"});
                $("#rightClickMenu").show();
                console.log(e.target);
                $(".focusedPart").removeClass("focusedPart");
                var partbody =  $(e.target);
                if ($(e.target).parent().hasClass("partitionRepresentation")){
                    //Clicked on the child instead.
                    $(e.target).parent().addClass("focusedPart");
                    partbody =  $(e.target).parent();
                }else{
                    //Click on the representation body.
                    $(e.target).addClass("focusedPart");
                }
                
                //Create a custom context menu for the operation
                var partInfo = ao_module_utils.attrToObject(partbody.attr("metadata"));
                console.log(partInfo);
                if (partInfo[3] == true){
                    //This disk is mounted. Provide unmount btn
                    if (partInfo[1] == "/" || partInfo[1] == "/boot"){
                        //No, you can't unmount root nor format it
                        $("#mtbtn").addClass("disabled");
                        $("#formatDisk").addClass("disabled");
                    }else{
                        $("#mtbtn").removeClass("disabled");
                        $("#formatDisk").removeClass("disabled");
                    }
                    $("#mtbtn").html('<i class="usb icon"></i> Safely Remove Hardware');
                    if (partInfo[1].substring(0,6) == "/media"){
                         //This can be opened
                         $("#openbtn").removeClass("disabled");
                    }else{
                         $("#openbtn").addClass("disabled");
                    }
                }else{
                    //This disk is not mounted. Provide mount btn
                    $("#mtbtn").html('<i class="usb icon"></i> Mount Drive');
                    $("#openbtn").addClass("disabled");
                    $("#mtbtn").removeClass("disabled");
                    $("#formatDisk").removeClass("disabled");
                }
                //Prevent browser menu from showing
                return false;
            });
        }
        
        function adjustPartitionViewHeight(){
            $("#diskVisualization").css("height",window.innerHeight - $("#diskListTable").height() + "px");
        }
        
        function initView(){
            if (mode == "window"){
                //Runing on top of Window Host
                $.get("diskmgWin.php",function(data){
                    $("#diskInfoTable").html("");
                    if (data.includes("ERROR") == false){
                       for (var i = 0; i < data.length; i++){
                           var thisDisk = data[i];
                           $("#diskInfoTable").append('<tr>\
                            <td class="collapsing">\
                                <i class="disk outline icon"></i>' + thisDisk[0] + '\
                            </td>\
                            <td class="">' + thisDisk[2] + '</td>\
                            <td class="collapsing">' + thisDisk[1] + '</td>\
                            <td class="right aligned collapsing">' + thisDisk[3] + '</td>\
                            <td class="right aligned collapsing">' + bytesToSize(thisDisk[6]) + '</td>\
                            <td class="right aligned collapsing">' + bytesToSize(thisDisk[5]) + '</td>\
                            <td class="right aligned collapsing">' + Math.round(thisDisk[5] / thisDisk[6] * 100) + '%</td>\
                        </tr>');
                       }
                    }
                });
            }else{
                //Runing on top of Linux Host
                $.get("diskmg.php",function(data){
                    $("#diskInfoTable").html("");
                    if (data.includes("ERROR") == false){
                        var disks = data[0]["blockdevices"];
                        var partitions = data[1];
                       for (var i = 0; i < disks.length; i++){
                           var thisDisk = disks[i]["children"];
                           if (thisDisk === undefined){
                               break;
                           }
                           for (var j =0; j < thisDisk.length; j++){
                               var thisPartition = thisDisk[j];
                               var mtPoint = thisPartition["mountpoint"];
                               if (mtPoint === null){
                                   mtPoint = "Not Mounted";
                               }
                               //Get the filesystem from another command return results
                               var disksFormats = data[1]["blockdevices"][i]["children"][j];
                               var fstype = disksFormats["fstype"];
                               if (fstype === null){
                                   fstype = "raw";
                               }
                               //console.log(disksFormats);
                               
                               //Read freesapce from the last command return results
                               var freeSpacesRatio = "0%";
                               for (var k =0; k < data[2].length; k++){
                                   if (data[2][k][5] == thisPartition["mountpoint"]){
                                       //This device is mounted at the same path as current partition. It should be this volume
                                       freeSpacesRatio = data[2][k][4];
                                   }
                               }
                               if (freeSpacesRatio === undefined){
                                   freeSpacesRatio = "0%";
                               }
                               var numericalFreeSpace = parseInt(freeSpacesRatio.replace("%","")) * thisPartition["size"] / 100;
                               
                               //Print the results to the interface
                               //console.log(thisPartition);
                               $("#diskInfoTable").append('<tr>\
                                    <td class="collapsing">\
                                        <i class="disk outline icon"></i>' + thisPartition["name"] + '\
                                    </td>\
                                    <td class="">' +  mtPoint + '</td>\
                                    <td class="right aligned collapsing">' + fstype + '</td>\
                                    <td class="right aligned collapsing">' + bytesToSize(thisPartition["size"]) + '</td>\
                                    <td class="right aligned collapsing">' + bytesToSize(numericalFreeSpace) + '</td>\
                                    <td class="right aligned collapsing">' + freeSpacesRatio + '</td>\
                                </tr>');
                           }
                           
                       }
                    }
                });
            }
        }
    
        
        function initPartitionTable(){
             if (mode == "window"){
                  $.get("diskmgWin.php?partition",function(data){
                    var disks = {};
                    for(var i =0; i < data.length; i++){
                        var thisPart = data[i];
                        //var diskID = thisPart[9].replace(":","");
                        var diskID = thisPart[0].replace(/\\+.+\\/,"");
                        if (disks == undefined || disks[diskID] == undefined){
                            disks[diskID] = {"partitionsTotalSize":thisPart[14],"partitionNames":[thisPart[16]],"partitionID":[ thisPart[9]],"partitionVolume":[thisPart[14]],"Type":[thisPart[5]],"Mounted":[thisPart[4]=="True"],"Format":[thisPart[12]]};
                        }else{
                           disks[diskID]["partitionsTotalSize"] = parseInt(disks[diskID]["partitionsTotalSize"]) + parseInt(thisPart[14]);
                           disks[diskID]["partitionVolume"].push(thisPart[14]);
                           disks[diskID]["partitionNames"].push(thisPart[16]);
                           disks[diskID]["partitionID"].push(thisPart[9]);
                           disks[diskID]["Type"].push(thisPart[5]);
                           disks[diskID]["Format"].push(thisPart[12]);
                           disks[diskID]["Mounted"].push(thisPart[4]=="True");
                        }
                    }
                    diskInformation = JSON.parse(JSON.stringify(disks));
                    drawDartitionTable();
                });
                
             }else{
                 //This is a Linux Host
                  $.get("diskmg.php",function(data){
                      var disks = {};
                      var diskInfo = data[0]["blockdevices"];
                      for (var i =0; i < diskInfo.length; i++){
                          var thisDisk = diskInfo[i];
                          var diskID = thisDisk["name"];
                          if (thisDisk["children"] === undefined){
                              //This disk do not have any child. Assume a large read-only raw partition.
                              disks[diskID] = {"partitionsTotalSize":0,"partitionNames":["Hotplug"],"partitionID":["✖"],"partitionVolume":[0],"Type":[thisPart["type"]],"Mounted":[thisPart["mountpoint"] !== null],"Format":[""]};
                              break;
                          }
                          for (var j =0; j < thisDisk["children"].length;j++){
                            var thisPart = thisDisk["children"][j];
                            var disksFormats = data[1]["blockdevices"][i]["children"][j];
                            console.log(disksFormats);
                            if (disks == undefined || disks[diskID] == undefined){
                                disks[diskID] = {"partitionsTotalSize":thisPart["size"],"partitionNames":[thisPart["mountpoint"]],"partitionID":[thisPart["name"]],"partitionVolume":[thisPart["size"]],"Type":[thisPart["type"]],"Mounted":[thisPart["mountpoint"] !== null],"Format":[disksFormats["fstype"]]};
                            }else{
                               disks[diskID]["partitionsTotalSize"] = parseInt(disks[diskID]["partitionsTotalSize"]) + parseInt(thisPart["size"]);
                               disks[diskID]["partitionVolume"].push(thisPart["size"]);
                               disks[diskID]["partitionNames"].push(thisPart["mountpoint"]);
                               disks[diskID]["partitionID"].push(thisPart["name"]);
                               disks[diskID]["Type"].push(thisPart["type"]);
                               disks[diskID]["Format"].push(disksFormats["fstype"]);
                               disks[diskID]["Mounted"].push(thisPart["mountpoint"] !== null);
                            }
                          }
                      }
                      diskInformation = JSON.parse(JSON.stringify(disks));
                      drawDartitionTable();
                  });
                 
             }
             
        }
        
        function drawDartitionTable(){
            var disks = JSON.parse(JSON.stringify(diskInformation));
            //Clear the old diskpart table
            $("#diskVisualization").html("");
            //Render the partition table
            var maxWidth = window.innerWidth * 0.95 - 110;
            var maxCapDisk = -1;
            var keys = [];
            for (key in disks){
                keys.push(key);
                var thisDiskSize = disks[key]["partitionsTotalSize"];
                if (thisDiskSize > maxCapDisk){
                    maxCapDisk = thisDiskSize;
                }
            }
            
            keys.sort();
            for (var i =0; i < keys.length; i++){
                var diskInfo = disks[keys[i]];
                var diskID = keys[i];
                var mountState = "Mounted";
                var shortenType = diskInfo["Type"][0].split(" ").shift();
                var thisMaxWidth = maxWidth - (1- (diskInfo["partitionsTotalSize"] / maxCapDisk)) * (window.innerWidth * displayScaleRatio);
                if (diskInfo["Mounted"] == false){
                    mountState = "Unmounted";
                }
                //console.log(diskID,diskInfo);
                //Append the disk info block
                $("#diskVisualization").append('<div class="diskPartTable">');
                $("#diskVisualization").append('<div class="sideblock">\
                    <i class="disk outline icon" style="margin-right:0px;font-weight: bold;"></i>\
                    <b style="font-weight: bold;">Drive ' + i + '</b><br>\
                    ' + shortenType + '<br>\
                    ' + bytesToSize(diskInfo["partitionsTotalSize"]) + '<br>\
                    ' + mountState + '\
                </div>');
                var partitionIDs = diskInfo["partitionID"];
                for (var k =0; k < partitionIDs.length; k++){
                    var thisWidth = thisMaxWidth * (parseInt(diskInfo["partitionVolume"][k]) / diskInfo["partitionsTotalSize"]);
                    var topbarExtraClass = "";
                    if (diskInfo["partitionVolume"][k] == 0){
                        topbarExtraClass = " unallocate";
                    }else if (diskInfo["partitionNames"][k] === null){
                        topbarExtraClass = " unmounted";
                        diskInfo["partitionNames"][k] = "Not Mounted";
                    }
                    $("#diskVisualization").append('<div class="partitionRepresentation" style="width:' + thisWidth + 'px;" metaData="\
                    ' + ao_module_utils.objectToAttr([diskInfo["partitionID"][k],diskInfo["partitionNames"][k],diskInfo["Format"][k],diskInfo["Mounted"][k],diskInfo["Type"][k],diskInfo["partitionVolume"][k]]) + '">\
                        <div class="partitionTopBar' + topbarExtraClass + '"></div>\
                        <div class="partitionDescription">\
                            ' + diskInfo["partitionNames"][k] +" (" + diskInfo["partitionID"][k] + ')<br>\
                            ' + bytesToSize(parseInt(diskInfo["partitionVolume"][k])) + ' ' + diskInfo["Format"][k] + '<br>\
                        </div>\
                    </div>');
                }
                $("#diskVisualization").append('</div>');
            }
            
            setTimeout(function(){
                adjustPartitionViewHeight();
            },500);
            createEventHooks();
        }
        
        $(window).on("resize",function(){
            adjustPartitionViewHeight();
            drawDartitionTable();
        });
        
        $("#diskVisualization").on('click',function(e){
           var target = e.target;
           //console.log($(target).parents(".partitionRepresentation"));
           if ($(target).parents(".partitionRepresentation").length == 0 && !$(target).hasClass("partitionRepresentation")){
               $("#rightClickMenu").hide();
           }else if (e.button == 0){
               if ($(target).parents(".partitionRepresentation").length > 0 || $(target).hasClass("partitionRepresentation")){
                   $(".focusedPart").removeClass("focusedPart");
                   if ($(target).parent().hasClass("partitionRepresentation")){
                       $(target).parent().addClass("focusedPart");
                   }else{
                       $(target).addClass("focusedPart");
                   }
               }
               $("#rightClickMenu").hide();
           }
        });
        
        function bytesToSize(bytes) {
            if (viewMode == "human"){
                var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
                 if (bytes == 0) return '0 Byte';
                 var i = parseFloat(Math.floor(Math.log(bytes) / Math.log(1024)));
                 return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
            }else if (viewMode == "raw"){
                return bytes + " B";
            }
           
        }
    </script>
    </body>
</html>