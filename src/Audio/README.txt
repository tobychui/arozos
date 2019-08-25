
                    _ _         __  __           _       _      
     /\            | (_)       |  \/  |         | |     | |     
    /  \  _   _  __| |_  ___   | \  / | ___   __| |_   _| | ___ 
   / /\ \| | | |/ _` | |/ _ \  | |\/| |/ _ \ / _` | | | | |/ _ \
  / ____ \ |_| | (_| | | (_) | | |  | | (_) | (_| | |_| | |  __/
 /_/    \_\__,_|\__,_|_|\___/  |_|  |_|\___/ \__,_|\__,_|_|\___|
                                                                
                                                                
=================================================================
Standard Audio Module - ArOZ Online BETA Standard Functional Module

# Introduction
The standard audio module for ArOZ Online BETA allow user to play
audio files within the system and support ArOZ background worker.

# Functions
1. Audio Controls include "Play", "Pause", "Stop", "Next Song", 
"Previous Song", "Vol up", "Vol Down", "Repeat Mode".
2. Song list generated from "uploads/" directory
3. Download Mode (Enable via bottom menu)
4. Upload Mode (Require ArOZ Online Upload Manager)
5. Share Mode (Require IMUS QuickSend portable)

# API
## Index.php - Standard playing interface
The Standard Audio Modules support API callback with GET variables.
The following are the format and examples for API access:

Audio/?share=file_path_to_audio_file&display=display_file_name&id=file_id_in_list

file_path_to_audio_file is the path to the files under uploads/.
display_file_name is the converted name for the file.
file_id_in_list is the id for the required audio in playlist.

For Example:
Audio/?share=uploads/inith47726973616961206e6f204b616a6974737520454434205375622045737061c3b16f6c.mp3
&display=Grisaia no Kajitsu ED4 Sub Español&id=6

will play the file with path:
uploads/inith47726973616961206e6f204b616a6974737520454434205375622045737061c3b16f6c.mp3

and display the song name as:
Grisaia no Kajitsu ED4 Sub Español

which is located in the playlist of item number:
6

## Using the standard playing interface for playing external audio source

The standard playing interface can be used to play external audio source with the following command:
Audio/?share=url_to_file&display=display_file_name&id=-1

For example,
Audio/?share=http://example.com/test.mp3&display=Testing Song&id=-1

The above url will play the audio at:
http://example.com/test.mp3

And display it as:
Testing Song

(C)IMUS Laboratory 2016-2017
Licensed under MIT
