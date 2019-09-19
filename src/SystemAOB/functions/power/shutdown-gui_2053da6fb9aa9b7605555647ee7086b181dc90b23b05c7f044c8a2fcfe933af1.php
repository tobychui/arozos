<?php
include '../../../auth.php';
?>
<html>
<head>
<title>Shutdown Sequence</title>
</head>
<body style="background-color:black;color:white;" align="center">
    <br><br><br><br><br><br>
    <div style="width:100%;color:#eb8934;" id="shutingDown" align="center">
        <div style="width:100%;font-size:200%;" >䷄ Your host device is shutting down.</div>
        <div>Do not unplug your host until the process finish.</div>
    </div>
    <div style="width:100%;color:#eb8934;display:none;" id="shutdownFinish" align="center">
        <div style="width:100%;font-size:200%;" >✔ It is now safe to turn off your host device.</div><br>
        <div>If you are running the system on SBCs, you will need to unplug the board and power it up again for restart.<br>
        Or otherwise, assume your system is running on modern PC hardware, the system will poweroff itself.</div>
    </div>
<script>
    setTimeout(function(){
        document.getElementById("shutingDown").style.display = 'none';
        document.getElementById('shutdownFinish').style.display = 'block';
        
    },10000);
</script>
</body>
</html>

<?php
system('sudo poweroff');
echo "DONE";
?>
