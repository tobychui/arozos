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
	  preg_match_all("/^\t.*=.*[^=].$/m", $data, $re);
	  $fix = [];
	  foreach($re as $data){
		  $data = preg_replace("/[\n\r\t]/","",$data);
		  array_push($fix,$data);
	  }
	  array_push($arr,$fix);
  }
  
	array_shift($arr);
  
  
  //find max priority in wpa_supplicant.conf
  $max = 0;
  foreach($arr as $wifi){
	  foreach($wifi[0] as $value){
		if(strpos($value, 'priority=') !== false){
			$priority = str_replace("priority=","",$value);
			if($priority > $max){
				$max = $priority;
			}
		}
	  }
  }
  
  $max = $max + 1;
  
  //here to math ssid and the array
  $w = 0;
  foreach($arr as $wifi){
	  foreach($wifi[0] as $value){
		if(strpos($value, 'ssid=') !== false){
			if('ssid="'.$_GET["ssid"].'"' == $value){
				echo $value;
				$location = $w;
			}
		}
	  }
	  $w = $w + 1;
  }
  
  $old = "";
  //here to find the priority of that ssid
  foreach($arr[$location][0] as $value){
	  	if(strpos($value, 'priority=') !== false){
			$old = $value;
		}
  }
  if($old."\r" == "\r"){
	  die("FATAL");
  }
  $unprased_data = str_replace($old."\r","priority=".$max."\r",$unprased_data);
  
  echo $unprased_data;
  $fp = fopen('/etc/wpa_supplicant/wpa_supplicant.conf', 'w');
fwrite($fp, $unprased_data);
fclose($fp);
?>