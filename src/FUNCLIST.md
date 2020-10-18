# Developer Function List

This is a list for quick referencing any functions for development

## Main Functions (main.go)

### Assistant Functions
```
mv(r *http.Request, getParamter string, postMode bool) => (string, error)
sendTextResponse(w http.ResponseWriter, msg string)
sendJSONResponse(w http.ResponseWriter, json string)
```

## Auth Related (auth.go)

### Service Init
```
system_auth_service_init()
```

### Web Access Functions
```
system_auth_getIPAddress(w,r)
system_auth_extCheckLogin(w,r)
system_auth_register(w,r)
system_auth_unregister(w,r)
system_auth_login(w,r)
system_auth_logout(w,r)

```

### Internal Access Functions
```
system_auth_chkauth(w,r) => bool
system_auth_getUserName(w,r) => (string, error)
system_auth_getUserCounts() => int
system_auth_hash(raw string) => string

```

## Database (database.go)

### Service Init
```
system_db_service_init(dbfile string) *skv.KVStore
```

### Web Access Functions
```
N/A
```

### Internal Access Functions
```
system_db_getValue(dbObject *skv.KVStore,key string) => (string, error)
system_db_setValue(dbObject *skv.KVStore, key string, value string) => bool
system_db_removeValue(dbObject *skv.KVStore, key string) => bool
system_db_closeDatabase(dbObject *skv.KVStore)
```

## File System
### Service Init
```
system_fs_service_init()
```

### Web Access Function
```
system_fs_validateFileOpr(w,r)
system_fs_handleOpr(w,r)
system_fs_handleList(w,r)
system_fs_listRoot(w,r)
system_fs_listDrives(w,r)
system_fs_handleNewObjects(w,r)
system_fs_handleUserPreference(w,r)
system_fs_handleUpload(w,r)
```

### Internal Access Functions
```
//Use the following Glob function to replace filepath.Glob() for user upload directories, 
//Example usage: system_fs_specialGlob("test/mydirectory/") !!CANNOT HANDLE *, RETURN ALL FILES IN DIR ONLY
system_fs_specialGlob(path string)  => ([]string, error)

//Use the following decode function to handle encodeURIComponent URL value
system_fs_specialURIDecode(inputPath string) => string

//Virtual and Realpath translation functions. Return error when permission denied or not exists
virtualPathToRealPath(virtualPath string, username string) => (string, error)
realpathToVirtualpath(realpath string, username string) => (string,error)

//The following function return the rawsize, human readable filesize in float64 and its unit in string
system_fs_getFileSize(path string) => (float64, float64, string, error)
```


## Others

### SMART
```
ReadSMART() => (SMART)
```