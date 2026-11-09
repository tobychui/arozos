package ftp

import (
	"crypto/tls"
	"errors"

	ftp "github.com/fclairamb/ftpserverlib"
	"imuslab.com/arozos/mod/info/logger"
)

func (m *mainDriver) GetSettings() (*ftp.Settings, error) {
	return &m.setting, nil
}

func (m *mainDriver) ClientConnected(cc ftp.ClientContext) (string, error) {
	if !AddressAllowed(cc.RemoteAddr(), m.opt.AllowPublic) {
		return "This server only accepts clients from private networks", errors.New("public address refused")
	}
	m.newClient(cc)
	return "arozos FTP Endpoint", nil
}

func (m *mainDriver) ClientDisconnected(cc ftp.ClientContext) {
	value, ok := m.clients.LoadAndDelete(cc.ID())
	if !ok {
		return
	}
	//Recalculate the storage quota of a signed in user
	if account := value.(*client).account(); account != nil && account.StorageQuota != nil {
		account.StorageQuota.CalculateQuotaUsage()
		logger.PrintAndLog("Ftp", "FTP storage quota updated: "+account.Username, nil)
	}
}

// AuthUser signs a client in through the Authenticate function of the options
func (m *mainDriver) AuthUser(cc ftp.ClientContext, username string, pass string) (ftp.ClientDriver, error) {
	if err := m.opt.Authenticate(username, pass, hostOf(cc.RemoteAddr())); err != nil {
		return nil, err
	}
	userinfo, err := m.opt.LookupUser(username)
	if err != nil {
		return nil, errors.New("Invalid username or password")
	}
	if value, ok := m.clients.Load(cc.ID()); ok {
		c := value.(*client)
		c.mu.Lock()
		c.user = userinfo
		c.mu.Unlock()
	}
	return aofs{userinfo: userinfo, readOnly: m.opt.ReadOnly}, nil
}

func (m *mainDriver) GetTLSConfig() (*tls.Config, error) {
	return nil, errors.New("Not Supported")
}
