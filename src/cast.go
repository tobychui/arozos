package main

/*
	Arozcast - Remote Projection Pub/Sub Backend
	author: tobychui

	Provides a simple room-based pub/sub WebSocket relay so that
	Arozcast (receiver) and Musicify (sender) can exchange playback
	commands in real time using a shared 4-digit room code.

	Endpoints (all require login):
	  POST /api/arozcast/create              --> {"code":"1234"}
	  GET  /api/arozcast/close?code=XXXX    --> "OK"
	  GET  /api/arozcast/ping?code=XXXX     --> {"exists":true/false}
	  POST /api/arozcast/publish            --> "OK"  (code=, msg=)
	  GET  /api/arozcast/ws?code=XXXX       --> WebSocket upgrade

	Room lifecycle / idle timeouts
	──────────────────────────────
	A sweep goroutine runs every 15 seconds and closes rooms that meet
	either of the following conditions:

	  1. Receiver idle — the receiver (Arozcast page) sends a
	     'status.update' frame every 3 s.  If no such frame has been
	     seen for receiverIdleTimeout (30 s) the receiver is considered
	     gone and the room is closed.  This guard only activates after
	     the receiver has connected at least once (lastStatusUpdate is
	     non-zero), so a freshly-created room is not immediately culled.

	  2. Empty + idle — the room has no connected clients and has been
	     idle for emptyRoomTimeout (10 min).  This catches rooms whose
	     owner never opened the Arozcast page.

	Before closing, the backend broadcasts {"topic":"room.closed"} to
	every connected sender so they can react immediately (emit 'giveup')
	instead of waiting for the watchdog cycle to fire.
*/

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"imuslab.com/arozos/mod/network/turn"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

// The built-in TURN relay lets the WebRTC screen-share feature traverse NAT and
// work over the Internet. It can be toggled at runtime from System Settings, so
// its lifecycle is mutex-guarded and its construction parameters are remembered
// for restart. arozcastTurnServer is nil when the relay is stopped or failed to
// start, in which case the ICE config falls back to STUN-only (LAN screen share
// still works).
const (
	arozcastDBTable        = "arozcast" // system DB table for Arozcast preferences
	arozcastTurnEnabledKey = "turn_on"  // persisted bool: relay on/off override
)

var (
	arozcastTurnMu     sync.RWMutex // guards arozcastTurnServer
	arozcastTurnServer *turn.Server // running relay, or nil when stopped/unavailable
	arozcastTurnConfig turn.Config  // remembered config used to (re)start the relay
)

// arozcastGetTurnServer returns the running relay, or nil when it is stopped or
// unavailable. Callers must treat nil as "fall back to STUN-only".
func arozcastGetTurnServer() *turn.Server {
	arozcastTurnMu.RLock()
	defer arozcastTurnMu.RUnlock()
	return arozcastTurnServer
}

// arozcastTurnRunning reports whether the relay is currently running.
func arozcastTurnRunning() bool {
	return arozcastGetTurnServer() != nil
}

// arozcastStartTurnRelay starts the relay from the remembered config. It is a
// no-op (returns nil) when the relay is already running.
func arozcastStartTurnRelay() error {
	arozcastTurnMu.Lock()
	defer arozcastTurnMu.Unlock()
	if arozcastTurnServer != nil {
		return nil
	}
	ts, err := turn.NewServer(arozcastTurnConfig)
	if err != nil {
		return err
	}
	arozcastTurnServer = ts
	return nil
}

// arozcastStopTurnRelay stops the relay and releases its listeners. It is a
// no-op when the relay is already stopped.
func arozcastStopTurnRelay() {
	arozcastTurnMu.Lock()
	defer arozcastTurnMu.Unlock()
	if arozcastTurnServer == nil {
		return
	}
	arozcastTurnServer.Close()
	arozcastTurnServer = nil
}

// arozcastTurnEnabledPref returns the persisted relay on/off preference,
// falling back to the -arozcast_turn flag default when nothing is stored.
func arozcastTurnEnabledPref() bool {
	if sysdb != nil && sysdb.KeyExists(arozcastDBTable, arozcastTurnEnabledKey) {
		var stored bool
		if err := sysdb.Read(arozcastDBTable, arozcastTurnEnabledKey, &stored); err == nil {
			return stored
		}
	}
	return *arozcast_enable_turn
}

// arozcastSetTurnEnabledPref persists the relay on/off preference so it survives
// a restart.
func arozcastSetTurnEnabledPref(enabled bool) error {
	return sysdb.Write(arozcastDBTable, arozcastTurnEnabledKey, enabled)
}

