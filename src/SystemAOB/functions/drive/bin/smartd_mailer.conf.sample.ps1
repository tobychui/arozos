# Sample file for smartd_mailer.conf.ps1
#
# Home page of code is: http://www.smartmontools.org
# $Id: smartd_mailer.conf.sample.ps1 4338 2016-09-07 19:31:28Z chrfranke $

# SMTP Server
$smtpServer = "smtp.domain.local"

# Optional settings [default values in square brackets]

# Sender address ["smartd daemon <root@$hostname>"]
#$from = "Administrator <root@domain.local>"

# SMTP Port [25]
#$port = 587

# Use STARTTLS [$false]
#$useSsl = $true

# SMTP user name []
#$username = "USER"

# Plain text SMTP password []
#$password = "PASSWORD"

# Encrypted SMTP password []
# (embedded newlines, tabs and spaces are ignored)
#$passwordEnc = "
#  0123456789abcdef...
#  ...
#"
