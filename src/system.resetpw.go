package main

import (
	"errors"
	"log"
	"net/http"
	"path/filepath"

	auth "imuslab.com/arozos/mod/auth"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/utils"
)

/*
	Password Reset Module

	This module exists to serve the password restart page with security check
*/

func system_resetpw_init() {
	http.HandleFunc("/system/reset/validateResetKey", system_resetpw_validateResetKeyHandler)
	http.HandleFunc("/system/reset/confirmPasswordReset", system_resetpw_confirmReset)
}

// Validate if the ysername and rkey is valid
func system_resetpw_validateResetKeyHandler(w http.ResponseWriter, r *http.Request) {
	username, err := utils.PostPara(r, "username")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid username or key")
		return
	}
	rkey, err := utils.PostPara(r, "rkey")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid username or key")
		return
	}

	if username == "" || rkey == "" {
		utils.SendErrorResponse(w, "Invalid username or rkey")
		return
	}

	//Check if the pair is valid
	err = system_resetpw_validateResetKey(username, rkey)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)

}

func system_resetpw_confirmReset(w http.ResponseWriter, r *http.Request) {
	username, _ := utils.PostPara(r, "username")
	rkey, _ := utils.PostPara(r, "rkey")
	newpw, _ := utils.PostPara(r, "pw")
	if username == "" || rkey == "" || newpw == "" {
		utils.SendErrorResponse(w, "Internal Server Error")
		return
	}

	//Check user exists
	if !authAgent.UserExists(username) {
		utils.SendErrorResponse(w, "Username not exists")
		return
	}

	//Validate rkey
	err := system_resetpw_validateResetKey(username, rkey)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//OK to procced
	newHashedPassword := auth.Hash(newpw)
	err = sysdb.Write("auth", "passhash/"+username, newHashedPassword)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)

}

func system_resetpw_validateResetKey(username string, key string) error {
	//Get current password from db
	passwordInDB := ""
	err := sysdb.Read("auth", "passhash/"+username, &passwordInDB)
	if err != nil {
		return err
	}

	//Get hashed user key
	hashedKey := auth.Hash(key)
	if passwordInDB != hashedKey {
		return errors.New("Invalid Password Reset Key")
	}

	return nil
}

func system_resetpw_handlePasswordReset(w http.ResponseWriter, r *http.Request) {
	//Check if the user click on this link with reset password key string. If not, ask the user to input one
	acc, err := utils.GetPara(r, "acc")
	if err != nil || acc == "" {
		system_resetpw_serveIdEnterInterface(w, r)
		return
	}

	resetkey, err := utils.GetPara(r, "rkey")
	if err != nil || resetkey == "" {
		system_resetpw_serveIdEnterInterface(w, r)
		return
	}

	//Check if the code is valid
	err = system_resetpw_validateResetKey(acc, resetkey)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid username or resetKey")
		return
	}

	//OK. Create the New Password Entering UI
	vendorIconSrc := filepath.Join(vendorResRoot, "vendor_icon.png")
	if !fs.FileExists(vendorIconSrc) {
		vendorIconSrc = "./web/img/public/vendor_icon.png"
	}
	imageBase64, _ := utils.LoadImageAsBase64(vendorIconSrc)
	template, err := utils.Templateload("system/reset/resetPasswordTemplate.html", map[string]string{
		"vendor_logo": imageBase64,
		"host_name":   *host_name,
		"username":    acc,
		"rkey":        resetkey,
	})
	if err != nil {
		log.Fatal(err)
	}
	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.Write([]byte(template))
}

func system_resetpw_serveIdEnterInterface(w http.ResponseWriter, r *http.Request) {
	//Reset Key or Username not found, Serve entering interface
	imgsrc := filepath.Join(vendorResRoot, "vendor_icon.png")
	if !fs.FileExists(imgsrc) {
		imgsrc = "./web/img/public/vendor_icon.png"
	}
	imageBase64, _ := utils.LoadImageAsBase64(imgsrc)
	template, err := utils.Templateload("system/reset/resetCodeTemplate.html", map[string]string{
		"vendor_logo": imageBase64,
		"host_name":   *host_name,
	})
	if err != nil {
		log.Fatal(err)
	}
	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.Write([]byte(template))
}
