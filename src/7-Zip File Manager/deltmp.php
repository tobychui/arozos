<?php
include '../auth.php';
?>
<?php
    $dirs = scandir("./tmp/");
    foreach ($dirs as $dir){
       $time = filectime("./tmp/".$dir) ;
        if($time + 3600*3 <= time() && $dir !== ".." && $dir !== "."){
            //echo "$dir Deleted.\r\n";
            if(is_dir("./tmp/".$dir)){
                rrmdir("./tmp/".$dir);
            }else{
                unlink("./tmp/".$dir);
            }
        }
    }
    echo "Completed.";

//https://stackoverflow.com/questions/3338123/how-do-i-recursively-delete-a-directory-and-its-entire-contents-files-sub-dir
 function rrmdir($dir) { 
   if (is_dir($dir)) { 
     $objects = scandir($dir); 
     foreach ($objects as $object) { 
       if ($object != "." && $object != "..") { 
         if (is_dir($dir."/".$object))
           rrmdir($dir."/".$object);
         else
           unlink($dir."/".$object); 
       } 
     }
     rmdir($dir); 
   } 
 }
