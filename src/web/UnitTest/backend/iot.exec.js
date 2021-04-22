//IoT Scanner
//This agi script will list the manager cached device list. If the list not exists
//It will perform an auto scan instead.

//Require the iot lib
requirelib("iot");

function main(){
	//Check if the IoT Controller is ready
	if (iot.ready() == true){
		//List the iot device in cache
		var deviceList = iot.list();
		
		if (deviceList.length == 0){
			sendResp("No iot device found");
			return;
		}

		//Assuming the first device is an example object with a basic echo function
		//When an AJAX request is called to its endpoint
		var thisDevice = deviceList[0]; //Change this if your testing device is not the first device on the iot device list
		console.log(thisDevice.Name);

		//Connect the first device by its uuid
		iot.connect(thisDevice.DeviceUUID);

		//Find the endpoint with type "none"
		var targetEndpoint = undefined;
		for (var i = 0; i < thisDevice.ControlEndpoints.length; i++){
			var thisEndpoint = thisDevice.ControlEndpoints[i];
			if (thisEndpoint.Type == "none"){
				//Lets pick this endpoint as an example for toggling
				targetEndpoint = thisEndpoint;
				break;
			}
		}

		if (targetEndpoint == undefined){
			sendResp("This device do not have an endpoint with type \"none\". Try again with another iot device in your network.")
			return
		}

		//Now, we execute this endpoint by the device id and the endpoint name
		//exec require {device id, target endppoint name, payload (object)}
		//In this case, we can pass anything into the object field as none type endpoint
		//will just ignore all the input payload
		var results = iot.exec(thisDevice.DeviceUUID, targetEndpoint.Name, {})

		//Disconnect the iot device if needed
		iot.disconnect(thisDevice.DeviceUUID);

		if (results == false){
			//There is something wrong with the toggling. See Terminal for output
			sendResp("Failed to toggle device. See terminal for more information.")
		}else{
			//Return what the iot device reply to the responce output
			//The results return from iot.exec is an JSON object
			HTTP_HEADER = "application/json; charset=utf-8";
			sendResp(JSON.stringify(results));
		}

	}else{
		sendResp("IoT Manager not ready");
	}
}

//Run the main function
main();
