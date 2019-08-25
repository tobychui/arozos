/**
ArOZ Online Beta 
Function Bar System Script
Toby Chui feat. IMUS Laboratory All Right Reserved

This script is design for launching the virtual taskbar and FloatWindow system.
DO NOT EDIT OR ATTEMPT TO CHANGE ANYTHING IF YOU ARE NOT SURE WHAT YOU ARE DOING.
Sections of the ArOZ Online System might collapse if this script file is changed. 
If you decide to change anything here, please do it with your own risk.

香港制作 安全好用
**/
var powerManualVisable = false;
var menuBarVisable = true;
var fileExplorerVisable = false;
var focusedObject = null;
var dragging = false;
var resizing = false;
var lastPosition = [0,0];
var focusedWindow = null;
var isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
var initialURL = "http://" + window.location.host + window.location.pathname.replace(window.location.pathname.split("/").pop(),"");
var floatWindowCount = 0; //Max 50 Floating Windows
var supportedModules = $("#DATA_PIPELINE_supportedModules").text().trim();
var USBNo = 0;
var notificationCount = 0;
var isFunctionBar = true; //Reference Point for background application
var windowID = $("#DATA_PIPELINE_windowID").text().trim();
$("#notificationbar").css("left",$(window).width() + "px");

window.mobilecheck = function() {
  var check = false;
  (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||window.opera);
  return check;
};

var hash = window.location.hash.replace("#","");
if (hash !== ""){
	$('#interface').attr('src',hash);
}

$( document ).ready(function() {
	if (window.mobilecheck()){
		//This device is mobile
		$('#menuBar').hide();
		$('#showMenuButton').show();
		menuBarVisable = false;
	}else{
		//This device is not a mobile device
		
	}
	//Bind the drag drop movement to all the existing divs on screen
	bindMotions();
	//Get the default USB numbers on the system
	UpdateUSBNo();
	//Assume no USB was plugged in during booting.
	SetUSBFound(false);
	//Set Interval for USB monitoring
	setInterval(CheckUSBChange,15000);
	//Set Interval to check if any iframe freezed or request external killing
	//setInterval(forceTerminate,3000);
	//Open Float Window with <src>,<title>,<iconTag>,<uid>
	//Example New FloatWindow call
	//newEmbededWindow('Audio/index.php','Audio','music','audioEmbedded');
	//newEmbededWindow('Video/index.php','Video','video','videoEmbedded');
	//newEmbededWindow('Memo/index.php','Memo','sticky note outline','memoEmbedded',475,700);
});

