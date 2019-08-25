<?php
include '../../../auth.php';
?>
<html>
<head>
<title>Shutdown Sequence</title>
</head>
<body style="background-color:black;color:white;">
The shutdown sequence has been running in the background.<br>
Please wait until your ArOZ Portable System completed the shutdown sequence before you switching off the main power supply.<br>
<br>
You can observe the finishing of shutdown sequence of the board if you are using:<br>
Raspberry Pi (2 / 3 / 3B+) --> Green LED is no longer flashing <br>
Raspberry Pi Zero / Zero W --> Red Power LED is turned off<br>
Banana Pi M2-Zero --> Red Power LED is turned on<br>
<br>
If you are using other development board for the ArOZ Online Portable build,<br>
Please refer to the documentation of your board for shutdown complete indication.<br><br>
Progress: <br>
</body>
</html>

<?php
echo "Initiated Shutdown Sequence <br>";
system('sudo shutdown -t 0');
echo "DONE";
?>
