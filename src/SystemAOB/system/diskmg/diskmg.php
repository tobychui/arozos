<?php
$partition = json_decode(shell_exec("lsblk -b --json"));
$format = json_decode(shell_exec("lsblk -f -b --json"));
$freeSpace =shell_exec("df");
while(strpos($freeSpace,"  ") !== false){
    $freeSpace = str_replace("  "," ",$freeSpace);
}
$freeSpace = explode("\n",$freeSpace);
$freeSpaceParsed = [];
foreach ($freeSpace as $part){
    $part = explode(" ",$part);
    array_push($freeSpaceParsed,$part);
}
//Throw away the table header
array_shift($freeSpaceParsed);
header('Content-Type: application/json');
echo json_encode([$partition,$format,$freeSpaceParsed]);
?>