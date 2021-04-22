//IoT Connector and Disconnector
//This agi script demonstrate how to connect / disconnect an iot device before / afteruse

//Require the iot lib
requirelib("iot");

function main(){
	//Check if the IoT Controller is ready
	if (iot.ready() == true){
		//List the iot devices in the network
		var devList = iot.list();
		
		//Pick the first device to connect
		var firstDevice = devList[0];
		
		//Connect the device if protocol required
		if (firstDevice.RequireConnect == true){
			//Connect to the iot device. Send in empty string ("") if not applicable
			var succ = iot.connect(firstDevice.DeviceUUID, "username", "password", "token");
			if (!succ){
				sendResp("Connection to iot device failed");
				return
			}
		}

		//Do something with the iot device

		//Disconenct the device if protocol required
		if (firstDevice.RequireConnect == true){
			var succ = iot.disconnect(firstDevice.DeviceUUID);
			if (!succ){
				sendResp("Device Disconnect Failed");
				return
			}
		}

		sendResp("Operation Completed");

	}else{
		sendResp("IoT Manager not ready");
	}
}

//Run the main function
main();
