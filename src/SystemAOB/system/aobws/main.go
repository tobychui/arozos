// Copyright 2013 The Gorilla WebSocket Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package main

import (
	"flag"
	"log"
	"time"
	"os"
	"net/http"
	"github.com/rs/cors"
	"github.com/marcsauter/single"
)

var addr = flag.String("port", "8000", "HTTP service address")
var endpt = flag.String("endpt","http://localhost/AOB/SystemAOB/system/jwt/validate.php", "ShadowJWT Validation Endpoint")
var useTLS = flag.Bool("tls", false, "Enable TLS support on websocket (aka wss:// instead of ws://). Reqire -cert and -key")
var cert = flag.String("cert","server.crt", "Certification for TLS encription")
var key = flag.String("key","server.key", "Server key for TLS encription")

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

func checkForTerminate(){
	if (fileExists("terminate.inf")){
		os.Remove("terminate.inf");
		os.Exit(0);
	}
}

func fileExists(filename string) bool {
    info, err := os.Stat(filename)
    if os.IsNotExist(err) {
        return false
    }
    return !info.IsDir()
}

func setInterval(someFunc func(), milliseconds int, async bool) chan bool {
	interval := time.Duration(milliseconds) * time.Millisecond
	ticker := time.NewTicker(interval)
	clear := make(chan bool)
	go func() {
		for {
			select {
			case <-ticker.C:
				if async {
					go someFunc()
				} else {
					someFunc()
				}
			case <-clear:
				ticker.Stop()
				return
			}
		}
	}()
	return clear
}

func main() {
	//Parse input flags
	flag.Parse()

	//Set terminate check on auto
	setInterval(checkForTerminate,1000,false)

	//Check if another instance is running
	s := single.New("aobws")
    if err := s.CheckLock(); err != nil && err == single.ErrAlreadyRunning {
        log.Fatal("Another instance of the app is already running, exiting")
    } else if err != nil {
        // Another error occurred, might be worth handling it as well
        log.Fatalf("Failed to acquire exclusive app lock: %v", err)
    }
	defer s.TryUnlock()
	
	//Create new websocket hub
	hub := newHub()
	go hub.run()
	log.Println("ArOZ Online WebSocket Server - CopyRight ArOZ Online Project 2020");
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
	var err error
	if (*useTLS == true){
		err = http.ListenAndServeTLS(":" + *addr, *cert, *key, nil)
	}else{
		err = http.ListenAndServe(":" + *addr, handler)
	}
	
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
