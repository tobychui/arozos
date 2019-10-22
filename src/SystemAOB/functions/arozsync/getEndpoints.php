<?php
include_once("../../../auth.php");
$url = "https://api.github.com/repos/aroz-online/aroz.online-public-service-endpoints/releases/latest";
$opts = [
    "http" => [
        "method" => "GET",
        "header" => "Accept-language: en\r\n" .
            "User-Agent: aroz.online.update-service\r\n"
    ]
];

$context = stream_context_create($opts);

// Open the file using the HTTP headers set above
$file = file_get_contents($url, false, $context);
$out = json_decode($file,true);
$targetDownloadFile = $out["assets"][0]["browser_download_url"];//
//echo $targetDownloadFile;
$json = file_get_contents($targetDownloadFile);
file_put_contents("endpoints.conf",$json);
echo "DONE";
?>