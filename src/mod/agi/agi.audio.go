package agi

import (
	"log"

	"imuslab.com/arozos/mod/agi/static"
)

/*
	AJGI Audio Library

	This is a library for allowing audio playback from AGI script
	Powered by Go Beep and the usage might be a bit tricky

	Author: tobychui

*/

func (g *Gateway) AudioLibRegister() {
	err := g.RegisterLib("audio", g.injectAudioFunctions)
	if err != nil {
		log.Fatal(err)
	}
}

func (g *Gateway) injectAudioFunctions(payload *static.AgiLibInjectionPayload) {
	//vm := payload.VM
	//u := payload.User
	//scriptFsh := payload.ScriptFsh
	//scriptPath := payload.ScriptPath
	//w := payload.Writer
	//r := payload.Request

}
