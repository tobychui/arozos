<?php
include '../../../auth.php';
?>
<!DOCTYPE html>
<html>
   <head>
      <meta charset="UTF-8">
      <link rel="stylesheet" href="../../../script/tocas/tocas.css">
      <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
      <script src="../../../script/jquery.min.js"></script>
	  
      <title>WIFI</title>
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

   </head>


<body>
<br>
<div class="ts narrow container">
            <div class="ts relaxed grid">

                <div class="sixteen wide column">
                    <h3 class="ts header">
                        Wi-Fi Information
                        <div class="sub header">Current WiFi Connection Information will be shown on this page.</div>
                    </h3>
                </div>

                <div class="sixteen wide column">
                    <div class="ts two cards">

                        <div class="ts card">
                            <div class="content">

                                <div class="ts left aligned statistic">
                                    <div class="value" id="CurrentConnectedWiFiNetworkName">
                                        Detecting...
                                    </div>
                                    <div class="label">Wi-Fi SSID</div>
                                </div>
         
                            </div>
                            <div class="symbol">
                                <i class="signal icon"></i>
                            </div>
                        </div>

                        <div class="ts card">
                            <div class="content">

                                <div class="ts left aligned statistic">
                                    <div class="value" id="CurrentInternetConnection">
                                        Detecting...
                                    </div>
                                    <div class="label">Internet</div>
                                </div>

                            </div>
                            <div class="symbol">
                                <i class="world icon"></i>
                            </div>
                        </div>


                    </div>

                    <div class="ts section divider"></div>
                    
                </div>


               
        </div>

<script>
var inWindows = <?php if(strtoupper(substr(PHP_OS, 0, 3)) === 'WIN'){
 echo "true";
 }else{
 echo "false";
 }?>;
if (inWindows){
	$.get("chkonline.php", function (data) {
		if (data != "false"){
			$("#CurrentInternetConnection").html("Connected (Windows)");
		}else{
			$("#CurrentInternetConnection").html("Disconnected (Windows)");
		}
		$("#CurrentConnectedWiFiNetworkName").html("Access Denied");
	});
}else{
	$.get("getSSID.php", function (data) {
	    if (data[0] != ""){
			$("#CurrentConnectedWiFiNetworkName").html(data[0]);
		}else{
			$("#CurrentConnectedWiFiNetworkName").html("N/A");
		}
		
	});
	$.get("internet.php", function (data) {
		if(data == true){
			$("#CurrentInternetConnection").html("Connected");
		}else{
			$("#CurrentInternetConnection").html("Disconnected");
		}
	});
}

</script>
</body>
</html>