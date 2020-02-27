<?php
include_once '../../../auth.php';

if (isset($_GET['getClusterList'])){
    if (file_exists("mappers/")){
        $results = [];
        $clusterUUIDs = glob("mappers/*.inf");
        foreach ($clusterUUIDs as $uuid){
            $thisuuid = basename($uuid,".inf");
            $ipaddr = file_get_contents($uuid);
            $nickname = $thisuuid;
            if (file_exists("nickname/" . basename($uuid))){
                $nickanme = file_get_contents("nickname/" . basename($uuid));
            }
            array_push($results, [$uuid, $ipaddr,$nickname]);
        }
        header('Content-Type: application/json');
        echo json_encode($results);
        exit(0);
    }else{
        die("ERROR. Mapper directory not found. Please perform a scan first.");
    }
}
?>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.8, maximum-scale=0.8"/>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>Cluster Selector</title>
    <link rel="stylesheet" href="../../../script/tocas/tocas.css">
	<script src="../../../script/tocas/tocas.js"></script>
	<script src="../../../script/jquery.min.js"></script>
	<script src="../../../script/ao_module.js"></script>
	<style>
	.item {
		cursor: pointer;
	}
	body{
	    background-color:#f0f0f0;
	}
	
	.topbar{
	    position:fixed !important;
	    left:0px !important;
	    top:-13px !important;
	    width:100%;
	    z-index:99;
	}
	
	.dirbar{
	    width:80%;
	    display:inline;
	}
	
	.dirbarHorizon{
	    width:100%;
	    padding-top:10px !important;
	}
	
	.sidebar{
	    border-right: 1px solid #d6d6d6;
	    padding-left:30px !important;
	    padding-right:15px !important;
	    background-color:white;
	    padding-top:20px !important;
	    min-height:300px;
	}
	
	.selectable{
	    padding:5px !important;
	    padding-left:12px !important;
	    border: 1px solid transparent !important;
	    white-space: nowrap !important;
		text-overflow: ellipsis;
		overflow: hidden; 
	}
	
	.selectable:hover{
	    border: 1px solid #aab7fa !important;
	    background-color:#d6ddff !important;
	}
	
	.fileListMenu{
	    padding-right:20px !important; 
	}
	
	.selected{
	    background-color:#c2cdff !important;
	    white-space: normal !important;
		text-overflow:initial;
		overflow: visible;
	}
	.dimmer{
		height:100% !important;
		position:fixed !important;
		left:0px !important;
		top:0px !important;
		z-index:99 !important;
	}
	.onlineState{
	    font-size:80%;
	}
	.blackFont{
	    color:black !important;
	}
	.diskNode{
	    padding:10px !important;
	}
	.diskList{
	    padding:3px !important; 
	}
	.diskinfo{
	    padding:8px;
	    font-size:130%;
	    border-radius: 4px;
	    border: 1px solid transparent;
	}
	.diskinfo:hover{
	    border: 1px solid #c2cdff;
	    background-color: #e5efff;
	}
	.diskDetails{
	    padding-left:30px;
	    font-size:80%;
	}
	</style>
</head>
<body>
<?php
$allowMultiple = "false";
$selectMode = "node"; //Allow node / disk
if (isset($_GET['allowMultiple']) && $_GET['allowMultiple'] == "true" ){
    $allowMultiple = "true";
}

if (isset($_GET['selectMode']) && $_GET['selectMode'] != "" ){
    if (in_array($_GET['selectMode'],["node","disk"])){
        $selectMode = $_GET['selectMode'];
    }else{
        die("ERROR. Not supported selectMode. Only allow 'node' or 'disk' mode");
    }
}

if (isset($_GET['puid']) && $_GET['puid'] != ""){
    $parentUID = $_GET['puid'];
}
?>
<div style="display:none;">
    <div id="allowMultiple"><?php echo $allowMultiple;?></div>
    <div id="selectMode"><?php echo $selectMode;?></div>
    <div id="parentUID"><?php echo $parentUID;?></div>
