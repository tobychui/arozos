echo Building openWRT
set GOARCH=riscv64
set GOOS=linux
set CGO_ENABLED=0
go build -ldflags "-s -w" -trimpath
ren "arozos" "arozos_linux_riscv64"