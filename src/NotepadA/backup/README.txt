
  _____  _           _           _____ _        _   _             
 |  __ \| |         | |         / ____| |      | | (_)            
 | |__) | |__   ___ | |_ ___   | (___ | |_ __ _| |_ _  ___  _ __  
 |  ___/| '_ \ / _ \| __/ _ \   \___ \| __/ _` | __| |/ _ \| '_ \ 
 | |    | | | | (_) | || (_) |  ____) | || (_| | |_| | (_) | | | |
 |_|    |_| |_|\___/ \__\___/  |_____/ \__\__,_|\__|_|\___/|_| |_|
                                                                  
                                                                  
=================================================================
Standard Photo Station - ArOZ Online BETA Standard Functional Module

# Introduction
The Photo Station allow user to view image uploaded to the system.
Photo Station support folder sorting and filename sorting. And this
is just a simple system that show you image store in this module.

# Functions
1. View Photos
2. Download Photos
3. Upload Photos (via ArOZ Online BETA Upload Manager)
4. Sort Photos into different directory
5. Support jpg,jpeg,gif and png

# API
The photo station provide extremely simple API for applying custom
search, sorting and folder viewing.

The API has the following format:
Photo/index.php?folder=folder_name&search=keyword&sort=mode

folder_name is the name of the directory for image scanning
keyword is the keyword for searching the image. (in string, not hex code)
mode is the sorting mode used. Left empty for filename in ascending order,
set to "reverse" for descending order.

(C)IMUS Laboratory 2016-2017
Licensed under MIT
