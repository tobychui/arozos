// filelib.musicglob.js
//
// For each mounted storage root (from LOADED_STORAGES):
//   - glob:  direct children of Music/ (shallow, pattern: Music/*)
//   - aglob: all descendants of Music/ (deep, pattern: Music/**/*)
//
// Note: aglob cannot scan bare root dirs; a sub-path is required.

requirelib("filelib");

var results = [];

for (var i = 0; i < LOADED_STORAGES.length; i++) {
    var storage  = LOADED_STORAGES[i];
    var basePath = storage.Uuid + ":/Music/";

    var globMatches  = filelib.glob( basePath + "*",    "default");
    var aglobMatches = filelib.aglob(basePath + "**/*", "default");

    results.push({
        storage: storage.Name,
        uuid:    storage.Uuid,
        path:    storage.Path,
        glob:    globMatches  || [],
        aglob:   aglobMatches || []
    });
}

sendJSONResp(JSON.stringify(results));
