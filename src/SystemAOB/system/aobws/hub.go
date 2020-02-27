// Copyright 2013 The Gorilla WebSocket Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

//Modified by ArOZ Online Project for websocket message redirection purpose

package main

import (
	"log"
	"net/http"
	"encoding/json"
	uuid "github.com/google/uuid"
	"strings"
)
// Hub maintains the set of active clients and broadcasts messages to the
// clients.
type Hub struct {
	// Registered clients.
	clients map[*Client]bool

	// Inbound messages from the clients.
	broadcast chan msgpackage

	// Register requests from the clients.
	register chan *Client

	// Unregister requests from clients.
	unregister chan *Client

	//Register the username from clients
	usernames map[*Client]string

	//State if the user has logged in
	loggedin map[*Client]bool

	//Module name for application registry
	channel map[*Client] string

	//Instance UUID for direct messaging between two clients
	uuids map[*Client] string

}

func newHub() *Hub {
	return &Hub{
		broadcast:  make(chan msgpackage),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
		usernames: make(map[*Client]string),
		loggedin: make(map[*Client]bool),
		channel: make(map[*Client] string),
		uuids: make(map[*Client] string),
	}
}
type validAuthJSON struct {
	username string
	signDevice string
	createdTime int
	expTime int
	discarded bool
}

func checkLogin(h *Hub, sender *Client) bool{
	if (h.loggedin[sender] == true){
		return true
	}
	return false
}

func sendResp(h *Hub, reciver *Client, message []byte){
	select {
	case reciver.send <- msgpackage{message,reciver}:
	default:
		close(reciver.send)
		delete(h.clients, reciver)
		
	}
}

func sendBadReq(h *Hub, reciver *Client, command string){
	message := `{"type":"resp","command":"` + command + `", "data":"400 Bad Request"}`
	select {
	case reciver.send <- msgpackage{[]byte(message),reciver}:
	default:
		close(reciver.send)
		delete(h.clients, reciver)
		
	}
}

func runCommand(h *Hub, sender *Client, message string) string{
	commandChunks := strings.Split(message[1:]," ")
	commandOutput := `{"type":"resp","command":"` + commandChunks[0] + `", "data":"405 Method Not Allowed"}`;
	//log.Println(commandChunks)
	switch commandChunks[0]{
	case "login":
		if (len(commandChunks) != 3){
			//Malformated command input.
			sendBadReq(h, sender, "login");
			log.Println("Bad command received.")
			return "";
		}
		registerModuleName := commandChunks[1]
		thisJWT := commandChunks[2]
		validationURL := string(*endpt) + "?token=" + string(thisJWT)
		//Get response from server for authentication check
		resp, err := http.Get(validationURL)
		if err != nil {
			panic(err)
		}
		defer resp.Body.Close()

		//log.Printf("%#v\n", resp)

		dec := json.NewDecoder(resp.Body)
		if dec == nil {
			panic("Failed to start decoding JSON data")
		}

		json_map := make(map[string]interface{})
		err = dec.Decode(&json_map)
		if err != nil {
			panic(err)
		}

		if (json_map["error"] == nil){
			//Check if token discarded. If yes, also report as failed to login.
			if (json_map["discarded"] == true){
				//This token is discarded. Ignore login
				h.loggedin[sender] = false
				commandOutput = `{"type":"resp","command":"login", "data":"401 Unauthorized"}`;
				sendResp(h, sender, []byte(commandOutput))
				return "";
			}else{
				//This authentication is successful
				h.loggedin[sender] = true
				h.channel[sender] = registerModuleName
				h.usernames[sender] = json_map["username"].(string)
				commandOutput = `{"type":"resp","command":"login", "data":"202 Accepted"}`;
			}
			

		}else{
			//This authentication failed
			h.loggedin[sender] = false
			commandOutput = `{"type":"resp","command":"login", "data":"401 Unauthorized"}`;
			sendResp(h, sender, []byte(commandOutput))
			return "";
		}

	case "chklogin":
		if (checkLogin(h, sender)){
			commandOutput = `{"type":"resp","command":"chklogin", "data":"` + "Logged in as " + h.usernames[sender] + `"}`;
		}else{
			sendResp(h, sender, []byte(`{"type":"resp","command":"chklogin", "data":"Not logged in"}`))
			return ""
		}
	case "logout":
		if (checkLogin(h, sender)){
			h.loggedin[sender] = false
			sendResp(h, sender, []byte(`{"type":"resp","command":"logout", "data":"202 Accepted"}`))
			return ""
		}else{
			commandOutput = `{"type":"resp","command":"logout", "data":"401 Unauthorized"}`;
		}
	case "chkchannel":
		if (checkLogin(h, sender)){
			commandOutput = `{"type":"resp","command":"chkchannel", "data":"` + h.channel[sender] + `"}`;
		}else{
			commandOutput = `{"type":"resp","command":"chkchannel", "data":"401 Unauthorized"}`;
		}
	case "chkuuid":
		if (checkLogin(h, sender)){
			commandOutput = `{"type":"resp","command":"chkuuid", "data":"` + h.uuids[sender] + `"}`;
		}else{
			commandOutput = `{"type":"resp","command":"chkuuid", "data":"401 Unauthorized"}`;
		}
	case "tell":
		//Tell comamnd, given another username
		targetUsername := commandChunks[1]
		messageToBeDelivered := strings.Join(commandChunks[2:]," ")
		//Parse the common communication protocol
		msgpack := "{\"type\": \"tell\",\"sender\": \"" + h.usernames[sender] + "\", \"connUUID\": \"" + h.uuids[sender] + "\", \"data\": \"" +  messageToBeDelivered + "\"}"
		if (checkLogin(h, sender)){
			//Send the message to all the clients with given username
			for client := range h.clients {
				if h.usernames[client] == targetUsername && client != sender{
					sendResp(h, client, []byte(msgpack))
				}
			}
			commandOutput = `{"type":"resp","command":"tell", "data":"200 OK"}`;
		}else{
			commandOutput = `{"type":"resp","command":"tell", "data":"401 Unauthorized"}`;
		}
	case "utell":
		//Tell comamnd, but using UUID instead of username
		targetUUID := commandChunks[1]
		messageToBeDelivered := strings.Join(commandChunks[2:]," ")
		msgpack := "{\"type\": \"utell\",\"sender\": \"" + h.usernames[sender] + "\", \"connUUID\": \"" + h.uuids[sender] + "\", \"data\": \"" +  messageToBeDelivered + "\"}"
		if (checkLogin(h, sender)){
			//Send the message to all the clients with given username
			for client := range h.clients {
				if h.uuids[client] == targetUUID{
					sendResp(h, client, []byte(msgpack))
				}
			}
			commandOutput = `{"type":"resp","command":"utell", "data":"200 OK"}`;
		}else{
			commandOutput = `{"type":"resp","command":"utell", "data":"401 Unauthorized"}`;
		}

	case "help":
		//The standard help command. Shows the list of command usable via this websocket reflector
		resp := `ArOZ Online Base System WebSocket Reflector
		Usage: 
		/login {channel} {shadowJWT token}
		/chklogin
		/logout
		/chkchannel
		/checkuuid
		/tell {username} {message}
		/utell	{connnection UUID} {message}`;
		sendResp(h, sender, []byte(resp))
		return ""
	}

	return commandOutput
}

