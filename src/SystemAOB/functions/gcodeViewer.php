<?php
include_once("../../auth.php");

?>
<!DOCTYPE html>
<html lang="en">
	<head>
		<title>Gcode Viewer</title>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, user-scalable=no, minimum-scale=1.0, maximum-scale=1.0">
		<!-- Modified from THREE.JS Gcode loader example-->
		<style>
			body {
				font-family: Monospace;
				background-color: #FFFFFF;
				margin: 0px;
				overflow: hidden;
			}
			#infotab{
				position:fixed;
				z-index:999;
				right:10px;
				bottom:0px;
				max-width:480px;
				word-break: break-all;
				color:white;
			}
		</style>
	</head>
	<body>
        <?php
        if (isset($_GET['filename']) && $_GET['filename'] != "" && isset($_GET['filepath']) && $_GET['filepath'] != ""){
            $filename = $_GET['filename'];
            $filepath = $_GET['filepath'];
            if (file_exists($filepath) && strpos($filepath,"/meida") !== false){
                //Using absolute path from external storage. Add the handler in front of it
                $filename = "extDiskAccess.php?file=" . $filepath;
			}else if (strpos($filepath,"extDiskAccess.php?file=") !== false){
                //This file already being catched by extDiskAccess. Continue to progress it request
                $filepath = "../" . $filepath;
            }else if (!file_exists($filepath)){
                //This might be paths from AOR. Add relative dots in front and check if it exists or not
                $AOR = "../";
                $filepath = $AOR . $filepath;
                if (!file_exists($filepath)){
                    die("ERROR. File not exists. " . $filepath . " given.");
                }
            }
        }else{
            die("ERROR. Undefined filename or filepath parameter.");
        }
        
        function formatSizeUnits($bytes){
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
        ?>
		<script src="../../script/threejs/build/three.js"></script>
		<script src="../../script/threejs/OrbitControls.js"></script>
		<script src="../../script/threejs/GCodeLoader.js"></script>
		<script src="../../script/jquery.min.js"></script>
		<script src="../../script/ao_module.js"></script>
		<div id="infotab">
			<p id="filename"><?php echo $filename;?></p>
			<p id="filepath"><?php echo $filepath;?></p>
			<p id="filesize"><?php echo formatSizeUnits(filesize($filepath));?></p>
		</div>
		<script>
			//ao module initiation
			ao_module_setWindowTitle("GCODEviewer - " + $("#filename").text().trim());
			ao_module_setWindowIcon("cube");
			ao_module_setGlassEffectMode();
			
			
			var container;
			var camera, scene, renderer;

			init();
			animate();

			function init() {

				container = document.createElement( 'div' );
				document.body.appendChild( container );
				camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.1, 10000 );
				camera.position.set(0, 50, 100 );
				

				var controls = new THREE.OrbitControls( camera );
				controls.target = new THREE.Vector3(0, 20, 0);
				controls.update();
				scene = new THREE.Scene();
				
				//Setup the background color and the platform
				var backgroundcolor = new THREE.Color("#212121");
				scene.background = backgroundcolor;
				
				var loader = new THREE.GCodeLoader();
				loader.load( "<?php echo $filepath;?>", function ( object ) {
					object.position.set( 0,0, 0);
					scene.add( object );
				} );
				
				renderer = new THREE.WebGLRenderer();
				renderer.setPixelRatio( window.devicePixelRatio );
				renderer.setSize( window.innerWidth, window.innerHeight );
				container.appendChild( renderer.domElement );
				window.addEventListener( 'resize', resize, false );
			}

			function resize() {

				camera.aspect = window.innerWidth / window.innerHeight;
				camera.updateProjectionMatrix();

				renderer.setSize( window.innerWidth, window.innerHeight );

			}

			function animate() {

				renderer.render( scene, camera );

				requestAnimationFrame( animate );

			}
		</script>

	</body>
</html>
