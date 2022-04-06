package ftp

import (
	"crypto/tls"
	"errors"
	"log"
	"os"
	"time"

	ftp "github.com/fclairamb/ftpserverlib"
)

func (m mainDriver) GetSettings() (*ftp.Settings, error) {
	return &m.setting, nil
}

func (m mainDriver) ClientConnected(cc ftp.ClientContext) (string, error) {
	//log.Println("Client Connected: ", cc.ID(), cc.RemoteAddr())
	m.connectedUserList.Store(cc.ID(), "")
	return "arozos FTP Endpoint", nil
}

func (m mainDriver) ClientDisconnected(cc ftp.ClientContext) {
	//log.Println("Client Disconencted: ", cc.ID(), cc.RemoteAddr())
	////Recalculate user quota if logged in
	val, ok := m.connectedUserList.Load(cc.ID())
	if ok {
		if val != "" {
			//Recalculate user storage quota
			if m.userHandler.GetAuthAgent().UserExists(val.(string)) {
				userinfo, err := m.userHandler.GetUserInfoFromUsername(val.(string))
				if err == nil {
					//Update the user storage quota
					userinfo.StorageQuota.CalculateQuotaUsage()
					log.Println("FTP storage quota updated: ", val.(string))
				}
			} else {
				//This user is being delete during his connection to FTP???

			}
		}
		m.connectedUserList.Delete(cc.ID())
	}

}

//Authenicate user using arozos authAgent
func (m mainDriver) AuthUser(cc ftp.ClientContext, user string, pass string) (ftp.ClientDriver, error) {
	authAgent := m.userHandler.GetAuthAgent()
	if authAgent.ValidateUsernameAndPassword(user, pass) {
		//OK
		userinfo, _ := m.userHandler.GetUserInfoFromUsername(user)

		//Check user permission to access ftp endpoint
		db := m.userHandler.GetDatabase()
		allowedPgs := []string{}
		err := db.Read("ftp", "groups", &allowedPgs)
		if err != nil {
			allowedPgs = []string{}
		}
		accessOK := userinfo.UserIsInOneOfTheGroupOf(allowedPgs)

		if accessOK {
			//Check if the request is from a blacklisted ip range
			allowAccess, err := m.userHandler.GetAuthAgent().ValidateLoginIpAccess(cc.RemoteAddr().String())
			if !allowAccess {
				accessOK = false
				return nil, err
			}
		}

		if !accessOK {
			//log the signin request
			m.userHandler.GetAuthAgent().Logger.LogAuthByRequestInfo(user, cc.RemoteAddr().String(), time.Now().Unix(), false, "ftp")
			//Disconnect this user as he is not in the group that is allowed to access ftp
			log.Println(userinfo.Username + " tries to access FTP endpoint with invalid permission settings.")
			return nil, errors.New("User " + userinfo.Username + " has no permission to access FTP endpoint")
		}

		//Create tmp buffer for this user
		tmpFolder := m.tmpFolder + "users/" + userinfo.Username + "/ftpbuf/"
		os.MkdirAll(tmpFolder, 0755)

		//Record username into connected user list
		m.connectedUserList.Store(cc.ID(), userinfo.Username)
		//log the signin request
		m.userHandler.GetAuthAgent().Logger.LogAuthByRequestInfo(userinfo.Username, cc.RemoteAddr().String(), time.Now().Unix(), true, "ftp")
		//Return the aofs object
		return aofs{
			userinfo:  userinfo,
			tmpFolder: tmpFolder,
		}, nil
	} else {
		//log the signin request
		m.userHandler.GetAuthAgent().Logger.LogAuthByRequestInfo(user, cc.RemoteAddr().String(), time.Now().Unix(), false, "ftp")
		return nil, errors.New("Invalid username or password")
	}
}

func (m mainDriver) GetTLSConfig() (*tls.Config, error) {
	return nil, errors.New("Not Supported")
}
