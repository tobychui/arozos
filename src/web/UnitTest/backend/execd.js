/*

    Execd - Execute after Detach

    This script demonstrate the execd function call
    USE WITH CAUTION

    Here is a few tips for you to develop a script containing execd
    1. Do not execute self script unless you are sure about what you are doing
    2. Instant / short task should be put in the main script while long running 
    task should be called with execd instead

*/

function parent(){
    console.log("Parent starting Child Process...")
    //Execute this script file in child mode with payload string
    execd("execd.js", "Payload to child")
    console.log("Parent Completed")
}

function child(){
    //Print the payload string
    console.log("Receiving payload from parent: " + PARENT_PAYLOAD)
    //Delay (emulate processing something)
    delay(5000);
    console.log("Child finished")
}

if (typeof PARENT_DETACHED == 'undefined'){
    //This is parent
    parent();

}else if (PARENT_DETACHED == true){
    //This is child
    child();
}