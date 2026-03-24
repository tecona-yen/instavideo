DISM /online /enable-feature /featureName:IIS-WebServerRole /All
del /Q C:\inetpub\wwwroot
rmdir C:\inetpub\wwwroot
gh repo clone tecona-yen/instavideo C:\inetpub\wwwroot
iisreset
New-NetFirewallRule -DisplayName "Web Server For Instavideo" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" }).IPAddress
.\upnpc-static.exe -a $localIP 80 80 TCP
echo Open Ports:
.\upnpc-static.exe -l
start chrome 127.0.0.1:80; if (-not $?) { start msedge 127.0.0.1:80 }