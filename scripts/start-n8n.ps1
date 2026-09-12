# Axiolyn Lead Automation - n8n launcher
#
# Starts the locally-installed n8n (npm global, v2.35.7) with the environment
# this project needs. Run this in its own PowerShell window and leave it open --
# n8n runs in the foreground and stops when the window closes.
#
#   Usage:  .\scripts\start-n8n.ps1
#   Then:   open http://localhost:5678
#
# NOTE: N8N_ENCRYPTION_KEY is deliberately NOT set here. A key already exists in
# ~/.n8n/config. Setting a different value would make every saved credential
# undecryptable. Leave it alone.

# Schedule Triggers fire in this timezone. Without it, n8n uses UTC and your
# "9am daily" run happens at 2pm Pakistan time.
$env:GENERIC_TIMEZONE = "Asia/Karachi"
$env:TZ               = "Asia/Karachi"

# Allows Code nodes to use Node built-ins. Needed in Phase 4 for free email
# validation via MX record lookup (dns) and for lead_id hashing (crypto).
$env:NODE_FUNCTION_ALLOW_BUILTIN = "dns,crypto,url"

# Allows Code nodes to import these npm packages. cheerio ships with n8n;
# libphonenumber-js is installed separately in Phase 4 for E.164 phone
# normalization (03xx-xxxxxxx -> +923xxxxxxxxx).
$env:NODE_FUNCTION_ALLOW_EXTERNAL = "libphonenumber-js,cheerio"

# Public REST API must be on for the n8n MCP server to manage workflows.
$env:N8N_PUBLIC_API_DISABLED = "false"

# Local dev over plain http, so the secure-cookie requirement has to be relaxed
# or login fails on some browsers.
$env:N8N_SECURE_COOKIE = "false"

Write-Host ""
Write-Host "  Axiolyn Lead Automation - starting n8n" -ForegroundColor Cyan
Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
Write-Host "  Timezone     : $env:GENERIC_TIMEZONE"
Write-Host "  Data dir     : $env:USERPROFILE\.n8n"
Write-Host "  Editor       : http://localhost:5678"
Write-Host ""
Write-Host "  Leave this window open. Ctrl+C stops n8n." -ForegroundColor Yellow
Write-Host ""

n8n start
