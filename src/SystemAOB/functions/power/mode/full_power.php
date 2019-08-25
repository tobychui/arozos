<?php
//High power profile, enable both wlan cards and with no CPU suppression
function noWaitExe($command){
	shell_exec($command . ' > /dev/null 2>/dev/null &');
}

if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    echo 'ERROR. Not supported OS';
}else{
	noWaitExe("sudo ifup wlan0");
	noWaitExe("sudo ifup wlan1");
	echo "DONE";
}

?>