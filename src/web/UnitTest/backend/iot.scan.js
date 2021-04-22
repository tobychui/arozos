//IoT Scanner
//This agi script force the IoT Manager to update the IoT scan results

//Require the iot lib
requirelib("iot");

function main(){
	//Check if the IoT Controller is ready
	if (iot.ready() == true){
		var deviceList = iot.scan();
		
		//Return the value as JSON string
		sendResp(deviceList.length + " IoT devices discovered. Run iot.list.js to see the list.");
		
	}else{
		sendResp("IoT Manager not ready");
	}
}

//Run the main function
main();
