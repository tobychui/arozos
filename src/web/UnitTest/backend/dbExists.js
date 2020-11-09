/*

    This unit test test for if db exists api call

*/

if (DBTableExists("auth")){
    sendJSONResp("true");
}else{
    sendJSONResp("false");
}