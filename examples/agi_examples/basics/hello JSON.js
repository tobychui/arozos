/*  
    hello JSON.js

    You can add this script to Serverless WebApp
	and visit the API endpoint generated to see 
	the code generated JSON file.
*/

var myObject = {
    "name": "Aroz Zoraxy",
    "age": 17,
    "interests": ["cats", "programming"],
    "workexp": {
        "programmer": {
            "start": 2016,
            "end": 2023
        }
    }
}

sendJSONResp(myObject);