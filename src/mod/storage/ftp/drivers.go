package ftp

import (
	"crypto/tls"
	"errors"

	ftp "github.com/fclairamb/ftpserverlib"
	"imuslab.com/arozos/mod/info/logger"
)

func (m *mainDriver) GetSettings() (out0 *ftp.Settings, out1 error) {
	defer logger.Out2(logger.In1("storage/ftp", "mainDriver.GetSettings", "m", m), &out0, &out1)
	return &m.setting, nil
}

func (m *mainDriver) ClientConnected(cc ftp.ClientContext) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("storage/ftp", "mainDriver.ClientConnected", "m", m, "&cc", &cc), &out0, &out1)
	if !AddressAllowed(cc.RemoteAddr(), m.opt.AllowPublic) {
		return "This server only accepts clients from private networks", errors.New("public address refused")
	}
	m.newClient(cc)
	return "arozos FTP Endpoint", nil
}

func (m *mainDriver) ClientDisconnected(cc ftp.ClientContext) {
	defer logger.Out0(logger.In2("storage/ftp", "mainDriver.ClientDisconnected", "m", m, "&cc", &cc))
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
func (m *mainDriver) AuthUser(cc ftp.ClientContext, username string, pass string) (out0 ftp.ClientDriver, out1 error) {
	defer logger.Out2(logger.In4("storage/ftp", "mainDriver.AuthUser", "m", m, "&cc", &cc, "username", username, "!pass", pass), &out0, &out1)
	if err := m.opt.Authenticate(username, pass, hostOf(cc.RemoteAddr())); err != nil {
		logger.DebugErr("storage/ftp", err)
		return nil, err
	}
	userinfo, err := m.opt.LookupUser(username)
	if err != nil {
		logger.DebugErr("storage/ftp", err)
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

func (m *mainDriver) GetTLSConfig() (out0 *tls.Config, out1 error) {
	defer logger.Out2(logger.In1("storage/ftp", "mainDriver.GetTLSConfig", "m", m), &out0, &out1)
	return nil, errors.New("Not Supported")
}
