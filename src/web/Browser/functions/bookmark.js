/*
    bookmark.js

    //Require paramter
    opr = {write / read}
    rtype = {bookmark / titles}
    newBookmarkArray = JSON array to store into the database under write mode
    newTitleArray = JSON array to store titles
*/

newDBTableIfNotExists("browser");

if (typeof(rtype) == "undefined" || rtype == "bookmark"){
    if (opr == "write"){
        //Write
        writeDBItem("browser", USERNAME, newBookmarkArray);
        sendOK();
    }else{
        //Read
        var bookmarks = readDBItem("browser", USERNAME);
        if (bookmarks == ""){
            //Not initiated
            sendJSONResp([]);
        }else{
            sendJSONResp(bookmarks);
        }
        
    }
}else if ( rtype == "titles"){
    //Write title
    if (opr == "write"){
        //Write
        writeDBItem("browser", USERNAME + "/titles", newTitleArray);
        sendOK();
    }else{
        //Read
        var titleMap = readDBItem("browser", USERNAME + "/titles");
        if (titleMap == ""){
            //Not initiated
            sendJSONResp({});
        }else{
            sendJSONResp(titleMap);
        }
        
    }
}


