<?php
include '../../auth.php';
?>
<?php
//This script will return the space left in the main filesystem of the main disk

function formatSizeUnits($bytes)
    {
        if ($bytes >= 1073741824)
        {
            $bytes = number_format($bytes / 1073741824, 2) . ' GB';
        }
        elseif ($bytes >= 1048576)
        {
            $bytes = number_format($bytes / 1048576, 2) . ' MB';
        }
        elseif ($bytes >= 1024)
        {
            $bytes = number_format($bytes / 1024, 2) . ' KB';
        }
        elseif ($bytes > 1)
        {
            $bytes = $bytes . ' bytes';
        }
        elseif ($bytes == 1)
        {
            $bytes = $bytes . ' byte';
        }
        else
        {
            $bytes = '0 bytes';
        }

        return $bytes;
}


if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    $df_c = disk_free_space("C:");
	$ds = disk_total_space("C:");
	echo formatSizeUnits($df_c). " / " . formatSizeUnits($ds);
} else {
	$df = disk_free_space("/");
	$ds = disk_total_space("/");
	echo formatSizeUnits($df) . " / " . formatSizeUnits($ds);
}
?>