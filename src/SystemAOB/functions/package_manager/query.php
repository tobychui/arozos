<?php
error_reporting(0);

if(empty($_GET["url"])){
	header("HTTP/1.0 404 Not Found");
}

header('Content-Type: application/json');

if(isset($_GET["query"])){
$json = file_get_contents(str_replace(" ","%20",$_GET["url"])."api/?method=query&query=".$_GET["query"]."&ver=".$_GET["ver"]);
$arr = json_decode($json);
if($arr->{"status_code"} == 500){
	$result["status_code"] = 500;
	$result["status_description"] = $arr->{"status_description"};
}else{
	$int = 0;
	$result["status_code"] = 200;
	$result["status_description"] = $arr->{"status_description"};
	
	if(PHP_OS == "WINNT"){
			foreach($arr->{"result"} as &$tmp){
				if($tmp->{"os"} == "WIN" || $tmp->{"os"} == "all"){
					$result["result"][$int] = $tmp;
					$int = $int + 1;
				}
			}
	}else{
		$installed_app = explode("\n",shell_exec("dpkg -l | grep ^ii | awk '{print $2}'"));
		foreach($arr->{"result"} as &$tmp){
				$flag = 0;
				//echo $tmp->{"name"};
				if($tmp->{"os"} !== "LINUX" && $tmp->{"os"} !== "all"){
					$flag = 1;
					//echo "FLAGGED 1".$tmp->{"name"};
				}
				
				if($tmp->{"prerequisite"}[0] !== "none"){
				foreach($tmp->{"prerequisite"} as &$systemapp){	
					if(!in_array($systemapp,$installed_app)){
						$flag = 1;
						//echo "FLAGGED 2".$tmp->{"name"};
					}
				}
				}
				
				if(strpos(php_uname("m"), 'arm') !== false){
					if($tmp->{"architecture"} !== "all"	 && $tmp->{"architecture"} !== "arm"){	
						$flag = 1;
						//echo "FLAGGED 3".$tmp->{"name"};
					}
				}
				
				
				
				if($flag == 0){
					$result["result"][$int]["name"] = $tmp->{"name"};
					$result["result"][$int]["icn"] =  $tmp->{"icn"};
					$result["result"][$int]["author"] =  $tmp->{"author"};
					$result["result"][$int]["version"] =  $tmp->{"version"};
					$result["result"][$int]["description"] =  $tmp->{"description"};		
					$result["result"][$int]["updatenote"] =  $tmp->{"updatenote"};
					$result["result"][$int]["installurl"] =  $tmp->{"installurl"};		
					//$result["result"][$int]["architecture"] =  $tmp->{"architecture"};
					//$result["result"][$int]["os"] =  $tmp->{"os"};
					$result["result"][$int]["category"] =  $tmp->{"category"};		
					$result["result"][$int]["permission"] =  $tmp->{"permission"};
					//$result["result"][$int]["prerequisite"] =  $tmp->{"prerequisite"};
					$int = $int + 1;
				}
				
				
		}
	}
}

}else{
	$json = file_get_contents(str_replace(" ","%20",$_GET["url"])."api/?method=status&ver=".$_GET["ver"]);
	$arr = json_decode($json);
	$result = [];
	if(isset($arr)){
	if($arr->{"status_code"} == 500){
		$result["status_code"] = 500;
		$result["status_description"] = $arr->{"status_description"};
	}else{
		$result["status_code"] = 200;
		$result["status_description"] = $arr->{"status_description"};
		$result["name"] = $arr->{"name"};
		$result["protocol"] = $arr->{"protocol"};
		$result["version"] = $arr->{"version"};
		$result["verification_key"] = $arr->{"verification_key"};
		$result["protection"] = $arr->{"protection"};
	}
	}
	if(!isset($result["status_description"])){
			//header("HTTP/1.0 404 Not Found");
			$result["status_code"] = 404;
			$result["status_description"] = "Resources not found.";
	}
	
}

echo json_encode($result);
?>