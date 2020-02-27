// Copyright 2013 The Gorilla WebSocket Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package main

import (
	"flag"
	"log"
	"net/http"
	"github.com/rs/cors"
)

var addr = flag.String("port", ":8080", "HTTP service address")
var endpt = flag.String("endpt","http://localhost/AOB/SystemAOB/system/jwt/validate.php", "ShadowJWT Validation Endpoint")

func serveHome(w http.ResponseWriter, r *http.Request) {
	log.Println(r.URL)
	if r.URL.Path != "/" {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	http.ServeFile(w, r, "home.html")
}


func main() {
	flag.Parse()
	hub := newHub()
	go hub.run()

	mux := http.NewServeMux()
	mux.HandleFunc("/", serveHome)
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		serveWs(hub, w, r)
	})
	/*
	http.HandleFunc("/", serveHome)
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		serveWs(hub, w, r)
	})
	*/
	handler := cors.Default().Handler(mux)
	err := http.ListenAndServe(*addr, handler)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
