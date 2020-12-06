# ArOZ Online Documentation Rendering Interface
This is the documentation rendering script for ArOZ Online Documentation System.
The json files follow the following structure

## How it works
It works by passing the lanauge into the html file as hash and ask the script to search all the JSON files which contain the content of the documentation in the respective directories.

## Structure
The first line is the meta tag in JSON string format and the rest of the document is in markdown format.
For example:
```
["Hello World!"]
# This is a document file for the ArOZ Online System
More lines here
```

The reader.php will then render the JSON content into css + HTML. All image should be placed inside /img directory under the /docs documentation root folder.