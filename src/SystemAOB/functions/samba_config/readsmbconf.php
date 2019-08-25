<?php
header('Content-Type:application/json');

shell_exec('sudo chmod 777 /etc/samba/smb.conf');

$result = [];

$smb = file_get_contents('/etc/samba/smb.conf');
$first_regex_data = preg_grep("/^[^#;]+/", explode("\n", $smb));
$second_regex_data = "";
foreach($first_regex_data as &$value){
	$value = trim($value);
	$second_regex_data = $second_regex_data.$value."\r\n";
}
preg_match_all("/^\[[^\]\r\n]+](?:\r?\n(?:[^[\r\n].*)?)*/m", $second_regex_data, $result_section);
foreach($result_section[0] as &$arr){
	$explode_arr = explode("\r\n",$arr);
	$name = str_replace("]","",str_replace("[","",$explode_arr[0]));
	array_shift($explode_arr);
	foreach($explode_arr as &$value){
		$config_row = explode("=",$value);
		if($config_row[0] !== null && $config_row[1] !== null){
			$result[$name][trim($config_row[0])] = trim($config_row[1]);
		}
	}
}

echo json_encode($result);