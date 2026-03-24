DISM /online /enable-feature /featureName:IIS-WebServerRole /All
del /Q C:\inetpub\wwwroot
rmdir C:\inetpub\wwwroot
gh repo clone tecona-yen/instavideo C:\inetpub\wwwroot
iisreset
start chrome 127.0.0.1:80; if (-not $?) { start msedge 127.0.0.1:80 }