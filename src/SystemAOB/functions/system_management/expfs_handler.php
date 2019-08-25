<?php
$output = shell_exec('sudo raspi-config --expand-rootfs');
echo "<pre>$output</pre>";
echo "DONE";
?>