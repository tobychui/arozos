/*
    includes.js

    This script file include another JavaScript file during runtime
*/

console.log("Include another script at runtime")

var success = includes("hello world.js")
if (success){
    console.log("You should see \"Hello World!\" output above")
}else{
    console.log("Oops. Something went wrong when executing the AGI includes function")
}
