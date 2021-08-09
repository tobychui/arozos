/*
    Save.js

    This file save the web content to file
    require paramter:
    filepath
    content

    Optional:
    template
    title
*/

requirelib("filelib");
requirelib("appdata");

function saveFile(){
    //Load templates
    var templateContent = "";
    if (typeof(template) == "undefined" || !filelib.fileExists(template)){
        //Use default template
        templateContent = appdata.readFile("Web Builder/template.html");
        
        //Custom CSS replacement in the content
        content = content.split("<table>").join("<table class='ui celled table'>")

        //Replace seperation lines
        content = content.split("__se__solid").join("__se__ ui divider");
        content = content.split("__se__dotted").join("__se__ ui dotted divider");
        content = content.split("__se__dashed").join("__se__ ui dashed divider");

    }else if (template != ""){
        //Use user defined template
        templateContent = filelib.readFile(template);
    }

    var defaultTitle = USERNAME + " Webpage";
    if (typeof(title) != "undefined" && title != ""){
        defaultTitle = title
    }

    //Apply the content to the template
    templateContent = templateContent.split("{{title}}").join(defaultTitle);
    templateContent = templateContent.split("{{content}}").join(content);
   
    filelib.writeFile(filepath, templateContent)
    sendResp("OK");
}

saveFile();