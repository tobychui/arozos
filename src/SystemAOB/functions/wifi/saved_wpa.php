<?php
include '../../../auth.php';
?>
<?php
	$filename = "/etc/wpa_supplicant/wpa_supplicant.conf";
	$handle = fopen($filename, "r");
	$unprased_data = fread($handle, filesize($filename));
	fclose($handle);
	
  $arr = [];
  
  $keywords = preg_split("/network={/", $unprased_data);
  foreach ($keywords as $data){
  $data = str_replace("}","",$data);
		
	  preg_match_all("/^\t.*=.*[^=]$/m", $data, $re);
	  $fix = [];
	  

	  //print_r($re);
	  
	  foreach($re as $data){
		  $data = preg_replace("/[\n\r\t]/","",$data);
		  array_push($fix,$data);
	  }
	  array_push($arr,$fix);
  }
  
	array_shift($arr);
  echo json_encode($arr);
?>