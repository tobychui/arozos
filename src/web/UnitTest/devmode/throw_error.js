/*
    throw_error.js

    Intentionally throws an explicit Error object with a custom message.
    Used to test the AGI_DEV debug message dump feature.
*/

function inner() {
    throw new Error("This is a deliberate test error from the AGI dev mode test suite");
}

function outer() {
    inner();
}

outer();
sendResp("This line should never be reached");
