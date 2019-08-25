<?php
include '../../../auth.php';
?>
<?php
//A script that simulate Windows Recycle bin structure but in a self contained way

//recursive way to do removing directory
function delete_directory($dirname) {
		 if (is_dir($dirname))
		   $dir_handle = opendir($dirname);
	 if (!$dir_handle)
		  return false;
	 while($file = readdir($dir_handle)) {
		   if ($file != "." && $file != "..") {
				if (!is_dir($dirname."/".$file))
					 unlink($dirname."/".$file);
				else
					 delete_directory($dirname.'/'.$file);
		   }
	 }
	 closedir($dir_handle);
	 rmdir($dirname);
	 return true;
}
		
if (isset($_GET['folder']) && $_GET['folder'] != ""){
	$folder = $_GET['folder'];
	if (is_dir($folder) && (realPath("../../../") == realPath(dirname($folder)))){
		//echo realPath("../../../") . "&&" . realPath(dirname($folder));
		//exit(0);
	}else{
		echo "ERROR. This is not a correct module install environment.";
		exit(0);
	}
	
	if (isset($_GET['foldername']) && $_GET['foldername'] != ""){
		$filename = time() . "_" . $_GET['foldername'] . ".zip";
	}else{
		$filename = time() . ".zip";
	}
	if (file_exists($folder) && is_dir($folder)){
		//Reference from Stack Overflow
		//https://stackoverflow.com/questions/4914750/how-to-zip-a-whole-folder-using-php
		
		// Get real path for our folder
		$rootPath = realpath($folder);

		// Initialize archive object
		$zip = new ZipArchive();
		$zip->open('TrashBin/'.$filename , ZipArchive::CREATE | ZipArchive::OVERWRITE);

		// Create recursive directory iterator
		/** @var SplFileInfo[] $files */
		$files = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator($rootPath),
			RecursiveIteratorIterator::LEAVES_ONLY
		);

		foreach ($files as $name => $file)
		{
			// Skip directories (they would be added automatically)
			if (!$file->isDir())
			{
				// Get real and relative path for current file
				$filePath = $file->getRealPath();
				$relativePath = substr($filePath, strlen($rootPath) + 1);

				// Add current file to archive
				$zip->addFile($filePath, $relativePath);
			}
		}

		// Zip archive will be created only after closing object
		$zip->close();
		echo $filename;
		delete_directory($folder);

	}else{
		echo 'ERROR. Folder path not found or it is not a folder.';
	}
}else{
	echo 'ERROR. Invalid folder path.';
	
}

?>