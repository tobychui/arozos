<?php
include_once '../auth.php';
?>
<html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>Home Dynamic</title>
<link rel="stylesheet" href="script/tocas/tocas.css">
<link rel="manifest" href="manifest.json">
<script src="script/tocas/tocas.js"></script>
<script src="script/jquery.min.js"></script>
<script src="../script/ao_module.js"></script>
<style>
.ultrasmall.image{
	height:35px;
	margin:0px !important;
	margin-right:10px !important;
}
.selectable{
	cursor:pointer;
}
.selectable:hover{
	background-color:#f0f0f0;
	
}
.noborder{
	border: 1px solid transparent !important;
}
.controlBtn{
	position:absolute;
	right:8px;
	bottom:8px;
}
.devIcon{
	border-radius: 10px;
}
.primary.button{
	background-color: #4aa9eb !important;
}
.bottom.item{
	position:absolute;
	bottom: 0px;
	left:0px;
	width:100%;
	font-size:80%;
}
#sideMenu{
	height: calc(100% - 85px);
}
body{
	height:100%;
	background:rgba(247,247,247,0.95);
}
</style>
</head>
<body>
    <div class="ts right sidebar overlapped vertical menu">
        	<div class="item">
        		<div class="ts header">
        			Home Dynamic
        			<div class="sub header">Universal IoT Controller</div>
        		</div>
        	</div>
        	<a class="selectable item" onClick="loadDevList();hideSideMenu();">
                <i class="refresh icon"></i> Refresh List
            </a>
        	<a class="selectable item" onClick="scanDevices();hideSideMenu();">
                <i class="search icon"></i> Scan Devices
            </a>
        	<a class="selectable item" onClick="manualDriverConfig();">
                <i class="edit icon"></i> Manual Device Config
            </a>
        	<a class="selectable item" onClick="initNicknameChangeList();">
                <i class="tags icon"></i> Set Nickname
            </a>
        	<a class="selectable item">
                <i class="object group icon"></i> Create Action Group
            </a>
        	<div class="item">
                <div class="ts checkbox">
                    <input type="checkbox" id="outdoor" >
                    <label for="outdoor">Outdoor Mode</label>
                </div>
        	</div>
        	<div class="bottom item">
                CopyRight ArOZ Online Project 2019
            </div>
    </div>

    <div class="pusher">
        <div class="ts menu">
            <a class="item noborder" href="index.php"><img class="ts ultrasmall circular image" src="img/main_icon.png"> Home Dynamic</a>
            <a class="right item" onClick="toggleSideMenu();"><i class="content icon"></i></a>
        </div>
        <div id="devList" class="ts container">

        </div>
        <br><br><br>
    </div>
    
            <div id="moreInfoInterface" class="ts active dimmer" style="display:none;">
        	<div style="position:absolute;width:100%;height:100%;left:0px;top:0px;" onClick='$("#moreInfoInterface").fadeOut("fast");'>
        	
        	</div>
        	<div id="informationItnerface" class="ts segment mainUI" style="height:80%;width:95%;overflow-y:auto;">
    		<div class="ts header">
    			Device Properties
    		</div><br>
    		<div class="ts horizontal form">
    			<div class="field">
    				<label>Device UUID</label>
    				<input id="duid" type="text" readonly="true">
    			</div>
    			<div class="field">
    				<label>Last Seen IP Address</label>
    				<input id="lastseen" type="text"  readonly="true">
    			</div>
    			<div class="field">
    				<label>Device Driver Identifier</label>
    				<input id="ddi" type="text"  readonly="true">
    			</div>
    			<div class="field">
    				<label>Device Information</label>
    				<input id="dinfo" type="text"  readonly="true">
    			</div>
    			<div class="field">
    				<label>Driver Found</label>
    				<input id="driverfound" type="text"  readonly="true">
    			</div>
    		</div>
    		<br>
    		<button class="ts primary button"  onClick='$("#moreInfoInterface").fadeOut("fast");'>Close</button>
    		<button id="setNicknameButton" class="ts button"  onClick='setNickname();'>Set Nickname</button>
    		<br><br>
    	</div>
    </div>
    
    
    <div id="actionInterface" class="ts active dimmer" style="display:none;">
    	<div style="position:absolute;width:100%;height:100%;left:0px;top:0px;" onClick='$("#actionInterface").fadeOut("fast");'>
    	
    	</div>
    	<div id="actionMainUI" class="ts segment mainUI" style="height:80%;width:95%;">
    		<iframe id="controlUI" src="" width="500px" height="800px"> </iframe>
    	</div>
    </div>
    
    <div id="nickNameSelector" class="ts active dimmer" style="display:none;">
    	<div style="position:absolute;width:100%;height:100%;left:0px;top:0px;" onClick='$("#nickNameSelector").fadeOut("fast");'>
    	
    	</div>
    	<div id="nicknameSelectorUI" class="ts segment mainUI" style="height:80%;width:95%;overflow-y:auto;">
    		<div class="ts header">
    			<div class="content">
    				Nickname Settings
    				<div class="sub header">Please select an UUID from below for changing its nickname.</div>
    			</div>
    		</div>
    		<div class="ts container">
    			<div id="nicknameChangeList" class="ts list">
    				
    			</div>
    		</div>
    	</div>
    </div>
    
    <div id="manualDevConfig" class="ts active dimmer" style="display:none;">
    	<div style="position:absolute;width:100%;height:100%;left:0px;top:0px;" onClick='$("#manualDevConfig").fadeOut("fast");'>
    	
    	</div>
    	<div id="manualDevConfigUI" class="ts segment mainUI" style="height:80%;width:95%;">
    		<div class="ts header">
    			<div class="content">
    				Manual Device Configuration
    				<div class="sub header">Add devices that runs other protocol to the system</div>
    			</div>
    		</div>
    		<div class="ts container">
    		    <button class="ts primary tiny button" onClick="addDevViaIP();"><i class="add icon"></i>Add device via IP</button>
    		    <button class="ts tiny button" onClick="openFolderForDev();"><i class="folder icon"></i>Open device folder</button>
    		    <p>Current list of Non-HDS Devices</p>
    		    <div id="customDevList" class="ts ordered list">
                    <div class="item">Loading</div>
                </div>
    		</div>
    	</div>
    </div>
     <div id="loadingMask" class="ts active dimmer" style="display:none;">
        <div class="ts text loader">Loading</div>
    </div>
    <div style="display:none;">
        <div id="data_session_username"><?php echo $_SESSION['login']; ?></div>
    </div>
