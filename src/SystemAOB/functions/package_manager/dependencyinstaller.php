<?php
if(in_array("curl",get_loaded_extensions()) == false){
	shell_exec("sudo apt update");
	shell_exec("sudo apt-get install php7.0-curl -y");
	shell_exec("sudo service apache2 restart");
	echo '<!-- php7.0-curl not installed -->'."\r\n";
}else{
	echo '<!-- php7.0-curl installed -->'."\r\n";
}