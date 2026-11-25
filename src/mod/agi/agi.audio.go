package agi

import (
	"fmt"
	"os"

	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	AJGI Audio Library

	This is a library for allowing audio playback from AGI script
	Powered by Go Beep and the usage might be a bit tricky

	Author: tobychui

*/

func (g *Gateway) AudioLibRegister() {
	logger.Debug("agi", "Gateway.AudioLibRegister")
	err := g.RegisterLib("audio", g.injectAudioFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

func (g *Gateway) injectAudioFunctions(payload *static.AgiLibInjectionPayload) {
	logger.DebugTrace("agi", "Gateway.injectAudioFunctions")
	//vm := payload.VM
	//u := payload.User
	//scriptFsh := payload.ScriptFsh
	//scriptPath := payload.ScriptPath
	//w := payload.Writer
	//r := payload.Request

}
