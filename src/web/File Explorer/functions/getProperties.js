if (requirelib("filelib")){
    let props = {
        Basename: filelib.rname(vpath),
        IsDirectory: filelib.isDir(vpath),
        Size: filelib.filesize(vpath),
        ModTime: filelib.mtime(vpath, true)
    };
    sendJSONResp(props);
}