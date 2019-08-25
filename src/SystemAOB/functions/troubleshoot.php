<?php
include '../../auth.php';
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
    <meta charset="UTF-8">
	<script src="../../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../../script/tocas/tocas.css">
	<script type='text/javascript' src="../../script/tocas/tocas.js"></script>
	<title>ArOZ Onlineβ</title>
</head>
<body>
	<?php
	if (isset($_GET['showAll']) && $_GET['showAll'] == 'true'){
		$showAll = true;
	}else{
		$showAll = false;
	}
	?>
    <nav class="ts attached inverted borderless normal menu">
        <div class="ts narrow container">
            <a href="../" class="item">ArOZ Onlineβ</a>
        </div>
    </nav>
	
	<div class="ts container">
	<br>
	<h2 class="ts header">
    <i class="settings icon"></i>
    <div class="content">
        Simple Troubleshooting Tool
        <div class="sub header">The utility detects common issues and also generate the debugging information for developers</div>
    </div>
</h2>
	<br>
	<table class="ts table">
    <thead>
        <tr>
            <th>Information</th>
            <th>Status</th>
        </tr>
    </thead>
    <tbody>
	<?php echo '<tr><td>Operation System</td><td>'.php_uname().'</td></tr>'; ?> 
	<?php echo '<tr><td>PHP version</td><td>'.phpversion().'</td></tr>'; ?>
	<?php
	echo '<tr><td>Disk Space</td><td>';
	include_once("diskSpace.php");
	echo '</td></tr>';
	?>
	<?php echo '<tr><td>Aroz Base Directory</td><td>'.dirname(__FILE__).'</td></tr>';?>
	<?php
		$files = glob("../../*");
		foreach ($files as $file){
			if (is_dir($file)){
				echo folder_prem($file,false);
				$filesInsideModule = glob($file . "/*");
				foreach ($filesInsideModule as $fim){
					if (is_dir($fim) && basename($fim) == "uploads"){
						echo folder_prem($fim,false);
					}else if (is_dir($fim) && $showAll == true){
						echo folder_prem($fim,false);
					}
				}
			}else{
				
			}
		}
	?>
	
    </tbody>
</table>
	<button class="ts inverted left icon labeled button" onclick="ts('#debugModal').modal('show')"><i class="bug icon"></i>Debugging Information</button>
	
	
	<div class="ts modals dimmer">
    <dialog id="debugModal" class="ts closable fluid modal">
        <div class="content">
               <div class="ts form">
					<div class="field">
						<label>Please copy all string and send to developer in order to solve your issues</label>
						<textarea rows="4" width="100%"><?php echo debug();?></textarea>
					</div>
				</div>
        </div>
        <div class="actions">
            <button class="ts positive button">
                Close
            </button>
        </div>
    </dialog>
</div>

	</div>

</body>
<?php
function folder_prem($dir,$debug) {
	
if(is_dir($dir)){
	if(is_readable($dir)){
		if(is_writable($dir)){
			if($debug == false){
				return '<tr class="positive"><td>Folder '.$dir.'</td><td><i class="check icon"></i>Read, Write</td></tr>';
			}else{
				return "FOLDER : ".$dir." - READ , WRITE";
			}
		}else{
			if($debug == false){
				return '<tr class="error"><td>Folder '.$dir.'</td><td><i class="close icon"></i>Read Only</td></tr>';
			}else{
				return "FOLDER : ".$dir." - READ ONLY";
			}
		}
	}else{
		if($debug == false){
			return '<tr class="error"><td>Folder '.$dir.'</td><td><i class="close icon"></i>No Permissions</td></tr>';
		}else{
			return "FOLDER : ".$dir." - NO PERMISSIONS";
		}
	}

}else{
	if($debug == false){
		return '<tr class="error"><td>Folder '.$dir.'</td><td><i class="close icon"></i>Error : Folder does not exist or this is not a valid folder</td></tr>';
	}else{
		return "FILE : ".$dir." - SIZE : ".filesize($dir)." - MD5 : ".md5_file($dir);
	}
}

}



function d_dir($pattern, $flags = 0) {
    $files = glob($pattern, $flags); 
    foreach (glob(dirname($pattern).'/*', GLOB_ONLYDIR|GLOB_NOSORT) as $dir) {
        $files = array_merge($files, d_dir($dir.'/'.basename($pattern), $flags));
    }
    return $files;
}

function debug(){
	$str = "";
	$str .= "==DEBUG LOG START=="."\r\n";
	$str .= "Generate Time : ".date('m/d/Y h:i:s a', time())."\r\n";
	$str .= "=Structure="."\r\n";
	foreach(d_dir("*") as $d){
			$str .=  folder_prem($d,true). "\r\n";
	}
	$str .= "=System Info="."\r\n";
	$str .= 'OS : '.php_uname()."\r\n";
	$str .= 'PHP : '.phpversion()."\r\n";
	$str .= 'WORKING DIR : '.dirname(__FILE__)."\r\n";
	$str .= 'AROZ SYSTEM'."\r\n";
	$str .= "==DEBUG LOG END=="."\r\n";
	$str = bin2hex($str);
	return $str;
}
?>	

</html>