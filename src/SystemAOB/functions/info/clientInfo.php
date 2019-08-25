<?php
include '../../../auth.php';

class OS_BR{

    private $agent = "";
    private $info = array();

    function __construct(){
        $this->agent = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : NULL;
        $this->getBrowser();
        $this->getOS();
    }

    function getBrowser(){
        $browser = array("Navigator"            => "/Navigator(.*)/i",
                         "Firefox"              => "/Firefox(.*)/i",
                         "Internet Explorer"    => "/MSIE(.*)/i",
                         "Google Chrome"        => "/chrome(.*)/i",
                         "MAXTHON"              => "/MAXTHON(.*)/i",
                         "Opera"                => "/Opera(.*)/i",
                         );
        foreach($browser as $key => $value){
            if(preg_match($value, $this->agent)){
                $this->info = array_merge($this->info,array("Browser" => $key));
                $this->info = array_merge($this->info,array(
                  "Version" => $this->getVersion($key, $value, $this->agent)));
                break;
            }else{
                $this->info = array_merge($this->info,array("Browser" => "UnKnown"));
                $this->info = array_merge($this->info,array("Version" => "UnKnown"));
            }
        }
        return $this->info['Browser'];
    }

    function getOS(){
        $OS = array("Windows"   =>   "/Windows/i",
                    "Linux"     =>   "/Linux/i",
                    "Unix"      =>   "/Unix/i",
                    "Mac"       =>   "/Mac/i"
                    );

        foreach($OS as $key => $value){
            if(preg_match($value, $this->agent)){
                $this->info = array_merge($this->info,array("Operating System" => $key));
                break;
            }
        }
        if (isset($this->info['Operating System'])){
			return $this->info['Operating System'];
		}else{
			return "Unknown";
		}
    }

    function getVersion($browser, $search, $string){
        $browser = $this->info['Browser'];
        $version = "";
        $browser = strtolower($browser);
        preg_match_all($search,$string,$match);
        switch($browser){
            case "firefox": $version = str_replace("/","",$match[1][0]);
            break;

            case "internet explorer": $version = substr($match[1][0],0,4);
            break;

            case "opera": $version = str_replace("/","",substr($match[1][0],0,5));
            break;

            case "navigator": $version = substr($match[1][0],1,7);
            break;

            case "maxthon": $version = str_replace(")","",$match[1][0]);
            break;

            case "google chrome": $version = substr($match[1][0],1,10);
        }
        return $version;
    }

    function showInfo($switch){
        $switch = strtolower($switch);
        switch($switch){
            case "browser": return $this->info['Browser'];
            break;

            case "os": 
			if (isset($this->info['Operating System'])){
				return $this->info['Operating System'];
			}else{
				return "Unknown";
			}
            break;

            case "version": return $this->info['Version'];
            break;

            default: return "Unknown";
            break;

        }
    }
}

?>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
<title>ArOZ Online - Client Information</title>
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
</head>
<body style="background-color:#f9f9f9;">
<br><br><br>
<div class="ts container">
	<div class="ts header">
    Client Device Information
    <div class="sub header">These are the information that your browser is telling the system.</div>
	
	<table class="ts celled striped table">
    <thead>
        <tr>
            <th colspan="3">
                PHP Information
            </th>
        </tr>
    </thead>
	<?php $obj = new OS_BR();?>
    <tbody>
        <tr>
            <td class="collapsing">
                <i class="browser icon"></i> Browser
            </td>
            <td><?php echo $obj->showInfo('browser');?></td>
        </tr>
        <tr>
            <td class="collapsing">
                <i class="hashtag icon"></i> Browser Version
            </td>
            <td><?php echo $obj->showInfo('version');?></td>
        </tr>
        <tr>
            <td class="collapsing">
                <i class="computer icon"></i> OS
            </td>
            <td><?php echo $obj->showInfo('os');?></td>
        </tr>
        <tr>
            <td class="collapsing">
                <i class="wifi icon"></i> Device IP
            </td>
            <td><?php echo $_SERVER["REMOTE_ADDR"];?></td>
        </tr>
        <tr>
            <td class="collapsing">
                <i class="user circle icon"></i> User Agent
            </td>
            <td><?php echo $_SERVER['HTTP_USER_AGENT'];?></td>
        </tr>
    </tbody>
</table>

<table class="ts celled striped table">
<thead>
        <tr>
            <th colspan="3">
                Javascript Information
            </th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td class="collapsing">
                <i class="sticky note icon"></i> Cookie Enabled
            </td>
            <td id="cke"></td>
        </tr>
        <tr>
            <td class="collapsing">
                <i class="hashtag icon"></i> Application Name
            </td>
            <td id="appname"></td>
        </tr>
        <tr>
            <td class="collapsing">
                <i class="hashtag icon"></i> Application Code Name
            </td>
            <td id="acn"></td>
        </tr>
        <tr>
            <td class="collapsing">
                <i class="browser icon"></i> Browser Engine
            </td>
            <td id="be"></td>
        </tr>
        <tr>
            <td class="collapsing">
                <i class="user circle icon"></i> User Agent
            </td>
            <td id="ua"></td>
        </tr>
    </tbody>
</table>
</div>
</div>
<br><br><br><br>
</div>
<script>
$("#cke").html(navigator.cookieEnabled);
$("#appname").html(navigator.appName);
$("#acn").html(navigator.appCodeName);
$("#be").html(navigator.product);
$("#ua").html(navigator.userAgent);
</script>
</body>
</html>