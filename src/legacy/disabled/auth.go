package main

import (
    "net/http"
    "strings"
    "log"
    "encoding/json"

    "imuslab.com/arozos/mod/auth"
)


var (
    // key must be 16, 24 or 32 bytes long (AES-128, AES-192 or AES-256)
    key = []byte("super-secret-key") //To be migrated to input flags
)


/*
    Initiation of web services endpoints from main()

    This function should be the preparation of auth services and register the url for auth services only
    Do not put in any computational algorithms
*/
func authRegisterHandlerEndpoints(authAgent *auth.AuthAgent){
    //Initiate auth services with system database
    authAgent = auth.NewAuthenticationAgent("ao_auth", key, sysdb)

    //Handle auth API
    http.HandleFunc("/system/auth/login", authAgent.HandleLogin)
    http.HandleFunc("/system/auth/logout", authAgent.HandleLogout)
    http.HandleFunc("/system/auth/checkLogin", authAgent.CheckLogin)
    http.HandleFunc("/system/auth/register", authAgent.HandleRegister)  //Require implemtantion of group check
    http.HandleFunc("/system/auth/unregister", authAgent.HandleUnregister) //Require implementation of admin check
    
    //Handle other related APUs
    http.HandleFunc("/system/auth/reflectIP", system_auth_getIPAddress)
    http.HandleFunc("/system/auth/checkPublicRegister", system_auth_checkPublicRegister)
    log.Println("ArOZ Online Authentication Service Loaded");


    if (*allow_public_registry){
        //Allow public registry. Create setting interface for this page
        registerSetting(settingModule{
            Name:     "Public Register",
            Desc:     "Settings for public registration",
            IconPath: "SystemAO/auth/img/small_icon.png",
            Group:    "Users",
            StartDir: "SystemAO/auth/regsetting.html",
            RequireAdmin: true,
        })


        //Register the direct link for template serving
        http.HandleFunc("/public/register", system_auth_serveRegisterInterface);
        http.HandleFunc("/public/register/settings", system_auth_handleRegisterInterfaceUpdate);
    }
}

func system_auth_checkPublicRegister(w http.ResponseWriter, r *http.Request){
    if (!*allow_public_registry){
        sendJSONResponse(w, "false");
        return
    }else{
        AllowPublicRegisterValue := false
        sysdb.Read("auth", "public/register/settings/allowRegistry", &AllowPublicRegisterValue)
        jsonString, _ := json.Marshal(AllowPublicRegisterValue)
        sendJSONResponse(w, string(jsonString))
        return
    }
    sendJSONResponse(w, "false");
}

func system_auth_serveRegisterInterface(w http.ResponseWriter, r *http.Request){
    username, err := mv(r, "username", true)
    if (err != nil){
        //Serve WebUI
        //Prepare contents for templating
        base64Image, _ := LoadImageAsBase64("./web/" + iconVendor)
        requireInvitationCode := false
        sysdb.Read("auth", "public/register/settings/enableInvitationCode", &requireInvitationCode)
        eic := "false"
        if (requireInvitationCode){
            eic = "true"
        }
        //registerUI, _ := ioutil.ReadFile("./web/" + "SystemAO/auth/register.system");
        registerUI, _ := template_load("./web/" + "SystemAO/auth/register.system",map[string]interface{}{
            "vendor_logo": base64Image,
            "host_name": *host_name,
            "require_invitationCode": eic,
        })
        w.Write([]byte(registerUI))
    }else{
        //Data incoming. Register this user if data is valid
        requireInvitationCode := false
        sysdb.Read("auth", "public/register/settings/enableInvitationCode", &requireInvitationCode)

        //Validate Invitation Code if enabled
        if (requireInvitationCode){
            //Validate the Invitation Code
            userInputCode, _ := mv(r, "invitationcode", true)
            correctCode := ""
            sysdb.Read("auth", "public/register/settings/invitationCode", &correctCode)
            if (correctCode == ""){
                panic("Invalid Invitation Code")
            }
            if (userInputCode != correctCode){
                sendErrorResponse(w, "Invalid Invitation Code")
                return
            }
        }

        //validate if this username already occupied
        if authAgent.UserExists(username){
            sendErrorResponse(w, "This username already occupied.")
            return
        }

        //Validate password
        password, err := mv(r, "password", true)
        if (err != nil){
            sendErrorResponse(w, "Invalid password")
            return
        }

        if len(password) < 8{
            sendErrorResponse(w, "Password too short. Password must be equal or longer than 8 characters")
            return
        }

        //Validate default usergroup
        DefaultUserGroupValue := ""
        err = sysdb.Read("auth", "public/register/settings/defaultUserGroup", &DefaultUserGroupValue)
        if (err != nil){
            log.Println(err.Error())
            sendErrorResponse(w, "Internal Server Error")
            return
        }

        /*
        if (DefaultUserGroupValue == "" || !system_permission_groupExists(DefaultUserGroupValue)){
            log.Println("Invalid group given or group not exists: " + DefaultUserGroupValue)
            sendErrorResponse(w, "Internal Server Error")
            return
        }
        */

        //Ok to create user
        err = authAgent.CreateUserAccount(username, password, DefaultUserGroupValue)
        if (err != nil){
            log.Println(err.Error())
            sendErrorResponse(w, "Internal Server Error")
            return
        }
        sendOK(w);
    }
    
}

