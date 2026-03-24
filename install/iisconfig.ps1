Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole
Install-WindowsFeature -name Web-Server -IncludeManagementTools
Import-Module IISAdministration
Import-Module WebAdministration
Get-IISSite
Get-Websites