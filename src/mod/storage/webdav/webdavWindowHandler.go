package webdav

/*
	WebDAV Handler for Windows

	Yes, because Windows sucks and require a special handler
	to handle Windows request over WebDAV protocol
*/

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
)

//http://localhost:8080/webdav
func (s *Server) HandleWindowClientAccess(w http.ResponseWriter, r *http.Request) {
	coookieName := "arozosWebdavToken"
	cookie, err := r.Cookie(coookieName)
	if err != nil {
		//New Client! Record its uuid and IP address
		//Generate a new UUID for this client
		thisWebDAVClientID := uuid.NewV4().String()

		//Generate a new HTTP Cookie
		http.SetCookie(w, &http.Cookie{
			Name:   coookieName,
			Value:  thisWebDAVClientID,
			MaxAge: 3600,
		})

		ip, err := getIP(r)
		if err != nil {
			ip = "Unknown"
		}

		if ip == "::1" || ip == "127.0.0.1" {
			ip = "localhost"
		}

		log.Println("New Window WebDAV Client Connected! Assinging UUID:", thisWebDAVClientID)
		//Store this UUID with the connection
		s.windowsClientNotLoggedIn.Store(thisWebDAVClientID, &WindowClientInfo{
			Agent:                   r.Header["User-Agent"][0],
			LastConnectionTimestamp: time.Now().Unix(),
			UUID:                    thisWebDAVClientID,
			ClientIP:                ip,
		})

		//OK. Serve the READONLY FS for Winwdows to remember this login
		s.serveReadOnlyWebDav(w, r)
		return
	} else {
		//This client already have a token. Extract it
		clientUUID := cookie.Value

		//Check if the client has been logged in
		value, ok := s.windowsClientLoggedIn.Load(clientUUID)
		if !ok {
			//Not logged in. Check if this is first connection
			cinfo, ok := s.windowsClientNotLoggedIn.Load(clientUUID)
			if !ok {
				//This is where the arozos data is loss about this client. Rebuild its cookie
				//Generate a new UUID for this client
				thisWebDAVClientID := uuid.NewV4().String()

				//Generate a new HTTP Cookie
				http.SetCookie(w, &http.Cookie{
					Name:   coookieName,
					Value:  thisWebDAVClientID,
					MaxAge: 3600,
				})

				ip, err := getIP(r)
				if err != nil {
					ip = "Unknown"
				}

				if ip == "::1" || ip == "127.0.0.1" {
					ip = "localhost"
				}

				//Store this UUID with the connection
				s.windowsClientNotLoggedIn.Store(thisWebDAVClientID, &WindowClientInfo{
					Agent:                   r.Header["User-Agent"][0],
					LastConnectionTimestamp: time.Now().Unix(),
					UUID:                    thisWebDAVClientID,
					ClientIP:                ip,
				})

				//OK. Serve the READONLY FS for Winwdows to remember this login
				s.serveReadOnlyWebDav(w, r)

			} else {
				//This client is not logged in but connected before
				//log.Println("Windows client with assigned UUID: " + clientUUID + " try to access becore login validation")

				//Update last connection timestamp
				cinfo.(*WindowClientInfo).LastConnectionTimestamp = time.Now().Unix()

				//OK. Serve the READONLY FS for Winwdows to remember this login
				s.serveReadOnlyWebDav(w, r)
			}

			return
		} else {
			//OK. Serve this user
			clientInfo := value.(*WindowClientInfo)
			userinfo, err := s.userHandler.GetUserInfoFromUsername(clientInfo.Username)
			if err != nil {
				//User not exists?
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte("500 - User not exists"))
				return
			}

			realRoot, err := userinfo.VirtualPathToRealPath("user:/")
			if err != nil {
				log.Println(err.Error())
				http.Error(w, "Invalid ", http.StatusUnauthorized)
				return
			}

			//Get and serve the file content
			fs := s.getFsFromRealRoot(realRoot)
			fs.ServeHTTP(w, r)
		}
	}

}

func getIP(r *http.Request) (string, error) {
	//Get IP from the X-REAL-IP header
	ip := r.Header.Get("X-REAL-IP")
	netIP := net.ParseIP(ip)
	if netIP != nil {
		return ip, nil
	}

	//Get IP from X-FORWARDED-FOR header
	ips := r.Header.Get("X-FORWARDED-FOR")
	splitIps := strings.Split(ips, ",")
	for _, ip := range splitIps {
		netIP := net.ParseIP(ip)
		if netIP != nil {
			return ip, nil
		}
	}

	//Get IP from RemoteAddr
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return "", err
	}
	netIP = net.ParseIP(ip)
	if netIP != nil {
		return ip, nil
	}
	return "", fmt.Errorf("No valid ip found")
}
