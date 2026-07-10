package main

/*
	MeetRoom - Video conferencing backend endpoints
	author: tobychui / AI assisted

	HTTP + WebSocket wiring for the MeetRoom WebApp (web/MeetRoom). Room
	state lives in mod/meetroom; this file exposes it to logged-in users:

	  POST /system/meetroom/create      title=&password=      --> {"roomid":"...","title":"..."}
	  POST /system/meetroom/join        roomid=&password=     --> room info (pre-flight check)
	  GET  /system/meetroom/info?roomid=XXXXXXXXX             --> {"exists":..,"protected":..}
	  GET  /system/meetroom/ws?roomid=&password=              --> WebSocket signaling upgrade
	  POST /system/meetroom/upload      multipart (file)      --> {"fileid":...}
	  GET  /system/meetroom/download?roomid=&password=&fileid=
	  GET  /system/meetroom/end?roomid=                       --> host ends the meeting
	  GET  /system/meetroom/iceservers                        --> WebRTC ICE config

	Signaling protocol (JSON frames over the WebSocket):
	  client -> server: {"type":"signal","to":peerid,"data":{...}}   SDP/ICE relay
	                    {"type":"chat","text":"..."}
	                    {"type":"file","fileid":"..."}               announce uploaded file
	                    {"type":"state","audio":b,"video":b,"screen":b}
	                    {"type":"ping"}                              app-level heartbeat
	                    {"type":"end"}                               host only
	  server -> client: {"type":"welcome",...}, {"type":"peer-join",...},
	                    {"type":"peer-leave",...}, {"type":"signal","from":..},
	                    {"type":"chat",...}, {"type":"file",...},
	                    {"type":"state",...}, {"type":"pong"},
	                    {"type":"room-closed"}

	Liveness: the server sends a WebSocket protocol ping every
	mrPingInterval and enforces mrReadTimeout as a read deadline (refreshed
	by pongs and by any incoming frame), so a silently dead client is
	removed from the room after at most mrReadTimeout. The client keeps its
	own app-level ping/pong heartbeat and auto-reconnects with backoff when
	the socket drops (see web/MeetRoom/app.js).

	Media never touches the server: clients negotiate WebRTC peer-to-peer
	connections through this relay, using the same STUN/TURN configuration
	as Arozcast screen share (see cast.go acBuildICEConfig).
*/

import (
	"encoding/json"
	"mime"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"imuslab.com/arozos/mod/meetroom"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

const (
	mrMaxChatLength  = 4000             // runes per chat message
	mrMaxSocketFrame = 512 << 10        // 512KB per signaling frame (SDP blobs included)
	mrSweepInterval  = 30 * time.Second // idle room sweep cadence
	mrPingInterval   = 20 * time.Second // server keepalive ping cadence on signaling sockets
	mrReadTimeout    = 60 * time.Second // drop a participant whose socket goes silent this long
	mrWriteTimeout   = 10 * time.Second // per-frame write deadline on signaling sockets
)

var (
	meetRoomManager  *meetroom.Manager
	meetRoomUpgrader = websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin:     func(r *http.Request) bool { return true },
	}
)

// mrPeerInfo is the participant descriptor shared with clients.
type mrPeerInfo struct {
	PeerID   int    `json:"peerid"`
	Username string `json:"username"`
	IsHost   bool   `json:"isHost"`
}

// mrRoomInfo is the room descriptor shared with clients.
type mrRoomInfo struct {
	ID        string `json:"id"`
	DisplayID string `json:"displayid"`
	Title     string `json:"title"`
	Host      string `json:"host"`
	Protected bool   `json:"protected"`
}

func mrDescribeRoom(room *meetroom.Room) mrRoomInfo {
	return mrRoomInfo{
		ID:        room.ID,
		DisplayID: meetroom.FormatRoomID(room.ID),
		Title:     room.Title,
		Host:      room.Host,
		Protected: room.HasPassword(),
	}
}

// mrMarshalOrDrop marshals v, returning nil when marshalling fails (the
// frame is simply not sent - all inputs are server-constructed).
func mrMarshalOrDrop(v interface{}) []byte {
	js, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return js
}

