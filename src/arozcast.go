package main

/*
	Arozcast - Remote Projection Pub/Sub Backend
	author: tobychui

	Provides a simple room-based pub/sub WebSocket relay so that
	Arozcast (receiver) and Musicify (sender) can exchange playback
	commands in real time using a shared 4-digit room code.

	Endpoints (all require login):
	  POST /api/arozcast/create              → {"code":"1234"}
	  GET  /api/arozcast/close?code=XXXX    → "OK"
	  GET  /api/arozcast/ping?code=XXXX     → {"exists":true/false}
	  POST /api/arozcast/publish            → "OK"  (code=, msg=)
	  GET  /api/arozcast/ws?code=XXXX       → WebSocket upgrade
*/

import (
	"fmt"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

// acClient is one WebSocket participant in a room.
type acClient struct {
	conn *websocket.Conn
	send chan []byte
	once sync.Once
}

func (c *acClient) safeClose() {
	c.once.Do(func() { close(c.send) })
}

// acRoom holds all connected clients sharing a 4-digit code.
type acRoom struct {
	code         string
	owner        string
	clients      map[*acClient]struct{}
	mu           sync.Mutex
	createdAt    time.Time
	lastActivity time.Time // updated on every client join / leave
}

func (r *acRoom) add(c *acClient) {
	r.mu.Lock()
	r.clients[c] = struct{}{}
	r.lastActivity = time.Now()
	r.mu.Unlock()
}

func (r *acRoom) remove(c *acClient) {
	r.mu.Lock()
	delete(r.clients, c)
	r.lastActivity = time.Now()
	r.mu.Unlock()
}

// broadcast sends msg to every client except exclude (nil = send to all).
func (r *acRoom) broadcast(msg []byte, exclude *acClient) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for c := range r.clients {
		if c == exclude {
			continue
		}
		select {
		case c.send <- append([]byte(nil), msg...):
		default: // drop frame if buffer is full
		}
	}
}

// acManager owns all live rooms.
type acManager struct {
	rooms map[string]*acRoom
	mu    sync.RWMutex
}

var acUpgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func ArozcastInit() {
	mgr := &acManager{rooms: make(map[string]*acRoom)}

	// Sweep rooms with no active clients that have been idle for 10 minutes.
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			mgr.mu.Lock()
			for code, room := range mgr.rooms {
				room.mu.Lock()
				if len(room.clients) == 0 && time.Since(room.lastActivity) > 10*time.Minute {
					delete(mgr.rooms, code)
				}
				room.mu.Unlock()
			}
			mgr.mu.Unlock()
		}
	}()

	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "Arozcast",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})

	// Create a new room; returns {"code":"XXXX"}.
	router.HandleFunc("/api/arozcast/create", func(w http.ResponseWriter, r *http.Request) {
		userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "Not logged in")
			return
		}

		mgr.mu.Lock()
		var code string
		for {
			code = fmt.Sprintf("%04d", rand.Intn(9000)+1000)
			if _, exists := mgr.rooms[code]; !exists {
				break
			}
		}
		mgr.rooms[code] = &acRoom{
			code:         code,
			owner:        userinfo.Username,
			clients:      make(map[*acClient]struct{}),
			createdAt:    time.Now(),
			lastActivity: time.Now(),
		}
		mgr.mu.Unlock()

		utils.SendJSONResponse(w, `{"code":"`+code+`"}`)
	})

	// Close a room and disconnect all its clients.
	router.HandleFunc("/api/arozcast/close", func(w http.ResponseWriter, r *http.Request) {
		code, err := utils.GetPara(r, "code")
		if err != nil {
			utils.SendErrorResponse(w, "Missing code")
			return
		}

		mgr.mu.Lock()
		room, exists := mgr.rooms[code]
		if exists {
			delete(mgr.rooms, code)
		}
		mgr.mu.Unlock()

		if exists {
			room.mu.Lock()
			for c := range room.clients {
				c.safeClose()
			}
			room.mu.Unlock()
		}

		utils.SendOK(w)
	})

	// Check whether a room with the given code exists.
	router.HandleFunc("/api/arozcast/ping", func(w http.ResponseWriter, r *http.Request) {
		code, err := utils.GetPara(r, "code")
		if err != nil {
			utils.SendErrorResponse(w, "Missing code")
			return
		}

		mgr.mu.RLock()
		_, exists := mgr.rooms[code]
		mgr.mu.RUnlock()

		if exists {
			utils.SendJSONResponse(w, `{"exists":true}`)
		} else {
			utils.SendJSONResponse(w, `{"exists":false}`)
		}
	})

	// HTTP publish: POST code=XXXX&msg=<json>
	// Useful for AGI scripts that cannot hold a WebSocket connection.
	router.HandleFunc("/api/arozcast/publish", func(w http.ResponseWriter, r *http.Request) {
		code, err := utils.PostPara(r, "code")
		if err != nil {
			utils.SendErrorResponse(w, "Missing code")
			return
		}
		msg, err := utils.PostPara(r, "msg")
		if err != nil {
			utils.SendErrorResponse(w, "Missing msg")
			return
		}

		mgr.mu.RLock()
		room, exists := mgr.rooms[code]
		mgr.mu.RUnlock()

		if !exists {
			utils.SendErrorResponse(w, "Room not found")
			return
		}

		room.broadcast([]byte(msg), nil)
		utils.SendOK(w)
	})

	// WebSocket: GET /api/arozcast/ws?code=XXXX
	// Each frame sent by a client is relayed to all OTHER clients in the room.
	router.HandleFunc("/api/arozcast/ws", func(w http.ResponseWriter, r *http.Request) {
		code, err := utils.GetPara(r, "code")
		if err != nil {
			http.Error(w, "Missing code", http.StatusBadRequest)
			return
		}

		mgr.mu.RLock()
		room, exists := mgr.rooms[code]
		mgr.mu.RUnlock()

		if !exists {
			http.Error(w, "Room not found", http.StatusNotFound)
			return
		}

		conn, err := acUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}

		client := &acClient{
			conn: conn,
			send: make(chan []byte, 128),
		}
		room.add(client)

		// Writer goroutine: drains client.send and writes to the socket.
		go func() {
			defer conn.Close()
			for msg := range client.send {
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			}
		}()

		// Reader loop: relay incoming frames to all other room members.
		defer func() {
			room.remove(client)
			client.safeClose()
		}()

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			room.broadcast(msg, client)
		}
	})
}
