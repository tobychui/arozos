package agi

import (
	"log"
	"net/http"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/filesystem"
	user "imuslab.com/arozos/mod/user"
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

func (g *Gateway) injectAudioFunctions(vm *otto.Otto, u *user.User, scriptFsh *filesystem.FileSystemHandler, scriptPath string, w http.ResponseWriter, r *http.Request) {

}
