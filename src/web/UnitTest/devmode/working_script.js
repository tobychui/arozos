/*
    working_script.js

    A script that completes successfully.
    Used to verify that AGI_DEV mode does not affect normal script execution.
*/

sendJSONResp(JSON.stringify({status: "ok", message: "Script executed successfully"}));