</div>

<div id="topMenubar" class="ts fluid raised segment topbar">
    <button class="ts tiny icon button" onClick="refresh();"><i class="refresh icon"></i></button>
    <div id="pathbar" class="ts tiny action input dirbar">
        <input type="text" id="searchKeyword" style="width:100%;" placeholder="Enter cluster name to search">
        <button class="ts icon primary button" onClick="searchName();" ><i class="search icon"></i></button>
    </div>
    <button class="ts positive icon button" onClick="confirmSelection();"><i class="checkmark icon"></i></button>
</div>
<div style="position:absolute; top:63px; left:0px; width:100%; height:100%;">
    <div id="content" class="ts fluid stackable grid padded" style="height:100%  !important;">
        <div class="four wide column sidebar" style="height:100% !important;">
            <p id="fsd">Laoding cliuster list...</p>
            <p id="sfc">Selected node / disk: 0</p>
        </div>
        <div class="twelve wide column fileListMenu">
            <div id="filelist" class="ts list" style="padding:10px;font-size:120%;">
                
            </div>
        </div>
    </div>
</div>
<div id="dimmer" class="ts active dimmer" style="display:none;">
	<div id="dimmerText" class="ts text loader">Processing...</div>
</div>
 <script>
    var allowMultiple = $("#allowMultiple").text().trim() == "true";
    var selectMode = $("#selectMode").text().trim();
    var puid = $("#parentUID").text().trim();
    var selectionConfirmed = false;
    var nickNameList = [];
    initSelection();
	
	 if (selectMode == "node"){
         ao_module_setWindowIcon("server");
         ao_module_setWindowTitle("Select Remote Node");
     }else{
         //Select disk on remote devices
         ao_module_setWindowIcon("disk outline");
         ao_module_setWindowTitle("Select Remote Disks");
     }
     ao_module_setGlassEffectMode();
     
     function confirmSelection(){
         //Constructing the selected list from DOM elements
        var selectedClusters = [];
        var containOffline = false;
        if (selectMode == "node"){
            //Node mode
            $(".selected").each(function(){
                var ip = $(this).attr("ipAddr");
                var uuid = $(this).attr("uuid");
                var status = $(this).attr("status");
                var nodeOnline = false;
                if (status == "offline"){
                    containOffline = true;
                }else{
                    nodeOnline = true;
                }
                selectedClusters.push({hostIP: ip, hostUUID: uuid, hostOnline: nodeOnline});
            });
            
            //Check and make sure if the user want to choose offline nodes
            if (containOffline){
                if (!confirm("Are you sure you want to choose OFFLINE NODES?")){
                    return;
                }   
            }
        }else{
            //Disk Mode
            $(".selected").each(function(){
                var thisDiskID = $(this).attr("diskID");
                selectedClusters.push({diskID: thisDiskID});
            });
        }
        
        //Handling data sending
         if (ao_module_virtualDesktop){
             var returnvalue = ao_module_parentCallback(selectedClusters);
             if (returnvalue == false){
                 console.log("%c[Cluster Selector] ERROR. Something wrong happened during sending selected file to parent. Are you sure the parent is alive?",'color: #ff4a4a');
             }else{
                 console.log("%c[Cluster Selector] Cluster Selected. Closing file selector...",'background: #f2f2f2; color: #363636');
                 ao_module_close();
                 selectionConfirmed = true;
             }             
         }else{
             //If the selector is not in VDI mode, callback using tmp variable in localStorage
             ao_module_writeTmp(puid,selectedClusters);
             selectionConfirmed = true;
			 $("#dimmer").show();
			 setTimeout(timeOutWarning,10000);
         }
     }
     
     function timeOutWarning(){
		 $("#dimmerText").html("<i class='remove icon'></i>Error. Parent window has no response. Please retry later.");
	 }
	 
     //Handle keyword searching change
     $("#searchKeyword").on("change",function(){
         updateSearchResult();
     });
     
     function updateSearchResult(){
         var keyword = $("#searchKeyword").val().trim();
         if (keyword.length > 0){
             if (selectMode == "disk"){
                 $(".diskinfo").each(function(){
                     //For each keyword in disk information
                     if ($(this).text().includes(keyword) == true){
                         //Show this 
                         $(this).show();
                     }else{
                         //Hide this
                          $(this).hide();
                     }
                 });
             }else if (selectMode == "node"){
                 $(".displayName ").each(function(){
                     if ($(this).text().includes(keyword)){
                         $(this).parent().parent().show();
                     }else{
                         $(this).parent().parent().hide();
                     }
                 });
             }
             
         }else{
             //No keyword. Show everything
              $(".diskinfo").show();
         }
     }

     
     function initSelection(){
         nickNameList = [];
         loadClusterList();
    	 loadNicknameList();
     }
     
     function updateSelectionCount(){
         $("#sfc").text("Selected node / disk: " + $(".selected").length);
     }
     function refresh(){
         initSelection();
         $("#filelist").html("");
         $("#sfc").text("Selected node / disk: 0");
         $("#searchKeyword").val("");
     }
     
     function replaceTag(tag,replacement,content){
         return content.split("{" + tag + "}").join(replacement);
     }
     
    function loadNicknameList(){
        $.ajax("clusterNicknameConfig.php").done(function(data){
            nickNameList = data;
            //console.log(nickNameList);
        });
    }
     
	function loadClusterList(){
	    var template = '<div class="selectable item clusterNode" ipaddr="{ipaddr}" uuid="{uuid}" onClick="selectNode(this);">\
                    <i class="server icon blackFont"></i>\
                    <div class="content">\
                        <div class="header displayName blackFont">{host_name}</div><div class="onlineState blackFont" ipaddr="{ipaddr}" retry="0"><i class="spinner loading icon blackFont"></i> Checking host online status</div>\
                    </div>\
                </div>';
	    $.ajax("clusterSelector.php?getClusterList").done(function(data){
	        //console.log(data);
	        $("#filelist").html("");
	        for (var i =0; i < data.length; i++){
	            var box = template;
	            box = replaceTag('ipaddr',data[i][1],box);
	            box = replaceTag('uuid',data[i][2],box);
	            box = replaceTag('host_name',data[i][2],box);
	            if (selectMode != "node"){
	                //Disk mode. Node is no longer selectable
	                box = $(box).removeClass("selectable");
	            }
	            $("#filelist").append(box);
	        }
	        updateStatus("Cluster list loaded. Matching nickname from database.");
	        checkOnlineStatus();
	        resolveNickName();
	    });
	}
	
	function selectNode(object){
	    if (selectMode != "node"){
	        //Node is not selectable in disk mode.
	        return;
	    }
	    if (allowMultiple){
	        if ($(object).hasClass("selected")){
	            $(object).removeClass("selected");
	        }else{
	            $(object).addClass("selected");    
	        }
	    }else{
	        $(".selected").removeClass("selected");
	        $(object).addClass("selected");
	    }
	    updateSelectionCount();
	}
	
	function selectDisk(object){
	    console.log(object);
	    if (allowMultiple){
	        if ($(object).hasClass("selected")){
	            $(object).removeClass("selected");
	        }else{
	            $(object).addClass("selected");    
	        }
	    }else{
	        $(".selected").removeClass("selected");
	        $(object).addClass("selected");
	    }
	    updateSelectionCount();
	}
	
	function updateStatus(text){
	    $("#fsd").text(text);
	}
	
	function resolveNickName(){
	    if (nickNameList.length == 0){
	        //The nickname list is not init yet. Do resolve process later
	        setTimeout(resolveNickName,500);
	        console.log("[Cluster Selector] nickname list empty! Retrying in 500 ms.");
	        return;
	    }
	    $(".clusterNode").each(function(){
	        var uuid = $(this).attr("uuid");
	        for (var i =0; i < nickNameList.length; i++){
	            if (nickNameList[i][0] == uuid){
	                //This uuid matched this nickname, update the display name
	                $(this).find(".displayName").html(nickNameList[i][1] + " (UUID: " + uuid + ")");
	                $(this).attr("nickName",nickNameList[i][1]);
	            }
	        }
	    });
	    
	    if (selectMode == "node"){
	        if (allowMultiple == true){
	            updateStatus("Select one or more nodes from the list below.");
	        }else{
	             updateStatus("Select one node from the list below.");
	        }
	    }else{
	        if (allowMultiple == true){
	            updateStatus("Select one or more remote disks from the list below.");
	        }else{
	             updateStatus("Select one disk from the list below.");
	        }
	    }
	    
	}
	
	function checkOnlineStatus(){
	    //Check if the required clusters / hosts is online
	    $(".onlineState").each(function(){
	        //Write the request time in the DOM
	        $(".onlineState").attr("startTime",new Date().getTime());
	        getInfo($(this));
	    });
	}
	
	function getInfo(object){
	    var ip = $(object).attr("ipaddr");
	    $.ajax("getInfo.php?ipaddr=" + ip).done(function(data){
	        if (data.includes("ERROR") == false){
	            //data is the uuid for listening to the cluster services
	            setTimeout(function(){
	                listenInfo(object,data);
	            },500);
	        }
	    });
	}
	
	function listenInfo(object,uuid){
	    var retry = parseInt($(object).attr("retry"));
	    if (retry < 3){
	         $.ajax("getInfo.php?listen=" + uuid).done(function(data){
    	        if (data.includes("false") == false){
    	            ///This node is online.
    	            if (selectMode == "node"){
    	                var respTime = (new Date().getTime()) - parseInt($(object).attr("startTime")) - 500 * retry;
        	            $(object).html('<i class="checkmark icon" style="color:#29a569;"></i> Host Online. Relay response time: ' + respTime + " ms");
        	            $(object).css("color","#29a569");
        	            $(object).parent().parent().attr("status","online");
    	            }else{
    	                //Pass the information of cluster into disk selection generator
    	                var diskInfo = JSON.parse(data[2]);
    	                console.log(diskInfo);
    	                var diskList = '<div class="ts segment diskList">';
    	                    for (var i =0; i < diskInfo.length; i++){
    	                        var thisDisk = diskInfo[i];
    	                        diskList = diskList + '<div class="diskinfo" diskID="'+ uuid + ":" + thisDisk[0] + '" onClick="selectDisk(this);"><i class="disk outline icon"></i>' + thisDisk[1] + " (" +  thisDisk[0] + ")" + '\
    	                                    <div class="diskDetails">Remaining: ' + thisDisk[2] + '</div>\
    	                               </div>';
    	                    }
    	                diskList = diskList + '</div>';
    	                $(object).html(diskList);
    	            }
    	            
    	        }else{
    	            //No record yet or no response. Retry 3 times.
    	            retry++;
	                $(object).attr("retry",retry + "");
	                $(object).parent().parent().attr("status","offline");
	                setTimeout(function(){
    	                listenInfo(object,uuid);
    	            },500);
    	        }
    	    });
	        
	    }else{
	        //Declare this node as offline
	        $(object).html('<i class="remove icon" style="color:#c42f2f;"></i> Host Offline');
    	    $(object).css("color","#c42f2f");
	    }
	}
	
     window.onbeforeunload = function(){
       //On before unload
       if (ao_module_virtualDesktop == false && selectionConfirmed == false){
           //As there are module waiting for returned data, if the user try to close this page without selection, the return tmp variable will also be set to an empty array.
           ao_module_writeTmp(puid,[]);
       }
    }

 </script>
</body>
</html>