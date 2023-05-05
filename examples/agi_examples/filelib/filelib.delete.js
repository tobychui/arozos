/*
    File Walk. Recursive scan all files and subdirs under this root
*/
console.log("Testing File Delete");
requirelib("filelib");

//Create a file
if (filelib.writeFile("user:/Desktop/test.txt")){
    //Delete the file
    filelib.deleteFile("user:/Desktop/test.txt");
}else{
    console.log("File create failed")
}
