<?php
include '../../../auth.php';
?>
<?php
//This function is used to handle upload via AOB File System
 
if (isset($_FILES['files']) && !empty($_FILES['files'])) {
	if (isset($_GET['path']) && $_GET['path'] != ""){
		$path = $_GET['path'];
		if  ((strpos($path,"/SystemAOB") === false || file_exists("developer.mode")) && $path != "/media"){
			$path = $path . "/";
			if (strpos($path,"AOB/") === 0){
				$path = "../../../" . substr($path,4);
			}
			$no_files = count($_FILES["files"]['name']);
			for ($i = 0; $i < $no_files; $i++) {
				if ($_FILES["files"]["error"][$i] > 0) {
					echo "ERROR. " . $_FILES["files"]["error"][$i] . "<br>";
				} else {
					if (file_exists($path . $_FILES["files"]["name"][$i])) {
						echo 'ERROR. File already exists.';
					} else {
						$filename = $_FILES["files"]["name"][$i];
						$ext = pathinfo($filename, PATHINFO_EXTENSION);
						$encodedName = "inith" . bin2hex(str_replace(".$ext","",$filename)) . "." . $ext;
						if (substr($filename,0,5) === "inith"){
							$ext = pathinfo($filename, PATHINFO_EXTENSION);
							$orgname = str_replace("inith","",basename($filename,"." . $ext));
							if (ctype_xdigit($orgname) && strlen($orgname) % 2 == 0) {
								//This file is already encoded in UMFN format. No need to change its name again.
								move_uploaded_file($_FILES["files"]["tmp_name"][$i], $path . $_FILES["files"]["name"][$i]);
								echo "DONE";
							}else{
								//This file start with inith but not in UMFN format. Display as recovered file
								move_uploaded_file($_FILES["files"]["tmp_name"][$i], $path . "[Recovered]" . $_FILES["files"]["name"][$i]);
								echo "DONE";
							}
						}else{
							move_uploaded_file($_FILES["files"]["tmp_name"][$i], $path . $encodedName);
							echo "DONE";
						}
					}
					
				}
			}
			echo 'DONE';
		}else{
			if ($path == "/media"){
				die("ERROR. /media is mounting directory.");
			}else{
				die("ERROR. SystemAOB is not a valid upload path for files.");
		
			}
			
		}
		
	}else{
		die("ERROR. Unset upload target.");
	}
    
} else {
    echo 'ERROR. No file selected.';
}
?>