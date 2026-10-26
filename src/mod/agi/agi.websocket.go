package agi

import (
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/robertkrimen/otto"
	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/info/logger"
	user "imuslab.com/arozos/mod/user"
)

/*
AJGI WebSocket Request Library

This is a library for allowing AGI based connection upgrade to WebSocket.
Different from other agi modules, this does not use the register lib interface
due to its special nature.

New functions exposed to AGI scripts:

  websocket.upgrade(timeoutSec)
    Upgrades the connection and overrides delay() with a message-pumping version
    so that websocket.onMessage fires naturally during pauses.

  websocket.send(text)         --> bool
  websocket.read(timeoutMs?)   --> string | null | false
    timeoutMs = 0 / omitted --> block until message arrives or connection closes
    timeoutMs > 0           --> return null on timeout (connection still open)
    returns false           --> connection is closed

  websocket.available()        --> int
    Number of messages currently waiting in the inbound buffer. Non-blocking.

  websocket.isClosed()         --> bool
    true when the connection is no longer active.

  websocket.onMessage          --> assign function(msg) to receive messages
    msg = { data: string, timestamp: int64 ms, type: int }
    Fired inside delay() on the script's own goroutine — Otto-safe.

  websocket.close()

Author: tobychui
*/

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// wsMsg is a single inbound WebSocket frame delivered to the AGI script.
type wsMsg struct {
	Data      string // text payload
	Timestamp int64  // arrival time as unix milliseconds
	Type      int    // gorilla message type (1 = text, 2 = binary)
}

// wsConn wraps a gorilla websocket.Conn with a buffered inbound message channel.
// All fields shared across goroutines are accessed via atomics or the channel itself.
// The Otto VM is NEVER touched from any goroutine other than the main script goroutine.
type wsConn struct {
	conn        *websocket.Conn
	msgChan     chan wsMsg // filled by the background reader goroutine
	closed      int32      // 1 when closed; use atomic load/store
	lastOprTime int64      // unix seconds of last activity; use atomic load/store
}

func newWsConn(c *websocket.Conn) *wsConn {
	wsc := &wsConn{
		conn:    c,
		msgChan: make(chan wsMsg, 128),
	}
	atomic.StoreInt64(&wsc.lastOprTime, time.Now().Unix())
	return wsc
}

func (w *wsConn) isClosed() bool    { return atomic.LoadInt32(&w.closed) == 1 }
func (w *wsConn) markClosed()       { atomic.StoreInt32(&w.closed, 1) }
func (w *wsConn) touchLastOpr()     { atomic.StoreInt64(&w.lastOprTime, time.Now().Unix()) }
func (w *wsConn) getLastOpr() int64 { return atomic.LoadInt64(&w.lastOprTime) }

var connections = sync.Map{}

// checkWebSocketConnectionUpgradeStatus returns whether the current VM has an
// active WebSocket connection.  Returns (active, connID, *wsConn).
func checkWebSocketConnectionUpgradeStatus(vm *otto.Otto) (bool, string, *wsConn) {
	value, err := vm.Get("_websocket_conn_id")
	if err != nil || value.IsUndefined() || value.IsNull() {
		return false, "", nil
	}
	connId, err := value.ToString()
	if err != nil || connId == "" {
		return false, "", nil
	}
	raw, ok := connections.Load(connId)
	if !ok {
		return false, "", nil
	}
	wsc := raw.(*wsConn)
	if wsc.isClosed() {
		return false, connId, nil
	}
	return true, connId, wsc
}

// cleanupWsConn sends a close frame, closes the raw connection, and removes the
// connection from both the sync.Map and the VM.
// MUST be called from the main (script) goroutine so vm.Set is safe.
func cleanupWsConn(vm *otto.Otto, connID string, wsc *wsConn) {
	if !wsc.isClosed() {
		wsc.markClosed()
		wsc.conn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		)
		time.Sleep(150 * time.Millisecond)
		wsc.conn.Close()
	}
	vm.Set("_websocket_conn_id", otto.UndefinedValue())
	connections.Delete(connID)
}

// dispatchOnMessage calls websocket.onMessage(msg) on the script goroutine.
// Passing data through vm.Set avoids the complexities of otto.Value.Call.
// MUST be called from the main (script) goroutine.
func dispatchOnMessage(vm *otto.Otto, msg wsMsg) {
	vm.Set("_ws_incoming", map[string]interface{}{
		"data":      msg.Data,
		"timestamp": msg.Timestamp,
		"type":      msg.Type,
	})
	if _, err := vm.Run(`
		if (typeof websocket !== 'undefined' && typeof websocket.onMessage === 'function') {
			websocket.onMessage(_ws_incoming);
		}
	`); err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint("*AGI WebSocket* onMessage handler error:", err), nil)
	}
	vm.Set("_ws_incoming", otto.UndefinedValue())
}

