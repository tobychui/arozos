package agi

import (
	"errors"
	"log"

	"imuslab.com/arozos/mod/agi/static"
	apt "imuslab.com/arozos/mod/apt"
)

/*
	AGI Module Manager

	This interface handles the agi function module registartions
	and make sure the structures of all modules fits the pre-defined
	interface to be used by ArozOS Core system
*/

// Lib interface, require vm, user, target system file handler and the vpath of the running script
// This interface is called during injection (in user's term, require / import)
// When called, the required agi function module will be injected into the virtual machine
// which provide the function required for the vm code to interact with the real-systems
type AgiLibInjectionIntergface func(*static.AgiLibInjectionPayload)

type AgiLibInterface interface {
	GetLibraryID() string                         //Get the module unique name for import
	GetInjectFunction() AgiLibInjectionIntergface //Get the module injection point
}

// Register a library's identification name and its injection interface to the VM environment
func (g *Gateway) RegisterLib(libname string, entryPoint AgiLibInjectionIntergface) error {
	_, ok := g.LoadedAGILibrary[libname]
	if ok {
		//This lib already registered. Return error
		return errors.New("This library name already registered")
	} else {
		g.LoadedAGILibrary[libname] = entryPoint
	}
	return nil
}

/*
	AGI Library Register List

	Add more library here if required
*/

func (g *Gateway) LoadAllFunctionalModules() {
	g.ImageLibRegister()
	g.FileLibRegister()
	g.HTTPLibRegister()
	g.ShareLibRegister()
	g.IoTLibRegister()
	g.AppdataLibRegister()

	//Only register ffmpeg lib if host OS have ffmpeg installed
	ffmpegExists, _ := apt.PackageExists("ffmpeg")
	if ffmpegExists {
		g.FFmpegLibRegister()
	} else {
		log.Println("[AGI] ffmpeg not installed on host OS. Bypassing module.")
	}

}
