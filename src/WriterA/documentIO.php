<?php
include_once("../auth.php");
if (isset($_GET['filepath']) && $_GET['filepath'] != ""){
    //Get the content of the 
    $content = "";
    if (file_exists("../" . $_GET['filepath'])){
        //This filepath is represented from AOR
        $content = file_get_contents("../" . $_GET['filepath']);
    }else if (file_exists($_GET['filepath']) && strpos($_GET['savepath'],"/media") == 0){
        //This file is represented using real path and it is located inside /media
        $content = file_get_contents($_GET['filepath']);
    }else{
        die("ERROR. file not found.");
    }
    echo json_encode($content);
    exit(0);
}else if (isset($_POST['create']) && $_POST['create'] != "" && isset($_POST['content']) && $_POST['content'] != ""){
    //The create path can be start with AOR or /media
    $content = json_decode($_POST['content']);
    if (strpos($_POST['create'],"/media") === 0){
        //This is a file in external storage
        if (!file_exists($_POST['create'])){
            file_put_contents($_POST['create'],$content);
            die($_POST['create']);
        }else{
            die("ERROR. File already exists.");
        }
    }else{
        //This is a filepath from AOR
        //Check if it is a valid path by checking if the realpath contains the AOR as part of its path
        $root = realpath("../");
        $target = realpath(dirname("../" . $_POST['create']));
        if (strpos($target,$root) === false){
            //This path is not inside AOR. not a valid path.
            die("ERROR. Filepath out of AOR");
        }
        $filename ="../" . $_POST['create'];
        if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN' && preg_match('/[^A-Za-z0-9]/',$filename)) {
            //If this is window host, and the filename contains non alphebet numeric values
            $tmp = explode("/",$filename);
            $filename = array_pop($tmp);
            $targetDir = implode("/",$tmp);
            $ftmp = explode(".",$filename);
            $ext = array_pop($ftmp);
            $filename = implode(".",$ftmp);
            $umfilename = "inith" . bin2hex($filename);
            $filename = $targetDir . "/" . $umfilename . "." .  $ext;
        }
        if (!file_exists($filename)){
            file_put_contents($filename,$content);
            echo $filename;
            exit(0);
        }else{
            die("ERROR. File already exists.");
        }
    }
}else if (isset($_POST['content']) && $_POST['content'] != "" && isset($_POST['savepath']) && $_POST['savepath'] != ""){
     $content =  json_decode($_POST['content']);
    if (file_exists("../" . $_POST['savepath'])){
        //This filepath is represented from AOR
        $root = realpath("../");
        $target = realpath(dirname("../" . $_POST['savepath']));
        if (strpos($target,$root) === false){
            //This path is not inside AOR. not a valid path.
            die("ERROR. Filepath out of AOR");
        }
        file_put_contents("../" . $_POST['savepath'],$content);
        echo "DONE";
        exit(0);
    }else if (file_exists($_POST['savepath']) && strpos($_POST['savepath'],"/media") == 0){
        //This file is represented using real path and it is located inside /media
        file_put_contents($_POST['savepath'],$content);
        echo "DONE";
        exit(0);
    }else{
        die("ERROR. file not found. " . $_POST['savepath'] . " was given.");
    }
    exit(0);
}else if (isset($_POST['parseMD']) && $_POST['parseMD']){
	//parseMD will pass in the content of the document as JSON string via POST
	include_once("Parsedown.php");
	$content = json_decode($_POST['parseMD']);
	$Parsedown = new Parsedown();
	echo $Parsedown->text($content);
	exit(0);
}else{
    die("ERROR. Missing variables.");
}

?>