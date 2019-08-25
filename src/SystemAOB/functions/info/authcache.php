<?php
include_once '../../../auth.php';

//Define the auth storage location
/*
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	$databasePath = "C:/AOB/whitelist.config";
	$seedsbank = "C:/AOB/cookieseeds/";
}else{
	$databasePath = "/etc/AOB/whitelist.config";
	$seedsbank = "/etc/AOB/cookieseeds/";
}
*/
//Check if clear cache is requested	
if (isset($_POST['confirm']) && $_POST['confirm'] == "true"){
	if (is_writable($seedsbank)){
		$files = glob($seedsbank . '*.auth');
		foreach ($files as $file){
			unlink($file);
		}
		echo "DONE";
	}else{
		echo 'ERROR. Directory not writable or not exists.';
	}
	exit(0);
}
?>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
<title>ArOZ Online - System Information</title>
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
</head>
<body style="background-color:#f9f9f9;">
<br><br><br>
<div class="ts container">
	<div class="ts header">
		System Login Cache
		<div class="sub header">These files make sure you can login again without your password on the same browser.</div>
	</div>
	<table class="ts table">
		<thead>
			<tr>
				<th># UUID</th>
				<th>Creation Time</th>
				<th>Filepath</th>
			</tr>
		</thead>
		<tbody>
			<?php
				$cookieSeeds = glob($seedsbank . "*.auth");
				foreach ($cookieSeeds as $seed){
					$filename = str_replace(".auth","",basename($seed));
					$creationTime = date('Y-m-d H:i:s',filectime($seed));
					echo "<tr>
							<td>$filename</td>
							<td>$creationTime</td>
							<td>$seed</td>
						</tr>";
				}
			
			?>
		</tbody>
		<tfoot>
			<tr>
				<th colspan="3">Total Cached Sessions: <?php echo count($cookieSeeds);?></th>
			</tr>
		</tfoot>
	</table>
	<br>
	<div class="ts negative segment">
		<p>Danger Zone</p>
		<p>Remove all the cached sessions will remove all permissions that gave to any browsers and all users will require entering password when they try to login again.</p>
		<button class="ts labeled icon negative button" onClick='askForRemoval();'>
			<i class="trash icon"></i>
			Remove All Cached Sessions
		</button>
	</div>
</div>
<br><br><br><br>
</div>
<script>
function askForRemoval(){
	if (confirm('CONFIRM REMOVAL?')) {
		$.post( "authcache.php", { confirm: "true" })
		  .done(function( data ) {
			  window.location.reload();
		 });
	}
}
</script>
</body>
</html>