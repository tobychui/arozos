/*
    modelSelector.js

    Handle neural network selection
    Require paramters:
    set
    model (Require when set = true)
*/
includes("imagedb.js");


function GetCurrentModel(){
    return getNNModel();
}

function SetClassifyModel(newModel){
    setNNModel(newModel);
    sendJSONResp(JSON.stringify("OK"));
}

if (typeof(set) == "undefined"){
    //Get
    sendJSONResp(JSON.stringify(GetCurrentModel()));
}else{
    //Set
    SetClassifyModel(model);
}