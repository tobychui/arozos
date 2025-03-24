if (requirelib("imagelib")){
    let base64 = imagelib.loadThumbString(vpath);
    sendResp(base64 ? base64 : "data:image/png;base64,...");// 默认图标
}