/*
    http.get Request the content from URL with GET method
*/

requirelib("http")

//Get the weather information from API endpoint
var weatherInfo = http.get("https://fcc-weather-api.glitch.me/api/current?lat=22.42649285936068&lon=114.21116977093158");

//Relay the JSON to client
sendJSONResp(weatherInfo);