<?php 

set_time_limit(0);
$save =  "./tmp/".hex2bin($_GET["name"]).".zip";
$url = str_replace(" ","%20",$_GET["url"]."api/dl.php?id=".$_GET["name"]);

    $in=    fopen($url, "rb");
    $out=   fopen($save, "wb");
    while ($chunk = fread($in,2048))
    {
        fwrite($out, $chunk, 2048);
    }
    fclose($in);
    fclose($out);
$zip = new ZipArchive;
if ($zip->open("./tmp/".hex2bin($_GET["name"]).".zip") === TRUE) {
    $zip->extractTo('../../../'.hex2bin($_GET["name"])."/");
    $zip->close();
    echo 'Successful installed '.hex2bin($_GET["name"]);
} else {
    echo 'Failed to install '.hex2bin($_GET["name"]);
}
sleep(2);
unlink("./tmp/".hex2bin($_GET["name"]).".zip");
?>