// mrEndMeeting broadcasts room-closed and tears the room down.
func mrEndMeeting(roomID string) {
	room, ok := meetRoomManager.GetRoom(roomID)
	if !ok {
		return
	}
	room.Broadcast([]byte(`{"type":"room-closed"}`), -1)
	meetRoomManager.CloseRoom(roomID)
}

// MeetRoomInit wires up the MeetRoom video conferencing endpoints.
func MeetRoomInit() {
	meetRoomManager = meetroom.NewManager("")

	//Sweep abandoned rooms so forgotten meetings do not accumulate
	go func() {
		ticker := time.NewTicker(mrSweepInterval)
		defer ticker.Stop()
		for range ticker.C {
			meetRoomManager.SweepIdleRooms(meetroom.DefaultEmptyIdle)
		}
	}()

	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "MeetRoom",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})

	//Create a new meeting room; the creator becomes the host.
	router.HandleFunc("/system/meetroom/create", func(w http.ResponseWriter, r *http.Request) {
		userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "Not logged in")
			return
		}
		title, _ := utils.PostPara(r, "title")
		password, _ := utils.PostPara(r, "password")

		room := meetRoomManager.CreateRoom(userinfo.Username, title, password)
		js := mrMarshalOrDrop(map[string]interface{}{
			"roomid":    room.ID,
			"displayid": meetroom.FormatRoomID(room.ID),
			"title":     room.Title,
		})
		utils.SendJSONResponse(w, string(js))
	})

	//Pre-flight join check: validates room ID + password before the client
	//acquires media devices and opens the signaling socket.
	router.HandleFunc("/system/meetroom/join", func(w http.ResponseWriter, r *http.Request) {
		roomID, err := utils.PostPara(r, "roomid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing room ID")
			return
		}
		password, _ := utils.PostPara(r, "password")

		room, err := meetRoomManager.ValidateJoin(meetroom.NormalizeRoomID(roomID), password)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		js := mrMarshalOrDrop(map[string]interface{}{
			"room":         mrDescribeRoom(room),
			"participants": room.ParticipantCount(),
		})
		utils.SendJSONResponse(w, string(js))
	})

	//Room existence probe for the lobby (no password required; reveals only
	//whether the room exists and needs a password).
	router.HandleFunc("/system/meetroom/info", func(w http.ResponseWriter, r *http.Request) {
		roomID, err := utils.GetPara(r, "roomid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing room ID")
			return
		}
		room, ok := meetRoomManager.GetRoom(meetroom.NormalizeRoomID(roomID))
		if !ok {
			utils.SendJSONResponse(w, `{"exists":false}`)
			return
		}
		js := mrMarshalOrDrop(map[string]interface{}{
			"exists":       true,
			"protected":    room.HasPassword(),
			"title":        room.Title,
			"participants": room.ParticipantCount(),
		})
		utils.SendJSONResponse(w, string(js))
	})

	//Host ends the meeting for everyone.
	router.HandleFunc("/system/meetroom/end", func(w http.ResponseWriter, r *http.Request) {
		userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "Not logged in")
			return
		}
		roomID, err := utils.GetPara(r, "roomid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing room ID")
			return
		}
		room, ok := meetRoomManager.GetRoom(meetroom.NormalizeRoomID(roomID))
		if !ok {
			utils.SendErrorResponse(w, "Room not found")
			return
		}
		if room.Host != userinfo.Username {
			utils.SendErrorResponse(w, "Only the host can end the meeting")
			return
		}
		mrEndMeeting(room.ID)
		utils.SendOK(w)
	})

	//ICE servers for the WebRTC mesh - shares Arozcast's STUN/TURN setup so
	//the built-in TURN relay (System Settings > Screen Share Relay) also
	//carries MeetRoom calls across NAT.
	router.HandleFunc("/system/meetroom/iceservers", func(w http.ResponseWriter, r *http.Request) {
		identity := ""
		if userinfo, err := userHandler.GetUserInfoFromRequest(w, r); err == nil {
			identity = userinfo.Username
		}
		js := mrMarshalOrDrop(acBuildICEConfig(r, identity))
		if js == nil {
			utils.SendErrorResponse(w, "Failed to build ICE config")
			return
		}
		utils.SendJSONResponse(w, string(js))
	})

	//Attachment upload: multipart form with roomid, password and file.
	router.HandleFunc("/system/meetroom/upload", func(w http.ResponseWriter, r *http.Request) {
		userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "Not logged in")
			return
		}
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			utils.SendErrorResponse(w, "Invalid upload")
			return
		}
		roomID := meetroom.NormalizeRoomID(r.FormValue("roomid"))
		password := r.FormValue("password")
		if _, err := meetRoomManager.ValidateJoin(roomID, password); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			utils.SendErrorResponse(w, "Missing file")
			return
		}
		defer file.Close()

		attachment, err := meetRoomManager.SaveAttachment(roomID, header.Filename, userinfo.Username, file, meetroom.DefaultMaxUpload)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		js := mrMarshalOrDrop(map[string]interface{}{
			"fileid": attachment.ID,
			"name":   attachment.Name,
			"size":   attachment.Size,
		})
		utils.SendJSONResponse(w, string(js))
	})

	//Attachment download for room members.
	router.HandleFunc("/system/meetroom/download", func(w http.ResponseWriter, r *http.Request) {
		roomID := meetroom.NormalizeRoomID(r.URL.Query().Get("roomid"))
		password := r.URL.Query().Get("password")
		fileID, err := utils.GetPara(r, "fileid")
		if err != nil {
			utils.SendErrorResponse(w, "Missing file ID")
			return
		}
		if _, err := meetRoomManager.ValidateJoin(roomID, password); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		attachment, ok := meetRoomManager.GetAttachment(roomID, fileID)
		if !ok {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(attachment.DiskPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()

		//Serve with the original name; the ASCII fallback strips anything
		//that could break the header, the RFC 5987 form keeps unicode names.
		fallback := strings.Map(func(c rune) rune {
			if c < 32 || c == '"' || c == '\\' || c > 126 {
				return '_'
			}
			return c
		}, attachment.Name)
		w.Header().Set("Content-Disposition", "attachment; filename=\""+fallback+"\"; filename*=UTF-8''"+url.PathEscape(attachment.Name))
		if ctype := mime.TypeByExtension(strings.ToLower(filepathExt(attachment.Name))); ctype != "" {
			w.Header().Set("Content-Type", ctype)
		} else {
			w.Header().Set("Content-Type", "application/octet-stream")
		}
		http.ServeContent(w, r, "", time.Now(), f)
	})

	//WebSocket signaling relay.
	router.HandleFunc("/system/meetroom/ws", func(w http.ResponseWriter, r *http.Request) {
		userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
		if err != nil {
			http.Error(w, "Not logged in", http.StatusUnauthorized)
			return
		}
		roomID := meetroom.NormalizeRoomID(r.URL.Query().Get("roomid"))
		password := r.URL.Query().Get("password")

		room, err := meetRoomManager.ValidateJoin(roomID, password)
		if err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}

		conn, err := meetRoomUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		conn.SetReadLimit(mrMaxSocketFrame)

		//Liveness: a client that goes silent (no frames and no pong
		//replies) past mrReadTimeout is dropped so it does not linger as a
		//ghost participant after a network failure.
		conn.SetReadDeadline(time.Now().Add(mrReadTimeout))
		conn.SetPongHandler(func(string) error {
			conn.SetReadDeadline(time.Now().Add(mrReadTimeout))
			return nil
		})

		participant, err := room.AddParticipant(userinfo.Username)
		if err != nil {
			conn.Close()
			return
		}

		//Writer: drain the send channel until it is closed, interleaving
		//keepalive pings, then hang up.
		go func() {
			pinger := time.NewTicker(mrPingInterval)
			defer pinger.Stop()
			defer conn.Close()
			for {
				select {
				case msg, ok := <-participant.Send:
					if !ok {
						return
					}
					conn.SetWriteDeadline(time.Now().Add(mrWriteTimeout))
					if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
						return
					}
				case <-pinger.C:
					conn.SetWriteDeadline(time.Now().Add(mrWriteTimeout))
					if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
						return
					}
				}
			}
		}()

		//Welcome frame: own identity, room descriptor and current peers.
		peers := []mrPeerInfo{}
		for _, p := range room.Participants() {
			if p.PeerID == participant.PeerID {
				continue
			}
			peers = append(peers, mrPeerInfo{PeerID: p.PeerID, Username: p.Username, IsHost: p.IsHost})
		}
		room.SendTo(participant.PeerID, mrMarshalOrDrop(map[string]interface{}{
			"type":     "welcome",
			"peerid":   participant.PeerID,
			"username": participant.Username,
			"isHost":   participant.IsHost,
			"room":     mrDescribeRoom(room),
			"peers":    peers,
		}))

		//Announce the newcomer to everyone else.
		room.Broadcast(mrMarshalOrDrop(map[string]interface{}{
			"type": "peer-join",
			"peer": mrPeerInfo{PeerID: participant.PeerID, Username: participant.Username, IsHost: participant.IsHost},
		}), participant.PeerID)

		defer func() {
			//The participant may already be gone if the room was closed.
			if _, stillHere := room.GetParticipant(participant.PeerID); stillHere {
				room.RemoveParticipant(participant.PeerID)
				room.Broadcast(mrMarshalOrDrop(map[string]interface{}{
					"type":     "peer-leave",
					"peerid":   participant.PeerID,
					"username": participant.Username,
				}), -1)
			}
			participant.CloseSend()
		}()

		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				return
			}
			conn.SetReadDeadline(time.Now().Add(mrReadTimeout))
			var frame struct {
				Type   string          `json:"type"`
				To     int             `json:"to"`
				Data   json.RawMessage `json:"data"`
				Text   string          `json:"text"`
				FileID string          `json:"fileid"`
				Audio  bool            `json:"audio"`
				Video  bool            `json:"video"`
				Screen bool            `json:"screen"`
			}
			if json.Unmarshal(raw, &frame) != nil {
				continue
			}
			room.Touch()

			switch frame.Type {
			case "signal":
				//SDP / ICE relay to a single peer
				room.SendTo(frame.To, mrMarshalOrDrop(map[string]interface{}{
					"type": "signal",
					"from": participant.PeerID,
					"data": frame.Data,
				}))
			case "chat":
				text := frame.Text
				if strings.TrimSpace(text) == "" {
					continue
				}
				if runes := []rune(text); len(runes) > mrMaxChatLength {
					text = string(runes[:mrMaxChatLength])
				}
				room.Broadcast(mrMarshalOrDrop(map[string]interface{}{
					"type":     "chat",
					"from":     participant.PeerID,
					"username": participant.Username,
					"text":     text,
					"time":     time.Now().Unix(),
				}), -1)
			case "file":
				attachment, ok := meetRoomManager.GetAttachment(room.ID, frame.FileID)
				if !ok {
					continue
				}
				room.Broadcast(mrMarshalOrDrop(map[string]interface{}{
					"type":     "file",
					"from":     participant.PeerID,
					"username": participant.Username,
					"fileid":   attachment.ID,
					"name":     attachment.Name,
					"size":     attachment.Size,
					"time":     time.Now().Unix(),
				}), -1)
			case "state":
				//Mic / camera / screen share indicator update
				room.Broadcast(mrMarshalOrDrop(map[string]interface{}{
					"type":   "state",
					"from":   participant.PeerID,
					"audio":  frame.Audio,
					"video":  frame.Video,
					"screen": frame.Screen,
				}), participant.PeerID)
			case "ping":
				//App-level heartbeat: lets the client detect a half-dead
				//connection and trigger its auto-reconnect logic.
				room.SendTo(participant.PeerID, []byte(`{"type":"pong"}`))
			case "end":
				if participant.IsHost {
					mrEndMeeting(room.ID)
					return
				}
			}
		}
	})
}

// filepathExt returns the extension of a display file name (which never
// contains a path separator by the time it reaches the server).
func filepathExt(name string) string {
	if idx := strings.LastIndex(name, "."); idx >= 0 {
		return name[idx:]
	}
	return ""
}
