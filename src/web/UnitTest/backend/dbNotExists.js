/*
    Try to access a not existsing database table

*/

var results = readDBItem("lkasdjqiofnqwejkfniw", "dummy");
if (results == false){
    sendResp("Table not found")
}else{
    //If the code reach here that means the system has crashed or you 
    //really have a table named "lkasdjqiofnqwejkfniw"
    sendResp("Something went wrong! " + results)
}

