<?php
include '../../../auth.php';
?>
<html>
<head>
	<meta charset="UTF-8">
	<script type='text/javascript' charset='utf-8'>
		// Hides mobile browser's address bar when page is done loading.
		  window.addEventListener('load', function(e) {
			setTimeout(function() { window.scrollTo(0, 1); }, 1);
		  }, false);
	</script>
    <link href="../../../script/tocas/tocas.css" rel='stylesheet'>
	<script src="../../../script/jquery.min.js"></script>
    <title>System Power</title>
    <style type="text/css">
        body {
            padding-top: 4em;
            background-color: rgb(250, 250, 250);
            overflow: scroll;
        }
    </style>
</head>
<body>
<div class="ts container">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			Power Management
			<div class="sub header">Adjust your power plan with the options below. All power settings will be reset upon system reboot.</div>
		</div>
	</div>
<div class="ts checkboxes">
	<?php
	if(file_exists("mode.csv")){
		$contents = file_get_contents("mode.csv");
		$options = explode("\n",$contents);
		foreach ($options as $config){
			$dc = explode(",",$config);
			$modeName = $dc[0];
			$modeDescript = $dc[1];
			$file = $dc[2];
			$functionID = basename($file,".php");
			echo '<div class="ts radio checkbox">';
			echo '<input type="radio" name="powermode" id="'.$functionID.'">
					<label for="'.$functionID.'">'.$modeName.'</label>';
			echo '</div>';
		}
		
	}else{
		echo ' <div class="ts disabled radio checkbox">
        <input type="radio" name="default" id="default">
        <label for="default">System Default</label>
		</div>';
	}
	
	?>
</div>
</div>
</body>
</html>