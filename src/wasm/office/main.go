//go:build js && wasm

/*
office.wasm - the Office format converters, in the browser
=========================================================

Built for the standalone web edition ("ArozOS Office Web"), where there is
no ArozOS server to run the AGI backends. This bridge exposes the same
conversions the office AGI library offers, under the same names, so a
call site names one converter for both hosts:

	globalThis.__officeWasm = {
	    version:  "1",
	    importers: ["docxToDocument", ...],
	    exporters: ["documentToDocx", ...],

	    // Uint8Array -> {ok:true, json:"..."} | {ok:false, error:"..."}
	    runImport(name, bytes),

	    // json string  -> {ok:true, data:Uint8Array, mediaZip:Uint8Array|null}
	    //              |  {ok:false, error:"..."}
	    runExport(name, jsonStr)
	}

	globalThis.__officeWasmReady()   // called once the table above is up

Both calls are synchronous. Go's wasm runtime shares the JavaScript event
loop, so handing the work to a goroutine would not free the main thread -
it would only make the API harder to use. The front end paints its busy
overlay and yields a frame before calling in (see common/wasm.js).

Build:  cd src && GOOS=js GOARCH=wasm go build -o office.wasm ./wasm/office

	(apps/ArozOS Office Web/generate.go -wasm does this for you)
*/
package main

import (
	"syscall/js"
)

const bridgeVersion = "1"

// jsError is the shape every failure comes back as: the front end shows
// .error verbatim, so it must read as a sentence a person can act on.
func jsError(err error) map[string]interface{} {
	return map[string]interface{}{"ok": false, "error": err.Error()}
}

// toUint8Array copies Go bytes into a fresh JS Uint8Array. js.CopyBytesToJS
// needs a real typed array on the JS side, so one is allocated first.
func toUint8Array(b []byte) js.Value {
	arr := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(arr, b)
	return arr
}

func fromUint8Array(v js.Value) []byte {
	n := v.Get("length").Int()
	b := make([]byte, n)
	js.CopyBytesToGo(b, v)
	return b
}

func stringSlice(list []string) []interface{} {
	out := make([]interface{}, len(list))
	for i, s := range list {
		out[i] = s
	}
	return out
}

// recoverTo turns a panic anywhere in the converters into a normal error
// result. A malformed file must never take the whole module down: the Go
// runtime cannot restart inside the page, so a panic would leave every later
// conversion dead until the tab is reloaded.
func recoverTo(result *interface{}) {
	if r := recover(); r != nil {
		msg := "conversion failed"
		if e, ok := r.(error); ok {
			msg = "conversion failed: " + e.Error()
		} else if s, ok := r.(string); ok {
			msg = "conversion failed: " + s
		}
		*result = map[string]interface{}{"ok": false, "error": msg}
	}
}

func runImport(this js.Value, args []js.Value) (result interface{}) {
	defer recoverTo(&result)
	if len(args) < 2 {
		return map[string]interface{}{"ok": false, "error": "runImport(name, bytes) needs two arguments"}
	}
	name := args[0].String()
	data := fromUint8Array(args[1])
	jsonStr, err := RunImport(name, data)
	if err != nil {
		return jsError(err)
	}
	return map[string]interface{}{"ok": true, "json": jsonStr}
}

func runExport(this js.Value, args []js.Value) (result interface{}) {
	defer recoverTo(&result)
	if len(args) < 2 {
		return map[string]interface{}{"ok": false, "error": "runExport(name, json) needs two arguments"}
	}
	name := args[0].String()
	jsonStr := args[1].String()
	data, mediaZip, err := RunExport(name, jsonStr)
	if err != nil {
		return jsError(err)
	}
	out := map[string]interface{}{"ok": true, "data": toUint8Array(data)}
	if len(mediaZip) > 0 {
		// .pptx keeps video and audio in a sidecar zip rather than embedding
		// them - the front end offers it as a second download
		out["mediaZip"] = toUint8Array(mediaZip)
	} else {
		out["mediaZip"] = nil
	}
	return out
}

func main() {
	in, out := ConverterNames()
	js.Global().Set("__officeWasm", map[string]interface{}{
		"version":   bridgeVersion,
		"importers": stringSlice(in),
		"exporters": stringSlice(out),
		"runImport": js.FuncOf(runImport),
		"runExport": js.FuncOf(runExport),
	})

	// the loader waits on this rather than polling for __officeWasm
	if cb := js.Global().Get("__officeWasmReady"); cb.Type() == js.TypeFunction {
		cb.Invoke()
	}

	// keep the module alive: returning from main would free the functions
	// registered above and every later call would hit a released FuncOf
	select {}
}
