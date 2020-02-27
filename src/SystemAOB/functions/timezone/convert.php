<?php
		$tzLinux = [];
		$file = fopen("data/timezone_n.csv","r+");
		while(! feof($file)){
			$tmp = fgetcsv($file);
			$tzLinux[$tmp[0]] = $tmp[1];
		}
		fclose($file);
		ksort($tzLinux);

		$tz = json_decode(file_get_contents('data/wintz.json'));
		foreach($tz->{"supplementalData"}->{"windowsZones"}->{"mapTimezones"}->{"mapZone"} as $item){
			if(isset($tzLinux[$item->{"_type"}])){
				echo $item->{"_type"}.",".$tzLinux[$item->{"_type"}].",".$item->{"_other"}."\r\n";
			}
			//,$item->{"_other"}
			//if($item->{"_type"} == $name){
					
					//$tz_win = $item->{"_other"};
			//};
		}
?>