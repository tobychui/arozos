Extract 7z and others zip

7za.exe (a = alone) is a standalone version of 7-Zip. 7za.exe supports only 7z, lzma, cab, zip, gzip, bzip2, Z and tar formats. 7za.exe doesn't use external modules.

Troubleshoot:
File can't unzipped
> Try fix the permission
sudo chmod 0777 7za_x86
sudo chmod 0777 7za
sudo chmod -R 0777 tmp
sudo chown www-data:www-data 7za_x86
sudo chown www-data:www-data 7za