func handleMessage(h *Hub, sender *Client, message []byte) (bool, []byte){
	if (string(message)[0:1] == "/"){
		//This is a command.
		returnString := runCommand(h, sender, string(message))
		return false,[]byte(returnString)
	}
	return true,message
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true //Enable this client as registered user
			h.usernames[client] = "anonymous" //Set its name to anonymous before it login
			h.loggedin[client] = false //Set to not logged in
			h.uuids[client] = (uuid.Must(uuid.NewRandom())).String() //Given this connection an uuid
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
		case msg := <-h.broadcast:
			message := msg.message
			sender := msg.clientID
			log.Println(string(message), h.usernames[sender])
			//Handle the message
			brodcaseMessage, message := handleMessage(h,sender, message)
			if (string(message) == ""){
				//Do not return anything
				break;
			}
			//Check if the sender has already logged in
			if (h.loggedin[sender] == true){
				//User logged in
				if brodcaseMessage{
					//Broadcast the message to the Clients in the same channel
					senderChannel := h.channel[sender]
					msgpack := "{\"type\": \"broadcast\",\"sender\": \"" + h.usernames[sender] + "\", \"connUUID\": \"" + h.uuids[sender] + "\", \"data\": \"" +  string(message) + "\"}"
					for client := range h.clients {
						//Send the message to all clients in the same channel
						if h.channel[client] == senderChannel{
							select {
							case client.send <- msgpackage{[]byte(msgpack),client}:
							default:
								close(client.send)
								delete(h.clients, client)
								
							}
						}
					}
				}else{
					//Only send reply back to the user
					select {
					case sender.send <- msgpackage{message,sender}:
					default:
						close(sender.send)
						delete(h.clients, sender)
						
					}
				}
			}else{
				//User not logged in
				select {
				case sender.send <- msgpackage{[]byte(`{"type":"resp","command":"generic", "data":"401 Unauthorized"}`),sender}:
				default:
					close(sender.send)
					delete(h.clients, sender)
					
				}
			}

			
		}
	}
}
