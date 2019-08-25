<?php
include '../auth.php';
?>
<html>
<head>
<meta name="apple-mobile-web-app-capable" content="yes" />

<meta name="viewport" content="width=device-width, initial-scale=0.8, shrink-to-fit=no">
<html>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<title>SYSTEM ArOZβ</title>
</head>
<body>
<div class="ts pointing secondary menu">
    <a class="item" href="../"><i class="chevron left icon"></i></a>
    <a class="active item" href="";><i class="server icon"></i>SYSTEM</a>
    <a class="item" href="status.php"><i class="area chart icon"></i>Status</a>
</div>
<div class="ts container">
	<!-- Warning Bar -->
	<div class="ts segment">
		<h4><i class="caution sign icon"></i>Warning!</h4>
		<p>These are the build in system manage and read/write functions. Wrong settings or operations may lead to system errors and data damage.<br>
		Please make sure you know what you are doing before modifying any of the settings or using the functions listed below.</p>
	</div>

	<!-- Function bar -->
        <div class="ts top attached info padded message">
            <div class="ts secondary fitted menu">
                <div class="item">
                    <strong>System Functions Currently Available&nbsp;</strong>
                    <span></span>
                </div>
                <div class="right item">
                    <button class="ts mini basic secondary button">New Function</button>
                </div>
            </div>
        </div>

        <table class="ts bottom attached selectable table">
            <tbody>
			<?php
			$dirs = array_filter(glob('functions/*'), 'is_dir');
			//print_r( $dirs);
			$template = '<tr>
                    <td class="collapsing">
                        <i class="sitemap icon"></i> %MODULENAME%
                    </td>
                    <td>%DESCRIPTION%</td>
                    <td class="right aligned collapsing"><a href="%PATH%"><i class="cogs icon"></i>Control Panel</a></td>
                </tr>';
			foreach ($dirs as $dir){
				$modulename = basename($dir);
				$box = str_replace("%MODULENAME%",$modulename,$template);
				$box = str_replace("%DESCRIPTION%","Function Group: %PATH%",$box);
				$box = str_replace("%PATH%",$dir,$box);
				echo $box;
			}
			
			$fdirs = array_filter(glob('functions/*.php'),"is_file");
			$template2 = '<tr>
                    <td>
                        <i class="code icon"></i>%MODULENAME%
                    </td>
                    <td>Stand Alone Function: %PATH%</td>
                    <td class="right aligned"><a href="%PATH%" target="_blank"><i class="external icon"></i>Launch</a><a href="viewraw.php?filename=%PATH%"><i class="eye icon"></i>View Raw</a></td>
                </tr>';
				
			foreach ($fdirs as $file){
				$box = str_replace('%MODULENAME%',str_replace(".php","",basename($file)),$template2);
				$box = str_replace('%PATH%',$file,$box);
				echo $box;
			}
			
			?>
                <tr>
                    <td>
                        <i class="book icon"></i> README
                    </td>
                    <td>Read more on how to use system functions in your modules.</td>
                    <td class="right aligned"><a><i class="book icon"></i>Read Doc</a></td>
                </tr>
            </tbody>
        </table>
</div>
</body>
</html>