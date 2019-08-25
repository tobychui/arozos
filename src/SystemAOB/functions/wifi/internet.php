<?php
include '../../../auth.php';
?>
<?php
function is_connected(){
     $connected = fopen("http://www.google.com:80/","r");
	  if($connected)
	  {
		 return true;
	  } else {
	   return false;
	  }
}

$result = is_connected();

header('Content-Type: application/json');
echo json_encode($result);
/*
$output = shell_exec('ping -c 1 8.8.8.8 | grep -o "[0-9]\sreceived"');
$arr = explode(" ",$output);
if($arr[0] >= 1){
		echo "[true]";
	}else{
		echo "[false]";
	}
*/