var iframeoffset;
function bindMotions(object = undefined){
	//START OF PAGE MOTION BINDING
	var draggingIcon = false;
	var animationFinished = true;
	var target = $("*");
	if (object !== undefined){
		target = $("#" + object);
	}
	//Float Window Drag Drop Control Code
	$( ".floatWindow" ).on("mousedown", target, function( event ) {
		event.preventDefault();
		focusedObject = event.target;
		if ($(event.target).prop('nodeName') == "I"){
			focusedObject = $(focusedObject).parent();
			draggingIcon = true;
			return;
		}else{
			draggingIcon = false;
		}
		if (focusedWindow !== null  && checkFocusWindowIsAlreadyFocused() === false){
			//Defocus the previously focued window
			//$(focusedWindow).parent().css('z-index',1);
			ShiftAllFloatWindowZIndex(true);
		}
		//Focus the new window
		$(focusedObject).parent().css('z-index',100);
		focusedWindow = focusedObject;
		//$('#iframeCover').show().insertAfter(focusedObject);
		var parentPosX = $(focusedObject).parent().offset().left;
		var parentPosY = $(focusedObject).parent().offset().top;
		/**
		//Deprecated since 8-3-2019, Non-glassEffect Mode windows will no longer have iframe border
		iframeoffset = 20;
		if($(focusedObject).parent().css("background-color") == "rgb(255, 255, 255)"){
			//If this is a floatWindows that is not supporting the glassEffect mode
			iframeoffset = 20;
		}
		**/
		iframeoffset = 20;
		$('#iframeCover').css({"left":parentPosX,"top":parentPosY + iframeoffset});
		$('#iframeCover').css('width',$(focusedObject).parent().css('width').replace("px",""));
		$('#iframeCover').css('height',$(focusedObject).parent().css('height').replace("px","") - iframeoffset);
		$('#iframeCover').css('z-index',115);
		$('#iframeCover').show();
		dragging = true;
		$('#backdrop').show();
		lastPosition[0] = event.pageX;
		lastPosition[1] = event.pageY;
		lastPosition[2] = parseInt($(focusedObject).parent().css("left").replace("px",""));
		lastPosition[3] = parseInt($(focusedObject).parent().css("top").replace("px",""));

	});

	$( ".floatWindow" ).on('touchstart', target, function( event ) {
		event.preventDefault();
		focusedObject = event.target;
		if ($(event.target).prop('nodeName') == "I"){
			focusedObject = $(focusedObject).parent();
			draggingIcon = true;
			return;
		}else{
			draggingIcon = false;
		}
		if (focusedWindow !== null  && checkFocusWindowIsAlreadyFocused() === false){
			//Defocus the previously focued window
			//$(focusedWindow).parent().css('z-index',1);
			ShiftAllFloatWindowZIndex(true);
		}
		//Focus the new window
		$(focusedObject).parent().css('z-index',100);
		focusedWindow = focusedObject;
		var parentPosX = $(focusedObject).parent().offset().left;
		var parentPosY = $(focusedObject).parent().offset().top;
		/**
		//Deprecated since 8-3-2019, Non-glassEffect Mode windows will no longer have iframe border
		iframeoffset = 20;
		if($(focusedObject).parent().css("background-color") == "rgb(255, 255, 255)"){
			//If this is a floatWindows that is not supporting the glassEffect mode
			iframeoffset = 20;
		}
		**/
		iframeoffset = 20;
		$('#iframeCover').css({"left":parentPosX,"top":parentPosY + iframeoffset});
		$('#iframeCover').css('width',$(focusedObject).parent().css('width').replace("px",""));
		$('#iframeCover').css('height',$(focusedObject).parent().css('height').replace("px","") - iframeoffset);
		$('#iframeCover').css('z-index',115);
		$('#iframeCover').show();
		dragging = true;
		$('#backdrop').show();
		lastPosition[0] = event.originalEvent.touches[0].pageX;
		lastPosition[1] = event.originalEvent.touches[0].pageY;
		lastPosition[2] = parseInt($(focusedObject).parent().css("left").replace("px",""));
		lastPosition[3] = parseInt($(focusedObject).parent().css("top").replace("px",""));
	});

	//Float window dragging
	$(document, 'body').on("mousemove",target,function( event ) {
		if (dragging === true && draggingIcon === false && animationFinished === true && focusedObject != "undefined"){
			var parentObject = $(focusedObject).parent();
			if (parentObject.attr("osize") !== undefined){
				//Set this floatWindow to floating mode if drag during full screen
				var restorePoint = JSON.parse(parentObject.attr("osize"));
				parentObject.css("width",restorePoint[0]);
				parentObject.css("height",restorePoint[1]);
				parentObject.find(".maximizeWindow").html('<i class="small window maximize icon"></i>');
				parentObject.removeAttr("osize");
				//As the frame is scaled down, the original touching position is no longer correct. The offset x value has to be manually offset with the width of the floatWindow object
				var xoffsets = restorePoint[0] / 2; 
				parentObject.css("top",parentPosY);
				parentObject.css("left",event.pageX - xoffsets);
				lastPosition[2] = parseInt($(focusedObject).parent().css("left").replace("px",""));
				lastPosition[3] = parseInt($(focusedObject).parent().css("top").replace("px",""));
				//Update the iframe cover as well
				$('#iframeCover').css('width',parentObject.css('width').replace("px",""));
				$('#iframeCover').css('height',parentObject.css('height').replace("px","") - iframeoffset);
			}
			//Move the div accordingly
			//$(focusedObject).css({left:event.pageX,top:event.pageY});
			var parentPosX = parentObject.offset().left;
			var parentPosY = parentObject.offset().top;
			$('#iframeCover').css({"left":parentPosX,"top":parentPosY + iframeoffset});
			var dx = event.pageX - lastPosition[0];
			var dy = event.pageY - lastPosition[1];
			var nx = lastPosition[2] + dx;
			var ny = lastPosition[3] + dy;
			
			parentObject.css("left", nx );
			parentObject.css("top", ny);
			
		}
	});

	$(document, 'body').bind('touchmove',target, function( event ) {
		if (dragging == true && draggingIcon == false && animationFinished == true && focusedObject != "undefined"){
			var parentObject = $(focusedObject).parent();
			if (parentObject.attr("osize") != undefined){
				//Set this floatWindow to floating mode if drag during full screen
				var restorePoint = JSON.parse(parentObject.attr("osize"));
				parentObject.css("width",restorePoint[0]);
				parentObject.css("height",restorePoint[1]);
				parentObject.find(".maximizeWindow").html('<i class="small window maximize icon"></i>');
				parentObject.removeAttr("osize");
				//As the frame is scaled down, the original touching position is no longer correct. The offset x value has to be manually offset with the width of the floatWindow object
				var xoffsets = restorePoint[0] / 2; 
				parentObject.css("top",parentPosY);
				parentObject.css("left",event.originalEvent.touches[0].pageX - xoffsets);
				lastPosition[2] = parseInt($(focusedObject).parent().css("left").replace("px",""));
				lastPosition[3] = parseInt($(focusedObject).parent().css("top").replace("px",""));
				//Update the iframe cover as well
				$('#iframeCover').css('width',parentObject.css('width').replace("px",""));
				$('#iframeCover').css('height',parentObject.css('height').replace("px","") - iframeoffset);
			}
			//Move the div accordingly
			//$(focusedObject).css({left:event.pageX,top:event.pageY});
			var parentPosX = parentObject.offset().left;
			var parentPosY = parentObject.offset().top;
			$('#iframeCover').css({"left":parentPosX,"top":parentPosY + iframeoffset});
			var dx = event.originalEvent.touches[0].pageX - lastPosition[0];
			var dy = event.originalEvent.touches[0].pageY - lastPosition[1];
			var nx = lastPosition[2] + dx;
			var ny = lastPosition[3] + dy;
			
			parentObject.css("left", nx );
			parentObject.css("top", ny);
		
		}
	});

	$( ".floatWindow").on("mouseup",target,function( event ) {
		$("#stickingIndictor").hide();
		if ($("#stickingIndictor").attr("attach") != ""){
			var parentObject = $(focusedObject).parent();
			var side = $("#stickingIndictor").attr("attach");
			if(checkIfObjectFixedSize(parentObject)){
				//This window is fixed size window and cannot be scale to fit half of the screen.
				$("#stickingIndictor").attr("attach","");
			}else{
				var fwWidth = parentObject.width();
				var fwHeight = parentObject.height();
				if (side == "left"){
					parentObject.attr("osize",JSON.stringify([fwWidth,fwHeight,parentObject.offset().left,parentObject.offset().top]));
					parentObject.css("left",0);
					parentObject.css("right","");
					parentObject.css("top",0);
					parentObject.css("height","100%").css('height', '-=34px');
					parentObject.css("width",$(window).width()/2);
					$("#stickingIndictor").attr("attach","");
					var maxicon = $(this).find(".small.window.maximize.icon") || $(this).find(".small.window.maximize.icon");
					maxicon.parent().html('<i class="small window restore icon"></i>');
				}else if (side == "right"){
					parentObject.attr("osize",JSON.stringify([fwWidth,fwHeight,parentObject.offset().left,parentObject.offset().top]));
					parentObject.css("right",0);
					parentObject.css("left","");
					parentObject.css("top",0);
					if (menuBarVisable){
						parentObject.css("height","100%").css('height', '-=34px');
					}else{
						parentObject.css("height","100%");
					}
					parentObject.css("top",0);
					parentObject.css("width",$(window).width()/2);
					$("#stickingIndictor").attr("attach","");
					var maxicon = $(this).find(".small.window.maximize.icon") || $(this).find(".small.window.maximize.icon");
					maxicon.parent().html('<i class="small window restore icon"></i>');
				}
			}
		}
		focusedObject = null;
		dragging = false;
		$('#backdrop').hide();
		$('#iframeCover').hide().appendTo('body');
	});

	$( ".floatWindow" ).on('touchend',target,function( event ) {
		$("#stickingIndictor").hide();
		if ($("#stickingIndictor").attr("attach") != ""){
			var parentObject = $(focusedObject).parent();
			var side = $("#stickingIndictor").attr("attach");
			if(checkIfObjectFixedSize(parentObject)){
				//This window is fixed size window and cannot be scale to fit half of the screen.
				$("#stickingIndictor").attr("attach","");
			}else{
				var fwWidth = parentObject.width();
				var fwHeight = parentObject.height();
				if (side == "left"){
					parentObject.attr("osize",JSON.stringify([fwWidth,fwHeight,parentObject.offset().left,parentObject.offset().top]));
					parentObject.css("left",0);
					parentObject.css("right","");
					parentObject.css("top",0);
					parentObject.css("height","100%").css('height', '-=34px');
					parentObject.css("width",$(window).width()/2);
					$("#stickingIndictor").attr("attach","");
					var maxicon = $(this).find(".small.window.maximize.icon") || $(this).find(".small.window.maximize.icon");
					maxicon.parent().html('<i class="small window restore icon"></i>');
				}else if (side == "right"){
					parentObject.attr("osize",JSON.stringify([fwWidth,fwHeight,parentObject.offset().left,parentObject.offset().top]));
					parentObject.css("right",0);
					parentObject.css("left","");
					if (menuBarVisable){
						parentObject.css("height","100%").css('height', '-=34px');
					}else{
						parentObject.css("height","100%");
					}
					parentObject.css("top",0);
					parentObject.css("width",$(window).width()/2);
					$("#stickingIndictor").attr("attach","");
					var maxicon = $(this).find(".small.window.maximize.icon") || $(this).find(".small.window.maximize.icon");
					maxicon.parent().html('<i class="small window restore icon"></i>');
				}
			}
		}
		focusedObject = null;
		dragging = false;
		$('#backdrop').hide();
		$('#iframeCover').hide().appendTo('body');
	});
	//Resize Window Control Code
	var originalResizeBtnSize = [0,0];
	var originalColor = "";
	$( ".resizeWindow" ).on("mousedown",target,function( event ) {
		event.preventDefault();
		hidefwListWindow();
		focusedObject = event.target;
		if (focusedWindow != null  && checkFocusWindowIsAlreadyFocused() == false){
			//Defocus the previously focued window
			//$(focusedWindow).parent().css('z-index',1);
			ShiftAllFloatWindowZIndex(true);
		}
		$(focusedObject).parent().css('z-index',100);
		$(focusedObject).parent().css('left',$(focusedObject).parent().offset().left);
		$(focusedObject).parent().css('right','');
		focusedWindow = focusedObject;
		originalResizeBtnSize[0] = parseInt($(focusedObject).css('width').replace("px",""));
		originalResizeBtnSize[1] = parseInt($(focusedObject).css('height').replace("px",""));
		originalColor = $(focusedObject).css('background-image');
		$(focusedObject).css('background','rgba(255,255,255,0.2)');
		$(focusedObject).css('width',$(focusedObject).parent().css('width').replace("px",""));
		$(focusedObject).css('height',$(focusedObject).parent().css('height').replace("px",""));
		resizing = true;
		lastPosition[0] = event.pageX;
		lastPosition[1] = event.pageY;
		lastPosition[2] = parseInt($(focusedObject).parent().css("width").replace("px",""));
		lastPosition[3] = parseInt($(focusedObject).parent().css("height").replace("px",""));
		$('#backdrop').show();
	});

	$( ".resizeWindow" ).on('touchstart',target,function( event ) {
		event.preventDefault();
		hidefwListWindow();
		focusedObject = event.target;
		if (focusedWindow != null  && checkFocusWindowIsAlreadyFocused() == false){
			//Defocus the previously focued window
			//$(focusedWindow).parent().css('z-index',1);
			ShiftAllFloatWindowZIndex(true);
		}
		$(focusedObject).parent().css('z-index',100);
		$(focusedObject).parent().css('left',$(focusedObject).parent().offset().left);
		$(focusedObject).parent().css('right','');
		focusedWindow = focusedObject;
		originalResizeBtnSize[0] = parseInt($(focusedObject).css('width').replace("px",""));
		originalResizeBtnSize[1] = parseInt($(focusedObject).css('height').replace("px",""));
		originalColor = $(focusedObject).css('background-image');
		$(focusedObject).css('background','rgba(255,255,255,0.2)');
		$(focusedObject).css('width',$(focusedObject).parent().css('width').replace("px",""));
		$(focusedObject).css('height',$(focusedObject).parent().css('height').replace("px",""));
		resizing = true;
		lastPosition[0] = event.originalEvent.touches[0].pageX;
		lastPosition[1] = event.originalEvent.touches[0].pageY;
		lastPosition[2] = parseInt($(focusedObject).parent().css("width").replace("px",""));
		lastPosition[3] = parseInt($(focusedObject).parent().css("height").replace("px",""));
		$('#backdrop').show();
	});

	function checkIfObjectFixedSize(object){
		if(object.find(".maximizeWindow").length == 0){
			return true;
		}else{
			return false;
		}
	}

	$( ".resizeWindow" ).off("click").on("click",function(event){
		//The resize window should not be clickable unless the control get stuck due to unknown reason. This function fixes the sticky resize problem
		if ($(this).width() > 20 || $(this).height() > 15){
			//Something went wrong. Adjust the window size to its origianl size and default class
			$(this).removeAttr('style');
			$(this).removeClass('resizeWindow').addClass('resizeWindow');
			focusedObject = null;
			resizing = false;
			$('#backdrop').hide();
		}
	});

	$(document, 'body').on("mousemove",target,function( event ) {
		if (resizing == true){
			//Move the preview div accordingly
			if ($(focusedObject).parent().attr("osize") != undefined){
				//Set this floatWindow to floating mode if drag during full screen
				$(focusedObject).parent().find(".maximizeWindow").html('<i class="small window maximize icon"></i>');
				$(focusedObject).parent().removeAttr("osize");
			}	
			var dx = event.pageX - lastPosition[0];
			var dy = event.pageY - lastPosition[1];
			var nx = lastPosition[2] + dx;
			var ny = lastPosition[3] + dy;
			if (ny < 120){ny = 120;};
			if (nx < 120){nx = 120;};
			$(focusedObject).parent().css("width", nx);
			$(focusedObject).parent().css("height", ny);
			$(focusedObject).css('width',$(focusedObject).parent().css('width').replace("px",""));
			$(focusedObject).css('height',$(focusedObject).parent().css('height').replace("px",""));
		}else{
			var parentObject = $(focusedObject).parent();
			if (event.pageX < 5 && checkIfObjectFixedSize(parentObject) == false){
				//Window sticking on the left
				$("#stickingIndictor").attr("attach",'left');
				/*
				$("#stickingIndictor").css("left",0);
				$("#stickingIndictor").css("right",'');
				$("#stickingIndictor").fadeIn('fast');
				*/
			}else if (event.pageX > $(window).width() - 5 && checkIfObjectFixedSize(parentObject) == false){
				//Window sticking on the right
				$("#stickingIndictor").attr("attach",'right');
				/*
				$("#stickingIndictor").css("left",'');
				$("#stickingIndictor").css("right",0);
				$("#stickingIndictor").fadeIn('fast');
				*/
			}else{
				$("#stickingIndictor").hide();
				$("#stickingIndictor").attr("attach",'');
			}
		}
	});

	$(document, 'body').bind('touchmove',target,function( event ) {
		if (resizing == true){
			//Move the preview div accordingly
			var dx = event.originalEvent.touches[0].pageX - lastPosition[0];
			var dy = event.originalEvent.touches[0].pageY - lastPosition[1];
			var nx = lastPosition[2] + dx;
			var ny = lastPosition[3] + dy;
			if (ny < 120){ny = 120;};
			if (nx < 120){nx = 120;};
			$(focusedObject).parent().css("width", nx);
			$(focusedObject).parent().css("height", ny);
			$(focusedObject).css('width',$(focusedObject).parent().css('width').replace("px",""));
			$(focusedObject).css('height',$(focusedObject).parent().css('height').replace("px",""));
		}else{
			var parentObject = $(focusedObject).parent();
			if (event.originalEvent.touches[0].pageX < 5 && checkIfObjectFixedSize(parentObject) == false){
				//Window docking on the left
				$("#stickingIndictor").attr("attach",'left');
				/*
				$("#stickingIndictor").css("left",0);
				$("#stickingIndictor").css("right",'');
				$("#stickingIndictor").fadeIn('fast');*/
			}else if (event.originalEvent.touches[0].pageX > $(window).width() - 5 && checkIfObjectFixedSize(parentObject) == false){
				//Window docking on the right
				$("#stickingIndictor").attr("attach",'right');
				/*
				$("#stickingIndictor").css("left",'');
				$("#stickingIndictor").css("right",0);
				$("#stickingIndictor").fadeIn('fast');
				*/
			}else{
				$("#stickingIndictor").hide();
				$("#stickingIndictor").attr("attach",'');
			}
		}
	});


	$( ".resizeWindow" ).on("mouseup",target,function( event ) {
		$(focusedObject).css('width',originalResizeBtnSize[0]);
		$(focusedObject).css('height',originalResizeBtnSize[1]);
		$(focusedObject).css('background-color','');
		$(focusedObject).css('background-image',originalColor);
		focusedObject = null;
		resizing = false;
		$('#backdrop').hide();
	});

	$( ".resizeWindow" ).on('touchend',function( event ) {
		$(focusedObject).css('width',originalResizeBtnSize[0]);
		$(focusedObject).css('height',originalResizeBtnSize[1]);
		$(focusedObject).css('background-color','');
		$(focusedObject).css('background-image',originalColor);
		focusedObject = null;
		resizing = false;
		$('#backdrop').hide();
	});

	$(document, 'body').on("mouseup",target,function( event ) {
		//Resize mouse go outside of the resizing window area
		//Just in case there are noobs that don't know how to resize a window properly
		if (resizing == true){
			$(focusedObject).css('width',originalResizeBtnSize[0]);
			$(focusedObject).css('height',originalResizeBtnSize[1]);
			$(focusedObject).css('background-color',originalColor);
			focusedObject = null;
			resizing = false;
			$('#backdrop').hide();
		}
		//Just in case someone who don't know how to adjust volume correctly
		VolAreaMouseDown=false;
	});

	$(document, 'body').on('touchend',target,function( event ) {
		//Resize mouse go outside of the resizing window area
		//Just in case there are noobs that don't know how to resize a window properly
		if (resizing == true){
			$(focusedObject).css('width',originalResizeBtnSize[0]);
			$(focusedObject).css('height',originalResizeBtnSize[1]);
			$(focusedObject).css('background-color',originalColor);
			focusedObject = null;
			resizing = false;
			$('#backdrop').hide();
			//Just in case someone who don't know how to adjust volume correctly
			VolAreaMouseDown=false;
		}
	});

	//Floating Window closing
	$(".floatWindow > .closeWindow").on("mousedown",target,function(event){
		focusedObject = event.target;
		hidefwListWindow();
		if ($(event.target).prop('nodeName') == "I"){
			focusedObject = $(focusedObject).parent();
		}
		dragging = false;
		//Updated on 15-3-2019, check if the module contain any onclose script. If there is, use its onClose script instead.
		try {
			if ($(focusedObject).parent().parent().find("iframe")[0] != undefined && $(focusedObject).parent().parent().find("iframe")[0].contentWindow != undefined && $(focusedObject).parent().parent().find("iframe")[0].contentWindow.ao_module_close && typeof $(focusedObject).parent().parent().find("iframe")[0].contentWindow.ao_module_close === "function") { 
				//Use ao_module_close to handle the window close instead of killing it
				//aka Ask the module to close itself
				$(focusedObject).parent().parent().find("iframe")[0].contentWindow.ao_module_close();
				return;
			}
		}catch(err){
			//This might happens when the target iframe contain external contents (hence CORS error). If that is the case, continue to process the force kill action.
		}
		var divLayer = $(focusedObject).parent().parent();
		var divid = divLayer.attr('id');
		divLayer.remove();
		//Section of code to remove grouped floatWindow button from menu bar
		removeFloatWindowFromMenuBarByID(divid);
		floatWindowCount --;
		
	});

	$(".floatWindow > .closeWindow").on('touchstart',target,function(event){
		focusedObject = event.target;
		hidefwListWindow();
		if ($(event.target).prop('nodeName') == "I"){
			focusedObject = $(focusedObject).parent();
		}
		dragging = false;
		//Updated on 15-3-2019, check if the module contain any onclose script. If there is, use its onClose script instead.
		if ($(focusedObject).parent().parent().find("iframe")[0] != undefined && $(focusedObject).parent().parent().find("iframe")[0].contentWindow != undefined && $(focusedObject).parent().parent().find("iframe")[0].contentWindow.ao_module_close && typeof $(focusedObject).parent().parent().find("iframe")[0].contentWindow.ao_module_close === "function") { 
			//Use ao_module_close to handle the window close instead of killing it
			//aka Ask the module to close itself
			$(focusedObject).parent().parent().find("iframe")[0].contentWindow.ao_module_close();
			return;
		};
		var divLayer = $(focusedObject).parent().parent();
		var divid = divLayer.attr('id');
		divLayer.remove();
		//Section of code to remove grouped floatWindow button from menu bar
		removeFloatWindowFromMenuBarByID(divid);
		floatWindowCount --;
		
	});

	//Floating Window Minimizing
	$(".floatWindow > .minimizeWindow").on("mousedown",target,function(event){
		focusedObject = event.target;
		if ($(event.target).prop('nodeName') == "I"){
			focusedObject = $(focusedObject).parent();
		}
		dragging = false;
		var divLayer = $(focusedObject).parent().parent();
		animationFinished = false;
		divLayer.fadeOut('fast',function(){
			animationFinished = true;
		});
		var divid = divLayer.attr('id');
		$('#' + divid + 'Btn').css('background-color','#444');
	});

	$(".floatWindow > .minimizeWindow").on('touchstart',target,function(event){
		focusedObject = event.target;
		if ($(event.target).prop('nodeName') == "I"){
			focusedObject = $(focusedObject).parent();
		}
		dragging = false;
		var divLayer = $(focusedObject).parent().parent();
		divLayer.fadeOut('fast',function(){
			animationFinished = true;
		});
		var divid = divLayer.attr('id');
		$('#' + divid + 'Btn').css('background-color','#444');
	});


	//Float Window Maximizing
	$(".floatWindow > .maximizeWindow").off("mousedown").on("mousedown",target,function(event){
		focusedObject = event.target;
		if ($(event.target).prop('nodeName') == "I"){
			focusedObject = $(focusedObject).parent();
		}
		dragging = false;
		var divLayer = $(focusedObject).parent().parent();
		animationFinished = false;
		var windowWidth = $( window ).width();
		var windowHeight = $( window ).height();
		var fwWidth = divLayer.width();
		var fwHeight = divLayer.height();
		if (divLayer.attr("osize") != undefined){
			//Set this floatWindow to floating mode
			//console.log($(focusedObject).parent().parent().find(".maximizeWindow"));
			var restorePoint = JSON.parse(divLayer.attr("osize"));
			divLayer.css("width",restorePoint[0]);
			divLayer.css("height",restorePoint[1]);
			divLayer.css("top",restorePoint[3]);
			divLayer.css("left",restorePoint[2]);
			divLayer.removeAttr("osize");
			$(this).html('<i class="small window maximize icon"></i>');
		}else{
			//Set this floatWindow to full screen mode
			var posx = divLayer.css("left");
			var posy = divLayer.css("top");
			divLayer.css("width","100%");
			if (menuBarVisable){
				divLayer.css("height","100%").css('height', '-=34px');
			}else{
				divLayer.css("height","100%");
			}
			divLayer.css("top",0);
			divLayer.css("left",0);
			divLayer.attr("osize",JSON.stringify([fwWidth,fwHeight,posx,posy]));
			$(this).html('<i class="small window restore icon"></i>');
		}
	});

	$(".floatWindow > .maximizeWindow").off("touchstart").on('touchstart',target,function(event){
		focusedObject = event.target;
		if ($(event.target).prop('nodeName') == "I"){
			focusedObject = $(focusedObject).parent();
		}
		dragging = false;
		var divLayer = $(focusedObject).parent().parent();
		animationFinished = false;
		var windowWidth = $( window ).width();
		var windowHeight = $( window ).height();
		var fwWidth = divLayer.width();
		var fwHeight = divLayer.height();
		if (divLayer.attr("osize") != undefined){
			//Set this floatWindow to floating mode
			//console.log(divLayer.attr("osize"));
			var restorePoint = JSON.parse(divLayer.attr("osize"));
			divLayer.css("width",restorePoint[0]);
			divLayer.css("height",restorePoint[1]);
			divLayer.css("top",restorePoint[3]);
			divLayer.css("left",restorePoint[2]);
			divLayer.removeAttr("osize");
			$(this).html('<i class="small window maximize icon"></i>');
		}else{
			//Set this floatWindow to full screen mode
			var posx = divLayer.css("left");
			var posy = divLayer.css("top");
			divLayer.css("width",windowWidth);
			if (menuBarVisable){
				divLayer.css("height","100%").css('height', '-=34px');
			}else{
				divLayer.css("height","100%");
			}
			divLayer.css("top",0);
			divLayer.css("left",0);
			divLayer.attr("osize",JSON.stringify([fwWidth,fwHeight,posx,posy]));
			$(this).html('<i class="small window restore icon"></i>');
		}
	});

	$( ".floatWindow" ).off("dblclick").on("dblclick",function(event) {
		//Double click will also enter full screen mode
		focusedObject = event.target;
		if ($(focusedObject).parent().find(".resizeWindow").length == 0){
			//This window is not resizable
			return;
		}
		dragging = false;
		var divLayer = $(focusedObject).parent();
		animationFinished = false;
		var windowWidth = $( window ).width();
		var windowHeight = $( window ).height();
		var fwWidth = divLayer.width();
		var fwHeight = divLayer.height();
		if (divLayer.attr("osize") != undefined){
			//Set this floatWindow to floating mode
			//console.log(divLayer.attr("osize"));
			var restorePoint = JSON.parse(divLayer.attr("osize"));
			divLayer.css("width",restorePoint[0]);
			divLayer.css("height",restorePoint[1]);
			divLayer.css("top",restorePoint[3]);
			divLayer.css("left",restorePoint[2]);
			divLayer.removeAttr("osize");
			var maxicon = $(this).find(".small.window.restore.icon");
			maxicon.parent().html('<i class="small window maximize icon"></i>');
		}else{
			//Set this floatWindow to full screen mode
			var posx = divLayer.css("left");
			var posy = divLayer.css("top");
			divLayer.css("width",windowWidth);
			if (menuBarVisable){
				divLayer.css("height","100%").css('height', '-=34px');
			}else{
				divLayer.css("height","100%");
			}
			divLayer.css("top",0);
			divLayer.css("left",0);
			divLayer.attr("osize",JSON.stringify([fwWidth,fwHeight,posx,posy]));
			var maxicon = $(this).find(".small.window.maximize.icon");
			maxicon.parent().html('<i class="small window restore icon"></i>');
		}
	});

}
//END OF PAGE MOTION BINDING

