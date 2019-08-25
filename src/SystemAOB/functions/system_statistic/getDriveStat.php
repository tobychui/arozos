<?php
//Removed auth request for this php in order to allow clients to access host information
//include '../../../auth.php';
?>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    $fso = new COM('Scripting.FileSystemObject'); 
    $D = $fso->Drives; 
    $type = array("Unknown","Removable","Fixed","Network","CD-ROM","RAM Disk"); 
	$result = [];
    foreach($D as $d ){ 
       $dO = $fso->GetDrive($d); 
       $s = ""; 
       if($dO->DriveType == 3){ 
           $n = $dO->Sharename; 
       }else if($dO->IsReady){ 
           $n = $dO->VolumeName; 
           $s = file_size($dO->FreeSpace) . "/" . file_size($dO->TotalSize); 
       }else{ 
           $n = "[Drive not ready]"; 
       } 
	//echo "Drive " . $dO->DriveLetter . ": - " . $type[$dO->DriveType] . " - " . $n . " - " . $s . "<br>";
	array_push($result,[$dO->DriveLetter . ":",$n,$s]);
    }
	header('Content-Type: application/json');
	echo json_encode($result);


} else {
	$result = [];
	exec('df -h',$out);
	//header('Content-Type: application/json');
	foreach ($out as $line){
		$dataline = preg_replace("!\s+!",",",$line);
		$dataline = explode(",",$dataline);
		if ($dataline[0] != "tmpfs" && $dataline[0] != "Filesystem"){
			array_push($result,[$dataline[5],$dataline[0],$dataline[3] . "/" . $dataline[1]]);
		}
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}

 
function file_size($size) 
{ 
  $filesizename = array("B", "K", "M", "G", "T", "P", "E", "Z", "Y"); 
  return $size ? round($size/pow(1024, ($i = floor(log($size, 1024)))), 2) . $filesizename[$i] : '0 Bytes'; 
} 

?> 