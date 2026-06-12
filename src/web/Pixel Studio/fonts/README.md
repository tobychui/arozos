# Pixel Studio fonts folder

Drop font files into this folder to make them available in the
Pixel Studio text tool. Supported formats:

- `.ttf` (TrueType)
- `.otf` (OpenType)
- `.woff` / `.woff2` (Web Open Font Format)

Fonts are enumerated by `backend/listFonts.js` through the AGI
`appdata` library every time the app starts, so a page reload is all
that is needed after adding or removing files. The display name shown
in the font picker is derived from the filename, e.g.
`Open-Sans_Bold.ttf` becomes "Open Sans Bold".

A set of common system fonts (Arial, Georgia, Courier New, ...) is
always available even when this folder is empty.

Make sure you only place fonts here that you are licensed to use.
