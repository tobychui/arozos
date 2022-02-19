echo Building openWRT
set GOARCH=mipsle
set GOOS=linux
set GOMIPS=softfloat
set CGO_ENABLED=0
go build -ldflags "-s -w" -trimpath
ren "arozos" "arozos_linux_mipsle"