// arozcastICEOverrideFile lets an operator fully replace the ICE server list
// returned to clients (e.g. to point at an external coturn/Cloudflare TURN).
// When present and valid it takes precedence over the built-in relay.
var arozcastICEOverrideFile = filepath.Join("system", "arozcast", "iceservers.json")

// acICEServer mirrors the RTCIceServer dictionary consumed by the browser.
type acICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type acICEConfig struct {
	ICEServers []acICEServer `json:"iceServers"`
}

// acDefaultSTUNServers are the public STUN servers used when no other config is
// available. STUN alone is enough on a LAN but not across most NATs.
var acDefaultSTUNServers = []acICEServer{
	{URLs: []string{"stun:stun.l.google.com:19302"}},
	{URLs: []string{"stun:stun1.l.google.com:19302"}},
}

// Idle-timeout constants.  Adjust here if you need different behaviour.
const (
	acReceiverIdleTimeout = 30 * time.Second // close room when receiver goes silent
	acEmptyRoomTimeout    = 10 * time.Minute // clean up empty rooms
	acSweepInterval       = 15 * time.Second // how often the sweep goroutine runs
)

// roomClosedMsg is broadcast to all senders before the room is torn down,
// giving arozcast.js (and the built-in sender apps) a chance to emit
// 'giveup' immediately rather than going through the full watchdog/retry cycle.
var roomClosedMsg = []byte(`{"topic":"room.closed","payload":{}}`)

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
	code             string
	owner            string
	clients          map[*acClient]struct{}
	mu               sync.Mutex
	createdAt        time.Time
	lastActivity     time.Time // updated on every client join / leave
	lastStatusUpdate time.Time // updated each time a 'status.update' frame is relayed
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
		default: // drop frame if send buffer is full
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

// acCloseRoom removes a room from the manager and disconnects all its clients.
// It first broadcasts roomClosedMsg so senders can react before the socket drops.
// Safe to call even if the room no longer exists.
func acCloseRoom(mgr *acManager, code string) {
	mgr.mu.Lock()
	room, exists := mgr.rooms[code]
	if exists {
		delete(mgr.rooms, code)
	}
	mgr.mu.Unlock()

	if !exists {
		return
	}

	// Notify senders that the room is going away.
	// broadcast() queues the message into each client's send channel;
	// the writer goroutine will deliver it before exiting when the channel
	// is closed below.
	room.broadcast(roomClosedMsg, nil)

	room.mu.Lock()
	for c := range room.clients {
		c.safeClose()
	}
	room.mu.Unlock()
}