//Standard Menu Control Code
function removeFloatWindowFromMenuBarByID(divid){
	//Remove floatWindow from Menu / bottom bar / 
	if ($('#' + divid + 'Btn').length > 0){
		//Check if the button is shared by multiple floatWindows. If yes, keep it remained here
		var idlist = JSON.parse(decodeURIComponent($('#' + divid + 'Btn').attr("floatWindowUID")));
		idlist = idlist.map(String)
		if (idlist.length == 1 && idlist.includes(divid.toString())){
			//This is the only floatWindow that is using this button
			$('#' + divid + 'Btn').remove();
		}else{
			//If the btn named as this floatWindow uid, that means this is the first item in array
			for (var i = 0; i < idlist.length; i++){
				if (idlist[i] == divid){
					idlist.splice(i,1);
				}
			}
			$('#' + divid + 'Btn').attr("floatWindowUID",encodeURIComponent(JSON.stringify(idlist)));
			$('#' + divid + 'Btn').attr("id",idlist[0] + "Btn");
			$('#' + idlist[0] + 'Btn').css("border-right",idlist.length - 1 + "px solid white");
		}
	}else{
		//This is a floatWindow get grouped into an already existing button. The only method to remove it is search each btn until one match is found
		var targetBtn = "";
		divid = divid.toString();
		$(".listMenuButton").each(function(){
			var idlist = JSON.parse(decodeURIComponent($(this).attr("floatWindowUID")));
			idlist = idlist.map(String)
			if (idlist.includes(divid)){
				targetBtn = $(this).attr("id");
			}
		});
		if (targetBtn == ""){
			//floatWindow already closed
			return;
		}
		var idlist = JSON.parse(decodeURIComponent($("#" + targetBtn).attr("floatWindowUID")));
		idlist = idlist.map(String)
		for (var i = 0; i < idlist.length; i++){
			if (idlist[i] == divid){
				idlist.splice(i,1);
			}
		}
		$("#" + targetBtn).attr("floatWindowUID",encodeURIComponent(JSON.stringify(idlist)));
		$("#" + targetBtn).css("border-right",idlist.length - 1 + "px solid white");
	}
}