<script>
var currentlyViewingDevices = "";
var uselocal = false; //Use Local as command sender or use Host as command sender
var username = $("#data_session_username").text().trim();
//ao_module Float Window functions
ao_module_setWindowIcon("home");
ao_module_setWindowTitle("Home Dynamic Panel");
ao_module_setGlassEffectMode();
ao_module_setWindowSize(465,730,true);
if (!ao_module_virtualDesktop){
    $("body").css("background-color","white");
}

var localSetting = ao_module_getStorage("hds","local");
if ( localSetting !== undefined && localSetting !== null && localSetting != ""){
    uselocal = (localSetting == "true");
}

if (uselocal){
    $('#outdoor').prop('checked', false);
}else{
    $('#outdoor').prop('checked', true);
}

//Initiate the page content
loadDevList();

$('#outdoor').change(function() {
    if(this.checked){
        ao_module_saveStorage("hds","local","false");
        uselocal = false;
    }else{
        ao_module_saveStorage("hds","local","true");
        uselocal = true;
    }
});
    
function inputbox(message, placeholder = ""){
    var input = prompt(message, placeholder);

    if (input != null) {
      return input;
    }else{
      return false;
    }
}

function addDevViaIP(){
    var ipaddr = inputbox("Please enter the IP Address of your device.");
    if (ipaddr != false){
         var classType = inputbox("Select the custom driver for this device. Leave empty for default.");
         if (classType == false){
             alert("Driver Type cannot be empty!");
             return;
         }
        $.get("manualDriverConfig.php?ipaddr=" + ipaddr + "&classType=" + classType,function(data){
            //Finished the adding process. Realod the list of custom devices.
            loadCustomDeviceList();
        });
    }else{
        //User cancelled the opr
    }
   
}

function openFolderForDev(){
    if (ao_module_virtualDesktop){
        ao_module_openPath("SystemAOB/system/iotpipe/devices/fixed");
    }else{
        window.open('../SystemAOB/functions/file_system/index.php?controlLv=2&subdir=SystemAOB/system/iotpipe/devices/fixed');
    }
}

function loadCustomDeviceList(){
    $("#customDevList").html("");
    $.ajax("manualDriverConfig.php").done(function(data){
        if (data.length == 0){
            $("#customDevList").append('<div class="item">N/A</div>');
        }else{
            for (var i =0; i < data.length; i++){
                $("#customDevList").append('<div class="item">' + data[i][1] + " <br>( Config UID: " + data[i][0] + " / Driver Loader: " + data[i][2] +  ")" + '</div>');
            }
        }
    });
}

