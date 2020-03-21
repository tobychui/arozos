#
# smartd mailer script
#
# Home page of code is: http://www.smartmontools.org
#
# Copyright (C) 2016 Christian Franke
#
# SPDX-License-Identifier: GPL-2.0-or-later
#
# $Id: smartd_mailer.ps1 4760 2018-08-19 18:45:53Z chrfranke $
#

$ErrorActionPreference = "Stop"

# Parse command line and check environment
$dryrun = $false
if (($args.Count -eq 1) -and ($args[0] -eq "--dryrun")) {
  $dryrun = $true
}

$toCsv = $env:SMARTD_ADDRCSV
$subject = $env:SMARTD_SUBJECT
$file = $env:SMARTD_FULLMSGFILE

if (!((($args.Count -eq 0) -or $dryrun) -and $toCsv -and $subject -and $file)) {
  echo `
"smartd mailer script

Usage:
set SMARTD_ADDRCSV='Comma separated mail addresses'
set SMARTD_SUBJECT='Mail Subject'
set SMARTD_FULLMSGFILE='X:\PATH\TO\Message.txt'

.\$($MyInvocation.MyCommand.Name) [--dryrun]
"
  exit 1
}

# Set default sender address
if ($env:COMPUTERNAME -match '^[-_A-Za-z0-9]+$') {
  $hostname = $env:COMPUTERNAME.ToLower()
} else {
  $hostname = "unknown"
}
if ($env:USERDNSDOMAIN -match '^[-._A-Za-z0-9]+$') {
  $hostname += ".$($env:USERDNSDOMAIN.ToLower())"
} elseif (     ($env:USERDOMAIN -match '^[-_A-Za-z0-9]+$') `
          -and ($env:USERDOMAIN -ne $env:COMPUTERNAME)    ) {
  $hostname += ".$($env:USERDOMAIN.ToLower()).local"
} else {
  $hostname += ".local"
}

$from = "smartd daemon <root@$hostname>"

# Read configuration
. .\smartd_mailer.conf.ps1

# Create parameters
$to = $toCsv.Split(",")
$body = Get-Content -Path $file | Out-String

$parm = @{
  SmtpServer = $smtpServer; From = $from; To = $to
  Subject = $subject; Body = $body
}
if ($port) {
  $parm += @{ Port = $port }
}
if ($useSsl) {
  $parm += @{ useSsl = $true }
}

if ($username -and ($password -or $passwordEnc)) {
  if (!$passwordEnc) {
    $secureString = ConvertTo-SecureString -String $password -AsPlainText -Force
  } else {
    $passwordEnc = $passwordEnc -replace '[\r\n\t ]',''
    $secureString = ConvertTo-SecureString -String $passwordEnc
  }
  $credential = New-Object -Typename System.Management.Automation.PSCredential -Argumentlist $username,$secureString
  $parm += @{ Credential = $credential }
}

# Send mail
if ($dryrun) {
  echo "Send-MailMessage" @parm
} else {
  Send-MailMessage @parm
}
