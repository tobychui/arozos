/*
    runtime_error.js

    Intentionally triggers a ReferenceError by calling an undefined variable.
    Used to test the AGI_DEV debug message dump feature.
*/

var result = undefinedFunction(); // ReferenceError: undefinedFunction is not defined
sendResp("This line should never be reached");
