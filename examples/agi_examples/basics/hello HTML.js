/*  
    hello HTML.js

    You can add this script to Serverless WebApp
	and visit the API endpoint generated to see 
	the code generated HTML file.
*/

HTTP_HEADER = "text/html; charset=utf-8";
var html = "";
html += "<h1>Welcome To My Website</h1>";
html += "<p>Hello World!</p>";
sendResp(html);