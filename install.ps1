Echo IIS will now be installed
DISM /online /enable-feature /featureName:IIS-WebServerRole /All
echo Ensure nothing important is in the wwwroot folder before continuing
remove-item -Force -Recurse C:\inetpub\wwwroot\*.*
remove-item -Force C:\inetpub\wwwroot
echo Ensure Github CLI is installed before proceeding
pause
gh repo clone tecona-yen/instavideo C:\inetpub\wwwroot
iisreset




New-NetFirewallRule -DisplayName "Web Server For Instavideo" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
start chrome 127.0.0.1:80; if (-not $?) { start msedge 127.0.0.1:80 }

Write-output "enable port fowarding now upnp? if behind cgn-nat or double nat this may not work, if the internet gateway has diabled upnp or does not support the correct upnp schemas it will not work, firewalls can also intefare with upnp, success is not guarenteed either way"

#get the best local IP to port foward
function Get-PrimaryPrivateIP {
    # Get all real physical adapters that are UP
    $adapters = Get-NetAdapter |
        Where-Object {
            $_.Status -eq "Up" -and
            $_.HardwareInterface -eq $true -and
            $_.InterfaceDescription -notmatch "Virtual|VPN|Tunnel|Hyper-V|Loopback"
        }

    # Get all IPv4 private addresses from those adapters
    $ips = foreach ($a in $adapters) {
        Get-NetIPAddress -InterfaceIndex $a.InterfaceIndex -AddressFamily IPv4 |
            Where-Object {
                $_.IPAddress -notlike "169.254.*" -and
                $_.IPAddress -match "^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)"
            } |
            Select-Object @{
                n="IP"; e={$_.IPAddress}
            }, @{
                n="Metric"; e={$_.InterfaceMetric}
            }, @{
                n="IfDesc"; e={$a.InterfaceDescription}
            }, @{
                n="IfAlias"; e={$a.Name}
            }
    }

    if (-not $ips) { return $null }

    # Apply stable preference: Ethernet > Wi-Fi > everything else
    $ordered = $ips | Sort-Object `
        @{Expression = { 
            if ($_.IfDesc -match "Ethernet") { 1 }
            elseif ($_.IfDesc -match "Wi-?Fi|WLAN|Wireless") { 2 }
            else { 3 }
        }}, `
        @{Expression = { $_.Metric }}

    return $ordered[0].IP
}

$IP = Get-PrimaryPrivateIP
Echo "port fowarded will be attempted on $IP"
Invoke-WebRequest -Uri "http://miniupnp.free.fr/files/upnpc-exe-win32-20220515.zip" -OutFile "$env:temp\upnp-tools.zip"
Expand-Archive -Path "$env:temp\upnp-tools.zip" -DestinationPath upnp\
upnp\upnpc-static.exe -a $IP 80 80 TCP
remove-item -Force -Recurse upnp\
