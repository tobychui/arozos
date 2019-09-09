<?php
include_once '../auth.php';
?>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>My Host - Disk Info</title>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script src="../script/tocas/tocas.js"></script>
	<script src="../script/jquery.min.js"></script>
	<script src="../script/ao_module.js"></script>
	<style>
    	body{
    	    min-width:300px;
    	}
	    .fixedsize{
            min-width:280px;
			border: 1px solid transparent;
			cursor:pointer;
	    }
		.fixedsize:hover{
			background-color:#ecf3fd;
			border: 1px solid #b8d6fb;
			border-radius: 3px;
		}
		.clickedFixedSize{
			background-image: linear-gradient(#daeafc,#c1dcfc);
			border: 1px solid #7da2ce !important;
			border-radius: 3px;
			cursor:pointer !important;
		}
		.selectable{
		    border: 1px solid transparent;
		    padding-left:10px !important;
		    padding-top:3px !important;
		    padding-bottom:1px !important;
		    margin-right: 3px !important;
		    border-radius: 3px;
		}
		
		.selectable:hover{
		    background-color:#ecf3fd;
			border: 1px solid #b8d6fb;
			cursor: pointer;
		}
		
		.statusIcon{
		    padding-top:2px !important;
		}
		.botomRightCorner{
		    position:absolute;
		    bottom:10px;
		    right:10px;
		}
		.forceoneline{
		    display:inline-block !important;
		    overflow-wrap: break-word; 
		    word-break: break-all;
		}
		.offlineCluster{
		    display:none !important;
		}
	</style>
</head>
<body style="overflow:hidden; padding-right: 15px;background:rgba(255,255,255,0.9);">
		<div id="sidebar" class="" style="background-color:white;z-index:10;height:100%;left:0px;width:180px;position:relative;overflow-y:auto; border-right-style: solid; border-right-color: #d3d3d3;padding-left: 15px">
			<br>
			<div class="ts container">
				<div class="ts list">
					<div class="item"><i class="star icon"></i>Shorcuts
						<div class="list">
							<div class="item selectable" onClick="OpenDefaultPath(10);" style="cursor: pointer;"><i class="desktop icon"></i>Desktop</div>
							<div class="item selectable" onClick="OpenDefaultPath(11);" style="cursor: pointer;"><i class="server icon" style="cursor: pointer;"></i>System Root</div>
						</div>
					</div>
					<br>
					<div class="item" style="cursor: pointer;"><i class="folder outline icon"></i>Media
						<div class="list">
							<div class="item selectable" onClick="OpenDefaultPath(20);"><i class="file text outline icon"></i>Documents</div>
							<div class="item selectable" onClick="OpenDefaultPath(21);"><i class="music icon"></i>Music</div>
							<div class="item selectable" onClick="OpenDefaultPath(22);"><i class="video icon"></i>Video</div>
							<div class="item selectable" onClick="OpenDefaultPath(23);"><i class="picture icon"></i>Pictures</div>
						</div>					
					</div>
					<br>
					<div class="item" style="cursor: pointer;">
						<div onClick="loadDefaultDriveView();"><i class="server icon"></i>Host Deivces</div>
						<div id="diskList" class="list">
							<div class="item">Loading...</div>
						</div>
					</div>
					<br>
					<?php
					if (file_exists("../SystemAOB/functions/cluster/")){
					?>
					<div id="clusterNetworkDrive" class="item" style="cursor: pointer;">
					    <div onClick="loadNetDiskView();"><i class="wi-fi icon"></i>Network Drives</div>
						<div id="netdriveList" class="list">
							<div class="item selectable"><i class="hdd outline icon"></i>N/A</div>
						</div>
					</div>
					<?php
					}
					?>
				</div>
				<br><br>
			</div>
		</div>
		
		<div id="FSPreview" style="height:100%;position:fixed;overflow-y:auto;left:180px;top:0px;overflow-x:hidden;background-color:white;">
			<br>
			<div class="ts container" style="padding-left: 30px; padding-right: 30px;">
			<div class="ts horizontal divider">Virtual Drives</div>
			    <div id="largeVirtualDriveList" class="ts stackable grid">
					
				</div>
			<div class="ts horizontal divider">Storage Device</div>
				<div id="largeStorageDeviceList" class="ts stackable grid">
					
				</div>
			</div>
		</div>
		<div id="sideBarToggleBtn" class="ts active bottom left snackbar" style="width:45px;cursor: pointer;position:fixed;left:0;bottom:10px;" onClick="ToggleSideBar();">
			<div class="content">
				<i class="sidebar icon"></i>
			</div>
		</div>
<script id="checkOnlineWorker">
    self.onmessage = function(e) {
      var uuid = e.data["clusterInfo"][0];
      var ip = e.data["clusterInfo"][1];
      var prefix = e.data["prefix"];
      var name = e.data["name"];
      var currentWindow = e.data["currentWindow"];
      currentWindow = currentWindow.split("/");
      currentWindow.pop();
      currentWindow.pop();
      currentWindow = currentWindow.join("/");
      tryPingCluster(uuid,ip,prefix,name,currentWindow)
    }
    function tryPingCluster(uuid,ip,prefix,name,currentWindow){
        var request = new XMLHttpRequest();
        request.timeout = 5000;
        request.open('GET', currentWindow + "/SystemAOB/functions/cluster/getInfo.php?ipaddr=" + ip, true);
        request.onload = function() {
            if (request.status >= 200 && request.status < 400) {
                // Success!
                var resp = request.responseText; //The returnedFileID for cluster result checking
                setTimeout(function(){
                    //In most of the case, the fast-ping process should take less than 5ms. For safty purpose, 500 ms is used.
                    getResult(uuid,ip,resp,currentWindow);
                },300);
            }else{
                console.log("[MyHost] Unknown error returned when trying to access cluster function group.");
            }
        };
        request.onerror = function() {
            // There was a connection error of some sort
            console.log("[MyHost] Error when trying to contact background cluster services.");
        };
        request.ontimeout = function (e) {
            console.log("[MyHost] Error when trying to contact background cluster services.");
        };
        request.send();
    }
    
    function getResult(uuid,ip,returnedFileID,currentWindow){
        var request = new XMLHttpRequest();
        request.timeout = 10000;
        request.open('GET', currentWindow + "/SystemAOB/functions/cluster/getInfo.php?listen=" + returnedFileID, true);
        request.onload = function() {
            if (request.status >= 200 && request.status < 400) {
                // Success!
                var resp = request.responseText;
                resp = resp.trim();
                //console.log(resp);
                if (resp == "false"){
                    //The ping result is not returned yet. Assume dead.
                    handlePingResult(uuid,ip,false);
                }else{
                    //The result is ready. Return the main thread that everything is doing fine.
                    handlePingResult(uuid,ip,true,resp);
                }
            }
        };
        request.onerror = function() {
            // There was a connection error of some sort
            handlePingResult(uuid,ip,false);
        };
        request.ontimeout = function (e) {
            handlePingResult(uuid,ip,false);
        };
        request.send();
    }
    
    function handlePingResult(uuid,ip,state,diskInfo = ""){
        self.postMessage([uuid,state,ip,diskInfo]);
    }
</script>
<script>
var sidebarHidden = false;
var isFunctionBar = true;
var diskPaths = [];
var prefix = "AOB";
var port = "80";
var nicknames = [];
var workers = [];
var clusterList = [];
var currentDisplayContent = "localDrives";
var clusterExists = ($("#clusterNetworkDrive").length > 0);
var autoRefresh = false;
$( window ).resize(function() {
	quickAdjust();
});

//Initialize the cluster settings
$.get("../SystemAOB/functions/cluster/clusterSettingLoader.php?json",function(data){
    prefix = data.prefix;
    port = data.port;
});

$(document).ready(function(){
	adjustSideBarWidth();
	//Initiate the cluster loading proceedure
	loadDriveList();
	if (clusterExists){
		//If there is cluser services, list network disk.
		if (window.Worker) {
			//Check if there are web worker. If yes, load the net disk with background workers
			pp_initNickNameClusterList();
			setInterval(function(){
				pp_updateClusterOnlineStatus();
				if (currentDisplayContent == "networkDrives" && autoRefresh){
					loadNetdiskDetail();
				}
			},30000); //Update cluster information every 30 seconds
		}else{
			//If the browser do not support worker, use the AJAX one by one request methods
			loadNetdiskList(); 
		}
	}
	
});

if (isFunctionBar){
	 //If it is currently in VDI, force the current window size and resize properties
	var windowID = $(window.frameElement).parent().attr("id");
	parent.setWindowPreferdSize(windowID + "",1080,650);
	parent.setGlassEffectMode(windowID + "");
}

/**
 * These are the functions used to parallelize the Cluster Listing tasks and make cluster discovery faster
 * These sections of code only works when there are web worker supported in your browser
 * All functions related parallel processing will start with prefix "pp_"
 * 
 **/

function SCRIPT2WORKER(divID){
    var result = new Blob([
        document.querySelector('#' + divID).textContent
      ], { type: "text/javascript" });
    return result;
}

function pp_initNickNameClusterList(){
    //Start two process for requesting the NicknameList and Cluster List at the same time
    var finished = [0,0];
    var nickname = [];
    $.get("../SystemAOB/functions/cluster/clusterNicknameConfig.php",function(data){
        if(data.includes("ERROR") == false){
            nickname = data;
            nicknames = nickname;
            finished[0] = 1;
            if (finished[1] == 1){
                pp_startParallelCheckOnlineProcess(nickname,clusterList);
            }
        }
    });
    
    $.get("../SystemAOB/functions/cluster/getClusterList.php",function(data){
        if(data.includes("ERROR") == false){
            clusterList = data;
            finished[1] = 1;
            if (finished[0] == 1){
                 pp_startParallelCheckOnlineProcess(nickname,clusterList);
            }
        }
    });
}

function pp_updateClusterOnlineStatus(){
    for (var i =0; i < workers.length;i++){
        var thisname = getValueByKey(nicknames,clusterList[i][0]);
        workers[i].postMessage({name: thisname, clusterInfo: clusterList[i], prefix: prefix, currentWindow: window.location.href});
    }
}

function pp_startParallelCheckOnlineProcess(nickname,clusterList){
    //Create the UI element for network disk
    $("#netdriveList").html("");
    for (var i =0; i < clusterList.length; i++){
        var thisname = getValueByKey(nickname,clusterList[i][0]);
        if (thisname == false){
            //This host is unnamed. Use its ip address instead.
            thisname = clusterList[i][1];
        }
        $("#netdriveList").append('<div class="item selectable forceoneline cluster offlineCluster" clusterID="' + clusterList[i][0] + '" lastSeen="' + clusterList[i][1] + '" clusterinfo="offline" ><i class="circle thin small icon statusIcon"></i>' + thisname + '</div>');
        var worker = new Worker(window.URL.createObjectURL(SCRIPT2WORKER("checkOnlineWorker")));
        worker.onmessage = function(e) {
          pp_updateClusterStatus(e);
        }
        worker.postMessage({name: thisname, clusterInfo: clusterList[i], prefix: prefix, currentWindow: window.location.href});
        workers.push(worker);
    }
    
    
}

function pp_updateClusterStatus(e){
    var uuid = e.data[0];
    var isOnline = e.data[1];
    var ip = e.data[2];
    var diskinfo = e.data[3];
    if (isOnline){
        setOnline(uuid,ip);
        diskinfo = JSON.parse(JSON.parse(diskinfo)[2]);
        getClusterDivByID(uuid)[0].attr("clusterInfo",ao_module_utils.objectToAttr(diskinfo));
        getClusterDivByID(uuid)[0].attr("updateTime",getCurrentFormattedTime());
    }else{
        setOffline(uuid,ip);
        getClusterDivByID(uuid)[0].attr("clusterInfo","offline");
        getClusterDivByID(uuid)[0].attr("updateTime",getCurrentFormattedTime());
    }
}

//End of parallel processing functions group

function loadNetdiskList(){
    //Initiate the list of Network Disks
    $.get("../SystemAOB/functions/cluster/clusterNicknameConfig.php",function(data){
        if(data.includes("ERROR") == false){
            //Nickname access successed
            nicknames = data;
            $.get("../SystemAOB/functions/cluster/getClusterList.php",function(data){
                if(data.includes("ERROR") == false){
                    $("#netdriveList").html("");
                    for(var i =0; i < data.length;i++){
                        var nickname = getValueByKey(nicknames,data[i][0]);
                        if (!nickname){
                            nickname = data[i][1];
                        }
                        $("#netdriveList").append('<div class="item selectable cluster" clusterID="' + data[i][0] + '" lastSeen="' + data[i][1] + '"><i class="circle thin small icon statusIcon"></i>' + nickname + '</div>');
                        tryPingCluster(data[i][0],data[i][1],prefix,setOnline,setOffline);
                    }
                }else{
                    console.log("[MyHost] Error. Something goes wrong while trying access to cluster services.");
                    $("#netdriveList").html('<div class="item selectable"><i class="hdd outline mini icon"></i>Fail to load Cluster Services.</div>');
                }
            });
        }else{
            $("#netdriveList").html('<div class="item selectable"><i class="hdd outline mini icon"></i>Fail to load Cluster Services.</div>');
            console.log("[MyHost] Error. Something goes wrong while trying access to cluster services.");
        }
    });
}

function getValueByKey(arr,key){
    for(var i = 0; i < arr.length; i++){
        if(arr[i][0] == key){
            return arr[i][1];
        }
    }
    return false;
}

function getClusterDivByID(uuid){
    var result = [];
    $(".cluster").each(function(){
        if ($(this).attr("clusterID") == uuid){
            result.push($(this));
        }
    });
    return result;
}

function setOnline(uuid,ip){
    console.log(uuid + " is online");
    getClusterDivByID(uuid)[0].find("i").css("color","#8bb96e").removeClass("thin");
    getClusterDivByID(uuid)[0].removeClass("offlineCluster");
}

function setOffline(uuid,ip){
    console.log(uuid + " is offline");
    getClusterDivByID(uuid)[0].find("i").css("color","#ce5f58").removeClass("thin");
    getClusterDivByID(uuid)[0].addClass("offlineCluster");
}

function tryPingCluster(uuid,ip,prefix,succ,fail){
    $.ajax({
        url: "../SystemAOB/functions/cluster/requestInfo.php?ip=" + ip + "/" + prefix,
        success: function(data){
            //The cluster with this ip is online.
        	succ(uuid,ip);
        },
        error: function(data){
            //The cluster with this ip do not exists / offline at the moment.
            fail(uuid,ip);
        },
        timeout: 10000 //in milliseconds
    });
}

function quickAdjust(){
	var w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
	var h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
	if (w < 700){
		$("#sidebar").hide();
		$("#sidebar").css("left",-$("#sidebar").outerWidth());
		$("#FSPreview").css("width",w + "px");
		$("#FSPreview").css("left","15px");
		$("#sideBarToggleBtn").show();
		sidebarHidden = true;
	}else{
		$("#sidebar").css("width","180px");
		$("#FSPreview").css("width",(w - 180) + "px");
		$("#FSPreview").css("left","180px");
		$("#FSPreview iframe").attr("width",(w - 180) + "px");
		$("#sidebar").show();
		$("#sidebar").css("left",0);
		sidebarHidden = false;
		$("#sideBarToggleBtn").hide();
	}
}


function adjustSideBarWidth(){
	var w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
	var h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
	if (w < 700){
		hideSideBar();
		$("#FSPreview").css("width",w + "px");
		$("#FSPreview").css("left","15px");
		$("#sideBarToggleBtn").show();
	}else{
		$("#sidebar").css("width","180px");
		$("#FSPreview").css("width",(w - 180) + "px");
		$("#FSPreview").css("left","180px");
		showSideBar();
		$("#sideBarToggleBtn").hide();
	}
}

function showSideBar(){
	$("#sidebar").show();
	$("#sidebar").animate({ left: parseInt($("#sidebar").css('left'),10) == 0});
	sidebarHidden = false;
}

function hideSideBar(){
	$("#sidebar").animate({ left: (-$("#sidebar").outerWidth())},function(){$("#sidebar").hide();});
	sidebarHidden = true;
}

function ToggleSideBar(){
	if (sidebarHidden == true){
		showSideBar();
	}else{
		hideSideBar();
	}
}

function loadDriveList(){
    currentDisplayContent = "localDrives";
	$.ajax({
        type: "GET",
        url: '../SystemAOB/functions/system_statistic/getDriveStat.php',
        success: function(data) {
            // Run the code here that needs
            //    to access the data returned
            if (data.includes("ERROR")){
				console.log("[My Host] GET Drive info error.");
				$("#diskList").html('<div class="item"><i class="remove icon"></i>Bad Request</div>');
			}else{
				//Update sidebar
				$("#diskList").html("");
				$("#largeStorageDeviceList").html("");
				$("#largeVirtualDriveList").html("");
				//Append the standard shortcuts into the device ist
				$("#largeVirtualDriveList").append('<div class="five wide column fixedsize" onClick="select(this);"><div class="ts header" ondblClick="OpenDefaultPath(12);" style="cursor: pointer;"><i class="disk outline icon"></i>' + "Base" + ' (Desktop)<div class="sub header"><div class="ts small active positive progress"><div class="bar" style="width: 100%"></div></div>Virtual Drive, Operational</div></div></div>');
				$("#largeVirtualDriveList").append('<div class="five wide column fixedsize" onClick="select(this);"><div class="ts header" ondblClick="OpenDefaultPath(13);" style="cursor: pointer;"><i class="disk outline icon"></i>' + "Root" + ' (AOR)<div class="sub header"><div class="ts small active positive progress"><div class="bar" style="width: 100%"></div></div>Virtual Drive, Operational</div></div></div>');
				
				for (var i=0; i < data.length; i++){
					//Append disk to sidebar
					$("#diskList").append('<div class="item selectable" onClick="OpenDefaultPath(3'+ i +');"><i class="disk outline icon"></i>' + data[i][1] + " (" + data[i][0] + ')</div>');
					diskPaths.push(data[i][0]);
					var sameUnit = (data[i][2].split("G").length-1 == 2)
					var remaining =data[i][2].split("/")[0].replace(/[^\d.-]/g, '');
					var total = data[i][2].split("/")[1].replace(/[^\d.-]/g, '');
					var usedPercentage = 0;
					if (sameUnit == true){
						//console.log(total,remaining);
						usedPercentage = Math.round(((total - remaining) / total)*100);
					}else{
						remaining = GetRealSize(data[i][2].split("/")[0]);
						total = GetRealSize(data[i][2].split("/")[1]);
						usedPercentage = Math.round(((total - remaining) / total)*100);
					}
					var type = "primary";
					if (usedPercentage > 90){
						type = "negative";
					}
					//Append disk to main interface
					$("#largeStorageDeviceList").append('<div class="five wide column fixedsize" onClick="select(this);"><div class="ts header" ondblClick="OpenDefaultPath(3'+ i +');" style="cursor: pointer;display:inline !important;"><i class="disk outline icon"></i>' + data[i][1] + " (" + data[i][0] + ')<div class="sub header"><div class="ts small '+ type +' progress"><div class="bar" style="width: '+usedPercentage+'%"></div></div>Remaining space: '+ data[i][2]+'</div></div></div>');
				}
			}
        },
        error: function() {
            console.log("[My Host] SystemAOB not found or not accessable.");
        }
    });
}

function loadNetdiskDetail(){
    currentDisplayContent = "networkDrives";
    $("#remoteNetDrives").html("");
    $("#localNetDrives").html("");
    //For each remote network location, show the icons
    $.get("../SystemAOB/functions/cluster/remoteLocationManager.php?list",function(data){
        for (var i =0; i < data.length; i++){
            var uuid = data[i]["uuid"];
            var endpoint = data[i]["endpoint"];
            $("#remoteNetDrives").append('<div class="five wide column fixedsize" style="cursor: pointer;padding-top:10px;padding-bottom:10px;"  onClick="select(this);">\
                <div class="ts header" ondblClick="" style="display:inline !important;">\
                <i class="large icons"><i class="server icon"></i><i class="corner cloud icon"></i></i><div style="display:inline;margin-left:10px;">' + endpoint[0]  +'</div>\
                <div class="sub header"><i class="exchange icon"></i> ' + endpoint[1] + ' (' +  endpoint[2] + ')\
                </div></div></div>');
        }
    });
    //For each scanned cluster, ask for details
    $(".cluster").each(function(){
        let clusterID = $(this).attr("clusterID").trim();
        let lastseen = $(this).attr("lastSeen").trim();
        let nickname = $(this).text();
        let diskinfo = $(this).attr("clusterinfo").trim();
        let updateTime = $(this).attr("updateTime").trim();
        if (diskinfo != "offline"){
            //This node is online. Show its storage informations.
            diskinfo = ao_module_utils.attrToObject(diskinfo);
            for (var i = 0; i < diskinfo.length;i++){
                var sameUnit = (diskinfo[i][2].split("G").length-1 == 2)
				var remaining =diskinfo[i][2].split("/")[0].replace(/[^\d.-]/g, '');
				var total = diskinfo[i][2].split("/")[1].replace(/[^\d.-]/g, '');
				var usedPercentage = 0;
				if (sameUnit == true){
					//console.log(total,remaining);
					usedPercentage = Math.round(((total - remaining) / total)*100);
				}else{
					remaining = GetRealSize(diskinfo[i][2].split("/")[0]);
					total = GetRealSize(diskinfo[i][2].split("/")[1]);
					usedPercentage = Math.round(((total - remaining) / total)*100);
				}
				var type = "primary";
				if (usedPercentage > 90){
					type = "negative";
				}
				
                $("#localNetDrives").append('<div class="five wide column fixedsize"  onClick="select(this);">\
                <div class="ts header" ondblClick="" style="cursor: pointer;display:inline !important;">\
                <i class="large icons"><i class="disk outline icon"></i><i class="corner cloud icon"></i></i>' + nickname + " : " + diskinfo[i][1] + " (" + diskinfo[i][0] + ')\
                <div class="sub header"><div class="ts small '+ type +' progress">\
                <div class="bar" style="width: '+usedPercentage+'%"></div>\
                </div>Remaining space: '+ diskinfo[i][2]+'\
                </div></div></div>');
                updateDisplayUpdateTime(updateTime);
            }
            
        }else{
            //This node is offline.
        }
        
        //Deprecated method for getting cluster information. This methods relies on timeout and take quite a bit time.
        /*
        $.ajax({
            url: "../SystemAOB/functions/cluster/getInfo.php?ipaddr=" + lastseen  + "&force-sync",
            success: function(data){
                //The cluster with this ip is online.
                var diskinfo = JSON.parse(data[2]);
                console.log(clusterID, diskinfo);
                for (var i = 0; i < diskinfo.length;i++){
                    var nickname = getValueByKey(nicknames,clusterID);
                    var sameUnit = (diskinfo[i][2].split("G").length-1 == 2)
					var remaining =diskinfo[i][2].split("/")[0].replace(/[^\d.-]/g, '');
					var total = diskinfo[i][2].split("/")[1].replace(/[^\d.-]/g, '');
					var usedPercentage = 0;
					if (sameUnit == true){
						//console.log(total,remaining);
						usedPercentage = Math.round(((total - remaining) / total)*100);
					}else{
						remaining = GetRealSize(diskinfo[i][2].split("/")[0]);
						total = GetRealSize(diskinfo[i][2].split("/")[1]);
						usedPercentage = Math.round(((total - remaining) / total)*100);
					}
					var type = "primary";
					if (usedPercentage > 90){
						type = "negative";
					}
					
					console.log(diskinfo);
                    $("#localNetDrives").append('<div class="five wide column fixedsize"  onClick="select(this);">\
                    <div class="ts header" ondblClick="" style="cursor: pointer;display:inline !important;">\
                    <i class="large icons"><i class="disk outline icon"></i><i class="corner cloud icon"></i></i>' + nickname + " : " + diskinfo[i][1] + " (" + diskinfo[i][0] + ')\
                    <div class="sub header"><div class="ts small '+ type +' progress">\
                    <div class="bar" style="width: '+usedPercentage+'%"></div>\
                    </div>Remaining space: '+ diskinfo[i][2]+'\
                    </div></div></div>');  
                }
            },
            error: function(data){
                //The cluster with this ip do not exists / offline at the moment.
                console.log(clusterID,"offline");
            },
            timeout: 15000 //in milliseconds
        });
        */
        
        
    });
}

function updateDisplayUpdateTime(updateTime){
    $("#updateTimeDisplay").html("<i class='refresh icon'></i>Last update: " + updateTime);
}

function getCurrentFormattedTime(){
    var today = new Date();
    //var date = today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
    var time = pz(today.getHours()) + ":" + pz(today.getMinutes()) + ":" + pz(today.getSeconds());
    //var dateTime = date+' '+time;
    return time;
}

function pz(digit){
    if ((digit + "").length < 2){
        return "0" + (digit + "");
    }else{
        return digit;
    }
}

function GetRealSize(size){
	var multication = 1;
	var value = size.replace(/[^\d.-]/g, '');
	var unit = size.replace(value,"");
	if (unit == "K"){
		return value * 1000;
	}else if (unit == "M"){
		return value * 1000 * 1000;
	}else if (unit == "G"){
		return value * 1000 * 1000 * 1000;
	}else if (unit == "T"){
		return value * 1000 * 1000 * 1000 * 1000;
	}
}

function loadFileExplorer(path){
	$("#FSPreview").html("");
	$("#FSPreview").append('<iframe src="'+path+'" style="width:100%;height:100%;" frameBorder="0"></iframe> ');
}

function loadReadOnlyFileList(path){
	$("#FSPreview").html("");
	$("#FSPreview").append('<iframe src="readonlyFileViewer.php?path='+path+'" style="width:100%;height:100%;" frameBorder="0"></iframe> ');
}

function loadMediaDiscover(extension){
	$("#FSPreview").html("");
	$("#FSPreview").append('<iframe src="mediaFileView.php?mediaType=.' + extension + '" style="width:100%;height:100%;" frameBorder="0"></iframe> ');

}

function getUserName(){
	return localStorage.getItem("ArOZusername");
}

function loadDefaultDriveView(){
	var template = '<br>\
			<div class="ts container" style="padding-left: 30px; padding-right: 30px;">\
			<div class="ts horizontal divider">Virtual Drives</div>\
			    <div id="largeVirtualDriveList" class="ts stackable grid">\
					\
				</div>\
			<div class="ts horizontal divider">Storage Device</div>\
				<div id="largeStorageDeviceList" class="ts stackable grid">\
					\
				</div>\
			</div>';
	$("#FSPreview").html(template);
	loadDriveList();
}

function loadNetDiskView(){
    var template = '<br>\
			<div class="ts container" style="padding-left: 30px !important; padding-right: 30px  !important;">\
			<div class="ts horizontal divider">Remote Network Drives</div>\
			    <div id="remoteNetDrives" class="ts stackable grid">\
					\
				</div>\
			<div class="ts horizontal divider">Local Network Drives</div>\
			    <div id="localNetDrives" class="ts stackable grid">\
					\
				</div>\
			</div>\
			<div id="updateTimeDisplay" class="botomRightCorner"></div>\
			</div>';
	$("#FSPreview").html(template);
	loadNetdiskDetail();
}


function OpenDefaultPath(code){
	switch(code) {
		case 10:
			var username = getUserName();
			if (username != null && username != ""){
				loadFileExplorer("../SystemAOB/functions/file_system/?controlLv=2&moduleName=Desktop&integrated=true&finishing=embedded&dir=Desktop/files/" + getUserName());
			}else{
				$("#FSPreview").html('<br><br><br><h3 class="ts center aligned icon header"><i class="key icon"></i>Identification Required<div class="sub header">Please identify yourself before proceed.</div></h3>');
			}
			
			break;
		case 11:
			var username = getUserName();
			if (username != null && username != ""){
				loadFileExplorer("../SystemAOB/functions/file_system/?controlLv=2&integrated=true&finishing=embedded");
			}else{
				$("#FSPreview").html('<br><br><br><h3 class="ts center aligned icon header"><i class="key icon"></i>Identification Required<div class="sub header">Please identify yourself before proceed.</div></h3>');
			}
			break;
		case 12:
		    //Load the Desktop that the user is currently working.
		    var username = getUserName();
		    if (username != null && username != ""){
				newEmbededWindow("SystemAOB/functions/file_system/?controlLv=2&finishing=embedded&dir=Desktop/files/" + username,"Desktop","folder open outline",Math.floor(Date.now() / 1000),ao_module_getWidth(),ao_module_getHeight(),ao_module_getLeft(),ao_module_getTop());
			    setTimeout(ao_module_close,200);
		    }else{
				$("#FSPreview").html('<br><br><br><h3 class="ts center aligned icon header"><i class="key icon"></i>Identification Required<div class="sub header">Please identify yourself before proceed.</div></h3>');
			}
		    break;
		case 13:
		    //Load the AOR of the system in new floatWindow
		    var username = getUserName();
			if (username != null && username != ""){
				newEmbededWindow("SystemAOB/functions/file_system/?controlLv=2&finishing=embedded","AOR","folder open outline",Math.floor(Date.now() / 1000),ao_module_getWidth(),ao_module_getHeight(),ao_module_getLeft(),ao_module_getTop());
				setTimeout(ao_module_close,200);
			}else{
				$("#FSPreview").html('<br><br><br><h3 class="ts center aligned icon header"><i class="key icon"></i>Identification Required<div class="sub header">Please identify yourself before proceed.</div></h3>');
			}
		    break;
		case 20:
			loadMediaDiscover("txt");
			break;
		case 21:
			loadMediaDiscover("mp3");
			break;
		case 22:
			loadMediaDiscover("mp4");
			break;
		case 23:
			loadMediaDiscover("png");
			break;
	}
	if (code >= 30 && code < 40){
		var DiskSelected = code - 30;
		var targetLoadPath = diskPaths[DiskSelected];
		loadReadOnlyFileList(targetLoadPath);
	}
	
	var w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
	if (sidebarHidden == false && w < 700){
		hideSideBar();
	}
}

function changeWindowTitle(id,text){
	//We do not allow the embedded version of the file explorer to change the title of this window
	return null;
}

function newEmbededWindow(url,filename,iconTag,uid,ww,wh,posx,posy,resizable){
	//Throw the information to the parent
	parent.newEmbededWindow(url,filename,iconTag,uid,ww,wh,posx,posy,resizable);
}

function select(object){
	$(".fixedsize").each(function(){
		$(this).removeClass("clickedFixedSize");
	});
	$(object).addClass("clickedFixedSize");
}
</script>
</body>
</html>