/**
function closeAndReloadIframe(){
	fileExplorerVisable = false;
	$('#fileMenu').hide();
	$('#folderBtn').css('background-color','#333');
	$('#filebrowser').attr('src', 'SystemAOB/functions/file_system/embedded.php?controlLv=2')
}
**/

function AddWindows(){
	$('#addWindow').clearQueue()
	$('#addWindow').stop()
	var startingLeft = $('#moreBtn').offset().left;
	$('#addWindow').css('left',startingLeft);
	var visable = ($('#addWindow').css('display') != 'none');
	$('#addWindow').fadeToggle('fast',function(){
		if (visable == true){
			$('#moreBtn').css('background-color','#222');
		}else{
			$('#moreBtn').css('background-color','#333');
		}
	});
	
}

function LaunchFloatWindowFromModule(module, suppressAddWindow=false){
	$('#newWindow iframe').attr('src',module + "/FloatWindow.php");
	if (!suppressAddWindow){
		AddWindows();
	}
	
}

function TooglePowerManuel(btn){
	$('#powerMenu').clearQueue()
	$('#powerMenu').stop()
	if (powerManualVisable == false){
		$('#powerMenu').fadeToggle('fast');
		powerManualVisable = true;
	}else{
		$('#powerMenu').fadeToggle('fast');
		powerManualVisable = false;
	}
}

function ToogleMenuBar(){
	$('#menuBar').clearQueue()
	$('#menuBar').stop()
	if (menuBarVisable == false){
		//Show it
		$('#menuBar').fadeToggle("fast");
		$('#showMenuButton').fadeToggle("fast");
		menuBarVisable = true;
	}else{
		//Hide it
		$('#menuBar').fadeToggle("fast");
		$('#showMenuButton').fadeToggle("fast");
		if (powerManualVisable == true){
			$('#powerMenu').hide();
			powerManualVisable = false;
		}
		$("#USBList").fadeOut('fast');
		menuBarVisable = false;
		
		//And hide all the other related windows
		$('#powerMenu').fadeOut('fast');
		powerManualVisable = false;
	}
}

function ToogleFileExplorer(){
	var uid = Date.now();
	newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2", "Loading", "folder open outline",uid,1080,580,undefined,undefined,true,false);
	
	/**
	//Deprecated, replaced with a function that open a new file explorer instead
	$('#fileMenu').clearQueue()
	$('#fileMenu').stop()
	if (fileExplorerVisable == false){
		$('#fileMenu').fadeToggle('fast');
		$('#folderBtn').css('background-color','#222');
		focusFloatWindow('fileMenu');
		fileExplorerVisable = true;
	}else{
		$('#fileMenu').fadeToggle('fast');
		$('#folderBtn').css('background-color','#444');
		fileExplorerVisable = false;
	}
	**/
}

jQuery.fn.justtext = function() {
	return $(this)	.clone()
			.children()
			.remove()
			.end()
			.text();
};

function newEmbededWindow(src, title, iconTag="folder", uid ,ww=720, wh=480, posx=100, posy=100, resizable=true, glassEffect=false, parentUID=null, callbackFunct=null,headless=false){
	if (floatWindowCount >= 50){
		//Reaching the maximum number of floating windows.
		return false;
	}
	//Check if the window already exists. If yes, only update the src of the iframe
	if ( $('#' + uid).length > 0 ){
		updateFloatWindowTitle(uid,title);
		$('#' + uid + ' iframe').attr('src',src);
		if ( $('#' + uid).css("display") == "none"){
			$('#' + uid).fadeIn('fast');
			$('#' + uid + 'Btn').css('background-color','#222');
		}
		focusFloatWindow(uid);
		return;
	}
	//This function will perform automatic Motion Binding after the window is being build
	$.when( openFloatWindow(src,title,iconTag,uid,ww,wh,posx,posy,resizable,glassEffect,parentUID,callbackFunct,headless) ).done(function() {
		   bindMotions(uid);
		   killDragging();
	});
}

function focusFloatWindow(uid){
	focusedObject = $('#' + uid + " .floatWindow");
	if (focusedWindow != null && checkFocusWindowIsAlreadyFocused() == false){
		//Defocus the previously focued window
		ShiftAllFloatWindowZIndex();
		//$(focusedWindow).parent().css('z-index',1);
	}
	//Focus the new window
	$(focusedObject).parent().css('z-index',100);
	focusedWindow = focusedObject;
}

