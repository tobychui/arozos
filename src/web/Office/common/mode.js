/*
    ArozOS Office Suite - build mode flag
    =====================================

    The suite runs in one of two modes and this one-line file is the switch:

      arozos      (this file, as it lives in src/web/Office/)
                  the normal webapp - ArozOS storage, the AGI backends and
                  the Go converters in mod/office are all available.

      standalone  the file the web-viewer generator writes over this one in
                  its output tree (see apps/ArozOS Office Web/generate.go)
                  the suite is served by any dumb static file server, with
                  no ArozOS behind it: documents are opened from and saved
                  back to the visitor's own device, and every server-side
                  conversion (docx / xlsx / pptx / odf / server PDF) is
                  switched off.

    Everything downstream reads the mode through OfficePlatform
    (common/platform.js) rather than testing these flags directly.
*/
window.OFFICE_STANDALONE = false;

/*
    OFFICE_WASM says whether the Office-format converters (mod/office
    compiled to WebAssembly, src/wasm/office) were shipped alongside this
    copy of the suite. It only matters in standalone mode - in ArozOS the
    same conversions run server side through the AGI gateway - so it stays
    false here and the generator sets it when built with -wasm.

    OfficePlatform.canConvert() is the question to ask; hasBackend() stays
    the separate question of whether there is a server at all.
*/
window.OFFICE_WASM = false;
