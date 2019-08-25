<?php
include '../../../auth.php';
?>
<?php

function remove_utf8_bom($text)
{
    $bom = pack('H*','EFBBBF');
    $text = preg_replace("/^$bom/", '', $text);
    return $text;
}

if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    $output = shell_exec('getNICinfo.exe');
	$result = file_get_contents("NICinfo.txt");
	$result = remove_utf8_bom($result);
	$tmp = explode("\r\n",$result);
	$result = [];
	foreach ($tmp as $nicinfo){
		if ($nicinfo != ""){
			$nicinfo = explode(",",$nicinfo);
			array_push($result,$nicinfo);
		}
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}else{
	
	
}

?>