function checkFocusWindowIsAlreadyFocused(){
	if ($(focusedObject).parent().attr("id") == $(focusedWindow).parent().attr("id")){
		return true;
	}else{
		return false;
	}
}

function ShiftAllFloatWindowZIndex(onlyShiftFrontWindows = false){
	var previousFocusedObjectZIndex = $(focusedObject).parent().css('z-index');
	if (onlyShiftFrontWindows){
		$('.floatWindow').each(function(i) {
			//Shift all the floatWindows z-index by two (leaving one gap for the background cover)
			if ($(this).parent().css("z-index") > previousFocusedObjectZIndex - 2 && $(this).parent().attr("id") != "newWindow"){
				//console.log($(this).parent().css("z-index"));
				var newindex = $(this).parent().css("z-index") - 2;
				$(this).parent().css("z-index",newindex);
			}
		});	
	}else{
		$('.floatWindow').each(function(i) {
			//Shift all the floatWindows z-index by two (leaving one gap for the background cover)
			if ($(this).parent().css("z-index") > 2 && $(this).parent().attr("id") != "newWindow"){
				var newindex = $(this).parent().css("z-index") - 2;
				$(this).parent().css("z-index",newindex);
			}
		});	
	}

}

//Replace the title of a FloatWindow
function updateFloatWindowTitle(uid,title){
	var oldTitle = $('#' + uid + " .floatWindow").justtext();
	if (title != oldTitle){
			//The title changed. Update the title to the new one
			var newHTML = $('#' + uid + " .floatWindow").html().replace(oldTitle.trim(),title);
			$('#' + uid + " .floatWindow").html(newHTML);
			bindMotions(uid);
		}
}

function checkoverlap(posx,posy){
	var result = false;
	$(".floatWindow").each(function(){
		if ($(this).offset().left == posx && $(this).offset().top == posy){
			result = true;
		}
	});
	return result;
}

//Open a new Windows
function openFloatWindow(src, title, iconTag="folder", uid ,ww=720, wh=480, posx=100, posy=100, resizable=true, glassEffect=false, parentUID=null, callbackFunct=null,headless=false){
	//src: The path in which the new window points to
	//title: The title text that displace on the window top bar
	//iconTag: The icon used for the window label and buttons. Reference Tocas UI for the iconTag information
	//uid: The uid is the unique id for this window.
	//ww, wh: Window Width, Window Height
	//posx, posy: Window Position x, Window Position y
	var template = $('#newWindow');
	var newWindow = template.clone(true).appendTo('body');
	newWindow.attr('id',uid);
	//Check if there are cached window size. If yes, replace the default pass in
	var cache = checkCachedWindowSize(src);
	if (cache !== false){
		ww = cache[0];
		wh = cache[1];
	}
	//Handle the window popup location
	if (ww > $(document).width()){
		ww = $(document).width();
		posx = 0;
	}
	if (wh > $(document).height()){
		wh = $(document).height() - 35;
		posy = 0;
	}
	//If it is the default value, check if there are any windows overlapping the position
	var tmpcounter = 0; //Killswitch for while loop
	if (posx == 100 && posy == 100){
		while(checkoverlap(posx,posy) == true && tmpcounter < 50){
			posx += 30;
			posy += 30;
			if (posy > window.innerHeight - 25){
				posy = 115;
			}
			if (posx > window.innerWidth - 25){
				posx = 115;
			}
			tmpcounter++;
		}
	}
	
	newWindow.css({'left':posx,'top':posy,'width':ww,'height':wh});
	if (glassEffect == true){
		newWindow.css("background-color","");
		newWindow.css("border","0px solid transparent");
		newWindow.find(".floatWindow").css("background-color","rgba(33, 33, 33, 0.8)");
		newWindow.find(".floatWindow").css("padding-top","1px");
		newWindow.find(".floatWindow").find(".closeWindow").css("top","2px");
		newWindow.find(".floatWindow").find(".minimizeWindow").css("top","4px");
		newWindow.css("box-shadow","1px 1px 4px #3d3d3d");
	}
	$('#' + uid + ' iframe').attr('src',src);
	var newHTML = newWindow.html();
	newHTML = newHTML.replace("%WINDOW_TITLE%",decodeURIComponent(title));
	newHTML = newHTML.replace("folder icon",iconTag + " icon");
	if (resizable == false){
		newHTML = newHTML.replace('<div class="resizeWindow" align="center"></div>','');
		newHTML = newHTML.replace('<div style="top:5px;right:25px;cursor: pointer;position:absolute;" class="maximizeWindow"><i class="small window maximize icon"></i></div>','');
		if (!glassEffect){
			newHTML = newHTML.replace('<div style="top:5px;right:47px;cursor: pointer;position:absolute;" class="minimizeWindow"><i class="minus icon"></i></div>','<div style="top:5px;right:25px;cursor: pointer;position:absolute;" class="minimizeWindow"><i class="minus icon"></i></div>');
		}else{
			newHTML = newHTML.replace('<div style="top: 4px; right: 47px; cursor: pointer; position: absolute;" class="minimizeWindow"><i class="minus icon"></i></div>','<div style="top:5px;right:25px;cursor: pointer;position:absolute;" class="minimizeWindow"><i class="minus icon"></i></div>');
		}
		
	}
	//Append the parentUID into the window of the child object so it can know who its parent is
	if (parentUID != null){
		newHTML = ($(newHTML).attr("puid",parentUID));
		//Check if parent request a call back. If yes, this will be passed to the child as well
		if (callbackFunct != null){
			newHTML = ($(newHTML).attr("callback",callbackFunct));
		}
	}
	newWindow.html(newHTML);
	//newWindow.fadeIn('fast');
	//Increase the speed of the window loading time
	newWindow.fadeIn(100);
	if (!headless){
		AppendNewIcon(iconTag,uid,src);
	}
	focusFloatWindow(uid);
	floatWindowCount++;
}

//Append new icon to the menu bar
function AppendNewIcon(iconTag,uid,src){
	var moduleBase = src.split("/").shift();
	//If the moduleBase is came from desktop or systemaob, special processing is needed
	if (moduleBase.toLowerCase() == "systemaob" || moduleBase.toLowerCase() == "desktop"){
		//Only group those start the same script base which is under SystemAOB
		if (moduleBase.toLowerCase() == "systemaob" || src.includes(".php")){
			var pathdata = src.split(".php")[0].split("/");
			moduleBase = pathdata.pop();
			if (moduleBase == "index"){
				//This might be a module inside function group (e.g. file_system/index.php), group it as file_system
				moduleBase = pathdata.pop();
			}
		}else{
			//This is a desktop module. One button per floatWindow is needed
			var template = '<div id="' + uid + 'Btn" floatWindowUID="' + encodeURIComponent(JSON.stringify([uid])) +'" moduleBase="' + moduleBase + '" class="one wide column fbicon listMenuButton" style="cursor: pointer;background-color: #222;height:60px;" onClick="ToggleFloatWindow(this);"><i class="' + iconTag +' icon" style="line-height: 35px;"></i></div>';
			$('#activatedModuleIcons').append(template);
			$('#' + uid + "Btn").insertAfter('#folderBtn');
			return;
		}
	}
	if (src.includes("http") && src.includes("://")){
		//Some stupid modules are passing in a fullpath (i.e. http://your_ip_here/aob/module/.....)
		//Strip from the back instead.
		var pathdata = src.split("/");
		moduleBase = pathdata[pathdata.length - 2];
	}
	//console.log(src,moduleBase);
	
	//Try to merge any windows that came from the same base Module
	//First, check if there is already a button that have the same base module.
	var sameBaseModuleButton = "";
	$(".listMenuButton").each(function(){
		var thisModuleBase = $(this).attr("moduleBase");
		if(thisModuleBase.toLowerCase() == moduleBase.toLowerCase()){
			sameBaseModuleButton = $(this).attr("id");
		}
	});
	if (sameBaseModuleButton == ""){
		//There is no similar matches. Append a new button
		var template = '<div id="' + uid + 'Btn" floatWindowUID="' + encodeURIComponent(JSON.stringify([uid])) +'" moduleBase="' + moduleBase + '" class="one wide column fbicon listMenuButton" style="cursor: pointer;background-color: #222;height:60px;" onClick="ToggleFloatWindow(this);"><i class="' + iconTag +' icon" style="line-height: 35px;"></i></div>';
		$('#activatedModuleIcons').append(template);
		$('#' + uid + "Btn").insertAfter('#folderBtn');
	}else{
		//There is a button with the same type. Append to its floatWindowUIDs
		var appendTarget = $("#" + sameBaseModuleButton);
		var UIDList = JSON.parse(decodeURIComponent(appendTarget.attr("floatWindowUID")));
		UIDList.push(uid);
		var sideBorderWidth = UIDList.length - 1;
		appendTarget.attr("floatWindowUID",encodeURIComponent(JSON.stringify(UIDList)));
		appendTarget.css("border-right",sideBorderWidth + "px solid white");
	}
	
	/**
	//Deprecated "single icon single fw" method, updated on 15-3-2019
	var template = '<div id="%UID%" class="one wide column fbicon" style="cursor: pointer;background-color: #222;height:60px;" onClick="ToggleFloatWindow(' + "'" + uid +"'" + ');"><i class="%TAG% icon" style="line-height: 35px;"></i></div>';
	template = template.replace("%UID%",uid + "Btn");
	template = template.replace("%TAG%",iconTag);
	$('#activatedModuleIcons').append(template);
	$('#' + uid + "Btn").insertAfter('#folderBtn');
	**/
}

