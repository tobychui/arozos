package agi

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/robertkrimen/otto"
	user "imuslab.com/arozos/mod/user"
)

/*
	AJGI WebSocket Request Library

	This is a library for allowing AGI based connection upgrade to WebSocket
	Different from other agi module, this do not use the register lib interface
	deal to it special nature.

	Author: tobychui
*/
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}
var connections = sync.Map{}

//This is a very special function to check if the connection has been updated or not
//Return upgrade status (true for already upgraded) and connection uuid
func checkWebSocketConnectionUpgradeStatus(vm *otto.Otto) (bool, string, *websocket.Conn) {
	if value, err := vm.Get("_websocket_conn_id"); err == nil {
		//Exists!
		//Check if this is undefined
		if value == otto.UndefinedValue() {
			//WebSocket connection has closed
			return false, "", nil
		}

		//Connection is still live. Try convert it to string
		connId, err := value.ToString()
		if err != nil {
			return false, "", nil
		}

		//Load the conenction from SyncMap
		if c, ok := connections.Load(connId); ok {
			//Return the conncetion object
			return true, connId, c.(*websocket.Conn)
		}

		//Connection object not found (Maybe already closed?)
		return false, "", nil

	}
	return false, "", nil
}

func (g *Gateway) injectWebSocketFunctions(vm *otto.Otto, u *user.User, w http.ResponseWriter, r *http.Request) {

	vm.Set("_websocket_upgrade", func(call otto.FunctionCall) otto.Value {
		//Check if the user specified any timeout time in seconds
		//Default to 5 minutes
		timeout, err := call.Argument(0).ToInteger()
		if err != nil {
			timeout = 300
		}

		//Check if the connection has already been updated
		connState, _, _ := checkWebSocketConnectionUpgradeStatus(vm)
		if connState {
			//Already upgraded
			return otto.TrueValue()
		}

		//Not upgraded. Upgrade it now
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Print("*AGI WebSocket*  WebSocket upgrade failed:", err)
			return otto.FalseValue()
		}

		//Generate a UUID for this connection
		connUUID := newUUIDv4()
		vm.Set("_websocket_conn_id", connUUID)
		connections.Store(connUUID, c)

		//Record its creation time as opr time
		vm.Set("_websocket_conn_lastopr", time.Now().Unix())

		//Create a go routine to monitor the connection status and disconnect it if timeup
		if timeout > 0 {
			go func() {
				time.Sleep(1 * time.Second)
				//Check if the last edit time > timeout time
				connStatus, connID, conn := checkWebSocketConnectionUpgradeStatus(vm)
				for connStatus {
					//For this connection exists
					if value, err := vm.Get("_websocket_conn_lastopr"); err == nil {
						lastOprTime, err := value.ToInteger()
						if err != nil {
							continue
						}
						//log.Println(time.Now().Unix(), lastOprTime)
						if time.Now().Unix()-lastOprTime > timeout {
							//Timeout! Kill this socket
							conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "Timeout"))
							time.Sleep(300)
							conn.Close()

							//Clean up the connection in sync map and vm
							vm.Set("_websocket_conn_id", otto.UndefinedValue())
							connections.Delete(connID)

							log.Println("*AGI WebSocket* Closing connection due to timeout")
							break
						}
					}
					time.Sleep(1 * time.Second)
					connStatus, _, _ = checkWebSocketConnectionUpgradeStatus(vm)
				}

			}()
		}

		return otto.TrueValue()
	})

	vm.Set("_websocket_send", func(call otto.FunctionCall) otto.Value {
		//Get the content to send
		content, err := call.Argument(0).ToString()
		if err != nil {
			g.raiseError(err)
			return otto.FalseValue()
		}

		//Send it
		connState, connID, conn := checkWebSocketConnectionUpgradeStatus(vm)
		if !connState {
			//Already upgraded
			//log.Println("*AGI WebSocket* Connection id not found in VM")
			return otto.FalseValue()
		}

		err = conn.WriteMessage(1, []byte(content))
		if err != nil {

			//Client connection could have been closed. Close the connection
			conn.Close()

			//Clean up the connection in sync map and vm
			vm.Set("_websocket_conn_id", otto.UndefinedValue())
			connections.Delete(connID)
			return otto.FalseValue()
		}

		//Write succeed

		//Update last opr time
		vm.Set("_websocket_conn_lastopr", time.Now().Unix())

		return otto.TrueValue()
	})

	vm.Set("_websocket_read", func(call otto.FunctionCall) otto.Value {
		connState, connID, conn := checkWebSocketConnectionUpgradeStatus(vm)
		if connState == true {
			_, message, err := conn.ReadMessage()
			if err != nil {
				//Client connection could have been closed. Close the connection
				conn.Close()

				//Clean up the connection in sync map and vm
				vm.Set("_websocket_conn_id", otto.UndefinedValue())
				connections.Delete(connID)

				log.Println("*AGI WebSocket* Trying to read from a closed socket")
				return otto.FalseValue()
			}
			//Update last opr time
			vm.Set("_websocket_conn_lastopr", time.Now().Unix())

			//Parse the incoming message
			incomingString, err := otto.ToValue(string(message))
			if err != nil {
				log.Println(err)
				//Unable to parse to JavaScript. Something out of the scope of otto?
				return otto.NullValue()
			}

			//Return the incoming string to the AGI script
			return incomingString
		} else {
			//WebSocket not exists
			//log.Println("*AGI WebSocket* Trying to read from a closed socket")
			return otto.FalseValue()
		}
	})

	vm.Set("_websocket_close", func(call otto.FunctionCall) otto.Value {
		connState, connID, conn := checkWebSocketConnectionUpgradeStatus(vm)
		if connState == true {
			//Close the Websocket gracefully
			conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			time.Sleep(300)
			conn.Close()

			//Clean up the connection in sync map and vm
			vm.Set("_websocket_conn_id", otto.UndefinedValue())
			connections.Delete(connID)

			//Return true value
			return otto.TrueValue()
		} else {
			//Connection not opened or closed already
			return otto.FalseValue()
		}

	})

	//Wrap all the native code function into an imagelib class
	vm.Run(`
		var websocket = {};
		websocket.upgrade = _websocket_upgrade;
		websocket.send = _websocket_send;
		websocket.read = _websocket_read;
		websocket.close = _websocket_close;
		
	`)
}
