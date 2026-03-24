DISM /online /enable-feature /featureName:IIS-WebServerRole /All
robocopy .\ C:\inetpub\wwwroot /e
iisreset
PAUSE