//Hiding a window with btn
function ToggleFloatWindow(object){
	var idlist = JSON.parse(decodeURIComponent($(object).attr("floatWindowUID")));
	if (idlist.length == 1){
		hidefwListWindow();
		id = idlist[0];
		if ($('#' + id).css('display') == 'none'){
			//If the window is going to show, focus it
			focusFloatWindow(id);
		}
		if ($('#' + id).css("z-index") < 100){
			//This window is at the back of some other windows --> Bring it in front
			focusFloatWindow(id);
		}else{
			//This window has already been focused
			$('#' + id).fadeToggle('fast',function(){
			if ($('#' + id).css('display') == 'none') {
				//The floatwindow is now hidden
				$('#' + id + 'Btn').css('background-color','#444');
			}else{
				//The floatwindow is now shown
				$('#' + id + 'Btn').css('background-color','#222');
			}
		});
		}
	}else{
		//There are multiple windows hidden inside this button. Use floatWindowListWindow to show all of them.
		var position = [$(object).offset().left,$(object).offset().top];
		var buttonModuleBase = $(object).attr("moduleBase").trim();
		$("#fwListWindow").html("");
		//Load the window with all the grouped window properties
		for (var i = 0; i < idlist.length; i++){
			var details = getIconAndTitleFromFloatWindow(idlist[i]); //return [windowTitle,icon]
			if (details != false){
				var icon = details[1];
				var windowTitle = details[0];
				var displayBox = '<div class="selectable fwListBtn" style="border:1px solid transparent;padding:5px;padding-right:20px;" floatWindowUID="'+ encodeURIComponent(JSON.stringify([idlist[i]])) + '" onClick="ToggleFloatWindow(this);">\
				<p class="ts inverted header"\ style="font-size:0.9em;">\
					<i class="mini ' + icon + '"></i>' + windowTitle + '\
					<button style="position:absolute;right:0px;top:3px;margin-right:-23px;color:white;cursor:pointer;" onClick="closeFromFWListWindow(this);"><i class="remove icon"></i></button>\
				</p>\
				</div>';
				$("#fwListWindow").append(displayBox);
			}else{
				//console.log("CRITICAL ERROR! Unable to parse floatWindow data from attributes. Please refresh this page.");
			}
		}
		if ($("#fwListWindow").attr("dockedModuleBase") != buttonModuleBase){
			//Move and show the floatWindowListWindow
			$("#fwListWindow").css("left",position[0] + "px").attr("dockedModuleBase",buttonModuleBase);
			//Animated slideUp to show code
			var div = $("#fwListWindow:not(:visible)");
			var height = div.css({
				display: "block"
			}).height();
			
			div.css({
				overflow: "hidden",
				height: 0
			}).animate({
				height: height
			}, 200, function () {
				$(this).css({
					display: "",
					overflow: "",
					height: ""
				});
			});
		}else{
			//Click twice on the same button
			hidefwListWindow();
		}
	
	}
	
}

function closeFromFWListWindow(object){
	$(object).parent().parent().hide();
	var fwWindowID = $(object).parent().parent().attr("floatWindowUID");
	fwWindowID = JSON.parse(decodeURIComponent(fwWindowID));
	closeWindow(fwWindowID);
}

function hidefwListWindow(){
	//Animated slideDown to hide code
	if ( $("#fwListWindow").is(':visible')){
		$("#fwListWindow").attr("dockedModuleBase","");
		var div = $("#fwListWindow");
		var height = div.height();
		
		div.css({
			overflow: "hidden",
			marginTop: 0,
			height: height
		}).animate({
			marginTop: height,
			height: 0
		}, 200, function () {
			$(this).css({
				display: "none",
				overflow: "",
				height: "",
				marginTop: ""
			});
		});
	}
}

function getIconAndTitleFromFloatWindow(uid){
	if ($("#" + uid).length > 0){
		var target = $("#" + uid).find(".floatWindow")[0];
		var windowTitle = $(target).text().trim();
		var icon = $(target).find("i").attr("class");
		return [windowTitle,icon];
	}else{
		console.log("ERROR. floatWindow with ID " + uid + " not found.");
		return false;
	}
}
/*
function ToogleHS(){
	$('#HostServer').clearQueue()
	$('#HostServer').stop()
	if ($('#HostServer').css('display') == 'none'){
		focusFloatWindow('HostServer');
	}
	
	$('#HostServer').fadeToggle('fast',function(){
		//Check if the window is shown, change button color
		if ($('#HostServer').css('display') != 'none'){
			//The window is now shown
			$('#diskBtn').css('background-color','#222');
			//$('#hostView').attr('src','SystemAOB/functions/system_statistic/index.php');
		}else{
			//The window is now hidden
			$('#diskBtn').css('background-color','#444');
		}
		
	});
}

function CloseHS(){
	$('#HostServer').clearQueue()
	$('#HostServer').stop()
	$('#HostServer').hide();
	$('#hostView').attr('src','SystemAOB/functions/system_statistic/index.php');
	$('#diskBtn').css('background-color','#333');
}
*/

//Simple Clock Script
var myVar = setInterval(function() {
  myTimer();
  GvolDisplay();
  FloatWindowWatchDog();
}, 1000);

function myTimer() {
  var d = new Date();
  document.getElementById("clock").innerHTML = d.toLocaleTimeString();
}


//Display the global volume of the system set by other modules
function GvolDisplay(){
	var vol = Math.round(GetStorage('global_volume') * 100);
	$('#gVol').html('<i class="volume down icon"></i>' + vol + "%");
	$('#volDisplay').css('width',vol + '%');
}

//Update URL onto the window top location
function updateURL(){
	var iframePath = document.getElementById("interface").contentDocument.location.href;
	//var baseUrl = window.location.href.split('#')[0];
	//window.location.replace( baseUrl + '#' + iframePath.replace(initialURL,""));
	//window.location.hash = iframePath.replace(initialURL,"");
	if (iframePath.replace(initialURL,"") != ""){
		history.replaceState(undefined, undefined, "#" + iframePath.replace(initialURL,""));
	}else{
		history.replaceState(undefined, undefined,"#index.php");
	}
	
}

//These function is for ArOZ Online System quick storage data processing
function CheckStorage(id){
	if (typeof(Storage) !== "undefined") {
		return true;
	} else {
		return false;
	}
}
function GetStorage(id){
	//All data get are string
	return localStorage.getItem(id);
}
function SaveStorage(id,value){
	localStorage.setItem(id, value);
	return true;
}

//USB Device Managing Script
function SetUSBFound(state){
	if (state == true){
		//New USB inserted
		$('#USBopr').html("<i class='usb icon'></i>Detecting");
		$.get( "SystemAOB/functions/system_statistic/usbPorts.php", function(data) {
			if (data.includes("Device") && data.includes("ID")){
				//This is raspberry pi
				var info = data.split("ID")[1];
				$('#USBopr').html("<i class='usb icon'></i>" + info);
			}else{
				//This is Window machine
				$('#USBopr').html("<i class='usb icon'></i>" + data[0]);
			}
			
		});
		
	}else{
		//No more usb is inserted
		$('#USBopr').html("<i class='usb icon'></i> USB Hub");
	}
}

function CheckUSBNoDifferent(){
	/*
	//Refresh System are moved to the usbMount.php in AOB version 22.1.2018
	if ($('#USBList').css("display") == "none"){
		//Refresh the content of driver display if reshow
		$('#USBListDisplay').attr('src','SystemAOB/functions/usbMount.php');
		
	}
	*/
	$('#USBList').clearQueue()
	$('#USBList').stop()
	$('#USBList').fadeToggle('fast');
	$.get( "SystemAOB/functions/system_statistic/usbPorts.php", function(data) {
		if (data.length != USBNo){
			if (data.length > USBNo){
				PopUpNewUSB();
			}else if (data.length < USBNo){
				USBRemoved();
			}
			USBNo = data.length;
		}
	});
	
}

function CheckUSBChange(){
	$.get( "SystemAOB/functions/system_statistic/usbPorts.php", function(data) {
		if (data.length != USBNo){
			if (data.length > USBNo){
				PopUpNewUSB();
			}else if (data.length < USBNo){
				USBRemoved();
			}
			USBNo = data.length;
		}
	});
}

function PopUpNewUSB(){
	$('#USBListDisplay').attr('src','SystemAOB/functions/usbMount.php');
	//alert("New USB FOUND!");
	$('#umw_head').html("New USB Storage Device Found.");
	$('#umw_text').html("Device auto mounting in progress. Please wait...");
	$.get( "SystemAOB/functions/system_statistic/usbPorts.php", function(data) {
	//	$('#umw_list').html(data[0]);
		$('#umw_list').html("fstab mounting in progress");
		$('#umw').fadeIn('fast').delay(4000).fadeOut('fast');
	});
	SetUSBFound(true);
}

function USBRemoved(){
	$('#USBListDisplay').attr('src','SystemAOB/functions/usbMount.php');
	//alert("USB Removed");
	$('#umw_head').html("USB Device Removed.");
	$('#umw_text').html("Please make sure you have unmounted the device before unplugging.");
	$('#umw_list').html("<i class='minus circle icon'></i> Device Removed");
	$('#umw').fadeIn('fast').delay(4000).fadeOut('fast');
	SetUSBFound(false);
}

function UpdateUSBNo(){
	$.get( "SystemAOB/functions/system_statistic/usbPorts.php", function(data) {
		USBNo = data.length;
	});
}

