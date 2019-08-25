<?php
include '../auth.php';

if (isset($_GET['username']) && $_GET['username'] != ""){
	$username = $_GET['username'];
}else{
	$username = "null";
}
?>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>Trash Bin</title>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script src="../script/tocas/tocas.js"></script>
	<script src="../script/jquery.min.js"></script>
	<style>
	body{
		 background:rgba(255,255,255,0.7);
		 padding-bottom:50px;
	}
	.longtext{
		word-break: break-all;
	}
	</style>
</head>
<body>
<div style="position:fixed;top:0px;left:0px;z-index:100;width:100%;background-color:#e8e8e8 !important;">
<div class="ts tiny pointing secondary fluid borderless menu">
    <div class="item"><i class="hashtag icon"></i></div>
	<a class="item" href="">Refresh</a>
	<a class="item" onClick="recoverAll();" style="background-color:#cadcf9;"><i class="undo icon"></i>Recover All</a>
	 <div style="position:fixed;top0px;right:0px;">
	 
		<a class="item" style="background-color:#932219;color:white;height:30px !important;" onClick="clearTrashBin();"><i class="delete icon"></i>Clean Trash Bin</a>
    </div>
</div>
</div>
<table class="ts table" style="width:100%;top:18px;left:0px;padding-bottom:20px;">
    <thead>
        <tr>
            <th>#</th>
            <th>Filename</th>
            <th>Storage Filename</th>
			<th>UUID</th>
			<th>Recover</th>
        </tr>
    </thead>
    <tbody id="filelist">
		
    </tbody>
    <tfoot>
    </tfoot>
</table>
<div class="ts slate" style="font-size:10px">
CopyRight ArOZ Online Project feat. IMUS Laboratory<br>
Warning. Developer will not bear any responsibility for accidentally removed files / data loss including but not limited to power outage and hard disk failure.
</div>
<script>
var username = "<?php echo $username;?>";
var template = "<tr><td>%COUNT%</td><td class='longtext'>%DISPLAYNAME%</td><td class='longtext'>%RAWNAME%</td><td class='longtext uuid'>%UUID%</td><td><button class='ts icon button' onClick='recover(this);'><i class='undo icon'></i></button></td></tr>";
$("#filelist").append('<div class="ts fluid segment" align="center"><i class="loading spinner icon"></i> Now loading...</div>');
$.get( "trashBin.php?username=" + username + "&act=load", function( data ) {
	if (data.includes("ERROR")){
		console.log(data);
	}
	$("#filelist").html("");
	if (data.length == 0){
		$("#filelist").append('<div class="ts fluid segment">There is no file in the Trash Bin.</div>');	
		return;
	}
	for(var i=0; i < data.length;i++){
		var box = template.replace("%COUNT%",i);
		box = box.replace("%UUID%",data[i][0].toUpperCase());
		box = box.replace("%RAWNAME%",data[i][1]);
		box = box.replace("%DISPLAYNAME%",data[i][2]);
		$("#filelist").append(box);
	}
});

function recoverAll(){
	$.get( "trashBin.php?username=" + username + "&act=undoAllContent", function( data ) {
		if (data.includes("ERROR") == false){
			window.location.reload();
		}
	});
}

function recover(object){
	var uuid = ($(object).parent().parent().find(".uuid").text());
	$.get( "trashBin.php?username=" + username + "&act=undo&uuid="  + uuid, function( data ) {
		if (data.includes("ERROR") == false){
			window.location.reload();
		}
	});
}

function clearTrashBin(){
	$.get( "trashBin.php?username=" + username + "&act=clearTrashBinConfirm", function( data ) {
		if (data.includes("ERROR") == false){
			window.location.reload();
		}
	});
}
</script>
</body>
</html>