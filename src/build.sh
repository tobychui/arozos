# /bin/sh
echo "Building darwin"
#GOOS=darwin GOARCH=386 go build
#mv aroz_online build/aroz_online_macOS_i386
GOOS=darwin GOARCH=amd64 go build
mv arozos ../aroz_online_autorelease/arozos_darwin_amd64

echo "Building linux"
#GOOS=linux GOARCH=386 go build
#mv aroz_online build/aroz_online_linux_i386
GOOS=linux GOARCH=amd64 go build
mv arozos ../aroz_online_autorelease/arozos_linux_amd64
GOOS=linux GOARCH=arm GOARM=6 go build
mv arozos ../aroz_online_autorelease/arozos_linux_arm
GOOS=linux GOARCH=arm GOARM=7 go build
mv arozos ../aroz_online_autorelease/arozos_linux_armv7
GOOS=linux GOARCH=arm64 go build
mv arozos ../aroz_online_autorelease/arozos_linux_arm64

#Currently not CGO is required to build arozos. May remove dependencies later in the future
#echo "Building OpenWRT"
#GOOS=linux GOARCH=mipsle GOMIPS=softfloat CGO_ENABLED=0 go build
#mv arozos ../aroz_online_autorelease/arozos_linux_mipsle

echo "Building windows"
#GOOS=windows GOARCH=386 go build
#mv aroz_online.exe aroz_online_windows_i386.exe
GOOS=windows GOARCH=amd64 go build
mv arozos.exe ../aroz_online_autorelease/arozos_windows_amd64.exe

echo "Removing old build resources"
rm -rf ../aroz_online_autorelease/web/
rm -rf ../aroz_online_autorelease/system/
#rm -rf ../aroz_online_autorelease/subservice/

echo "Moving subfolders to build folder"
cp -r ./web ../aroz_online_autorelease/web/
#cp -r ./subservice ../aroz_online_autorelease/subservice/
cp -r ./system ../aroz_online_autorelease/system/

rm ../aroz_online_autorelease/system/dev.uuid
rm ../aroz_online_autorelease/system/ao.db
mv ../aroz_online_autorelease/system/storage.json ../aroz_online_autorelease/system/storage.json.example
rm -rf ../aroz_online_autorelease/system/aecron/
rm ../aroz_online_autorelease/system/cron.json

echo "Creating tarball for all required files"
cd ../aroz_online_autorelease/
rm web.tar.gz
tar -czf web.tar system/ web/

cd ../arozos/
go build
echo "Completed"
