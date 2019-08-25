<?php
include_once("../../../auth.php");
?>
<html>
    <head>
        <title>Desktop Module Selector</title>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
         <script src="../../../script/ao_module.js"></script>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    </head>
    <body>
	<br><br>
		<div class="ts container">
			<div class="ts segment">
				<div class="ts header">
					<i class="desktop icon"></i>Desktop Module Selector
					<div class="sub header">Change the default Desktop Module if you want something special.</div>
				</div>
			</div>
			<div class="ts segment">
				<div class="ts form">
					<div class="field">
						<label>Desktop Interfacing Module</label>
						<input id="sdm" type="text" placeholder="Desktop">
					</div>
					<div class="field">
						<label>Default Starting Path</label>
						<input id="ssp" type="text"  placeholder="index.php">
					</div>
					<div class="field">
						<label>Desktop Extension Module</label>
						<input id="sed" type="text"  placeholder="Desktop">
					</div>
					<div class="field">
						<label>Extension Starting Path</label>
						<input id="sep" type="text"  placeholder="extended.php">
					</div>
					<div id="confirmUpdate" class="ts inverted positive segment" style="display:none;">
						<p><i class="checkmark icon"></i>Desktop Module Selection Updated.</p>
					</div>
					<div align="right">
						<button id="updateBtn" class="ts small primary button" onClick="update();">Update</button>
						<button class="ts small basic button" onClick="reset();">Reset</button>
						<button class="ts small basic button" onClick="factory();">Set to Default</button>
					</div>
				</div>
			</div>
		</div>
		<script>
			$(document).ready(function(){
				reset();
			});
			
			function update(){
				var sdm = $("#sdm").val();
				var ssp = $("#ssp").val();
				var sed = $("#sed").val();
				var sep = $("#sep").val();
				var configObject = {systemDesktopModule: sdm,systemStartingPath: ssp,systemExtendedDesktop: sed,systemExtentedPath: sep};
				$.post("desktopConfig.php",{newConfig: JSON.stringify(configObject)}).done(function(data){
					if (data.includes("ERROR") == false){
						$("#confirmUpdate").stop(true).slideDown().delay(3000).slideUp();
						reset();
					}
				});
			}
			
			function factory(){
				$("#sdm").val("Desktop");
				$("#ssp").val("index.php");
				$("#sed").val("Desktop");
				$("#sep").val("extended.php");
			}
	
			function reset(){
				$.get("desktopConfig.php",function(data){
					$("#sdm").val(data["systemDesktopModule"]);
					$("#ssp").val(data["systemStartingPath"]);
					$("#sed").val(data["systemExtendedDesktop"]);
					$("#sep").val(data["systemExtentedPath"]);
				});
			}
			
			
		</script>
	</body>
</html>