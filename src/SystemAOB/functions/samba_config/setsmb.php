
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<meta charset="UTF-8">
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
</head>
<body style="background:rgba(255,255,255,1);">
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			Server Message Block Configuration
			<div class="sub header">Create New Directory</a>
			</div>
		</div>
	</div>

</div>
<br>
	<div class="ts container">
		<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    echo '<div class="ts container"><div class="ts divider"></div><div class="ts secondary message">
		<div class="header">Host Operation System not supported</div>
		<p>This function is currently not supported on Windows Host.<br> If you are sure this function should be available, please check if your ArOZ Online system is up to date.</p>
	</div><div class="ts divider"></div></div>';
	die();
}
?>
<div class="ts horizontal form">
    <div class="field">
        <label>Path</label>
        <input type="text" id="path">
    </div>
	
    <div class="field">
        <label>Comment</label>
        <input type="text" id="comment">
    </div>
	 <div class="field">
        <div class="ts checkbox">
            <input id="browseable" type="checkbox" id="browseable">
            <label for="browseable">Browseable</label>
        </div>
	</div>
	 <div class="field">
        <div class="ts checkbox">
            <input id="guestok" type="checkbox" id="guestok">
            <label for="guestok">Guest OK</label>
        </div>
	</div>
	 <div class="field">
        <div class="ts checkbox">
            <input id="readonly" type="checkbox" id="readonly">
            <label for="readonly">Read only</label>
        </div>
	</div>
	
	<br>
	<div class="ts grid">
    <div class="right aligned four wide column">Owner</div>
    <div class="right aligned four wide column">
		<div class="ts checkbox">
            <input id="read_o" type="checkbox">
            <label for="read_o">Read</label>
        </div>
	</div>
    <div class="right aligned four wide column">
		<div class="ts checkbox">
            <input id="write_o" type="checkbox">
            <label for="write_o">Write</label>
        </div>
	</div>
    <div class="right aligned four wide column">
		<div class="ts checkbox">
            <input id="execute_o" type="checkbox">
            <label for="execute_o">Execute</label>
        </div>
	</div>
	
    <div class="right aligned four wide column">Group</div>
    <div class="right aligned four wide column">
		<div class="ts checkbox">
            <input id="read_g" type="checkbox">
            <label for="read_g">Read</label>
        </div>
	</div>
    <div class="right aligned four wide column">
		<div class="ts checkbox">
            <input id="write_g" type="checkbox">
            <label for="write_g">Write</label>
        </div>
	</div>
    <div class="right aligned four wide column">
		<div class="ts checkbox">
            <input id="execute_g" type="checkbox">
            <label for="execute_g">Execute</label>
        </div>
	</div>
	
    <div class="right aligned four wide column">Others</div>
    <div class="right aligned four wide column">
		<div class="ts checkbox">
            <input id="read_t" type="checkbox">
            <label for="read_t">Read</label>
        </div>
	</div>
    <div class="right aligned four wide column">
		<div class="ts checkbox">
            <input id="write_t" type="checkbox">
            <label for="write_t">Write</label>
        </div>
	</div>
    <div class="right aligned four wide column">
		<div class="ts checkbox">
            <input id="execute_t" type="checkbox">
            <label for="execute_t">Execute</label>
        </div>
	</div>
	</div>
	<br>
	<div class="ts right floated separated buttons">
		<a class="ts button" href="index.php">Back</a>
		<div class="ts primary button" onclick="submit()">Submit</div>
		<div class="ts negative button" onclick="remove()">Remove</div>
	</div>
	</div>
	
</div>

<div id="msgbox" class="ts active bottom right snackbar" style="display:none;">
    <div class="content">
        Your request is processing now.
    </div>
</div>

<br><br>
<?php
$result = [];

if(isset($_GET["data"])){
$tmp = explode(";",$_GET["data"]);
array_pop($str);
foreach($tmp as &$value){
	$arrtmp = explode(":",$value);
	$result[$arrtmp[0]] = $arrtmp[1];
}
}



function convp($str,$group){
	if($str == 1){
		return "$('#execute_".$group."').prop('checked',true);";
	}else if($str == 2){
		return "$('#write_".$group."').prop('checked',true);";
	}else if($str == 3){
		return "$('#execute_".$group."').prop('checked',true);\r\n$('#write_".$group."').prop('checked',true);";
	}else if($str == 4){
		return "$('#read_".$group."').prop('checked',true);";
	}else if($str == 5){
		return "$('#execute_".$group."').prop('checked',true);\r\n$('#read_".$group."').prop('checked',true);";
	}else if($str == 6){
		return "$('#write_".$group."').prop('checked',true);\r\n$('#read_".$group."').prop('checked',true);";
	}else if($str == 7){
		return "$('#execute_".$group."').prop('checked',true);\r\n$('#write_".$group."').prop('checked',true);\r\n$('#read_".$group."').prop('checked',true);";
	}
	
}

function conv($str){
	if(strtolower($str)=="yes"){
		return "true";
	}else{
		return "false";
	}
}


?>
<script>
$('#path').val("<?php echo $result["path"];?>");
$('#comment').val("<?php echo $result["comment"];?>");
$('#browseable').prop('checked', <?php echo conv($result["browseable"]); ?>);
$('#guestok').prop('checked', <?php echo conv($result["guest ok"]); ?>);
$('#readonly').prop('checked', <?php echo conv($result["read only"]); ?>);

<?php
//dir mask and create mask will same, therefore just one setting
$dir = str_split($result["directory mask"]); 

echo convp($dir[1],"o");
echo convp($dir[2],"g");
echo convp($dir[3],"t");
?>

function calc(gp){
	var tmp = 0;
	if ($('#read_' + gp).is(':checked')) {
		tmp = tmp + 4;
	}
	if ($('#write_' + gp).is(':checked')) {
		tmp = tmp + 2;
	}
	if ($('#execute_' + gp).is(':checked')) {
		tmp = tmp + 1;
	}
	return tmp;
}

function conv(str){
	if($('#' + str).is(':checked')){
		return "yes";
	}else{
		return "no";
	}
}

function submit(){
	var perm = "0" + calc("o") + calc("g")  + calc("t")  ;
	
	var str = 'path:' + $('#path').val() + ';' + 'comment:' + $('#comment').val() + ';' + 'browseable:' + conv('browseable') + ';' + 'guest ok:' + conv('guestok') + ';' + 'read only:' + conv('readonly') + ';' + 'create mask:' + perm + ';' + 'directory mask:' + perm + ';';
	$.get( "writesmbconf.php?section=<?php echo $_GET["section"] ?>&config=" + str, function( data ) {
		//console.log("finished");
		window.location = "index.php?msg=Samba Configuration has been updated.";
	});
}
function remove(){
	$.get( "writesmbconf.php?section=<?php echo $_GET["section"] ?>", function( data ) {
		//console.log("finished");
		window.location = "index.php?msg=Directory Removed.";
	});
}
</script>
</body>
</html>