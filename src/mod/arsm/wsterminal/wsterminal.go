package wsterminal

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"imuslab.com/arozos/mod/auth"
)

/*
	WebSocket Terminal
	Author: tobychui

	This module is a remote support service that allow
	reverse ssh like connection using websocket.

	For normal weboscket based shell or WsTTY, see wstty module instead.
*/

type Connection struct {
	RemoteName            string
	RemoteUUID            string
	RemoteIP              string
	RemoteToken           string
	ConnectionStartedTime int64
	LastOnline            int64
	connection            *websocket.Conn
	terminateTicker       chan bool
}

type Server struct {
	connectionPool sync.Map
	upgrader       websocket.Upgrader
	authAgent      *auth.AuthAgent
}

type Client struct {
}

//Create a new Server
func NewWsTerminalServer(authAgent *auth.AuthAgent) *Server {
	return &Server{
		connectionPool: sync.Map{},
		upgrader:       websocket.Upgrader{},
		authAgent:      authAgent,
	}
}

//List all the active connection that is current connected to this server
func (s *Server) ListConnections(w http.ResponseWriter, r *http.Request) {
	activeConnections := []Connection{}
	s.connectionPool.Range(func(key, value interface{}) bool {
		activeConnections = append(activeConnections, *value.(*Connection))
		return true
	})
	js, _ := json.Marshal(activeConnections)
	sendJSONResponse(w, string(js))
}

//Handle new connections
func (s *Server) HandleConnection(w http.ResponseWriter, r *http.Request) {
	//Get the token and validate it
	token, err := mv(r, "token", false)
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`401 Unauthorized - Invalid token given`))
		return
	}

	//Try to get the uuid from connectio
	uuid, err := mv(r, "uuid", false)
	if err != nil {
		uuid = "unknown"
	}

	//Valida te the token
	valid, username := s.authAgent.ValidateAutoLoginToken(token)
	if !valid {
		//Invalid token
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`401 Unauthorized - Invalid token given`))
		return
	}

	//Create a connection object
	thisConnection := Connection{
		RemoteName:            username,
		RemoteUUID:            uuid,
		RemoteIP:              "",
		RemoteToken:           "",
		ConnectionStartedTime: time.Now().Unix(),
		LastOnline:            time.Now().Unix(),
	}

	//Check if the same connection already exists. If yes, disconnect the old one
	val, ok := s.connectionPool.Load(username)
	if ok {
		//Connection already exists. Disconenct the old one first
		previousConn := val.(*Connection).connection
		previousConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		time.Sleep(1 * time.Second)
		previousConn.Close()
	}

	//Upgrade the current connection
	c, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`500 Internal Server Error`))
		return
	}

	thisConnection.connection = c

	//Create a timer for poking the client and check if it is still online
	ticker := time.NewTicker(5 * time.Minute)
	done := make(chan bool)

	thisConnection.terminateTicker = done
	go func(connectionObject Connection) {
		for {
			select {
			case <-done:
				//Termination from another thread
				return
			case <-ticker.C:
				//Send a ping signal to the client
				if err := connectionObject.connection.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
					//Unable to send ping message. Assume closed. Remove from active connection pool
					s.connectionPool.Delete(thisConnection.RemoteName)
					return
				} else {
					connectionObject.LastOnline = time.Now().Unix()
				}
			}
		}
	}(thisConnection)

	//Store the connection object to the connection pool
	s.connectionPool.Store(username, &thisConnection)
}
