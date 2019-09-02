<html>
<head>
<title>Tocas UI 2.3.3 min.document</title>
<link rel="stylesheet" href="dist/tocas.css">
<style>
    body{
        background-color:white;
        padding:5px;
    }
</style>
</head>
<body>
<br>
<a href="index.php" style="padding-left:10px;">< Back to List</a>
<?php
/* $it = new RecursiveDirectoryIterator(realpath("."));
$allowed=array("json");
foreach(new RecursiveIteratorIterator($it) as $file) {
    if(in_array(substr($file, strrpos($file, '.') + 1),$allowed)) {
		$filename = basename($file);
		$content = json_decode(file_get_contents($file));
		//print_r($content);
		
    }
} */

function objectToArray($d) {
        if (is_object($d)) {
            // Gets the properties of the given object
            // with get_object_vars function
            $d = get_object_vars($d);
        }
		
        if (is_array($d)) {
            /*
            * Return array converted to object
            * Using __FUNCTION__ (Magic constant)
            * for recursive call
            */
            return array_map(__FUNCTION__, $d);
        }
        else {
            // Return array
            return $d;
        }
    }
if (isset($_GET['docname']) == false || $_GET['docname'] == ""){
	die("ERROR. Undefined document name");
}
$content = json_decode(file_get_contents($_GET['docname']));
$content = objectToArray($content);
?>
<div class="ts segment">
	<div class="ts header">
		<?php if (isset($content['Title'])){echo $content['Title'];}?>
		<div class="sub header"><?php echo $content['Description'];?><br><?php 
		if (isset($content['Outline'])){
			echo $content['Outline'];
		}?></div>
	</div>
</div>
<div class="ts segment">
<?php
function replaceHighLight($result){
	return str_replace("]]","</mark>",str_replace("[[","<mark>",$result));
}

function stripHighLight($result){
	return str_replace("}}","",str_replace("{{","",str_replace("]]","",str_replace("[[","",$result))));
}

function replaceDummyImage($result){
	$returnval = [];
	if (strpos($result,"!-") != 0){
		$data = explode("\n",$result);
		foreach ($data as $line){
			if (strpos($line,"!-") != 0){
				$firstpos = strpos($line,"!-");
				$lastpos = strripos($line,"-!");
				$key = substr($line,$firstpos,$lastpos - $firstpos + 2);
				$finishedLine = str_replace($key,"img/dummy.png",$line);
				array_push($returnval,$finishedLine);
			}else{
				array_push($returnval,$line);
			}
		}
		return implode("\n",$returnval);
	}else{
		return $result;
	}
	
}
foreach ($content['Definitions'] as $defines){
	foreach ($defines['Sections'] as $define){
		$title = "";
		if(isset($define['Title'])){$title = $define['Title'];}
		echo '<div class="ts header">' . $title . '
			<div class="inline sub header">' . $define['Description'] . '</div>
		</div>';
		echo '<div class="ts segment">' . replaceDummyImage(stripHighLight($define['HTML'])) . '</div>';
		//echo replaceDummyImage(stripHighLight($define['HTML']));
		echo '<div class="ts segment">
		<div class="fluid field" style="width:100%;">
			<textarea rows="5" style="width:100%;">'.replaceDummyImage(stripHighLight($define['HTML'])).'</textarea>
		</div></div>';
	}
	
	//print_r($defines['Sections']);
	echo '<div class="ts section divider"></div>';
}
?>
Tocas UI 2.3.3 Documentation written by <a href="https://github.com/YamiOdymel">Yami Odymel</a>, adapter to ArOZ Online System under ArOZ Online Project feat. IMUS Laboratory.
<br>
<a href="index.php" style="padding-left:10px;">< Back to List</a>
<br><br><br>
</div>
</body>
</html>