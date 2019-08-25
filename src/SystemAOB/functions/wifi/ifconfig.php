<?php
include '../../../auth.php';
?>
<?php
//ArOZ Online network hardware detection code written for debian and windows (require exe!)
function remove_utf8_bom($text)
{
    $bom = pack('H*','EFBBBF');
    $text = preg_replace("/^$bom/", '', $text);
    return $text;
}

if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    exec("getNICinfo.exe");
	sleep(1);
	$nics = [];
	$content = remove_utf8_bom(file_get_contents("NICinfo.txt"));
	$data = explode(PHP_EOL,$content);
	foreach ($data as $nicinfo){
		array_push($nics,explode(",",$nicinfo)[0]);
	}
	header('Content-Type: application/json');
	echo json_encode($nics);
	exit();
} else {
	$result = [];
	
	/* due to ubuntu seem can't adapt this method 
	$sysver = shell_exec('cat /etc/os-release | grep VERSION_ID');
	$sysvernum = substr(explode('="',$sysver)[1],0,-2);
	echo $sysvernum;
	*/
	
	if(shell_exec('sudo ip a') !== ""){ // check if system support ip a command, should be available on debian 9 or ubuntu 19.04 upwards
	    exec('sudo ip a',$arrayoutput);
	}else{
	    exec('sudo ifconfig',$arrayoutput);
	}
   
	foreach ($arrayoutput as $line){
			$line = trim($line);
			$inlinedoutput .= $line."\n";
	}
    //debug here
    /*
    $inlinedoutput = "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
    inet 127.0.0.1/8 scope host lo
       valid_lft forever preferred_lft forever
    inet6 ::1/128 scope host
       valid_lft forever preferred_lft forever
2: enp2s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 14:14:4b:b2:d7:42 brd ff:ff:ff:ff:ff:ff
    inet 192.168.0.155/24 brd 192.168.0.255 scope global dynamic enp2s0
       valid_lft 4095sec preferred_lft 4095sec
    inet6 fe80::1614:4bff:feb2:d742/64 scope link
       valid_lft forever preferred_lft forever
3: ibs1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 14:15:4b:b2:d7:42 brd ff:ff:ff:ff:ff:ff
    inet 192.168.0.151/24 brd 192.168.0.255 scope global dynamic enp2s0
       valid_lft 4095sec preferred_lft 4095sec
    inet6 fe80::1614:4bff:feb2:d742/64 scope link
       valid_lft forever preferred_lft forever
4: slo9: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 14:16:4b:b2:d7:42 brd ff:ff:ff:ff:ff:ff
    inet 192.168.0.152/24 brd 192.168.0.255 scope global dynamic enp2s0
       valid_lft 4095sec preferred_lft 4095sec
    inet6 fe80::1614:4bff:feb2:d742/64 scope link
       valid_lft forever preferred_lft forever
5: wlx78e7d1ea46da: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 14:17:4b:b2:d7:42 brd ff:ff:ff:ff:ff:ff
    inet 192.168.0.1/24 brd 192.168.0.255 scope global dynamic enp2s0
       valid_lft 4095sec preferred_lft 4095sec
    inet6 fe80::1614:4bff:feb2:d742/64 scope link
       valid_lft forever preferred_lft forever
6: wwp2s9: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
    link/ether 14:18:4b:b2:d7:42 brd ff:ff:ff:ff:ff:ff
    inet 192.168.0.154/24 brd 192.168.0.255 scope global dynamic enp2s0
       valid_lft 4095sec preferred_lft 4095sec
    inet6 fe80::1614:4bff:feb2:d742/64 scope link
       valid_lft forever preferred_lft forever";
       */
	//echo $inlinedoutput;
	
if(shell_exec('sudo ip a') !== ""){ // check if system support ip a command, should be available on debian 9 or ubuntu 19.04 upwards
    $i = 0;
    $inlinedoutput = preg_replace('/\n/', '', $inlinedoutput);
    preg_match_all('/([0-9]+): (wlan[0-9]+|eth[0-9]+|lo|en[o|s][0-9]+|enx[0-9A-Za-z]+|enp[0-9]+s[0-9]+|ib[o|s][0-9]+|ibx[0-9A-Za-z]+|ibp[0-9]+s[0-9]+|sl[o|s][0-9]+|slx[0-9A-Za-z]+|slp[0-9]+s[0-9]+|wl[o|s][0-9]+|wlx[0-9A-Za-z]+|wlp[0-9]+s[0-9]+|ww[o|s][0-9]+|wwx[0-9A-Za-z]+|wwp[0-9]+s[0-9]+):/', $inlinedoutput, $wlanname);
    $InterfaceRawInformation = preg_split('/([0-9]+): (wlan[0-9]+|eth[0-9]+|lo|en[o|s][0-9]+|enx[0-9A-Za-z]+|enp[0-9]+s[0-9]+|ib[o|s][0-9]+|ibx[0-9A-Za-z]+|ibp[0-9]+s[0-9]+|sl[o|s][0-9]+|slx[0-9A-Za-z]+|slp[0-9]+s[0-9]+|wl[o|s][0-9]+|wlx[0-9A-Za-z]+|wlp[0-9]+s[0-9]+|ww[o|s][0-9]+|wwx[0-9A-Za-z]+|wwp[0-9]+s[0-9]+):/', $inlinedoutput);
    array_shift($InterfaceRawInformation);
    foreach ($InterfaceRawInformation as &$datas){
        $datas = $wlanname[2][$i].": ".$datas."\r\n";
        $i = $i + 1;
    }
   //print_r($InterfaceRawInformation);
}else{
    $InterfaceRawInformation = explode("\n\n",$inlinedoutput);
    array_pop($InterfaceRawInformation);
}
//$prased_data = preg_split("/wlan.|lo|eth./", $unprased_data,-1,PREG_SPLIT_NO_EMPTY);
foreach ($InterfaceRawInformation as $data){
	$data = preg_replace('/\n/', '', $data);
	//echo $data;
	preg_match('/(wlan[0-9]+|eth[0-9]+|lo|en[o|s][0-9]+|enx[0-9A-Za-z]+|enp[0-9]+s[0-9]+|ib[o|s][0-9]+|ibx[0-9A-Za-z]+|ibp[0-9]+s[0-9]+|sl[o|s][0-9]+|slx[0-9A-Za-z]+|slp[0-9]+s[0-9]+|wl[o|s][0-9]+|wlx[0-9A-Za-z]+|wlp[0-9]+s[0-9]+|ww[o|s][0-9]+|wwx[0-9A-Za-z]+|wwp[0-9]+s[0-9]+)/', $data, $tmp);
	if(isset($tmp[1])){
		//$exported_information["InterfaceName"] = $tmp[1];
		if(shell_exec('sudo ip a') == ""){ // check if system support ip a command, should be available on debian 9 or ubuntu 19.04 upwards
		    $exported_information["InterfaceID"] = preg_replace('/\w+([0-9]+)/', '$1', $tmp[1]);
		}else{
		    if(strpos($tmp[1], 'eth') !== false){
		       $exported_information["InterfaceID"] = preg_replace('/\w+([0-9]+)/', '$1', $tmp[1]);
		    }else if(strpos($tmp[1], 'wlan') !== false){
		        $exported_information["InterfaceID"] = preg_replace('/\w+([0-9]+)/', '$1', $tmp[1]);
		    }else{
		       //attempt new method for Debian9
		       $InterfaceType = substr($tmp[1], 2);
		       if(strpos($InterfaceType, 'o') !== false){
		            $exported_information["InterfaceID"] =  "Device".preg_replace('/\w+([A-Za-z])([0-9]+)/', '$2', $tmp[1]);
		       }else if(strpos($InterfaceType, 'p') !== false && strpos($InterfaceType, 's') !== false){
		           $exported_information["InterfaceID"] =  preg_replace('/\w+p([0-9]+)s([0-9]+)/', 'Bus$1Slot$2', $tmp[1]);
		       }else if(strpos($InterfaceType, 's') !== false){
		           $exported_information["InterfaceID"] =  "Slot".preg_replace('/\w+([A-Za-z])([0-9]+)/', '$2', $tmp[1]);
		       }else if(strpos($InterfaceType, 'x') !== false){
		           $exported_information["InterfaceID"] =  "Mac".preg_replace('/\w+x([0-9A-Z]+)/', '$1', $tmp[1]);
		       }
		    }
		}
		
		if(strpos($tmp[1], 'eth') !== false){
			$exported_information["InterfaceIcon"] = "Ethernet";
		}else if(strpos($tmp[1], 'wlan') !== false){
			$exported_information["InterfaceIcon"] = "WiFi";
		
		// following is for Debian9 or ubuntu 19.04 upwards
		// for changing the interfaceIcon, the InterfaceName will also changed, so if you are gonna to modfiy those icon or name, just changing InterfaceIcon is Fine
		// also you might want to add the Unknown.png for Unknown Interface
		}else if(strpos($tmp[1], 'en') !== false){
			$exported_information["InterfaceIcon"] = "Ethernet";
		}else if(strpos($tmp[1], 'ib') !== false){
			$exported_information["InterfaceIcon"] = "InfiniBand";
		}else if(strpos($tmp[1], 'sl') !== false){
			$exported_information["InterfaceIcon"] = "Serial";
		}else if(strpos($tmp[1], 'wl') !== false){
			$exported_information["InterfaceIcon"] = "WiFi";
		}else if(strpos($tmp[1], 'ww') !== false){
			$exported_information["InterfaceIcon"] = "WWAN";
		//end
		
		}else if(strpos($tmp[1], 'lo') !== false){
			continue;
		}else{
		    $exported_information["InterfaceID"] = 0;
			$exported_information["InterfaceIcon"] = "Unknown";
		}
	}else{
		$exported_information["InterfaceName"] = "Unknown";
		$exported_information["InterfaceIcon"] = "Unknown";
	}
	
	preg_match('/HWaddr ([0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z])/', $data, $tmp);
	if(isset($tmp[1])){
		$exported_information["HardwareAddress"] = $tmp[1];
	}else{
		preg_match('/ether ([0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z]:[0-9A-Za-z][0-9A-Za-z])/', $data, $tmp);
		if(isset($tmp[1])){
			$exported_information["HardwareAddress"] = $tmp[1];
		}else{
			$exported_information["HardwareAddress"] = "Unknown";
		}
	}
	
	preg_match('/inet addr:([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/', $data, $tmp);
	if(isset($tmp[1])){
		$exported_information["IPv4Address"] = $tmp[1];
	}else{
		preg_match('/inet ([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/', $data, $tmp);
		if(isset($tmp[1])){
			$exported_information["IPv4Address"] = $tmp[1];
		}else{
			$exported_information["IPv4Address"] = "Unknown";
		}
	}
	
	preg_match('/Mask:([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/', $data, $tmp);
	if(isset($tmp[1])){
		$exported_information["IPv4SubNetMask"] = $tmp[1];
	}else{
		preg_match('/mask ([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/', $data, $tmp);
		if(isset($tmp[1])){
			$exported_information["IPv4SubNetMask"] = $tmp[1];
		}else{
		    preg_match('/inet [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/([0-9]+)/', $data, $tmp);
		    if(isset($tmp[1])){
		        //https://stackoverflow.com/questions/5710860/php-cidr-prefix-to-netmask
		        $exported_information["IPv4SubNetMask"] = long2ip(-1 << (32 - (int)$tmp[1]));
	    	}else{
		    	$exported_information["IPv4SubNetMask"] = "Unknown";
	    	}
		}
	}
	
	preg_match('/inet6 addr: ([a-zA-Z0-9:]+\/[0-9]+)/', $data, $tmp);
	if(isset($tmp[1])){
		$exported_information["IPv6Address"] = $tmp[1];
	}else{
		preg_match('/inet6 ([a-zA-Z0-9:]+)/', $data, $tmp);
		if(isset($tmp[1])){
			$exported_information["IPv6Address"] = $tmp[1];
		}else{
			$exported_information["IPv6Address"] = "Unknown";
		}
	}

	array_push($result,$exported_information);
}


header('Content-Type: application/json');
echo json_encode($result);

}
?>