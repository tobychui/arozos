if (!requirelib("filelib")) {
    sendJSONResp(JSON.stringify({error: "Unable to load filelib"}));
    return;
}

try {
    // 处理路径参数
    let targetPath = typeof dirParam !== "undefined" ? decodeURIComponent(dirParam) : "user:/";
    
    // 规范化路径格式
    if (!targetPath.endsWith("/")) targetPath += "/";
    targetPath = targetPath.replace(/\/+/g, "/");

    // 特殊处理根目录
    if (targetPath === "root/") {
        let rootDirs = filelib.glob("/");
        let rootInfo = rootDirs.map(root => ({
            Filename: filelib.rootName(root) || root.split("/")[1],
            Filepath: root + "Music/", // 保持与音乐模块一致的路径结构
            IsDir: true,
            Filesize: 0,
            ModTime: new Date().toISOString()
        }));
        sendJSONResp(JSON.stringify({files: rootInfo, sort: "default"}));
        return;
    }

    // 读取目录内容
    let dirContents = filelib.readdir(targetPath);
    
    // 转换数据结构
    let processedFiles = dirContents.map(item => ({
        Filename: item.Filename,
        Filepath: item.Filepath,
        Filesize: item.Filesize,
        ModTime: item.Modtime ? new Date(item.Modtime).toISOString() : new Date().toISOString(),
        IsDir: item.IsDir,
        Realpath: item.Realpath || item.Filepath // 保持向后兼容
    }));

    // 应用排序（示例实现，可根据需要扩展）
    if (sortParam === "name") {
        processedFiles.sort((a, b) => a.Filename.localeCompare(b.Filename));
    } else if (sortParam === "size") {
        processedFiles.sort((a, b) => b.Filesize - a.Filesize);
    }

    sendJSONResp(JSON.stringify({
        files: processedFiles,
        sort: sortParam || "default"
    }));

} catch (error) {
    console.error("Directory listing error:", error);
    sendJSONResp(JSON.stringify({
        error: `无法读取目录: ${error.message}`,
        code: 500
    }));
}