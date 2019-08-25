<?php
session_start();
$_SESSION["login"] = "";
setcookie("username","",time()+ 3600);
setcookie("password","",time()+ 3600);
session_destroy();
header("Location: login.php?logout");
?>