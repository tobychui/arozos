/*
    Remove a User

    This example demonstrate the agi script to remove an existsing user
    REQUIRE ADMIN PERMISSION

*/

if (userIsAdmin() == false){
    //Not admin. Reject request
    sendResp("Require admin permission to remove user")
}else{
    //Try to creat a new user call Dummy
    if (userExists("YamiOdymel")){
        //User Exists. Continue removing
        var succ = removeUser("YamiOdymel");
        if (!succ){
            sendResp("User Removal Failed");
        }else{
            sendResp("User Removed");
        }
    }else{
        sendResp("User Not Exists!");
    }
}