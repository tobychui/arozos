# /bin/sh

echo "Building linux"
#GOOS=linux GOARCH=386 go build
#mv aroz_online build/aroz_online_linux_i386
GOOS=linux GOARCH=amd64 go build
mv aroz_online ../release/aroz_online_linux_amd64
GOOS=linux GOARCH=arm go build
mv aroz_online ../release/aroz_online_linux_arm
GOOS=linux GOARCH=arm64 go build
mv aroz_online ../release/aroz_online_linux_arm64

echo "Removing old build resources"
rm -rf ../release/web/
rm -rf ../release/system/
rm -rf ../release/subservice/

echo "Moving subfolders to build folder"
cp -r ./web ../release/web/
cp -r ./system ../release/system/

rm ../release/system/dev.uuid
rm ../release/system/ao.db
mv ../release/system/storage.json ../release/system/storage.json.example

echo "Completed"