func (g *Gateway) injectWebSocketFunctions(vm *otto.Otto, u *user.User, w http.ResponseWriter, r *http.Request) {

	// ── websocket.upgrade(timeoutSeconds) ────────────────────────────────────
	vm.Set("_websocket_upgrade", func(call otto.FunctionCall) otto.Value {
		timeout, err := call.Argument(0).ToInteger()
		if err != nil || timeout <= 0 {
			timeout = 300
		}

		if connState, _, _ := checkWebSocketConnectionUpgradeStatus(vm); connState {
			return otto.TrueValue() // already upgraded
		}

		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			logger.PrintAndLog("Agi", fmt.Sprint("*AGI WebSocket* upgrade failed:", err), nil)
			return otto.FalseValue()
		}

		wsc := newWsConn(c)
		connUUID := uuid.NewV4().String()
		connections.Store(connUUID, wsc)
		vm.Set("_websocket_conn_id", connUUID)

		// Background reader — feeds all inbound frames into msgChan.
		// Never touches the Otto VM; only updates wsc atomics and the channel.
		go func() {
			defer func() {
				wsc.markClosed()
				close(wsc.msgChan)
				// Do NOT call vm.Set here — Otto is not goroutine-safe.
			}()
			for {
				msgType, message, err := c.ReadMessage()
				if err != nil {
					return // connection closed or error
				}
				wsc.touchLastOpr()
				select {
				case wsc.msgChan <- wsMsg{
					Data:      string(message),
					Timestamp: time.Now().UnixMilli(),
					Type:      msgType,
				}:
				default:
					logger.PrintAndLog("Agi", "*AGI WebSocket* inbound buffer full, dropping frame", nil)
				}
			}
		}()

		// Idle-timeout watcher — closes the raw connection when no activity.
		// Does NOT touch the VM; closing the connection causes the reader to exit.
		go func() {
			ticker := time.NewTicker(1 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				if wsc.isClosed() {
					return
				}
				if time.Now().Unix()-wsc.getLastOpr() > timeout {
					logger.PrintAndLog("Agi", "*AGI WebSocket* idle timeout — closing connection", nil)
					c.Close()
					return
				}
			}
		}()

		// Override delay() so that websocket.onMessage callbacks fire naturally
		// inside pauses without the user needing an explicit poll() call.
		vm.Run(`
			var _ws_orig_delay = (typeof delay === 'function') ? delay : function(ms){};
			delay = function(ms){ _websocket_pump_messages(ms); };
		`)

		return otto.TrueValue()
	})

	// ── websocket.send(text) ─────────────────────────────────────────────────
	vm.Set("_websocket_send", func(call otto.FunctionCall) otto.Value {
		content, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		connState, connID, wsc := checkWebSocketConnectionUpgradeStatus(vm)
		if !connState {
			return otto.FalseValue()
		}
		if err := wsc.conn.WriteMessage(websocket.TextMessage, []byte(content)); err != nil {
			cleanupWsConn(vm, connID, wsc)
			return otto.FalseValue()
		}
		wsc.touchLastOpr()
		return otto.TrueValue()
	})

	// ── websocket.read(timeout ms) ───────────────────────────────────────────
	// timeoutMs = 0 or omitted --> block until a message arrives or socket closes
	// timeoutMs > 0            --> return null if no message within that many ms
	// Returns: string on message · null on timeout · false if connection closed
	vm.Set("_websocket_read", func(call otto.FunctionCall) otto.Value {
		timeoutMs, _ := call.Argument(0).ToInteger()

		connState, connID, wsc := checkWebSocketConnectionUpgradeStatus(vm)
		if !connState {
			if connID != "" {
				// Stale entry — tidy up from the main goroutine
				vm.Set("_websocket_conn_id", otto.UndefinedValue())
				connections.Delete(connID)
			}
			return otto.FalseValue()
		}

		var msg wsMsg
		var ok bool

		if timeoutMs > 0 {
			select {
			case msg, ok = <-wsc.msgChan:
			case <-time.After(time.Duration(timeoutMs) * time.Millisecond):
				return otto.NullValue() // timed out; connection still open
			}
		} else {
			msg, ok = <-wsc.msgChan // block until message or channel close
		}

		if !ok {
			// Channel closed — background reader exited (connection gone)
			cleanupWsConn(vm, connID, wsc)
			return otto.FalseValue()
		}

		wsc.touchLastOpr()
		v, err := otto.ToValue(msg.Data)
		if err != nil {
			return otto.NullValue()
		}
		return v
	})

	// ── websocket.available() ────────────────────────────────────────────────
	// Returns the number of messages currently waiting in the inbound buffer.
	// Non-blocking — safe to poll in a tight loop.
	vm.Set("_websocket_available", func(call otto.FunctionCall) otto.Value {
		_, _, wsc := checkWebSocketConnectionUpgradeStatus(vm)
		count := 0
		if wsc != nil {
			count = len(wsc.msgChan)
		}
		v, _ := otto.ToValue(count)
		return v
	})

	// ── websocket.isClosed() ─────────────────────────────────────────────────
	// Returns true when the WebSocket connection is no longer active.
	vm.Set("_websocket_is_closed", func(call otto.FunctionCall) otto.Value {
		connState, _, _ := checkWebSocketConnectionUpgradeStatus(vm)
		if connState {
			return otto.FalseValue()
		}
		return otto.TrueValue()
	})

	// ── _websocket_pump_messages(ms) ─────────────────────────────────────────
	// Replaces delay() after upgrade.  Sleeps for ms milliseconds while
	// dispatching any queued messages to websocket.onMessage.
	// All JS execution happens on this (main script) goroutine — Otto-safe.
	//
	// Important: messages are only consumed from the buffer when onMessage is
	// actually a function.  When it is null/undefined the function falls back to
	// a plain sleep so that websocket.available() / websocket.read() can still
	// see the queued frames afterwards (Mode 2 / manual-read patterns).
	vm.Set("_websocket_pump_messages", func(call otto.FunctionCall) otto.Value {
		ms, err := call.Argument(0).ToInteger()
		if err != nil || ms < 0 {
			ms = 0
		}

		_, _, wsc := checkWebSocketConnectionUpgradeStatus(vm)
		if wsc == nil {
			// No active WebSocket — fall back to plain sleep
			if ms > 0 {
				time.Sleep(time.Duration(ms) * time.Millisecond)
			}
			return otto.UndefinedValue()
		}

		// Check once whether a handler is registered.  We evaluate in JS so
		// that the typeof check is unambiguous regardless of Otto internals.
		hasHandlerVal, _ := vm.Run(`typeof websocket !== 'undefined' && typeof websocket.onMessage === 'function'`)
		hasHandler, _ := hasHandlerVal.ToBoolean()
		if !hasHandler {
			// No handler — plain sleep; leave messages in the buffer untouched.
			if ms > 0 {
				time.Sleep(time.Duration(ms) * time.Millisecond)
			}
			return otto.UndefinedValue()
		}

		const tickSize = 20 * time.Millisecond
		deadline := time.Now().Add(time.Duration(ms) * time.Millisecond)

		for {
			remaining := time.Until(deadline)
			if remaining <= 0 {
				break
			}
			tick := tickSize
			if remaining < tick {
				tick = remaining
			}

			select {
			case msg, ok := <-wsc.msgChan:
				if !ok {
					// Connection closed while waiting — stop pumping
					return otto.UndefinedValue()
				}
				wsc.touchLastOpr()
				dispatchOnMessage(vm, msg)

			case <-time.After(tick):
				// No message in this 20 ms slice — keep waiting
			}
		}
		return otto.UndefinedValue()
	})

	// ── websocket.close() ────────────────────────────────────────────────────
	vm.Set("_websocket_close", func(call otto.FunctionCall) otto.Value {
		connState, connID, wsc := checkWebSocketConnectionUpgradeStatus(vm)
		if !connState {
			return otto.FalseValue()
		}
		cleanupWsConn(vm, connID, wsc)
		return otto.TrueValue()
	})

	// ── JS wrapper ───────────────────────────────────────────────────────────
	vm.Run(`
		var websocket = {};
		websocket.upgrade   = _websocket_upgrade;
		websocket.send      = _websocket_send;
		websocket.read      = _websocket_read;
		websocket.close     = _websocket_close;
		websocket.available = _websocket_available;
		websocket.isClosed  = _websocket_is_closed;

		// Assign a function(msg) here to receive messages asynchronously.
		// msg = { data: string, timestamp: number, type: number }
		// The handler fires inside delay() after websocket.upgrade() is called.
		websocket.onMessage = null;
	`)
}
