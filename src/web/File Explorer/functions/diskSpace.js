if (requirelib("filelib")){
    let tmpPath = "tmp:/";
    let space = {
        Available: filelib.filesize(tmpPath), 
        Total: filelib.filesize(tmpPath) * 2 // 示例计算
    };
    sendJSONResp(space);
}