<?php
include '../../../auth.php';
?>
<?php
//Create tmp locale in UTF8
$lc = new LocaleManager();
$lc->doBackup();
$lc->fixLocale();

function isJson($string) {
 json_decode($string);
 return (json_last_error() == JSON_ERROR_NONE);
}


//Filename conversion for hex -> bin and bin-> hex for supporting both UM and hex folder format
if (isset($_GET['filename']) && $_GET['filename'] != ""){
	//Given the filename, check if it is a directory or file
	$filename = $_GET['filename'];
	if (isJson($filename)){
	    //This is a json encoded string. Decode it first
	    $filename = json_decode($filename);
	}
	if (file_exists($filename)){
		if (is_file($filename)){
			//Is file
			if (substr(basename($filename),0,5) === "inith"){
				//This is hex file, convert it back to bin
				$ext = pathinfo($filename, PATHINFO_EXTENSION);
				$orgname = str_replace("inith","",basename($filename,"." . $ext));
				if (ctype_xdigit($orgname) && strlen($orgname) % 2 == 0) {
					$orgname = hex2bin($orgname);
				} else {
					$lc->doRestore();
					die("ERROR. Filename Decode Error.<br>" . "Filename: " . $orgname);
				}
				$decodedName = dirname($filename) . "/" . $orgname . "." . $ext;
				if (file_exists($decodedName)){
					//A file found with the same name of the decoding file
					$lc->doRestore();
					die("ERROR. File with the same decoded name exists.");
				}else{
					rename($filename,$decodedName);
					echo "DONE";
					$lc->doRestore();
				}
				
			}else{
				//This is a normal file. Encode it into hex
				$ext = pathinfo($filename, PATHINFO_EXTENSION);
				$fName = basename($filename, "." .$ext);
				$parentpath = dirname($filename);
				$fName = "inith" . bin2hex($fName) . "." . $ext;
				rename($filename,$parentpath . "/" . $fName);
				echo 'DONE';
				$lc->doRestore();
				
			}
		}else{
			//Is directory
			$foldername = basename($filename);
			$parentDir = dirname($filename);
			if (ctype_xdigit($foldername) && strlen($foldername) % 2 == 0) {
				//This is an encoded foldername. Decode it
				$decodedName = hex2bin($foldername);
				rename(realPath($filename),$parentDir . "/" . $decodedName);
				echo "DONE";
				$lc->doRestore();
			} else {
				//This is not an encoded foldername. Encode it into hex]
				rename(realPath($filename),$parentDir . "/" . bin2hex($foldername));
				echo "DONE";
				$lc->doRestore();
			}
		}
		
	}else{
		$lc->doRestore();
		die("ERROR. File not found.");
	}

}else{
	$lc->doRestore();
	die("ERROR. filename not defined.");
}


class LocaleManager
{
    /** @var array */
    private $backup;


    public function doBackup()
    {
        $this->backup = array();
        $localeSettings = setlocale(LC_ALL, 0);
        if (strpos($localeSettings, ";") === false)
        {
            $this->backup["LC_ALL"] = $localeSettings;
        }
        // If any of the locales differs, then setlocale() returns all the locales separated by semicolon
        // Eg: LC_CTYPE=it_IT.UTF-8;LC_NUMERIC=C;LC_TIME=C;...
        else
        {
            $locales = explode(";", $localeSettings);
            foreach ($locales as $locale)
            {
                list ($key, $value) = explode("=", $locale);
                $this->backup[$key] = $value;
            }
        }
    }


    public function doRestore()
    {
        foreach ($this->backup as $key => $value)
        {
            setlocale(constant($key), $value);
        }
    }


    public function fixLocale()
    {
        setlocale(LC_ALL, "C.UTF-8");
    }
}
?>