function manualDriverConfig(){
    //Open manual driver configuration interface
    loadCustomDeviceList();
    $("#manualDevConfig").show();
    hideSideMenu();
}

function scanDevices(){
    $("#loadingMask").show();
    $.ajax("../SystemAOB/system/iotpipe/scandev.php").done(function(data){
        if (data.includes("ERROR")){
            alert("Scan Error! See console.log for more information.");
            console.log(data);
        }else{
            loadDevList();
        }
        $("#loadingMask").hide();
    });
    
}

function setSelectNickname(object){
	currentlyViewingDevices = $(object).attr("uuid");
	setNickname();
}

function initNicknameChangeList(){
	hideSideMenu();
	var template = '<a class="item" uuid="{uuid}" onClick="setSelectNickname(this);">\
					<i class="hashtag icon"></i>\
					<div class="content">\
						<div class="header">Current Nickname: {currentNickname}</div>\
						<div class="description">Device UUID: {uuid} / Device Type: {devClassName}</div>\
					</div>\
				</a>';
	$("#nicknameChangeList").html("");
	$(".HDSDev").each(function(){
	    if ($(this).attr("className") != "offline" && $(this).attr("className") !== undefined){
    		var uuid = $(this).attr("uuid");
    		var devClassname = $(this).attr("classname");
    		var nickName = $(this).attr("nickname");
    		if (nickName === undefined){
    			//This devices has no old nickname
    			nickName = uuid;
    		}
    		var box = template;
    		box = box.split("{uuid}").join(uuid);
    		box = box.split("{currentNickname}").join(nickName);
    		box = box.split("{devClassName}").join(devClassname);
    		$("#nicknameChangeList").append(box);
	    }
	});
	$("#nickNameSelector").fadeIn('fast');
}

function setNickname(){
	var newnickname = prompt("Please enter a nickname for this devices.", "");
	if (newnickname == null || newnickname == ""){
		//Opr canceld
	}else{
		if (currentlyViewingDevices != "Unknown"){
			$.ajax("nicknameman.php?nickname=" + newnickname + "&uuid=" + currentlyViewingDevices).done(function(data){
				loadDevList();
				$("#moreInfoInterface").fadeOut('fast');
				$("#nickNameSelector").fadeOut('fast');
			});
		}else{
			alert("Error. Unknown device UUID");
		}
	}
}

function hideSideMenu(){
	ts('.right.sidebar').sidebar('hide');
}

function showMore(object){
	var device = $(object).parent().parent();
	var duid = device.attr("uuid");
	var lastseen = device.attr("devip");
	var ddi = device.attr("classtype");
	var dinfo = device.attr("classname");
	var dfound = device.attr("driverfound");
	if (duid === undefined){
		duid = "Unknown";
		$("#setNicknameButton").hide();
	}else{
		$("#setNicknameButton").show();
	}
	if (dfound === undefined){
		dfound = "Offline";
	}
	$("#duid").val(duid);
	$("#lastseen").val(lastseen);
	$("#ddi").val(ddi);
	$("#dinfo").val(dinfo);
	$("#driverfound").val(dfound);
	currentlyViewingDevices = duid;
	$("#moreInfoInterface").fadeIn('fast');
}


function action(object){
	var classType = $(object).parent().parent().attr("classtype");
	var driverFound = ($(object).parent().parent().attr("driverfound") == "true");
	var ip = $(object).parent().parent().attr("devip");
	if (driverFound){
		$("#actionInterface").fadeIn('fast');
		updateIframeSize();
		if ($(object).parent().parent().attr("location") == "remote"){
		    	$("#controlUI").attr("src","../SystemAOB/system/iotpipe/drivers/" + classType + "/" + classType + ".php?ip=" + ip + "&location=remote");
		}else{
		    	$("#controlUI").attr("src","../SystemAOB/system/iotpipe/drivers/" + classType + "/" + classType + ".php?ip=" + ip);
		}
	
	}else{
		alert("Driver not found!");
	}
}