func system_auth_handleRegisterInterfaceUpdate(w http.ResponseWriter, r *http.Request){
    /*
    isAdmin := system_permission_checkUserIsAdmin(w,r)
    if !isAdmin{
        sendErrorResponse(w, "Permission denied")
        return
    }
    */
    
    //keys for access the properties
    var (
        rootKey string = "public/register/settings/"
        allowPublicRegister string = rootKey + "allowRegistry"
        enableInvitationCode string = rootKey + "enableInvitationCode"
        invitationCode string = rootKey + "invitationCode"
        defaultUserGroup string = rootKey + "defaultUserGroup"
    )

    opr, _ := mv(r,"opr",true);
    if (opr == "write"){
        //Write settings to db
        config, err := mv(r,"config",true);
        if err != nil{
            sendErrorResponse(w, "config not defined");
            return
        }

        type configStruct struct {
            Apr   bool   `json:"apr"`
            Eivc  bool   `json:"eivc"`
            Icode string `json:"icode"`
            Group string `json:"group"`
        }

        newConfig := new(configStruct)
        err = json.Unmarshal([]byte(config), &newConfig)
        if (err != nil){
            sendErrorResponse(w, err.Error())
            return
        }

        /*
        if (newConfig.Group == "" || !system_permission_groupExists(newConfig.Group)){
            //Group is not set. Reject update
            sendErrorResponse(w, "Invalid group selected");
            return
        }
        */

        //Write the configuration to file
        sysdb.Write("auth", allowPublicRegister, newConfig.Apr)
        sysdb.Write("auth", enableInvitationCode, newConfig.Eivc)
        sysdb.Write("auth", invitationCode, newConfig.Icode)
        sysdb.Write("auth", defaultUserGroup, newConfig.Group)

        sendOK(w)
    }else{
        //Read the current settings
        type replyStruct struct{
            AllowPublicRegister bool
            EnableInvitationCode bool
            InvitationCode string
            DefaultUserGroup string
        }

        var AllowPublicRegisterValue bool = false
        var EnableInvitationCodeValue bool = false
        var InvitationCodeValue string = ""
        var DefaultUserGroupValue string = ""

        sysdb.Read("auth", allowPublicRegister, &AllowPublicRegisterValue)
        sysdb.Read("auth", enableInvitationCode, &EnableInvitationCodeValue)
        sysdb.Read("auth", invitationCode, &InvitationCodeValue)
        sysdb.Read("auth", defaultUserGroup, &DefaultUserGroupValue)

        jsonString, _ := json.Marshal(replyStruct{
            AllowPublicRegister:AllowPublicRegisterValue,
            EnableInvitationCode:EnableInvitationCodeValue,
            InvitationCode:InvitationCodeValue,
            DefaultUserGroup:DefaultUserGroupValue,
        })

        sendJSONResponse(w, string(jsonString))
    }
}




