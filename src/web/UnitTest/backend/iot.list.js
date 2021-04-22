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
		
		//Return the value as JSON string
		HTTP_HEADER = "application/json; charset=utf-8";
		sendResp(JSON.stringify(deviceList));
		
	}else{
		sendResp("IoT Manager not ready");
	}
}

//Run the main function
main();