function loadDevList(){
	$("#devList").html("");
	var template = '<div class="ts segment HDSDev" devIp="{deviceIP}" location="local">\
							<div class="ts grid">\
								<div class="four wide column"><img class="ts tiny devIcon image" src="img/system/loading.gif"></div>\
								<div class="twelve wide column">\
									<div class="ts container">\
										<div class="ts header">\
											<span class="devHeader">{deviceIP}</span>\
											<div class="sub devProperty header"><i class="spinner loading icon"></i> Loading</div>\
										</div>\
									</div>\
								</div>\
							</div>\
							<div class="controlBtn infoMount">\
								<button class="ts icon button" onClick="showMore(this);"><i class="notice icon"></i></button>\
								<button class="ts primary icon button" onClick="action(this);"><i class="external icon"></i></button>\
							</div>\
						</div>';	
	$.ajax("loadDevList.php").done(function(data){
		if (data.length == 0){
			var nodevFound = '<div class="ts segment">\
			<h5 class="ts center aligned icon header">\
				<i class="remove icon"></i>No Device Found\
					<div class="sub header">No HDS based device is found in your network.<br>\
					Click <a href="readmore.html">here</a> to know more on how to build one yourself.</div>\
				</h5>\
			</div>';
			$("#devList").append(nodevFound);
		}else{
			for (var i =0; i < data.length; i++){
				var ip = data[i];
				var box = template;
				box = box.split("{deviceIP}").join(ip);
				$("#devList").append(box);
			}
		}
		
		//All devices loaded. Get information about the devices.
		$(".HDSDev").each(function(){
			let ip = $(this).attr("devIp");
			requestInfo(ip,"info",this,uselocal);
			requestUUID(ip,"uuid",this,uselocal);
		});
	});
	$.ajax("manualDriverConfig.php").done(function(data){
	    for(var i =0; i < data.length; i++){
	        var uuid = data[i][0];
	        var ipaddr = data[i][1];
	        var classType = data[i][2];
	        var box = template;
	        box = box.split("{deviceIP}").join(ipaddr);
	        box = $(box).attr("uuid",uuid);
	        box = $(box).attr("classtype",classType);
	        box = $(box).attr("classname",classType.split(".").join(" "));
	        box = $(box).removeClass("HDSDev").addClass("CustomDev");
	        box = $(box).attr("location","fixed");
	        $("#devList").append(box);
	    }
	    initCustomDevUI();
	});
}

function initCustomDevUI(){
    $(".CustomDev").each(function(){
        var classType = $(this).attr("classtype");
        loadDevImage(classType,this);
        loadDevDefaultDescription(this);
        getNickName(this);
    });
}

function loadDevDefaultDescription(object){
    var classType = $(object).attr("classtype");
    $.ajax("loadDriverProperties.php?classType=" + classType).done(function(data){
        $(object).find(".devProperty").text(data);
    });
}


function requestUUID(ip,subpath, object,local){
    if (local){
        //use local device as controller
        $.ajax({
        url: "http://" + ip + "/" + subpath,
        error: function(){
            //Declare offline
    		
        },
        success: function(data){
            //UUID found.
    		var uuid = data;
    		$(object).attr("uuid",uuid);
    		$(object).find(".devHeader").text(uuid);
    		$(object).attr('location',"local");
    		getNickName(object);
        },
        timeout: 5000 // sets timeout to 3 seconds
    	});
    }else{
        //use host server as controller
         $.ajax({
	        url:"../SystemAOB/system/iotpipe/extreq.php?ipa=" + ip + "&subpath=" + subpath,
	        error: function(){
	            //This devices might be not on the server side. Try again with client side request
	            requestUUID(ip,subpath, object,false);
	        },
	         success: function(data){
	             let filename = data;
	             let thisObject = object;
	             setTimeout(function(){
	                 tryGetUUID(filename,ip,subpath,thisObject,local);
	             },1300);
	             
	         }
         }
	    );
    }
	
}

function tryGetUUID(filename,ip,subpath, object,local,retryCount=0){
    if (retryCount > 10){
        //Assume offline
        return;
    }
    $.get("../SystemAOB/system/iotpipe/extreq.php?getreq=" + filename,function(data){
        if (data.includes("ERROR")){
            retryCount++;
            setTimeout(function(){
                tryGetUUID(filename,ip,subpath, object,local,retryCount);
            },1300);
        }else{
            var uuid = data;
    		$(object).attr("uuid",uuid);
    		$(object).attr('location',"remote");
    		$(object).find(".devHeader").text(uuid);
    		getNickName(object);
        }
     
     });
}

