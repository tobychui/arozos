<?php
include '../../auth.php';
?>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	die("ERROR. Windows do not need to mount NTFS drives manually.");
}
//NTFS-3g Interface for USB mounting
if (isset($_GET['md']) && isset($_GET['mpo'])&& isset($_GET['mpn'])){
	//Remount the disk to new mount point
	exec('sudo umount ' . '"' . $_GET['mpo'] . '"',$out);
	echo 'sudo umount ' . '"' . $_GET['mpo'] . '"' . '<br>';
	foreach ($out as $line){
		echo $line;
	}
	exec('sudo ntfs-3g ' . '"' . $_GET['md'] . '" "' . $_GET['mpn'] . '"' ,$out);
	echo 'sudo ntfs-3g ' . '"' . $_GET['md'] . '" "' . $_GET['mpn'] . '"'. '<br>';
	foreach ($out as $line){
		echo $line;
	}
	echo 'DONE';
	
}else if (isset($_GET['mpo'])){
	//Umount the disk and do nothing
	$out = shell_exec('umount ' . '"' . $_GET['mpo'] . '"');
	echo 'sudo umount ' . '"' . $_GET['mpo'] . '"'. '<br>';
	echo $out;
	foreach ($out as $line){
		echo $line;
	}
	echo 'DONE';

}else if (isset($_GET['md']) && isset($_GET['mpn'])){
	//Mount the device to new mount point
	exec('sudo ntfs-3g ' . '"' . $_GET['md'] . '" "' . $_GET['mpn'] . '"' ,$out);
	echo 'sudo ntfs-3g ' . '"' . $_GET['md'] . '" "' . $_GET['mpn'] . '"'. '<br>';
	foreach ($out as $line){
		echo $line;
	}
	echo 'DONE';
}else if (isset($_GET['lsblk'])){
	exec("lsblk",$out);
	$result = [];
	foreach ($out as $line){
		array_push($result, $line);
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}else if (isset($_GET['blkid'])){
	exec("blkid",$out);
	$result = [];
	foreach ($out as $line){
		array_push($result, $line);
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}else if (isset($_GET['listUSB'])){
	$files = glob("/dev/*");
	$result = [];
	foreach ($files as $hardware){
		if (strpos($hardware,"sd") !== false){
			//return /dev/sda, /dev/sdb etc
			array_push($result, $hardware);
		}
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}else{
	echo 'ERROR. Variable not satisfied.';
	
}

?>