<?php
include_once("../../../auth.php");
$result = [];
if (file_exists("mappers")){
    $hostDevices = glob("mappers/*.inf");
    foreach ($hostDevices as $host){
        array_push($result,[basename($host,".inf"),file_get_contents($host)]);
    }
}
header('Content-Type: application/json');
echo json_encode($result);
exit(0);

function unicodeTrim($str){
    $str = preg_replace(
  '/
    ^
    [\pZ\p{Cc}\x{feff}]+
    |
    [\pZ\p{Cc}\x{feff}]+$
   /ux',
  '',
  $str
);
return $str;
}
?>