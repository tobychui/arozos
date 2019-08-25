<?php
include '../../../auth.php';
?>
<?php
echo 'DONE';
system('python apache_restart.py');
?>