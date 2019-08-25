<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<meta charset="UTF-8">
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
</head>
<body style="background:rgba(255,255,255,1);">
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			WebApp Package Manager
			<div class="sub header">Repo manange</div>
		</div>
	</div>
	</div>
	<table class="ts table">
    <thead>
        <tr>
            <th>Repo</th>
            <th>Description</th>
			<th>Action</th>
        </tr>
    </thead>
    <tbody id="table">
    </tbody>
	 <tfoot class="full-width">
        <tr>
            <th></th>
            <th colspan="4">
                <div class="ts right floated primary small button" onclick="ts('#modal').modal('show')">
                    Add new repo
                </div>

            </th>
        </tr>
    </tfoot>
</table>
	

<div class="ts modals dimmer">
<dialog class="ts basic modal" id="modal" style="background-color:white" close>
    <div class="header" style="color:black" id="head_modal">
        Adding new repo
    </div>
<div class="content">
   <div class="ts form">
    <div class="field">
        <label>Repository URL</label>
        <input type="text" placeholder="https://example.com/Package Server/" id="url">
        <small>IMUSLab don't take any responsibility for 3rd repository. ENTER to fetch data.</small>
    </div>
	<div class="ts very relaxed divided list">
		<div class="item" id="name">Name : None</div>
		<div class="item" id="protocol">Protocol : None</div>
		<div class="item" id="version">Version : None</div>
	</div>
</div>
    </div>
	<div class="actions">
        <button class="ts deny button">
            Cancel
        </button>
        <button class="ts positive button" id="installbtn" onclick="addrepo()" disabled="disabled">
            Add
        </button>
    </div>
</dialog>
</div>
</body>
<script>
var sourcecsv = "<?php echo str_replace("\r\n",",",file_get_contents('source.csv')) ?>";
startup();

function startup(){
	sourcecsv.split(",").forEach(function(element){
		if(element !== ""){
		$('#table').append('<tr><td>' + element +'</td><td>' + chkdescription(element) + '</td><td><button onclick="remove(this)" url="' +element + '" class="ts basic button">Remove</button></td></tr>');
		}
	});
}

function fetchrepo(){
$('#installbtn').attr("disabled","disabled");
$('#installbtn').html('<div class="ts active inline mini loader"></div>');
$.getJSON("query.php?url=" + $('#url').val() + "&ver=1.0.0", function( data ) {
	if(data["status_code"] == 200){
		$('#name').text("Name : " + data["name"]);
		$('#protocol').text("Protocol : " + data["protocol"]);
		$('#version').text("Version : " + data["version"]);
		$('#installbtn').removeAttr("disabled");
	}else if(data["status_code"] == 404){
		$('#name').text("Name : Not found");
		$('#protocol').text("Protocol : Not found");
		$('#version').text("Version : Not found");
		$('#installbtn').attr("disabled","disabled");	
	}else{
		$('#name').text("Name : Error");
		$('#protocol').text("Protocol : Error");
		$('#version').text("Version : Error");
		$('#installbtn').attr("disabled","disabled");	
	}
	if(sourcecsv.indexOf($('#url').val()) !== -1){
		$('#installbtn').html('Exists');
		$('#installbtn').attr("disabled","disabled");
	}else{
		$('#installbtn').html('Add');
	}
});
}

function addrepo(){
	$.get("repo.php?method=add&url=" + $('#url').val(), function( data ) {
		location.reload();
	});
}

function chkdescription(url){
	var tmp = "No description";
	$.ajax({
		url: "query.php?url=" + url + "&ver=1.0.0",
		dataType: 'json',
		async: false,
		success: function(data) {
			tmp = data["name"];
			//console.log(data["name"]);
		}
	});
	return tmp;
}

function remove(url){
		$.get("repo.php?method=remove&url=" + $(url).attr("url"), function( data ) {
			location.reload();
		});
}

$(document).keypress(function(e) {
	if(e.which == 13) {
		e.preventDefault();
		fetchrepo();
	}
});
</script>
</html>
