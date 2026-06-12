/*
    search.js

    Front-end helpers for the Photo search feature. The reactive state and the
    Alpine methods live in photoListObject() (photo.js); this file only holds the
    pure helpers they delegate to, so the search logic stays out of the big
    component object.

    Backend endpoints used (all under system/ajgi/interface):
      Photo/backend/searchPhotos.js   - run a search
      Photo/backend/searchSuggest.js  - autocomplete suggestions
      Photo/backend/indexPhotos.js    - incremental (auto) indexing
      Photo/backend/indexStatus.js    - index statistics
*/

// POST a JSON payload to a Photo AGI backend script and resolve with parsed JSON.
function aoPhotoBackend(script, payload) {
    return fetch(ao_root + "system/ajgi/interface?script=" + script, {
        method: 'POST',
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
    }).then(function (resp) {
        return resp.json();
    });
}

// Map a suggestion type to a Semantic-UI icon class.
function photoSuggestIcon(type) {
    switch (type) {
        case 'camera':
            return 'camera';
        case 'lens':
            return 'expand';
        case 'date':
            return 'calendar alternate outline';
        case 'type':
            return 'file image outline';
        case 'file':
            return 'image outline';
        case 'filter':
            return 'filter';
        default:
            return 'search';
    }
}

// Simple debounce used for the autocomplete fetch.
function photoDebounce(fn, ms) {
    var timer = null;
    return function () {
        var ctx = this;
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () {
            fn.apply(ctx, args);
        }, ms);
    };
}
