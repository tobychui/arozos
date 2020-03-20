# aobws
ArOZ Online Base WebSocket Server 

```
Usage of aobws.exe:
  -cert string
        Certification for TLS encription (default "server.crt")
  -endpt string
        ShadowJWT Validation Endpoint (default "http://localhost/AOB/SystemAOB/system/jwt/validate.php")
  -key string
        Server key for TLS encription (default "server.key")
  -port string
        HTTP service address (default "8000")
  -tls
        Enable TLS support on websocket (aka wss:// instead of ws://). Reqire -cert and -key
```