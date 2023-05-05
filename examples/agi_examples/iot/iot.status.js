//IoT Status
//This agi script get the device status of the first iot device in list

//Require the iot lib
requirelib("iot");

function main(){
	//Check if the IoT Controller is ready
	if (iot.ready() == true){
		//List the iot devices in the network
		var devList = iot.list();
		
		//Pick the first device to get status
		var firstDevice = devList[0];
		
		iot.connect(firstDevice);
		var deviceStatus = iot.status(firstDevice.DeviceUUID);
		
		//Return the results as respond
		var output = JSON.stringify(deviceStatus);
		
		HTTP_HEADER = "application/json; charset=utf-8";
		sendResp(output);

	}else{
		sendResp("IoT Manager not ready");
	}
}

//Run the main function
main();
