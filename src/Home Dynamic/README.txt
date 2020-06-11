                                                      
    //    ) )                                                 
   //    / /          __      ___      _   __     ( )  ___    
  //    / //   / / //   ) ) //   ) ) // ) )  ) ) / / //   ) ) 
 //    / ((___/ / //   / / //   / / // / /  / / / / //        
//____/ /    / / //   / / ((___( ( // / /  / / / / ((____     
               
=================================================================
Home Dynamic - Home Automation System

# Introduction
Home Dynamic is a fully automated Open Source Home Automation Control Hub.
Home dynamic provide full scanning of in range IoT devices with custom protocol.

# ESP8266 Protocol
## Basic Requirement
The ESP8266 Wifi IoT Module (ESP) can be used with Home Dynamic Module.
In the code of the ESP, there are custom API that needed to be provided for the
Home Dynamic Module for ESP connection and identification.

The minimal structure is as follow:
1. <ip address>:<port>/info
2. <ip address>:<port>/on
3. <ip address>:<port>/off

The return value of the following command have to be at least with these information:
1. <Module Name>_On:<Relative Path for On Command>_Off:<Relative Path for Off Command>
2. true
3. true

<!> In the condition that the relative path contain "/" or "\", replace the symbol with "|".

## Advance Communication Protocol
Home Dynamic Module support advanced sensor/ micro-controller control protocol.
Examples:

1. [Get return state of module]
<Module Name>_On:<Relative Path for On Command>_Off:<Relative Path for Off Command>_State:<Item Name>,<value>;<Item Name>,<value>
Example Code:
printf("<p>DHT11 Sensor_On:switch|on_Off:switch|off_State:Temperature, %s℃;Humidity,%s%%</p>",temp_value,humi_value);
Example Output:
DHT11 Sensor_On:switch|on_Off:switch|off_State:Temperature,25℃;Humidity,60%

2. [Update module mode]
<Module Name>_On:<Relative Path for On Command>_Off:<Relative Path for Off Command>_Mode:<Relative Path for Mode Switch>_Option:<option 1>,<option 2>,<option 3>
Example Code:
printf("<p>Desk Lamp_On:switch|on_Off:switch|off_Mode:mode|_Option:Warm,Bright,Night_State:Mode,%s</p>",current_Mode);
Example Output:
Desk Lamp_On:switch|on_Off:switch|off_Mode:mode|_Option:Warm,Bright,Night_State:Mode,Warm

<!> The current mode of the module is using can be shown using state option.

3. [Passing variables to module]
<Module Name>_On:<Relative Path for On Command>_Off:<Relative Path for Off Command>_Variables:<variable accepting path>_Keywords:<keyword1>,<keyword2>
And the returned value will be in the format same as the PHP GET. For example, this URL will be requested from the ESP for a TV Controller.
<variable path>?keyword1=something&keyword2=something_else

Example Code for Getting Argument from URL Path:

void handleSpecificArg() { 
String message = “”;
if (server.arg(“Keyword1”)== “”){     //Parameter not found
message = “Keyword1 Argument not found”;
}else{     //Parameter found
message = “Keyword1 Argument = “;
message += server.arg(“Keyword1”);     //Gets the value of the query parameter
}
server.send(200, “text/plain”, message);          //Returns the HTTP response
}

Example Output of info page:
IoT Remote_On:switch|on_Off:switch|off_Variables:sendCommand_Keywords:channel,volume

Example URL request:
sendCommand?channel=10&volume=0.8

(C)IMUS Laboratory 2017-2018
Licensed under (C) IMUS Laboratory
