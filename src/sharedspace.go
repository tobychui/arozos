package main

/*
	SharedSpace - Shared collaboration area wiring
	author: tobychui / AI assisted

	Creates the system-wide shared space manager (mod/sharedspace): an
	in-memory area where multiple different users can share texts, images
	and files together. It is consumed by the AGI "sharedspace" library
	(scripts create / read / post into spaces) and by MeetRoom, which
	binds one space to every meeting room.

	Must be initiated before MeetRoomInit and AGIInit (see startup.go).
*/

import (
	"imuslab.com/arozos/mod/sharedspace"
)

var sharedSpaceManager *sharedspace.Manager

// SharedSpaceInit creates the shared collaboration space manager.
func SharedSpaceInit() {
	sharedSpaceManager = sharedspace.NewManager("", 0)
}
