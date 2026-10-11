/*
Package odf converts between the editor models and the OpenDocument formats:

	.odt  ParseOdt / BuildOdt  text documents (model.Document)
	.ods  ParseOds / BuildOds  spreadsheets (model.Workbook)
	.odp  ParseOdp / BuildOdp  presentations (model.Presentation)

The three share the ODF package plumbing in odf.go: the zip container with
its manifest, a namespace-aware XML tree, meta.xml and picture handling.
*/
package odf
