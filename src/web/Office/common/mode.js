/*
    ArozOS Office Suite - build mode flag
    =====================================

    The suite runs in one of two modes and this one-line file is the switch:

      arozos      (this file, as it lives in src/web/Office/)
                  the normal webapp - ArozOS storage, the AGI backends and
                  the Go converters in mod/office are all available.

      standalone  the file the web-viewer generator writes over this one in
                  its output tree (see apps/arozos_office/generate.go)
                  the suite is served by any dumb static file server, with
                  no ArozOS behind it: documents are opened from and saved
                  back to the visitor's own device, by the Office format
                  code compiled to WebAssembly instead of the AGI backends.

    Everything downstream reads the mode through OfficePlatform
    (common/platform.js) rather than testing these flags directly.
*/
window.OFFICE_STANDALONE = false;

/*
    OFFICE_WASM says whether the Office format code (mod/office compiled to
    WebAssembly, src/wasm/office) was shipped alongside this copy of the
    suite. It only matters in standalone mode - in ArozOS the same code runs
    server side through the AGI gateway - so it stays false here, and the
    generator, which always builds the module, sets it: the documents are
    .docx / .xlsx / .pptx, and nothing opens or saves them without it.

    OfficePlatform.canConvert() is the question to ask; hasBackend() stays
    the separate question of whether there is a server at all.
*/
window.OFFICE_WASM = false;