var VolAreaMouseDown = false
//Global Vol Control Script
$('#globVolBar').on("mousedown",function(e){
	VolAreaMouseDown = true;
	var posX = $(this).offset().left;
	var totalWidth = $(this).width();
    var percentage = Math.round(((e.pageX - posX) / totalWidth) * 100);
	if (percentage > 100){
		percentage = 100;
	}else if (percentage < 0){
		percentage = 0;
	}
	$('#volDisplay').css('width',percentage + '%');
	SaveStorage('global_volume',percentage/100)
});

$('#globVolBar').on("mousemove",function(e){
	if (VolAreaMouseDown){
		var posX = $(this).offset().left;
		var totalWidth = $(this).width();
		var percentage = Math.round(((e.pageX - posX) / totalWidth) * 100);
		if (percentage > 100){
		percentage = 100;
		}else if (percentage < 0){
			percentage = 0;
		}
		$('#volDisplay').css('width',percentage + '%');
		SaveStorage('global_volume',percentage/100)
	}
});

$('#globVolBar').on("mouseup",function(e){
	VolAreaMouseDown = false;
});

//The same things as above but for tablet
$('#globVolBar').on('touchstart',function(e){
	VolAreaMouseDown = true;
	var posX = $(this).offset().left;
	var totalWidth = $(this).width();
    var percentage = Math.round(((e.pageX - posX) / totalWidth) * 100);
	$('#volDisplay').css('width',percentage + '%');
	//console.log(percentage);
	SaveStorage('global_volume',percentage/100)
});

$('#globVolBar').bind('touchmove',function( event ) {
	if (VolAreaMouseDown){
		var posX = $(this).offset().left;
		var totalWidth = $(this).width();
		var percentage = Math.round(((e.pageX - posX) / totalWidth) * 100);
		if (percentage < 0){
			percentage = 0;
		}else if (percentage > 100){
			percentage = 100;
		}
		$('#volDisplay').css('width',percentage + '%');
		//console.log(percentage);
		SaveStorage('global_volume',percentage/100)
	}
});

$('#globVolBar').on("touchend",function(e){
	VolAreaMouseDown = false;
});

function mutevol(){
	//mute the volume when the user press the low vol icon
	$('#volDisplay').css('width','0%');
	SaveStorage('global_volume',0);
}

function ToggleGlobalVol(e){
	$('#globVolInterface').clearQueue();
	$('#globVolInterface').stop();
	$('#globVolInterface').fadeToggle('fast');
	$("#globVolInterface").css("left",$("#gVol").offset().left + "px");
}

$( window ).resize(function() {
	//Update the position of the global vol selector
	$("#globVolInterface").css("left",$("#gVol").offset().left + "px");
	$("#notificationbar").css("left",$(window).width() + "px");
	$("#notificationbar").addClass("hidden");
	
	var isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
	if (isChrome){
		//Chrome full screen activated --> As there are some minor css problem in Chrome for unknown reasons
		$("#interface").css("height",$(window).outerHeight() + "px");
	}
});

var notificationbarAnimateOngoing = false;
function toggleNoticeBoard(){
	if ($("#notificationbar").hasClass("hidden") && notificationbarAnimateOngoing == false){
		notificationbarAnimateOngoing = true;
		$("#notificationbar").removeClass("hidden");
		$("#notificationbar").finish().animate({left: "-=350"},350,"swing",function(){
			notificationbarAnimateOngoing = false;
		});
	}else if (notificationbarAnimateOngoing == false){
		notificationbarAnimateOngoing = true;
		$("#notificationbar").addClass("hidden");
		$("#notificationbar").finish().animate({left: "+=350"},350,"swing",function(){
			notificationbarAnimateOngoing = false;
		});
	}
}

function closemsgbox(object){
	var messageboxObject = $(object).parent().parent().parent();
	if (messageboxObject.hasClass("messagebox")){
		messageboxObject.fadeOut('500', function() { $(this).remove(); });
		notificationCount--;
		if (notificationCount == 0){
			setTimeout(function(){
				if (!$("#notificationbar").hasClass("hidden")){
					//If the notification bar is shown, hide it
					toggleNoticeBoard();
				}
			},800);
		}
	}else{
		console.log("ERROR! Unable to remove messagebox / messagebox not exists.");
	}
}

function clearAllNotification(){
	$(".messagebox").each(function(){
		$(this).fadeOut(350,function(){
			$(this).remove();
		});
	});
	setTimeout(function(){
		if (!$("#notificationbar").hasClass("hidden")){
			//If the notification bar is shown, hide it
			toggleNoticeBoard();
		}
	},800);
	notificationCount = 0;
}


function FloatWindowWatchDog(){
	//This watch dog is used to fix the FloatWindow top bar offset problem in not normal user operation in drag drop
	$( ".floatWindow" ).each(function() {
	  var FWcontainer = $(this).parent();
	  var FWC_offset = FWcontainer.offset();
	  var FWT_offset = $(this).offset();
	  if (Math.round(FWC_offset.top + 2) < Math.round(FWT_offset.top) && Math.round(FWC_offset.top) != Math.round(FWT_offset.top)){
		  //The y axis of the window control is shifted!
		  dragging = false;
		  $(this).offset({top: FWC_offset.top, left: FWC_offset.left});
		  console.log("Top value mismatch --> Container: " + FWcontainer.attr("id") + " FWC_offsets: " + FWC_offset.top + "," + FWC_offset.left + " FWT_offsets: " + FWT_offset.top + "," + FWT_offset.left);
		  focusedObject = null;
		  $('#backdrop').hide();
	      $('#iframeCover').hide().appendTo('body');
	  }else if (Math.round(FWC_offset.left + 2) < Math.round(FWT_offset.left) && Math.round(FWC_offset.left) != Math.round(FWT_offset.left)){
		  //The x axis of the window control is shifted!
		  dragging = false;
		  $(this).offset({top: FWC_offset.top, left: FWC_offset.left});
		  console.log("Left value mismatch --> Container: " + FWcontainer.attr("id") + " FWC_offsets: " + FWC_offset.top + "," + FWC_offset.left + " FWT_offsets: " + FWT_offset.top + "," + FWT_offset.left);
		  focusedObject = null;
		  $('#backdrop').hide();
		  $('#iframeCover').hide().appendTo('body');
	  }
	  
	  //This watch dog is used to find crashed tab and redirect it to the blue screen interface.
	  if (FWcontainer.attr("id") != "newWindow" && $(FWcontainer).find("iframe").attr("src") == "%srcPath%"){
		  $(FWcontainer).find("iframe").attr("src","SystemAOB/functions/crashScreen.php?errormsg=A module trying to open a new floatWindow but failed due to unknown reason.<br>" +  FWcontainer.attr("id"));
		  var windowIDofCrashedWindow = FWcontainer.attr("id");
		    changeWindowTitle(windowIDofCrashedWindow,"[Crashed] FloatWindow has no response or could not be loaded")
			setWindowIcon(windowIDofCrashedWindow,"remove")
			
	  }
	  
	});
}
/*
//Function removed and replaced by closeWindow() in update 20-9-2018
function forceTerminate(){
	$( "iframe" ).each(function() {
		var id = $(this).parent().attr("id");
		if ($(this).contents().get(0).location.href != undefined){
			var src = $(this).contents().get(0).location.href;
		}else{
			return;
		}
		if (src == undefined){
			return;
		}
		if (src.includes("SystemAOB/functions/killProcess.php")){
			$("#" + id).delay(500).remove();
			$('#' + id + 'Btn').remove();
			floatWindowCount --;
			killDragging();
		}
	});
}
*/

function ShowCalender(){
	//Display the calender when the user press on the clock
	$("#calGrid").fadeIn("fast");
}

function HideCalender(){
	//Hide the calender when mouse leave
	$("#calGrid").fadeOut("fast");
}

function killDragging(){
	focusedObject = null;
	dragging = false;
	$('#backdrop').hide();
	$('#iframeCover').hide().appendTo('body');
}

function changeWindowTitle(id,newTitle = "New Window"){
	//With given ID, change the floatWindow title
	//console.log(id,newTitle);
	$(".floatWindow").each(function(){
		var thisid = $(this).parent().attr("id");
		if (thisid == id){
			var windowTitle = $(this).text().trim();
			var thisHTML = $(this).html();
			$(this).html(thisHTML.replace(windowTitle,newTitle));
			killDragging();
			bindMotions(id);
		}
	});

}

function setWindowResizable(id){
	//With given ID, change the floatWindow resizable to true
	$(".floatWindow").each(function(){
		var thisid = $(this).parent().attr("id");
		if (thisid == id){
			//if this float window exists
			$(this).parent().append('<div class="resizeWindow" align="center"></div>');
			killDragging();
			bindMotions(id);
		}
	});

}

function setWindowFixedSize(id){
	//With given ID, change the floatWindow resizable to false
	$(".floatWindow").each(function(){
		var thisid = $(this).parent().attr("id");
		if (thisid == id){
			//This floatWindow exists
			$("#" + id + " .resizeWindow").remove();
			$("#" + id + " .maximizeWindow").remove();
			$("#" + id + " .minimizeWindow").css("right","25px");
			killDragging();
			bindMotions(id);
		}
	});
}

function setWindowPreferdSize(id,width,height){
	//With given ID, change the floatWindow size
	$(".floatWindow").each(function(){
		var thisid = $(this).parent().attr("id");
		if (thisid == id){
			//This floatWindow exists
			if (width > $(window).width()){
				width = $(window).width();
				$("#" + id).css("left",0);
			}
			$("#" + id).css("width",width);
			if (height > $(document).height()){
				height = $(document).height();
				$("#" + id).css("top",0);
				$("#" + id).css("height",height).css("height","-=35px");
			}else{
				$("#" + id).css("height",height);
			}
			killDragging();
			bindMotions(id);
		}
	});
	
}

