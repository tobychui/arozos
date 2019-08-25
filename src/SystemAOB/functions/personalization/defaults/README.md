#### READ ME
This directory contains all the required configuration for ArOZ Online System.
To facilitate the auto configuration generator and editor, please use the following methods (or rules) when creating configuration in this folder.

1. When naming a configuration, please try to match your script filename or your module name. If due to some reason you cannot name it according to your module's name, please give your config file a meaningful name.
2. Different config format has different rules for arranging the variables. The most common one will be "Setting Name", "Setting Description", "Input Type" and "default Value". Please try to follow this rule when creating new configs.
3. For non-system related configs, please put them inside the module you are working with unless it has in deep interaction withe the ArOZ Online Base System (e.g. Modification of the original file system mechanism / brand new cluster naming method etc)

##### Documented Standards
These are the current documented standards (Input Types) for configuration generations.

- file (Path start from AOR or /media)
- color (#00000 - #FFFFFF)
- boolean (true / false)
- string (anything that you can type on keyboard)
- integer (numeric)
