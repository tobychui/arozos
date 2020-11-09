/*
    Create a new User

    This example demonstrate the agi script to create a new user
    REQUIRE ADMIN PERMISSION

*/

if (userIsAdmin() == false){
    //Not admin. Reject request
    sendResp("Require admin permission to create user")
}else{
    //Try to creat a new user call Dummy
    if (userExists("YamiOdymel")){
        sendResp("User Already Exists!");
    }else{
        //Create the user if not exists
        var success = createUser("YamiOdymel", "123456", "default");
        if (success){
            sendResp("User Creation Succeed");
        }else{
            sendResp("User Creation failed. See terminal for more info.")
        }
    }
}