function getNickName(object){
	$.ajax({
    url: "nicknameman.php?uuid=" + $(object).attr("uuid"),
    success: function(data){
        //UUID found.
		if (data != false){
			//Replace the uuid with nickname
			$(object).find(".devHeader").text(data);
			$(object).attr("nickname",data);
		}
    },
    timeout: 5000 // sets timeout to 3 seconds
	});
}

function requestInfo(ip,subpath,object,local=true){
	//This function should work if both devices are in the same subnet. If not, something else will be done.
	if (local){
	    $.ajax({
        url: "http://" + ip + "/" + subpath,
        error: function(){
            //Declare offline
    		$(object).attr("className","offline");
    		$(object).attr("classType","offline");
    		$(object).find(".devHeader").html("<i class='remove icon'></i> Unable to Connect");
    		$(object).find(".devProperty").html("This device is offline or its address has been changed.");
    		$(object).find(".devIcon").attr('src',"img/system/unable2connect.png");
        },
        success: function(data){
            //Device in the same subnet. Try to load driver.
    		if (data.includes("_")){
    			var className = data.split("_")[0];
    			var classType = data.split("_")[1];
    			$(object).attr("className",className);
    			$(object).attr("classType",classType);
    			$(object).find(".devProperty").html(className);
    			loadDevImage(classType,object);
    		}else{
    			console.log("[Homdynm] Error. Unknown devices class for ip address: " + $(object).attr("devIP"));
    		}
    		
        },
        timeout: 5000 // sets timeout to 3 seconds
    	});
	}else{
	    //use server to get the required information.
	    $.ajax({
	        url:"../SystemAOB/system/iotpipe/extreq.php?ipa=" + ip + "&subpath=" + subpath,
	        error: function(){
	            //This devices might be not on the server side. Try again with client side request
	            requestInfo(ip,subpath,object,true);
	        },
	        success: function(data){
	            //The data should be a filename for getreq. Get it after 2 sec
	            let filename = data;
	            let thisip = ip;
	            let thisObject = object;
	            setTimeout(function(){
    	                tryGetReqInfo(filename,ip,subpath,thisObject,false);
	            },1000);
	            
	        },
	        timeout: 5000 // sets timeout to 3 seconds
	    })
	}
	
}

function tryGetReqInfo(filename,ip,subpath,thisObject,local,retryCount = 0){
    if (retryCount > 10){
        //Assume offline
    	$(thisObject).attr("className","offline");
		$(thisObject).attr("classType","offline");
		$(thisObject).find(".devHeader").html("<i class='remove icon'></i> Unable to Connect");
		$(thisObject).find(".devProperty").html("This device is offline or its address has been changed.");
		$(thisObject).find(".devIcon").attr('src',"img/system/unable2connect.png");
        return;
    }
    
    $.get("../SystemAOB/system/iotpipe/extreq.php?getreq=" + filename,function(data){
        console.log("[Home Dynamic] Remote returned value: " + ip + " " + data);
        if (data.includes("ERROR")){
            retryCount++;
            setTimeout(function(){
                tryGetReqInfo(filename,ip,subpath,thisObject,local,retryCount)
            },1000);
            
        }else{
            //Device found on server side. Get the information.
            if (data.includes(".") && data.includes("_")){
                //Found! Do something here
                	var className = data.split("_")[0];
        			var classType = data.split("_")[1];
        			$(thisObject).attr("className",className);
        			$(thisObject).attr("classType",classType);
        			$(thisObject).find(".devProperty").html(className);
        			loadDevImage(classType,thisObject);
            }else{
                //Might be trash from a random web server. Just ignore them.
            }
           
            
        }
    });
}

function loadDevImage(classType,object){
	$.ajax("loadDevImage.php?driverClass=" + classType).done(function(data){
		$(object).find(".devIcon").attr('src',data[0]);
		$(object).attr("driverFound",data[1]);
		if (data[1] == false){
			//Driver not found. Update the icon
			$(object).find(".devIcon").attr('src',"img/system/driverNotFound.png");
			
		}
	});
}

function toggleSideMenu(){
	//$("#sideMenu").toggle();
	ts('.right.sidebar').sidebar('toggle');
}

function updateIframeSize(){
	$("#controlUI").attr("width",$("#actionMainUI").width());
	$("#controlUI").attr("height",$("#actionMainUI").height());
	$("#controlUI").css("width",$("#actionMainUI").width());
	$("#controlUI").css("height",$("#actionMainUI").height());
}

$(window).on("resize",function(){
	updateIframeSize();
});
</script>
</body>
</html>