function setWindowIcon(id,iconname){
	//With given ID, change the floatWindow icon
	$(".floatWindow").each(function(){
		var thisid = $(this).parent().attr("id");
		if (thisid == id){
			//This floatWindow exists
			var thisHTML = $(this).html();
			var iconEndPos = thisHTML.indexOf("/i>") + 3;
			var controls = thisHTML.substring(iconEndPos);
			var newhtml = '  <i class="'+iconname+' icon"></i>' + controls;
			$(this).html(newhtml);
			$("#" + id + "Btn").html('<i class="'+iconname+' icon" style="line-height: 35px;"></i>');
			killDragging();
			bindMotions(id);
			
		}
	});
}

function setGlassEffectMode(id){
	//With given ID, change the floatWindow icon
	$(".floatWindow").each(function(){
		var thisid = $(this).parent().attr("id");
		if (thisid == id){
			//This floatWindow exists
			$(this).parent().css("background-color","");
			$(this).parent().css("border","0px solid transparent");
			$(this).css("background-color","rgba(33, 33, 33, 0.8)");
			$(this).css("padding-top","1px");
			$(this).find(".closeWindow").css("top","2px");
			$(this).find(".minimizeWindow").css("top","4px");
			$(this).parent().css("box-shadow","1px 1px 4px #3d3d3d");
			killDragging();
			bindMotions(id);
		}
	});
}

function closeWindow(id){
	$(".floatWindow").each(function(){
		var thisid = $(this).parent().attr("id");
		if (thisid == id){
			//This floatWindow exists, remove the window
			$(this).parent().delay(500).remove();
			//Direct button remove is deprecated since 15-3-2019
			//$('#' + id + 'Btn').remove();
			removeFloatWindowFromMenuBarByID(id);
			floatWindowCount --;
			killDragging();
			bindMotions(id);
		}
	});
}
	
function callToInterface(){
	return frames[0];
}

function getWindowFromModule(modulename){
	//Get the floatWindow id of fw that is running the same module
	result = [];
	$(".floatWindow").each(function(){
		var iframeObject = $(this).parent().find("iframe")[0];
		var src = $(iframeObject).attr("src");
		if (src.substr(0,modulename.length) == modulename|| src.includes("/" + modulename + "/")){
			result.push($(this).parent().attr("id"));
		}
		
	});
	return result;
}

function crossFrameFunctionCall(id,funct){
	if ($("#" + id).length != 0){
		$("#" + id).find("iframe")[0].contentWindow.eval(funct);
	}
}

function getWindowObjectFromID(id){
	if ($("#" + id).length != 0){
		return $("#" + id).find("iframe")[0].contentWindow;
	}else{
		return null;
	}
}
/*
//This function has been replaced by the notification bar in 16-9-2018 updates
function msgbox(warningMsg,displayText="",title="Message Box",icon=""){
	var template='<div class="msgbox" style="position:fixed;top:20%;left:20%;width:400px;max-height:300px;border-radius:0px;padding-top:0px;display:;border-width: 0px;background-color:#f2f2f2" open><div class="floatWindow" style="width:100%; position: relative; background-color:#333;color:white;left:0px;top:0px;height:20px;z-index:8;overflow:hidden;text-overflow: ellipsis;white-space: nowrap;cursor: context-menu;">   %WINDOW_TITLE%<div style="top:2px;right:3px;cursor: pointer;position:absolute;" class="closeWindow"><i class="remove icon"></i></div></div><div style="padding-top:4px;padding-bottom:4px;padding-right:6px;padding-left:10px;"><div class="ts container"><h4 class="ts header"><i class="%ICON% icon"></i><div class="content">%MESSAGEHEADER%<div class="sub header">%CONTENT%</div></div></h4></div><button class="ts inverted tiny right floated button" onClick="$(this).parent().parent().remove();" style="border-radius: 0px;">Confirm</button><br><br></div></div>';
	var box = template.replace("%WINDOW_TITLE%",title);
	box = box.replace("%ICON%",icon);
	box = box.replace("%MESSAGEHEADER%",warningMsg);
	box = box.replace("%CONTENT%",displayText);
	$("body").append(box);
	killDragging();
	bindMotions();
}*/

var previosTimeoutEvent = undefined;
function msgbox(warningMsg,title="",redirectpath="",autoclose=true){
	if (previosTimeoutEvent != undefined){
		clearTimeout(previosTimeoutEvent);
	}
	if ($("#notificationbar").hasClass("hidden")){
		//If the notice board is hidden during the notification time, show it
		toggleNoticeBoard();
	}
	var box = "";
	box += '<div class="messagebox"><div class="ts grid"><div class="twelve wide column">';
	if (title != ""){
		box += '<div style="color:white;font-size:130%;border-bottom:1px dashed white;">' + title + '</div>';
	}
	box += warningMsg;
	if (redirectpath != ""){
		box += '<br><a style="cursor:pointer;" href="' + redirectpath + '" target="_blank">Open in Module <i class="external icon"></i></a>';
	}
	box += '</div><div class="four wide column" align="right"><i class="remove icon pressable" onClick="closemsgbox(this);"></i><br><br></div></div></div>';
	$(box).hide().prependTo("#messageBoard").slideDown();
	playSound("script/msgbox.mp3");
	notificationCount++;
	if (autoclose){
		previosTimeoutEvent = setTimeout(function(){
			if (!$("#notificationbar").hasClass("hidden")){
				//If the notification bar is shown, hide it
				toggleNoticeBoard();
				previosTimeoutEvent = undefined;
			}
		},3500);
	}
}

function playSound(filename){
	var audio = new Audio(filename);
	audio.volume = (Math.round(GetStorage('global_volume') * 100)) / 100;
	audio.play();
}


updateArOZKeypassHandler();
function updateArOZKeypassHandler(){
	window.document.addEventListener('aroz-keypass', handleEvent, false)
	function handleEvent(e) {
		console.log(e.detail.which);
	}
}

function openFullscreen() {
	//Opening full screen will lead to hidden of all iframe for unknown reasons
  var isInFullScreen = (document.fullscreenElement && document.fullscreenElement !== null) ||
        (document.webkitFullscreenElement && document.webkitFullscreenElement !== null) ||
        (document.mozFullScreenElement && document.mozFullScreenElement !== null) ||
        (document.msFullscreenElement && document.msFullscreenElement !== null);
	var elem = document.documentElement;
    if (!isInFullScreen) {
         if (elem.requestFullscreen) {
			elem.requestFullscreen();
		  } else if (elem.mozRequestFullScreen) { /* Firefox */
			elem.mozRequestFullScreen();
		  } else if (elem.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
			elem.webkitRequestFullscreen();
		  } else if (elem.msRequestFullscreen) { /* IE/Edge */
			elem.msRequestFullscreen();
		  }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

$(document).keyup(function(e) {
	var keycode = e.keyCode || e.which;
	if (keycode == 27){
		killDragging();
		console.log("[info] Dragging function killed. Restarting all dragging elements.");
		//bindMotions();
	}else if (keycode == 120){
		//On F9 being pressed, enter full screen with Javascript API
		openFullscreen();
	}
});

function checkCachedWindowSize(url){
	//Check if there are cached window size for this interface. If yes, override the default value
	if (localStorage.getItem("aosystem.fwscache") === null){
		return false;
	}else{
		var cachedWindowSizeList = JSON.parse(localStorage.getItem("aosystem.fwscache"));
		var baseurl = url;
		if (url.includes("?") == true){
			baseurl = url.split("?")[0];
		}
		for (var i =0; i < cachedWindowSizeList.length; i++){
			if (cachedWindowSizeList[i][0] == baseurl || cachedWindowSizeList[i][0] == url){
				//return ww and wh as array
				return [cachedWindowSizeList[i][1],cachedWindowSizeList[i][2]];
			}
		}
	}
	return false;	
}

//FloatWindow size caching mechanism
function cacheWindowSize(url,ww,wh,exact=false){
	var baseurl = url;
	if (!exact){
		if (url.includes("?") == true){
			baseurl = url.split("?")[0];
		}
	}
	if (localStorage.getItem("aosystem.fwscache") === null){
		localStorage.setItem("aosystem.fwscache", JSON.stringify([[baseurl,ww,wh]]));
		console.log([[baseurl,ww,wh]]);
	}else{
		//Append to the list
		var cachedWindowSizeList = JSON.parse(localStorage.getItem("aosystem.fwscache"));
		//Check if the baseurl is in array
		var found = false;
		for (var i=0; i < cachedWindowSizeList.length; i++){
			if (cachedWindowSizeList[i][0] == baseurl){
				found = true;
				cachedWindowSizeList[i][1] = ww;
				cachedWindowSizeList[i][2] = wh;
			}
		}
		if (!found){
			cachedWindowSizeList.push([baseurl,ww,wh]);
		}
		localStorage.setItem("aosystem.fwscache", JSON.stringify(cachedWindowSizeList));
	}
	
	
	
}


//Debug only function
/*
 $(document).keyup(function(e) {
	 //Handle Error in Float Window
     if (e.keyCode == 27) { // escape key 
		dragging = false;
		FloatWindowWatchDog();
		//console.log("Error while handling: " + $(focusedObject).attr("id"));
		//$(focusedObject).parent().remove();
    }
});
*/