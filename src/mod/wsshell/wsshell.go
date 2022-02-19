package wsshell

import (
	"bufio"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

/*
	Bash Module
	author: tobychui

	This module handles the connection of bash terminal to websocket interface

*/
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type Terminal struct {
	cwd string //Current Working Directory
}

func NewWebSocketShellTerminal() *Terminal {
	baseCWD, _ := filepath.Abs("./")
	upgrader.CheckOrigin = func(r *http.Request) bool { return true }
	return &Terminal{
		cwd: baseCWD,
	}
}

func (t *Terminal) HandleOpen(w http.ResponseWriter, r *http.Request) {
	//Upgrade the connection to WebSocket connection
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Websocket Upgrade Failed"))
		return
	}

	//Check if the system is running on windows or linux. Use cmd and bash
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd")
	} else if runtime.GOOS == "linux" {
		cmd = exec.Command("/bin/bash")
	} else {
		//Currently not supported.
		c.WriteMessage(1, []byte("[ERROR] Host Platform not supported: "+runtime.GOOS))
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 - Host OS Not supported"))
		return
	}

	if cmd == nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("500 -Internal Server Error"))
		return
	}

	//Create pipe to all interfaces: STDIN, OUT AND ERR

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Println(err)
		return
	}

	//Pipe stderr to stdout
	cmd.Stderr = cmd.Stdout

	/*
		stderr, err := cmd.StderrPipe()
		if err != nil {
			log.Println(err)
			return
		}
	*/

	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Println(err)
		return
	}

	//Start the shell
	if err := cmd.Start(); err != nil {
		log.Println(err)
		return
	}

	//Start listening
	go func() {
		//s := bufio.NewScanner(io.MultiReader(stdout, stderr))
		s := bufio.NewScanner(io.MultiReader(stdout))
		s.Split(customSplitter)
		for s.Scan() {
			resp := s.Bytes()

			respstring := string(resp)
			if runtime.GOOS == "windows" {
				//Strip out all non ASCII characters
				re := regexp.MustCompile("[[:^ascii:]]")
				respstring = re.ReplaceAllLiteralString(string(resp), "?")

			} else if runtime.GOOS == "linux" {
				//Linux. Check if this is an internal test command.
				if len(respstring) > 12 && respstring[:12] == "<arozos_pwd>" {
					//This is an internal pwd update command
					t.cwd = strings.TrimSpace(respstring[12:])
					log.Println("Updating cwd: ", t.cwd)
					continue
				}
			}

			err := c.WriteMessage(1, []byte(respstring))
			//log.Println(string(resp))
			if err != nil {
				//Fail to write websocket. (Already disconencted?) Terminate the bash
				//log.Println(err.Error())
				cmd.Process.Kill()
			}
		}
	}()

	//Do platform depending stuffs
	if runtime.GOOS == "windows" {
		//Force codepage to be english
		io.WriteString(stdin, "chcp 65001\n")

	} else if runtime.GOOS == "linux" {
		//Send message of the day
		content, err := ioutil.ReadFile("/etc/motd")
		if err != nil {
			//Unable to read the motd, use the arozos default one
			c.WriteMessage(1, []byte("Terminal Connected. Start type something!"))
		} else {
			c.WriteMessage(1, content)
		}
	}

	//Start looping for inputs
	for {
		_, message, err := c.ReadMessage()
		if err != nil {
			//Something went wrong. Close the socket and kill the process
			cmd.Process.Kill()
			c.Close()
			return
		}

		//Check if the message is exit. If yes, terminate the section
		if strings.TrimSpace(string(message)) == "exit" {
			//Terminate the execution
			cmd.Process.Kill()

			//Exit listening loop
			break
		} else if strings.TrimSpace(string(message)) == "\x003" {
			log.Println("WSSHELL SIGKILL RECEIVED")
			if runtime.GOOS == "windows" {
				//Send kill signal, see if it kill itself
				_ = cmd.Process.Signal(os.Kill)

				//Nope, just forcefully kill it
				err := cmd.Process.Kill()
				if err != nil {
					c.WriteMessage(1, []byte("[Error] "+err.Error()))
				}
			} else if runtime.GOOS == "linux" {
				//Do it nicely
				go func() {
					time.Sleep(2 * time.Second)
					_ = cmd.Process.Signal(os.Kill)
				}()
				cmd.Process.Signal(os.Interrupt)
			}

		} else {
			//Push the input valie into the shell with a newline at the last position of the line
			if len(string(message)) > 0 && string(message)[len(message)-1:] != "\n" {
				message = []byte(string(message) + "\n")
			} else if len(string(message)) == 0 {

				continue
			}
			//Write to STDIN
			io.WriteString(stdin, string(message)+"\n")

			if runtime.GOOS == "linux" {
				//Reply what user has typed in on linux
				hostname, err := os.Hostname()
				if err != nil {
					hostname = "arozos"
				}

				if len(string(message)) > 2 && string(message)[:2] == "cd" {
					//Request an update to the pwd
					time.Sleep(300 * time.Millisecond)
					io.WriteString(stdin, `echo "<arozos_pwd>$PWD"`+"\n")
					time.Sleep(300 * time.Millisecond)
				}

				c.WriteMessage(1, []byte(hostname+":"+t.cwd+" & "+strings.TrimSpace(string(message))))
			}
		}

	}

	c.WriteMessage(1, []byte("Exiting session"))
	c.Close()

}

func (t *Terminal) Close() {
	//Nothing needed to be done
}
