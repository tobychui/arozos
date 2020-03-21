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
<table class="ts celled striped table">
    <thead>
        <tr>
    <thead>
        <tr>
            <th>#</th>
            <th>Name</th>
            <th>Value</th>
            <th>Worst</th>
            <th>Status</th>
        </tr>
    </thead>
    <tbody id="smartbody">
        
    </tbody>
</table>

<script>
if(typeof ao_module_inputs !== "function"){
	$.getScript( "../../../script/ao_module.js", function() {ao_module_setWindowSize(700,500);});
}

	$.getJSON( "readsmart.php", function( data ) {
		if(typeof data["<?php echo $_GET["disk"]; ?>"]["ata_smart_attributes"] !== "undefined"){
			$.each(data["<?php echo $_GET["disk"] ?>"]["ata_smart_attributes"]["table"], function( index, value ) {
				if(value["id"] !== undefined){
					var id = value["id"];
				}else{
					var id = "Unknown";
				}
				if(value["name"] !== undefined){
					var name = value["name"];
				}else{
					var name = "Unknown";
				}
				if(value["value"] !== undefined){
					var Svalue = value["value"];
				}else{
					var Svalue = "Unknown";
				}
				if(value["worst"] !== undefined){
					var worst = value["worst"];
				}else{
					var worst = "Unknown";
				}
				if(typeof value["when_failed"] !== "undefined"){
					if(value["when_failed"] !== ""){ //probabally FAILING_NOW, but not sure.
						var when_failed = "Failed";
					}else{
						var when_failed = "OK";
					}
				}else{
					var when_failed = "Unknown";
				}
				$("#smartbody").append('<tr><td>' + id + '</td><td>' + name + '</td><td>' + Svalue + '</td><td>' + worst + '</td><td>' + when_failed + '</td></tr>');
			});
		}
	});
</script>
</body>
</html>