func ArozcastInit() {
	mgr := &acManager{rooms: make(map[string]*acRoom)}

	// ── Built-in TURN relay ───────────────────────────────────────────────
	// Screen share uses a direct WebRTC peer-to-peer connection. Over the
	// Internet the peers are usually behind NAT, so a TURN relay is needed to
	// forward the media. ArozOS runs that relay itself (both peers already
	// reach this host for signalling). Failure is non-fatal: we just fall back
	// to STUN-only, which keeps LAN screen share working.
	//
	// The construction parameters are remembered so the relay can be toggled
	// from System Settings without a restart. Whether it starts now comes from
	// the persisted preference, which defaults to the -arozcast_turn flag.
	// When -arozcast_turn_tls is set and a TLS certificate is available it also
	// serves TURN-over-TLS (TURNS) using the system certificate, so screen share
	// can traverse firewalls that only allow outbound TLS. We only wire it up
	// when the cert actually exists so HTTP-only deployments stay silent.
	sysdb.NewTable(arozcastDBTable)
	arozcastTurnConfig = turn.Config{
		ListenPort: *arozcast_turn_port,
		Realm:      "arozos",
		PublicIP:   *arozcast_turn_publicip,
	}
	if *arozcast_turn_tls && utils.FileExists(*tls_cert) && utils.FileExists(*tls_key) {
		arozcastTurnConfig.TLSPort = *arozcast_turn_tls_port
		arozcastTurnConfig.TLSCertFile = *tls_cert
		arozcastTurnConfig.TLSKeyFile = *tls_key
	}

	if arozcastTurnEnabledPref() {
		if err := arozcastStartTurnRelay(); err != nil {
			systemWideLogger.PrintAndLog("Arozcast", "Built-in TURN relay unavailable; screen share will be LAN-only", err)
		} else {
			msg := "Built-in TURN relay started on port " + strconv.Itoa(*arozcast_turn_port)
			if ts := arozcastGetTurnServer(); ts != nil && ts.TLSEnabled() {
				msg += " (TURNS on port " + strconv.Itoa(ts.TLSPort()) + ")"
			}
			systemWideLogger.PrintAndLog("Arozcast", msg, nil)
		}
	}

	// ── Sweep goroutine ───────────────────────────────────────────────────
	// Runs every acSweepInterval and closes rooms that match either idle
	// condition.  Rooms to close are collected while holding a read-lock,
	// then actually closed (write-lock + WS teardown) after releasing it.
	go func() {
		ticker := time.NewTicker(acSweepInterval)
		defer ticker.Stop()
		for range ticker.C {
			var toClose []string

			mgr.mu.RLock()
			for code, room := range mgr.rooms {
				room.mu.Lock()
				receiverDead := !room.lastStatusUpdate.IsZero() &&
					time.Since(room.lastStatusUpdate) > acReceiverIdleTimeout
				emptyIdle := len(room.clients) == 0 &&
					time.Since(room.lastActivity) > acEmptyRoomTimeout
				room.mu.Unlock()

				if receiverDead || emptyIdle {
					toClose = append(toClose, code)
				}
			}
			mgr.mu.RUnlock()

			for _, code := range toClose {
				acCloseRoom(mgr, code)
			}
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

	// ── Admin: built-in TURN relay status & toggle (System Settings) ───────
	// Lets an administrator see the relay's state and turn it on/off at runtime
	// without restarting ArozOS. The on/off choice is persisted so it survives
	// a restart (overriding the -arozcast_turn flag default).
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Settings",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	registerSetting(settingModule{
		Name:         "Screen Share Relay",
		Desc:         "Built-in TURN relay for Arozcast screen share over the Internet",
		IconPath:     "SystemAO/arozcast/img/small_icon.png",
		Group:        "Network",
		StartDir:     "SystemAO/arozcast/turn.html",
		RequireAdmin: true,
	})

	// Report the relay's current configuration and running state.
	adminRouter.HandleFunc("/system/arozcast/turn/status", func(w http.ResponseWriter, r *http.Request) {
		js, err := json.Marshal(acTurnStatus())
		if err != nil {
			utils.SendErrorResponse(w, "Failed to build status")
			return
		}
		utils.SendJSONResponse(w, string(js))
	})

	// Toggle the relay on/off at runtime and persist the preference.
	adminRouter.HandleFunc("/system/arozcast/turn/setEnabled", func(w http.ResponseWriter, r *http.Request) {
		enable, err := utils.GetBool(r, "enable")
		if err != nil {
			utils.SendErrorResponse(w, "Missing or invalid enable parameter")
			return
		}

		if err := arozcastSetTurnEnabledPref(enable); err != nil {
			utils.SendErrorResponse(w, "Failed to save preference")
			return
		}

		if enable {
			if err := arozcastStartTurnRelay(); err != nil {
				systemWideLogger.PrintAndLog("Arozcast", "Failed to start built-in TURN relay from System Settings", err)
				utils.SendErrorResponse(w, "Relay could not start: "+err.Error())
				return
			}
		} else {
			arozcastStopTurnRelay()
		}

		js, err := json.Marshal(acTurnStatus())
		if err != nil {
			utils.SendErrorResponse(w, "Failed to build status")
			return
		}
		utils.SendJSONResponse(w, string(js))
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
		acCloseRoom(mgr, code)
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

	// ICE servers for the WebRTC screen-share feature.
	// Returns the STUN/TURN configuration the browser should use. Built-in TURN
	// credentials are minted fresh per request and are short-lived.
	router.HandleFunc("/api/arozcast/iceservers", func(w http.ResponseWriter, r *http.Request) {
		identity := ""
		if userinfo, err := userHandler.GetUserInfoFromRequest(w, r); err == nil {
			identity = userinfo.Username
		}
		config := acBuildICEConfig(r, identity)
		js, err := json.Marshal(config)
		if err != nil {
			utils.SendErrorResponse(w, "Failed to build ICE config")
			return
		}
		utils.SendJSONResponse(w, string(js))
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
		// When the send channel is closed (safeClose), the goroutine delivers
		// any queued messages (e.g. roomClosedMsg) before closing the connection.
		go func() {
			defer conn.Close()
			for msg := range client.send {
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			}
		}()

		// Reader loop: relay incoming frames to all other room members.
		// Also inspects each frame: if it is a 'status.update' from the
		// receiver, refresh lastStatusUpdate so the sweep goroutine knows
		// the receiver is still alive.
		defer func() {
			room.remove(client)
			client.safeClose()
		}()

		var topicCheck struct {
			Topic string `json:"topic"`
		}

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if json.Unmarshal(msg, &topicCheck) == nil && topicCheck.Topic == "status.update" {
				room.mu.Lock()
				room.lastStatusUpdate = time.Now()
				room.mu.Unlock()
			}
			room.broadcast(msg, client)
		}
	})
}

// acTurnStatusInfo is the JSON status of the built-in TURN relay shown on the
// admin System Settings page.
type acTurnStatusInfo struct {
	Enabled       bool   `json:"enabled"`       // persisted on/off preference
	Running       bool   `json:"running"`       // relay actually running right now
	Port          int    `json:"port"`          // UDP/TCP relay port
	TLS           bool   `json:"tls"`           // TURN-over-TLS (TURNS) listener active
	TLSPort       int    `json:"tlsPort"`       // TURNS port
	PublicIP      string `json:"publicIP"`      // configured advertise host ("" = auto-detect)
	AdvertiseHost string `json:"advertiseHost"` // host actually advertised ("" = derived per request)
}

// acTurnStatus snapshots the built-in TURN relay's configuration and live state.
func acTurnStatus() acTurnStatusInfo {
	info := acTurnStatusInfo{
		Enabled:  arozcastTurnEnabledPref(),
		Port:     arozcastTurnConfig.ListenPort,
		TLSPort:  arozcastTurnConfig.TLSPort,
		PublicIP: strings.TrimSpace(arozcastTurnConfig.PublicIP),
	}
	if ts := arozcastGetTurnServer(); ts != nil {
		info.Running = true
		info.AdvertiseHost = ts.AdvertiseHost()
		info.TLS = ts.TLSEnabled()
		info.TLSPort = ts.TLSPort()
	}
	return info
}

// acBuildICEConfig assembles the ICE server list returned to the browser for
// WebRTC screen share. Order of precedence:
//  1. An operator override file (system/arozcast/iceservers.json), if valid.
//  2. Public STUN servers plus the built-in TURN relay when it is running.
//  3. Public STUN servers only (LAN screen share still works).
func acBuildICEConfig(r *http.Request, identity string) acICEConfig {
	if servers, ok := acLoadICEOverride(); ok {
		return acICEConfig{ICEServers: servers}
	}

	servers := make([]acICEServer, len(acDefaultSTUNServers))
	copy(servers, acDefaultSTUNServers)

	if ts := arozcastGetTurnServer(); ts != nil {
		host := ts.AdvertiseHost()
		if host == "" {
			host = acDeriveTURNHost(r)
		}
		if host != "" {
			base := net.JoinHostPort(host, strconv.Itoa(ts.ListenPort()))
			urls := []string{
				"turn:" + base + "?transport=udp",
				"turn:" + base + "?transport=tcp",
			}
			// TURN-over-TLS rides on TCP only; advertise it so clients behind
			// TLS-only firewalls can still relay.
			if ts.TLSEnabled() {
				tlsBase := net.JoinHostPort(host, strconv.Itoa(ts.TLSPort()))
				urls = append(urls, "turns:"+tlsBase+"?transport=tcp")
			}
			username, credential := ts.Credentials(identity)
			servers = append(servers, acICEServer{
				URLs:       urls,
				Username:   username,
				Credential: credential,
			})
		}
	}

	return acICEConfig{ICEServers: servers}
}

// acLoadICEOverride reads the optional operator override file. It returns
// ok=false when the file is absent, unreadable, malformed, or empty.
func acLoadICEOverride() ([]acICEServer, bool) {
	data, err := os.ReadFile(arozcastICEOverrideFile)
	if err != nil {
		return nil, false
	}
	var parsed acICEConfig
	if err := json.Unmarshal(data, &parsed); err != nil {
		systemWideLogger.PrintAndLog("Arozcast", "Ignoring malformed "+arozcastICEOverrideFile, err)
		return nil, false
	}
	if len(parsed.ICEServers) == 0 {
		return nil, false
	}
	return parsed.ICEServers, true
}

// acDeriveTURNHost determines the host clients should dial for the TURN relay,
// using the same host the client used to reach ArozOS (honouring a reverse
// proxy's X-Forwarded-Host) so it stays reachable. The port is stripped — the
// relay listens on its own port.
func acDeriveTURNHost(r *http.Request) string {
	host := r.Host
	if xfh := r.Header.Get("X-Forwarded-Host"); xfh != "" {
		if idx := strings.Index(xfh, ","); idx >= 0 {
			xfh = xfh[:idx] // first entry is the original client-facing host
		}
		host = strings.TrimSpace(xfh)
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return host
}
