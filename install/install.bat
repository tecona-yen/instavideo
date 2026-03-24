DISM /online /enable-feature /featureName:IIS-WebServerRole /All
robocopy .\ C:\inetpub\wwwroot /e
powershell start iisconfig.ps1 -ExecutionPolicy Bypass
iisreset
echo Now testing web server
start 127.0.0.1:80
PAUSE