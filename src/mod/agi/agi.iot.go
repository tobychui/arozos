package agi

import (
	"encoding/json"
	"log"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/iot"
)

/*
	AGI IoT Control Protocols

	This is a library for allowing AGI script to control / send commands to IoT devices
	Use with caution and prepare to handle errors. IoT devices are not always online / connectabe.

	Author: tobychui
*/

func (g *Gateway) IoTLibRegister() {
	err := g.RegisterLib("iot", g.injectIoTFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectIoTFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	//u := payload.User
	//scriptFsh := payload.ScriptFsh
	//scriptPath := payload.ScriptPath
	//w := payload.Writer
	//r := payload.Request
	//Scan and return the latest iot device list
	vm.Set("_iot_scan", func(call otto.FunctionCall) otto.Value {
		scannedDevices := g.Option.IotManager.ScanDevices()
		js, _ := json.Marshal(scannedDevices)
		devList, err := vm.ToValue(string(js))
		if err != nil {
			return otto.FalseValue()
		}
		return devList
	})

	//List the current scanned device list from cache
	vm.Set("_iot_list", func(call otto.FunctionCall) otto.Value {
		devices := g.Option.IotManager.GetCachedDeviceList()
		js, _ := json.Marshal(devices)
		devList, err := vm.ToValue(string(js))
		if err != nil {
			return otto.FalseValue()
		}
		return devList
	})

	//Conenct an iot device. Return true if the device is connected or the device do not require connection before command exec
	vm.Set("_iot_connect", func(call otto.FunctionCall) otto.Value {
		//Get device ID from paratmer
		devID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		//Get the auth info from paramters
		username, err := call.Argument(1).ToString()
		if err != nil {
			username = ""
		}

		password, err := call.Argument(2).ToString()
		if err != nil {
			password = ""
		}

		token, err := call.Argument(3).ToString()
		if err != nil {
			token = ""
		}

		//Get device by id
		dev := g.Option.IotManager.GetDeviceByID(devID)
		if dev == nil {
			//No device with that ID found
			return otto.FalseValue()
		}

		if dev.RequireConnect == true {
			//Build the auto info
			autoInfo := iot.AuthInfo{
				Username: username,
				Password: password,
				Token:    token,
			}

			//Connect the device
			dev.Handler.Connect(dev, &autoInfo)
		}

		//Return true
		return otto.TrueValue()
	})

	//Get the status of the given device
	vm.Set("_iot_status", func(call otto.FunctionCall) otto.Value {
		//Get device ID from paratmer
		devID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		dev := g.Option.IotManager.GetDeviceByID(devID)

		if dev == nil {
			return otto.FalseValue()
		}

		//We have no idea what is the structure of the dev status.
		//Just leave it to the front end to handle :P
		devStatus, err := dev.Handler.Status(dev)
		if err != nil {
			log.Println("*AGI IoT* " + err.Error())
			return otto.FalseValue()
		}

		js, _ := json.Marshal(devStatus)
		results, _ := vm.ToValue(string(js))
		return results
	})

	vm.Set("_iot_exec", func(call otto.FunctionCall) otto.Value {
		//Get device ID from paratmer
		devID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		//Get endpoint name
		epname, err := call.Argument(1).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		//Get payload if any
		payload, err := call.Argument(2).ToString()
		if err != nil {
			payload = ""
		}

		//Get device by id
		dev := g.Option.IotManager.GetDeviceByID(devID)
		if dev == nil {
			//Device not found
			log.Println("*AGI IoT* Given device ID do not match any IoT devices")
			return otto.FalseValue()
		}

		//Get the endpoint from name
		var targetEp *iot.Endpoint
		for _, ep := range dev.ControlEndpoints {
			if ep.Name == epname {
				//This is the target endpoint
				thisEp := ep
				targetEp = thisEp
			}

		}

		if targetEp == nil {
			//Endpoint not found
			log.Println("*AGI IoT* Failed to get endpoint by name in this device")
			return otto.FalseValue()
		}

		var results interface{}

		//Try to convert it into a string map
		if payload != "" {
			payloadMap := map[string]interface{}{}

			err = json.Unmarshal([]byte(payload), &payloadMap)
			if err != nil {
				log.Println("*AGI IoT* Failed to parse input payload: " + err.Error())
				return otto.FalseValue()
			}

			//Execute the request
			results, err = dev.Handler.Execute(dev, targetEp, payloadMap)

		} else {
			//Execute the request without payload
			results, err = dev.Handler.Execute(dev, targetEp, nil)
		}

		if err != nil {
			log.Println("*AGI IoT* Failed to execute request to device: " + err.Error())
			return otto.FalseValue()
		}

		js, _ := json.Marshal(results)
		reply, _ := vm.ToValue(string(js))
		return reply
	})

	//Disconnect a given iot device using the device UUID
	vm.Set("_iot_disconnect", func(call otto.FunctionCall) otto.Value {
		//Get device ID from paratmer
		devID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		dev := g.Option.IotManager.GetDeviceByID(devID)

		if dev == nil {
			return otto.FalseValue()
		}

		if dev.RequireConnect == true {
			err = dev.Handler.Disconnect(dev)
			if err != nil {
				return otto.FalseValue()
			}
		}

		return otto.TrueValue()
	})

	//Return the icon tag for this device
	vm.Set("_iot_iconTag", func(call otto.FunctionCall) otto.Value {
		//Get device ID from paratmer
		devID, err := call.Argument(0).ToString()
		if err != nil {
			return otto.FalseValue()
		}

		dev := g.Option.IotManager.GetDeviceByID(devID)
		if dev == nil {
			//device not found
			return otto.NullValue()
		}

		deviceIconTag := dev.Handler.Icon(dev)
		it, _ := vm.ToValue(deviceIconTag)

		return it
	})

	vm.Set("_iot_ready", func(call otto.FunctionCall) otto.Value {
		if g.Option.IotManager == nil {
			return otto.FalseValue()
		} else {
			return otto.TrueValue()
		}
	})

	//Wrap all the native code function into an imagelib class
	_, err := vm.Run(`
		var iot = {
			"scan": function(){
				var devList = _iot_scan();
				return JSON.parse(devList);
			},
			"list": function(){
				var devList = _iot_list();
				return JSON.parse(devList);
			},
			"status": function(devid){
				var devStatus = _iot_status(devid);
				return JSON.parse(devStatus);
			},
			"exec": function(devid, epname, payload){
				payload = payload || "";
				payload = JSON.stringify(payload);
				var resp = _iot_exec(devid, epname, payload);
				if (resp == false){
					return false;
				}else{
					return JSON.parse(resp);
				}
			}
		};

		iot.ready = _iot_ready;
		iot.connect = _iot_connect;
		iot.disconnect = _iot_disconnect;
		iot.iconTag = _iot_iconTag;
		
	`)

	if err != nil {
		log.Println("*AGI* IoT Functions Injection Error", err.Error())
	}
}
