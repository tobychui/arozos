package main

import (
	"net/http"
	"log"
	"errors"

	auth "imuslab.com/arozos/mod/auth"
)

/*
	Password Reset Module

	This module exists to serve the password restart page with security check
*/

func system_resetpw_init(){
	http.HandleFunc("/system/reset/validateResetKey", system_resetpw_validateResetKeyHandler);
	http.HandleFunc("/system/reset/confirmPasswordReset", system_resetpw_confirmReset);
}

//Validate if the ysername and rkey is valid
func system_resetpw_validateResetKeyHandler(w http.ResponseWriter, r *http.Request){
	username, err := mv(r, "username", true)
	if err != nil{
		sendErrorResponse(w, "Internal Server Error")
		return
	}
	rkey, err := mv(r, "rkey", true)
	if err != nil{
		sendErrorResponse(w, "Internal Server Error")
		return
	}

	if username == "" || rkey == "" {
		sendErrorResponse(w, "Invalid username or rkey")
		return
	}

	//Check if the pair is valid
	err = system_resetpw_validateResetKey(username, rkey)
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}

	sendOK(w)

}

func system_resetpw_confirmReset(w http.ResponseWriter, r *http.Request){
	username, _ := mv(r, "username", true)
	rkey, _ := mv(r, "rkey", true)
	newpw, _ := mv(r, "pw", true)
	if (username == "" || rkey == "" || newpw == ""){
		sendErrorResponse(w, "Internal Server Error")
		return
	}

	//Check user exists
	if !authAgent.UserExists(username){
		sendErrorResponse(w, "Username not exists")
		return
	}

	//Validate rkey
	err := system_resetpw_validateResetKey(username, rkey)
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}

	//OK to procced
	newHashedPassword := auth.Hash(newpw)
	err = sysdb.Write("auth", "passhash/" + username, newHashedPassword)
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}

	sendOK(w);

}

func system_resetpw_validateResetKey(username string, key string) error{
	//Get current password from db
	passwordInDB := ""
	err := sysdb.Read("auth", "passhash/" + username, &passwordInDB)
	if err != nil{
		return err
	}

	//Get hashed user key
	hashedKey := auth.Hash(key)
	if (passwordInDB != hashedKey){
		return errors.New("Invalid Password Reset Key")
	}

	return nil
}

func system_resetpw_handlePasswordReset(w http.ResponseWriter, r *http.Request){
	//Check if the user click on this link with reset password key string. If not, ask the user to input one
	acc, err := mv(r, "acc", false)
	if err != nil || acc == "" {
		system_resetpw_serveIdEnterInterface(w,r);
		return
	}

	resetkey, err := mv(r, "rkey", false)
	if err != nil || resetkey == "" {
		system_resetpw_serveIdEnterInterface(w,r);
		return
	}

	//Check if the code is valid
	err = system_resetpw_validateResetKey(acc, resetkey)
	if err != nil {
		sendErrorResponse(w, "Invalid username or resetKey")
		return
	}

	//OK. Create the New Password Entering UI
	imageBase64, _ := LoadImageAsBase64("./web/" + iconVendor)
	template, err := template_load("system/reset/resetPasswordTemplate.html",map[string]interface{}{
		"vendor_logo": imageBase64,
		"host_name": *host_name,
		"username": acc,
		"rkey": resetkey,
	});
	if err != nil{
		log.Fatal(err);
	}
	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.Write([]byte(template))
}

func system_resetpw_serveIdEnterInterface(w http.ResponseWriter, r *http.Request){
	//Reset Key or Username not found, Serve entering interface
	imageBase64, _ := LoadImageAsBase64("./web/" + iconVendor)
	template, err := template_load("system/reset/resetCodeTemplate.html",map[string]interface{}{
		"vendor_logo": imageBase64,
		"host_name": *host_name,
	});
	if err != nil{
		log.Fatal(err);
	}
	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.Write([]byte(template))
}
