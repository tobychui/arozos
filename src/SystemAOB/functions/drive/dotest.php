<?php
include_once("../../../auth.php");
?>
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
<body style="background-color: white">
<br>
<div class="ts container">
	<p id="Tstatus">Quick diagnostic in progress... Approximate time was 3 minutes.</p>
	<div class="ts progress">
		<div class="bar" id="prbar" style="width: 0%"></div>
	</div>
	<p id="status"></p>
</div>
<script>
if(typeof ao_module_inputs !== "function"){
	$.getScript( "../../../script/ao_module.js", function() {ao_module_setWindowSize(500,130);});
}
ao_module_setFixedWindowSize();
var timer = setInterval(function(){ 
	$.getJSON( "readsmart.php", function( data ) {
		if(typeof data["<?php echo $_GET["disk"]; ?>"]["ata_smart_data"]["self_test"] !== "undefined"){
			var status = data["<?php echo $_GET["disk"]; ?>"]["ata_smart_data"]["self_test"]["status"];
			if(status["value"] == 246){
				var width = status["remaining_percent"];
				$("#prbar").attr("style","width: " + (100-width) + "%");
				$("#status").text("Status:" + status["string"]);
			}else if(status["value"] == 16){
				$("#Tstatus").text("Harddisk test aborted.");
				$("#status").text("Status:" + status["string"]);					
			}else if(status["value"] == 0){
				$("#Tstatus").text("Harddisk test finished.");
				$("#status").text("Status:" + status["string"]);
			}
		}
	});
}, 3000);


</script>
</body>
</html>
<?php
exec('sudo smartctl -t short -C '.$_GET["disk"]);
?>