console.log("Try to attack auth database");

//Try to reate an user admin with password "admin"
var x = writeDBItem("auth","admin","c7ad44cbad762a5da0a452f9e854fdc1e0e7a52a38015f23f3eab1d80b931dd472634dfac71cd34ebc35d16ab7fb8a90c81f975113d6c7538dc69dd8de9077ec")

//Should return false
console.log(x)

var y = dropDBTable("auth");

//Should return false
console.log(y)

sendResp("Attack Test Done");