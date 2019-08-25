<?php
include '../../../auth.php';
?>
<?php
if (isset($_GET['folder']) && $_GET['folder'] != ""){
	$folder = $_GET['folder'];
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
		$zip->open('export/'.$filename , ZipArchive::CREATE | ZipArchive::OVERWRITE);

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
	}else{
		echo 'ERROR. Folder path not found or it is not a folder.';
	}
}else{
	echo 'ERROR. Invalid folder path.';
	
}

?>