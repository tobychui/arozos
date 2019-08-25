
  _    _       _                 _   __  __                                   
 | |  | |     | |               | | |  \/  |                                  
 | |  | |_ __ | | ___   __ _  __| | | \  / | __ _ _ __   __ _  __ _  ___ _ __ 
 | |  | | '_ \| |/ _ \ / _` |/ _` | | |\/| |/ _` | '_ \ / _` |/ _` |/ _ \ '__|
 | |__| | |_) | | (_) | (_| | (_| | | |  | | (_| | | | | (_| | (_| |  __/ |   
  \____/| .__/|_|\___/ \__,_|\__,_| |_|  |_|\__,_|_| |_|\__,_|\__, |\___|_|   
        | |                                                    __/ |          
        |_|                                                   |___/           
==============================================================================
ArOZ Upload Manager - ArOZ Online BETA System Module

# Introduction
The ArOZ upload Manager provide a simple to use interface for module developer
to upload files into their system with a simple API call. The files will be 
uploaded to the target module's uploads/ folder.

# Upload Target
The upload target directory will be the "uploads/" folder inside the target 
directory. For example, if the target is set to "example", the upload target
will be: example/uploads/files.ext

# API
The API of this module is as follow:
Upload Manager/upload_interface.php?target=module_dir&reminder=reminder_text:)
&filetype=ext1,ext2,ext3&finishing=process_handler.php

module_dir is the directory you put your modules. For example, if your module is
placed under "module/index.php", then you put "target=module" here.

reminder_text is the reminder that you want to pop out before letting user to upload
files. Left empty for not poping out any reminder.

ext1,ext2,ext3 are the file types that user is allowed to upload to the server side.
file extensions are seperated with "," and with no space in between.
DO NOT LEFT THIS EMPTY.

process_handler.php is the post processing php that is located inside your module.
For example, if your module is placed under "module/index.php", then you have to put 
the post processing php under "module" also. (i.e. module/process_handler.php")
This variable can be left unset for redirecting back to the target module's index after
the uploading process has been finished.

(C)IMUS Laboratory 2016-2017
Licensed under (CC) NC-ND