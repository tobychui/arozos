//Image Manager Control Script
//Global Variables
var csdirectory = "";//Current Selected Directory
var previewMode = true;
var sendmode = 0;
var selectedFiles = [];
//SendMode define the mode to move files.
// 0 - Do not sent
// 1 - Sent only selected
// 2 - Sent All
// 3 - Delete Selected
$( document ).ready(function() {
	//Hide the notification bar
    $('#nfb').hide();
	//Hide the confirm box
	$('#confirmbox').hide();
	//Enable Preview mode as default
	$("#btn1").attr('class','ts button active');
	//Unselect all checkbox to prevent browser memory.
	toggleFalse();
});

//Check if the foldername contain illegal characters
$('#fileNameInput').on('input',function(e){
	$('#fileNameInput').val($('#fileNameInput').val().replace(/[^A-Za-z0-9]/g, ""));
});

//Check if the user confirm folder creation
$("#fileNameInput").on('keyup', function (e) {
    if (e.keyCode == 13) {
		if ($('#fileNameInput').val() != ""){
        $.ajax({
			data: 'name=' + $('#fileNameInput').val(),
			url: 'new_folder.php',
			method: 'POST', // or GET
			success: function(msg) {
				console.log(msg);
				if (msg == "DONE"){
					location.reload(); 
				}else{
					showNotifiy("Something went wrong on the server side :(");
				}
			}
		});
		}else{
			$('#filenamer').fadeOut('fast');
		}
    }
});



//Management finished
function done(){
	$("body").fadeOut(1000,function(){
       window.location.href = "index.php";
    })
}

//Starting a new folder
function newfolder(){
	$('#filenamer').show();
	$('#fileNameInput').focus();
	showNotifiy('Enter the folder name and press Enter to create new folder.');
}

//Check all checkbox
function toggle() {
  checkboxes = document.getElementsByName('box2check');
  for(var i=0, n=checkboxes.length;i<n;i++) {
    checkboxes[i].checked = true;
  }
}

//Uncheck all checkbox
function toggleFalse() {
  checkboxes = document.getElementsByName('box2check');
  for(var i=0, n=checkboxes.length;i<n;i++) {
    checkboxes[i].checked = false;
  }
}

function ConfirmAction(){
	$('#confirmbox').fadeOut('slow');
	if (selectedFiles.length != 0 && sendmode != 0){
		//There are action and files prepared to be sent
		$.ajax({
			data: 'files=' + selectedFiles + '&opr=' + sendmode + '&dir=' + csdirectory,
			url: 'Image_mover.php',
			method: 'POST', // or GET
			success: function(msg) {
				console.log(msg);
				if (msg == "DONE"){
					location.reload(); 
				}else{
					showNotifiy("Something went wrong on the server side :(");
				}
			}
		});
		
		
	}
	
}

function MoveFile(mode){
	$('#confirmbox').css('background', 'rgba(0,0,0,0.7)');
	if (csdirectory == "" && mode != 3){
		//No selected folder target 
		showNotifiy("No target folder selected.");
	}else{
		$('#confirmbox').fadeIn('slow');
		var msg = "Error. Please refresh this page."
		sendmode = mode;
		if (mode == 1){
			//Get all the checked ids
			var all, checked, notChecked;
			all = $("input:checkbox");
			checked = all.filter(":checked");
			notChecked = all.not(":checked");
			var checkedIds = checked.map(function() {
				return this.id;
			});
			msg = "Are you sure that you want to sent the these files to '" + csdirectory +"' ? <br> This process cannot be undo. List of files to be moved:<br>";
			selectedFiles = [];
			for (var i = 0, len = checkedIds.length; i < len; i++){
				//console.log(GetFileNameFromID(checkedIds[i]));
				var filename = GetFileNameFromID(checkedIds[i]);
				msg += filename + " -> " + filename.replace("uploads/",csdirectory + "/") + "<br>";
				selectedFiles.push(filename);
			}
			console.log(selectedFiles);
		}else if (mode == 2){
			var all, checked, notChecked;
			all = $("input:checkbox");
			var Ids = all.map(function() {
				return this.id;
			});
			msg = "All files under 'Unsorted' will be moved to '" + csdirectory + "'. Are you sure?<br> This process cannot be undo. List of files to be moved:<br>";
			selectedFiles = [];
			for (var i = 0, len = Ids.length; i < len; i++){
				//console.log(GetFileNameFromID(checkedIds[i]));
				var filename = GetFileNameFromID(Ids[i]);
				msg += filename + " -> " + filename.replace("uploads/",csdirectory + "/") + "<br>";
				selectedFiles.push(filename);
			}
			
		} else if (mode == 3){
			$('#confirmbox').css('background', 'rgba(124,66,70,0.8)'); //DARKER:rgba(84,44,47,0.7)
			var all, checked, notChecked;
			all = $("input:checkbox");
			checked = all.filter(":checked");
			notChecked = all.not(":checked");
			var checkedIds = checked.map(function() {
				return this.id;
			});
			msg = "All selected files will be DELETED. Are you sure?<br> This process cannot be undo. List of files TO BE DELETED:<br>";
			selectedFiles = [];
			for (var i = 0, len = checkedIds.length; i < len; i++){
				//console.log(GetFileNameFromID(checkedIds[i]));
				var filename = GetFileNameFromID(checkedIds[i]);
				msg += "[REMOVE] " + filename + "<br>";
				selectedFiles.push(filename);
			}
			
		}
		$('#confirminfo').html(msg);
	}
}


function GetFileNameFromID(divid){
	return $("#" + divid + "-rfp").html();
}

function TogglePreview(){
	if (previewMode == true){
		$("#btn1").attr('class','ts button');
		showNotifiy("Preview Mode Disabled.");
		previewMode = false;
		$("#previewWindow").attr("src","img/Photo_manager.png");
	}else{
		$("#btn1").attr('class','ts button active');
		showNotifiy("Preview Mode Enabled.");
		previewMode = true;
	}
}

//Show preview if clicked
function showPreview(divid){
	if (previewMode == true){
		var src = $("#" + divid + "-rfp").html();
		$("#previewWindow").attr("src",src);
		if($("#" + divid + "-rfp").length == 0) {
		  console.log('DIV NOT FOUND');
		}
		
	}
	//Update other information
	$('#ImageName').html($("#" + divid + "-ofn").html() + "." + $("#" + divid + "-ext").html());
	$('#fileext').html($("#" + divid + "-ext").html());
	$('#storagename').html($("#" + divid + "-rfp").html());
	$('#imgsize').html($("#" + divid + "-size").html());
	//$('#targetdir').html($("#" + divid + "-rfp").html());
}

//Change active focus of folder
function selectFolder(foldername){
	$("#" + foldername).attr('class','item active');
	if (csdirectory != ""){
		$("#" + csdirectory).attr('class','item');
	}
	csdirectory = foldername;
	$('#targetdir').html(foldername);
}

//Simple function for poping out the notification bar
function showNotifiy(text){
	$('#nfbtxt').html(text);
	$('#nfb').stop().fadeIn('slow').delay(2000).fadeOut('slow');
}
