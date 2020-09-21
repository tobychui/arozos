console.log("User Permission Checking");
var permissionGroup = getUserPermissionGroup();
if (userIsAdmin() == true){
	sendResp("This user is admin with group = " + permissionGroup);
}else{
	sendResp("This user not admin with group = " + permissionGroup);
}