package sftpserver

import (
	"errors"
	"io"
	"log"
	"net"
	"os"
	"sync"

	"github.com/pkg/sftp"
	uuid "github.com/satori/go.uuid"
	"golang.org/x/crypto/ssh"
	user "imuslab.com/arozos/mod/user"
)

type SFTPConfig struct {
	ListeningIP string
	KeyFile     string
	UserManager *user.UserHandler
}

type Instance struct {
	Closed           bool
	closer           chan bool
	ConnectedClients sync.Map
}

// Create a new SFTP Server
// listeningIP in the format of 0.0.0.0:2022
func NewSFTPServer(sftpConfig *SFTPConfig) (*Instance, error) {
	// An SSH server is represented by a ServerConfig, which holds
	// certificate details and handles authentication of ServerConns.
	config := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			// Should use constant-time compare (or better, salt+hash) in
			// a production setting.
			//fmt.Printf("[SFTP] %s Logged in\n", c.User())

			ok := sftpConfig.UserManager.GetAuthAgent().ValidateUsernameAndPassword(c.User(), string(pass))
			if !ok {
				return nil, errors.New("[SFTP] Password rejected for " + c.User())
			}
			return nil, nil
		},
	}

	privateBytes, err := os.ReadFile(sftpConfig.KeyFile)
	if err != nil {
		return nil, err
	}

	private, err := ssh.ParsePrivateKey(privateBytes)
	if err != nil {
		return nil, err
	}

	config.AddHostKey(private)

	// Once a ServerConfig has been configured, connections can be accepted.
	listener, err := net.Listen("tcp", sftpConfig.ListeningIP)
	if err != nil {
		return nil, err
	}
	log.Printf("[SFTP] Listening on %v\n", listener.Addr())

	//Setup a closer handler for this instance
	closeChan := make(chan bool)
	thisServerInstance := Instance{
		closer:           closeChan,
		Closed:           false,
		ConnectedClients: sync.Map{},
	}

	go func() {
		<-closeChan
		//Kick all the client off
		thisServerInstance.ConnectedClients.Range(func(key, value interface{}) bool {
			value.(chan bool) <- true
			return true
		})

		//Close the listener
		listener.Close()
	}()

	//Start the ssh server listener in go routine
	go func() error {
		for {
			nConn, err := listener.Accept()
			if err != nil {
				return err
			}

			go func(nConn net.Conn) error {
				// Before use, a handshake must be performed on the incoming
				// net.Conn.
				cx, chans, reqs, err := ssh.NewServerConn(nConn, config)
				if err != nil {
					return err
				}
				log.Println("[SFTP] User Connected: ", cx.User())

				userinfo, err := sftpConfig.UserManager.GetUserInfoFromUsername(cx.User())
				if err != nil {
					return err
				}

				// The incoming Request channel must be serviced.
				go ssh.DiscardRequests(reqs)

				// Service the incoming Channel channel.
				for newChannel := range chans {
					// Channels have a type, depending on the application level
					// protocol intended. In the case of an SFTP session, this is "subsystem"
					// with a payload string of "<length=4>sftp"
					//fmt.Println("Incoming channel: %s\n", newChannel.ChannelType())
					if newChannel.ChannelType() != "session" {
						newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
						//fmt.Println("Unknown channel type: %s\n", newChannel.ChannelType())
						continue
					}
					channel, requests, err := newChannel.Accept()
					if err != nil {
						return err
					}
					//fmt.Println("Channel accepted\n")

					// Sessions have out-of-band requests such as "shell",
					// "pty-req" and "env".  Here we handle only the
					// "subsystem" request.
					go func(in <-chan *ssh.Request) {
						for req := range in {
							//fmt.Println("Request: %v\n", req.Type)
							ok := false
							switch req.Type {
							case "subsystem":
								//fmt.Println("Subsystem: %s\n", req.Payload[4:])
								if string(req.Payload[4:]) == "sftp" {
									ok = true
								}
							}
							//fmt.Println(" - accepted: %v\n", ok)
							req.Reply(ok, nil)
						}
					}(requests)

					//Create a virtual SSH Server that contains all this user's fsh
					root := GetNewSFTPRoot(userinfo.Username, userinfo.GetAllFileSystemHandler())
					server := sftp.NewRequestServer(channel, root)

					//Create a channel for kicking the user off
					kickChan := make(chan bool)
					channelId := uuid.NewV4().String()
					thisServerInstance.ConnectedClients.Store(channelId, kickChan)
					go func() {
						//Close the server
						gratefully := <-kickChan
						if gratefully {
							server.Close()
						}

						//Remove this channel from array
						thisServerInstance.ConnectedClients.Delete(channelId)
					}()

					if err := server.Serve(); err == io.EOF {
						kickChan <- true
						//server.Close()
						log.Print("sftp client exited session.")
					} else if err != nil {
						kickChan <- false
						log.Println("sftp server completed with error:", err)
					}

				}

				return nil
			}(nConn)
		}
	}()

	return &thisServerInstance, nil
}

func (i *Instance) Close() {
	i.closer <- true
	i.Closed = true
	log.Println("[SFTP] SFTP Server Closed")
}
