param(
    [switch]$SkipDiscord,
    [switch]$SkipGitHubDeploySync,
    [switch]$SkipTunnel,
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$script:AwsCommandPath = ""
$script:GitCommandPath = ""
$script:GhCommandPath = ""
$script:SshCommandPath = ""

function Get-EnvValue {
    param(
        [string[]]$Names,
        [string]$DefaultValue = ""
    )

    foreach ($Name in $Names) {
        foreach ($Scope in @("Process", "User", "Machine")) {
            $Value = [Environment]::GetEnvironmentVariable($Name, $Scope)
            if ($null -ne $Value -and $Value.Trim()) {
                return $Value.Trim()
            }
        }
    }

    return $DefaultValue
}

function Get-RequiredEnvValue {
    param(
        [string[]]$Names,
        [string]$Label
    )

    $Value = Get-EnvValue -Names $Names
    if (-not $Value) {
        throw "Missing required environment variable for $Label. Checked: $($Names -join ', ')"
    }
    return $Value
}

function Get-DefaultSshKeyPath {
    $CandidateRoots = @()
    if ($env:USERPROFILE) {
        $CandidateRoots += $env:USERPROFILE
    }
    if ($env:HOMEDRIVE -and $env:HOMEPATH) {
        $CandidateRoots += ($env:HOMEDRIVE + $env:HOMEPATH)
    }

    $CandidateRoots = $CandidateRoots | Select-Object -Unique
    foreach ($Root in $CandidateRoots) {
        foreach ($Name in @("3d-earth-actions-ec2", "id_ed25519", "id_rsa")) {
            $Candidate = Join-Path $Root ".ssh\$Name"
            if (Test-Path -LiteralPath $Candidate) {
                return $Candidate
            }
        }
    }

    return ""
}

function Get-ProjectRoot {
    return Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}

function Get-BridgeRoot {
    $WorkspaceRoot = Split-Path -Parent (Get-ProjectRoot)
    return Join-Path $WorkspaceRoot "DiscorcCon"
}

function Require-CommandPath {
    param([string]$CommandName)

    $Command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($null -ne $Command) {
        return $Command.Source
    }

    $FallbackPaths = @()
    switch ($CommandName.ToLowerInvariant()) {
        "aws" {
            $FallbackPaths = @(
                "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
            )
        }
        "gh" {
            $FallbackPaths = @(
                "C:\Program Files\GitHub CLI\gh.exe"
            )
        }
        "git" {
            $FallbackPaths = @(
                "C:\Program Files\Git\cmd\git.exe",
                "C:\Program Files\Git\bin\git.exe"
            )
        }
        "ssh" {
            $FallbackPaths = @(
                "C:\Windows\System32\OpenSSH\ssh.exe"
            )
        }
    }

    foreach ($Candidate in $FallbackPaths) {
        if (Test-Path -LiteralPath $Candidate) {
            $CandidateDirectory = Split-Path -Parent $Candidate
            if (-not (($env:Path -split ';') -contains $CandidateDirectory)) {
                $env:Path = "$CandidateDirectory;$env:Path"
            }
            return $Candidate
        }
    }

    throw "Required command was not found: $CommandName"
}

function Convert-WindowsPathToWsl {
    param([string]$Path)

    if (-not $Path) {
        return ""
    }

    if ($Path -match '^([A-Za-z]):\\(.*)$') {
        $Drive = $matches[1].ToLowerInvariant()
        $Rest = $matches[2] -replace '\\', '/'
        return "/mnt/$Drive/$Rest"
    }

    throw "Unable to convert Windows path to WSL path: $Path"
}

function Escape-BashSingleQuotedString {
    param([string]$Value)

    $Replacement = [string]::Concat("'", '"', "'", '"', "'")
    return "'" + ($Value -replace "'", $Replacement) + "'"
}

function Format-WindowsCommandArgument {
    param([string]$Value)

    if ($null -eq $Value -or $Value -eq "") {
        return '""'
    }

    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    $Escaped = $Value -replace '(\\*)"', '$1$1\"'
    $Escaped = $Escaped -replace '(\\+)$', '$1$1'
    return '"' + $Escaped + '"'
}

function Invoke-NativeCommandCapture {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    $StdOutFile = [System.IO.Path]::GetTempFileName()
    $StdErrFile = [System.IO.Path]::GetTempFileName()
    $ArgumentString = ($Arguments | ForEach-Object { Format-WindowsCommandArgument -Value ([string]$_) }) -join " "

    try {
        $Process = Start-Process `
            -FilePath $FilePath `
            -ArgumentList $ArgumentString `
            -NoNewWindow `
            -Wait `
            -PassThru `
            -RedirectStandardOutput $StdOutFile `
            -RedirectStandardError $StdErrFile

        $StdOut = ""
        $StdErr = ""

        if (Test-Path -LiteralPath $StdOutFile) {
            $StdOut = (Get-Content -LiteralPath $StdOutFile -Raw -ErrorAction SilentlyContinue)
        }

        if (Test-Path -LiteralPath $StdErrFile) {
            $StdErr = (Get-Content -LiteralPath $StdErrFile -Raw -ErrorAction SilentlyContinue)
        }

        if ($null -eq $StdOut) {
            $StdOut = ""
        }

        if ($null -eq $StdErr) {
            $StdErr = ""
        }

        return [pscustomobject]@{
            ExitCode = $Process.ExitCode
            StdOut = $StdOut.Trim()
            StdErr = $StdErr.Trim()
        }
    }
    finally {
        Remove-Item -LiteralPath $StdOutFile, $StdErrFile -Force -ErrorAction SilentlyContinue
    }
}

function Convert-ToInt {
    param(
        [string]$Value,
        [string]$Label
    )

    try {
        return [int]$Value
    }
    catch {
        throw "$Label must be an integer. Received: $Value"
    }
}

function Invoke-AwsJson {
    param(
        [string[]]$Arguments,
        [string]$Region
    )

    $FullArguments = @()
    if ($Region) {
        $FullArguments += @("--region", $Region)
    }
    $FullArguments += $Arguments

    $Result = Invoke-NativeCommandCapture -FilePath $script:AwsCommandPath -Arguments $FullArguments
    if ($Result.ExitCode -ne 0) {
        $Details = @($Result.StdErr, $Result.StdOut) | Where-Object { $_ }
        throw "aws command failed: aws $($FullArguments -join ' ')`n$([string]::Join([Environment]::NewLine, $Details))"
    }
    return $Result.StdOut | ConvertFrom-Json
}

function Assert-AwsCredentials {
    $Result = Invoke-NativeCommandCapture -FilePath $script:AwsCommandPath -Arguments @(
        "sts",
        "get-caller-identity",
        "--output",
        "json"
    )
    if ($Result.ExitCode -ne 0) {
        $RenderedOutput = [string]::Join(
            [Environment]::NewLine,
            (@($Result.StdErr, $Result.StdOut) | Where-Object { $_ })
        )
        if ($RenderedOutput) {
            throw "AWS credentials are not available.`n$RenderedOutput"
        }
        throw "AWS credentials are not available."
    }
}

function Wait-Aws {
    param(
        [string[]]$Arguments,
        [string]$Region
    )

    $FullArguments = @()
    if ($Region) {
        $FullArguments += @("--region", $Region)
    }
    $FullArguments += $Arguments

    $Result = Invoke-NativeCommandCapture -FilePath $script:AwsCommandPath -Arguments $FullArguments
    if ($Result.ExitCode -ne 0) {
        $Details = @($Result.StdErr, $Result.StdOut) | Where-Object { $_ }
        throw "aws wait failed: aws $($FullArguments -join ' ')`n$([string]::Join([Environment]::NewLine, $Details))"
    }
}

function Get-InstanceInfo {
    param(
        [string]$InstanceId,
        [string]$Region
    )

    return Invoke-AwsJson -Region $Region -Arguments @(
        "ec2",
        "describe-instances",
        "--instance-ids",
        $InstanceId,
        "--query",
        "Reservations[0].Instances[0]",
        "--output",
        "json"
    )
}

function Build-SshArguments {
    param(
        [string]$User,
        [string]$RemoteHost,
        [int]$Port,
        [string]$KeyPath
    )

    $Arguments = @(
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        "-p", "$Port"
    )

    if ($KeyPath) {
        $Arguments += @("-i", $KeyPath)
    }

    $Arguments += "$User@$RemoteHost"
    return $Arguments
}

function Invoke-RemoteCommand {
    param(
        [string[]]$SshArguments,
        [string]$CommandText
    )

    $Result = Invoke-NativeCommandCapture -FilePath $script:SshCommandPath -Arguments ($SshArguments + @($CommandText))
    if ($Result.ExitCode -ne 0) {
        $Details = @($Result.StdErr, $Result.StdOut) | Where-Object { $_ }
        throw "Remote command failed.`n$([string]::Join([Environment]::NewLine, $Details))"
    }
    return $Result.StdOut
}

function Invoke-GhCommand {
    param(
        [string[]]$Arguments
    )

    $Result = Invoke-NativeCommandCapture -FilePath $script:GhCommandPath -Arguments $Arguments
    if ($Result.ExitCode -ne 0) {
        $Details = @($Result.StdErr, $Result.StdOut) | Where-Object { $_ }
        throw "GitHub CLI command failed.`n$([string]::Join([Environment]::NewLine, $Details))"
    }
    return $Result.StdOut
}

function Assert-GitHubCliAuth {
    $Result = Invoke-NativeCommandCapture -FilePath $script:GhCommandPath -Arguments @(
        "auth",
        "status",
        "--hostname",
        "github.com"
    )
    if ($Result.ExitCode -ne 0) {
        $Details = @($Result.StdErr, $Result.StdOut) | Where-Object { $_ }
        throw "GitHub CLI authentication is not available.`n$([string]::Join([Environment]::NewLine, $Details))"
    }
}

function Get-GitHubRepoSlug {
    $ConfiguredRepo = Get-EnvValue -Names @(
        "THREE_D_EARTH_GITHUB_REPO"
    )
    if ($ConfiguredRepo) {
        return $ConfiguredRepo
    }

    $Result = Invoke-NativeCommandCapture -FilePath $script:GitCommandPath -Arguments @(
        "-C",
        (Get-ProjectRoot),
        "config",
        "--get",
        "remote.origin.url"
    )
    if ($Result.ExitCode -ne 0 -or -not $Result.StdOut) {
        throw "Unable to determine GitHub repository from git remote.origin.url."
    }

    $RemoteUrl = $Result.StdOut.Trim()
    $Patterns = @(
        '^https://github\.com/(?<repo>[^/]+/[^/]+?)(?:\.git)?$',
        '^ssh://git@[^/]+/(?<repo>[^/]+/[^/]+?)(?:\.git)?$',
        '^git@[^:]+:(?<repo>[^/]+/[^/]+?)(?:\.git)?$'
    )

    foreach ($Pattern in $Patterns) {
        if ($RemoteUrl -match $Pattern) {
            return $Matches["repo"]
        }
    }

    throw "Unable to parse GitHub repository from remote URL: $RemoteUrl"
}

function Get-RemoteSshEd25519PublicKey {
    param(
        [string[]]$SshArguments
    )

    $Key = Invoke-RemoteCommand `
        -SshArguments $SshArguments `
        -CommandText "awk 'NR==1 {print `$1 "" "" `$2}' /etc/ssh/ssh_host_ed25519_key.pub"

    $NormalizedKey = $Key.Trim()
    if (-not $NormalizedKey) {
        throw "Remote host did not return an ED25519 SSH public key."
    }
    return $NormalizedKey
}

function Sync-GitHubDeploySettings {
    param(
        [string]$Repository,
        [string[]]$SshArguments,
        [string]$DeployHost
    )

    $RemoteHostKey = Get-RemoteSshEd25519PublicKey -SshArguments $SshArguments
    $KnownHostsEntry = "$DeployHost $RemoteHostKey"

    Invoke-GhCommand -Arguments @(
        "variable",
        "set",
        "DEPLOY_HOST",
        "--repo",
        $Repository,
        "--body",
        $DeployHost
    ) | Out-Null

    Invoke-GhCommand -Arguments @(
        "secret",
        "set",
        "DEPLOY_KNOWN_HOSTS",
        "--repo",
        $Repository,
        "--body",
        $KnownHostsEntry
    ) | Out-Null
}

function Build-RemoteTunnelCommand {
    param(
        [string]$DeployPath,
        [int]$AppPort
    )

    $EscapedDeployPath = $DeployPath.Replace("'", "'\''")
    $CommandTemplate = @'
cd '__DEPLOY_PATH__'
if [ -f ./scripts/start-cloudflare-quick-tunnel.sh ]; then
  APP_PORT='__APP_PORT__' bash ./scripts/start-cloudflare-quick-tunnel.sh
else
  APP_PORT='__APP_PORT__'
  RUN_DIR='.run'
  PID_FILE="$RUN_DIR/cloudflared.pid"
  LOG_FILE='/tmp/3d-earth-cloudflared.log'
  TUNNEL_TIMEOUT_SECONDS='45'
  URL_REGEX='https://[-a-zA-Z0-9]+\.trycloudflare\.com'

  mkdir -p "$RUN_DIR"

  if ! command -v cloudflared >/dev/null 2>&1; then
    echo '[tunnel] cloudflared command was not found on the EC2 instance.' >&2
    exit 1
  fi

  if [ -f "$PID_FILE" ]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      kill "$OLD_PID" 2>/dev/null || true
      for _ in $(seq 1 20); do
        if ! kill -0 "$OLD_PID" 2>/dev/null; then
          break
        fi
        sleep 0.5
      done
    fi
    rm -f "$PID_FILE"
  fi

  : >"$LOG_FILE"
  nohup cloudflared tunnel --url "http://127.0.0.1:${APP_PORT}" --no-autoupdate >"$LOG_FILE" 2>&1 &
  NEW_PID=$!
  echo "$NEW_PID" >"$PID_FILE"

  for _ in $(seq 1 "$TUNNEL_TIMEOUT_SECONDS"); do
    URL="$(grep -Eo "$URL_REGEX" "$LOG_FILE" | tail -n 1 || true)"
    if [ -n "$URL" ]; then
      echo "$URL"
      exit 0
    fi
    if ! kill -0 "$NEW_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  echo '[tunnel] Failed to obtain a trycloudflare URL. Last log lines:' >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  exit 1
fi
'@

    return $CommandTemplate.Replace("__DEPLOY_PATH__", $EscapedDeployPath).Replace("__APP_PORT__", [string]$AppPort)
}

function Send-DiscordNotificationViaBridge {
    param(
        [string]$BotToken,
        [string]$OwnerUserId,
        [string]$Content
    )

    $WslCommandPath = Require-CommandPath -CommandName "wsl"
    $BridgeRoot = Get-BridgeRoot
    $BridgePython = Join-Path $BridgeRoot ".venv\bin\python"
    $HelperScript = Join-Path (Get-ProjectRoot) "scripts\send-discord-dm.py"

    if (-not (Test-Path -LiteralPath $BridgePython)) {
        throw "Discord bridge Python was not found: $BridgePython"
    }
    if (-not (Test-Path -LiteralPath $HelperScript)) {
        throw "Discord helper script was not found: $HelperScript"
    }

    $RunDirectory = Join-Path (Get-ProjectRoot) ".run"
    New-Item -ItemType Directory -Path $RunDirectory -Force | Out-Null
    $MessageFile = Join-Path $RunDirectory "discord-notification.txt"
    [System.IO.File]::WriteAllText(
        $MessageFile,
        $Content,
        (New-Object System.Text.UTF8Encoding($false))
    )

    try {
        $BridgePythonWsl = Convert-WindowsPathToWsl $BridgePython
        $HelperScriptWsl = Convert-WindowsPathToWsl $HelperScript
        $MessageFileWsl = Convert-WindowsPathToWsl $MessageFile

        $BashCommandParts = @(
            (Escape-BashSingleQuotedString $BridgePythonWsl)
            (Escape-BashSingleQuotedString $HelperScriptWsl)
            "--token"
            (Escape-BashSingleQuotedString $BotToken)
            "--user-id"
            (Escape-BashSingleQuotedString $OwnerUserId)
            "--message-file"
            (Escape-BashSingleQuotedString $MessageFileWsl)
        )
        $BashCommand = [string]::Join(" ", $BashCommandParts)

        $Output = & $WslCommandPath "bash" "-lc" $BashCommand 2>&1
        if ($LASTEXITCODE -ne 0) {
            $Details = @($Output | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
            throw "Discord bridge send failed.`n$([string]::Join([Environment]::NewLine, $Details))"
        }
    }
    finally {
        Remove-Item -LiteralPath $MessageFile -Force -ErrorAction SilentlyContinue
    }
}

function Test-SshAuthentication {
    param(
        [string[]]$SshArguments
    )

    $Result = Invoke-NativeCommandCapture -FilePath $script:SshCommandPath -Arguments ($SshArguments + @("echo ssh-ok"))
    if ($Result.ExitCode -ne 0) {
        $Details = @($Result.StdErr, $Result.StdOut) | Where-Object { $_ }
        throw "SSH authentication failed.`n$([string]::Join([Environment]::NewLine, $Details))"
    }

    if ($Result.StdOut -notmatch "ssh-ok") {
        throw "SSH authentication probe completed without the expected response."
    }
}

function Send-DiscordNotification {
    param(
        [string]$BotToken,
        [string]$OwnerUserId,
        [string]$Content
    )

    try {
        Send-DiscordNotificationViaBridge `
            -BotToken $BotToken `
            -OwnerUserId $OwnerUserId `
            -Content $Content
        return
    }
    catch {
        $BridgeFailure = $_.Exception.Message
        if ($BridgeFailure) {
            Write-Host "[discord] bridge send failed, falling back to raw REST" -ForegroundColor Yellow
            Write-Host $BridgeFailure -ForegroundColor Yellow
        }

        $Headers = @{
            Authorization = "Bot $BotToken"
            "Content-Type" = "application/json"
        }

        $DmChannel = Invoke-RestMethod `
            -Method Post `
            -Headers $Headers `
            -Uri "https://discord.com/api/v10/users/@me/channels" `
            -Body (@{ recipient_id = $OwnerUserId } | ConvertTo-Json -Compress)

        Invoke-RestMethod `
            -Method Post `
            -Headers $Headers `
            -Uri ("https://discord.com/api/v10/channels/{0}/messages" -f $DmChannel.id) `
            -Body (@{ content = $Content } | ConvertTo-Json -Compress) | Out-Null
    }
}

function Build-StartupSummary {
    param(
        [string]$InstanceId,
        [string]$PublicHost,
        [string]$PublicIp,
        [string]$Url,
        [string]$DeployPath
    )

    $Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
    $Lines = @(
        "3D Earth Explorer is online.",
        "URL: $Url",
        "EC2 Instance: $InstanceId",
        "Public Host: $PublicHost",
        "Public IP: $PublicIp",
        "Deploy Path: $DeployPath",
        "Timestamp: $Timestamp"
    )
    return [string]::Join([Environment]::NewLine, $Lines)
}

$DiscordToken = ""
$DiscordOwnerUserId = ""

try {
    $script:AwsCommandPath = Require-CommandPath -CommandName "aws"
    $script:GitCommandPath = Require-CommandPath -CommandName "git"
    $script:SshCommandPath = Require-CommandPath -CommandName "ssh"
    Assert-AwsCredentials

    $InstanceId = Get-RequiredEnvValue -Label "AWS instance id" -Names @(
        "THREE_D_EARTH_AWS_INSTANCE_ID"
    )
    $Region = Get-EnvValue -Names @(
        "THREE_D_EARTH_AWS_REGION",
        "AWS_REGION",
        "AWS_DEFAULT_REGION"
    )
    $DeployUser = Get-RequiredEnvValue -Label "deploy user" -Names @(
        "THREE_D_EARTH_DEPLOY_USER"
    )
    $DeployPath = Get-RequiredEnvValue -Label "deploy path" -Names @(
        "THREE_D_EARTH_DEPLOY_PATH"
    )
    $DeployPort = Convert-ToInt -Label "deploy port" -Value (Get-EnvValue -Names @(
        "THREE_D_EARTH_DEPLOY_PORT"
    ) -DefaultValue "22")
    $AppPort = Convert-ToInt -Label "app port" -Value (Get-EnvValue -Names @(
        "THREE_D_EARTH_APP_PORT"
    ) -DefaultValue "4173")
    $SshKeyPath = Get-EnvValue -Names @(
        "THREE_D_EARTH_SSH_KEY_PATH"
    )
    if (-not $SshKeyPath) {
        $SshKeyPath = Get-DefaultSshKeyPath
    }

    if (-not $SkipDiscord) {
        $DiscordToken = Get-RequiredEnvValue -Label "Discord bot token" -Names @(
            "THREE_D_EARTH_DISCORD_BOT_TOKEN",
            "CODEX_BRIDGE_DISCORD_TOKEN"
        )
        $DiscordOwnerUserId = Get-RequiredEnvValue -Label "Discord owner user id" -Names @(
            "THREE_D_EARTH_DISCORD_OWNER_USER_ID",
            "CODEX_BRIDGE_DISCORD_OWNER_USER_ID"
        )
    }

    if ($SshKeyPath -and -not (Test-Path -LiteralPath $SshKeyPath)) {
        throw "SSH key path was not found: $SshKeyPath"
    }

    $GitHubRepo = ""
    $CanSyncGitHubDeploySettings = -not $SkipGitHubDeploySync
    if ($CanSyncGitHubDeploySettings) {
        try {
            $script:GhCommandPath = Require-CommandPath -CommandName "gh"
            Assert-GitHubCliAuth
            $GitHubRepo = Get-GitHubRepoSlug
        }
        catch {
            $CanSyncGitHubDeploySettings = $false
            $Reason = $_.Exception.Message
            if ($Reason) {
                Write-Host "[github] deploy setting sync disabled: $Reason" -ForegroundColor Yellow
            }
        }
    }

    if ($ValidateOnly) {
        $ValidateInstance = Get-InstanceInfo -InstanceId $InstanceId -Region $Region
        if ($null -eq $ValidateInstance) {
            throw "Unable to locate EC2 instance: $InstanceId"
        }

        $ValidateHost = [string]$ValidateInstance.PublicDnsName
        if (-not $ValidateHost) {
            $ValidateHost = [string]$ValidateInstance.PublicIpAddress
        }

        Write-Host "[validate] aws: OK"
        Write-Host "[validate] aws credentials: OK"
        Write-Host "[validate] ssh: OK"
        Write-Host "[validate] instance id: $InstanceId"
        Write-Host "[validate] region: $Region"
        Write-Host "[validate] deploy target: $DeployUser@$DeployPath"
        Write-Host "[validate] app port: $AppPort"
        if ($SshKeyPath) {
            Write-Host "[validate] ssh key: $SshKeyPath"
        }
        else {
            Write-Host "[validate] ssh key: <default ssh config or agent>"
        }
        if ($ValidateHost) {
            $ValidateSshArguments = Build-SshArguments `
                -User $DeployUser `
                -RemoteHost $ValidateHost `
                -Port $DeployPort `
                -KeyPath $SshKeyPath
            Test-SshAuthentication -SshArguments $ValidateSshArguments
            Write-Host "[validate] ssh authentication: OK"
        }
        else {
            Write-Host "[validate] ssh authentication: skipped (instance has no public host yet)"
        }
        if ($CanSyncGitHubDeploySettings) {
            Write-Host "[validate] github deploy sync: $GitHubRepo"
        }
        elseif ($SkipGitHubDeploySync) {
            Write-Host "[validate] github deploy sync: skipped by parameter"
        }
        else {
            Write-Host "[validate] github deploy sync: unavailable"
        }
        if ($SkipTunnel) {
            Write-Host "[validate] tunnel: skipped by parameter"
        }
        else {
            Write-Host "[validate] tunnel mode: cloudflare quick tunnel on EC2"
        }
        if ($SkipDiscord) {
            Write-Host "[validate] discord: skipped by parameter"
        }
        else {
            Write-Host "[validate] discord owner user id: $DiscordOwnerUserId"
        }
        exit 0
    }

    $Instance = Get-InstanceInfo -InstanceId $InstanceId -Region $Region
    if ($null -eq $Instance) {
        throw "Unable to locate EC2 instance: $InstanceId"
    }

    $State = [string]$Instance.State.Name
    if ($State -eq "stopped" -or $State -eq "stopping") {
        Write-Host "[aws] Starting EC2 instance $InstanceId"
        $null = Invoke-AwsJson -Region $Region -Arguments @(
            "ec2",
            "start-instances",
            "--instance-ids",
            $InstanceId,
            "--output",
            "json"
        )
    }
    else {
        Write-Host "[aws] EC2 instance $InstanceId is already $State"
    }

    Write-Host "[aws] Waiting for instance-running"
    Wait-Aws -Region $Region -Arguments @(
        "ec2",
        "wait",
        "instance-running",
        "--instance-ids",
        $InstanceId
    )

    Write-Host "[aws] Waiting for instance-status-ok"
    Wait-Aws -Region $Region -Arguments @(
        "ec2",
        "wait",
        "instance-status-ok",
        "--instance-ids",
        $InstanceId
    )

    $Instance = Get-InstanceInfo -InstanceId $InstanceId -Region $Region
    $PublicHost = [string]$Instance.PublicDnsName
    if (-not $PublicHost) {
        $PublicHost = [string]$Instance.PublicIpAddress
    }
    $PublicIp = [string]$Instance.PublicIpAddress
    if (-not $PublicHost) {
        throw "EC2 instance is running but has no public DNS or public IP."
    }

    $GitHubDeployHost = $PublicIp
    if (-not $GitHubDeployHost) {
        $GitHubDeployHost = $PublicHost
    }

    $SshArguments = Build-SshArguments `
        -User $DeployUser `
        -RemoteHost $PublicHost `
        -Port $DeployPort `
        -KeyPath $SshKeyPath

    if ($CanSyncGitHubDeploySettings) {
        Write-Host "[github] Syncing DEPLOY_HOST and DEPLOY_KNOWN_HOSTS for $GitHubRepo"
        Sync-GitHubDeploySettings `
            -Repository $GitHubRepo `
            -SshArguments $SshArguments `
            -DeployHost $GitHubDeployHost
    }

    Write-Host "[remote] Deploying and starting app on $PublicHost"
    $null = Invoke-RemoteCommand `
        -SshArguments $SshArguments `
        -CommandText ("cd '{0}' && bash ./scripts/deploy-on-ec2.sh" -f $DeployPath.Replace("'", "'\''"))

    if ($SkipTunnel) {
        $Url = "http://${PublicHost}:$AppPort/"
    }
    else {
        Write-Host "[remote] Starting Cloudflare quick tunnel"
        $Url = Invoke-RemoteCommand `
            -SshArguments $SshArguments `
            -CommandText (Build-RemoteTunnelCommand -DeployPath $DeployPath -AppPort $AppPort)
    }

    $Summary = Build-StartupSummary `
        -InstanceId $InstanceId `
        -PublicHost $PublicHost `
        -PublicIp $PublicIp `
        -Url $Url `
        -DeployPath $DeployPath

    Write-Host ""
    Write-Host $Summary

    if (-not $SkipDiscord) {
        Write-Host ""
        Write-Host "[discord] Sending notification"
        Send-DiscordNotification `
            -BotToken $DiscordToken `
            -OwnerUserId $DiscordOwnerUserId `
            -Content $Summary
        Write-Host "[discord] Notification sent"
    }
}
catch {
    $ErrorParts = @()

    if ($_.Exception -and $null -ne $_.Exception.Message) {
        $Message = $_.Exception.Message.Trim()
        if ($Message) {
            $ErrorParts += $Message
        }
    }

    if ($_.ErrorDetails -and $null -ne $_.ErrorDetails.Message) {
        $Message = $_.ErrorDetails.Message.Trim()
        if ($Message) {
            $ErrorParts += $Message
        }
    }

    $RenderedRecord = ($_ | Out-String).Trim()
    if ($RenderedRecord -and $ErrorParts.Count -eq 0) {
        $ErrorParts += $RenderedRecord
    }

    $ErrorMessage = ($ErrorParts | Select-Object -Unique) -join [Environment]::NewLine
    if (-not $ErrorMessage) {
        $ErrorMessage = "3D Earth Explorer startup failed with an unknown error."
    }

    Write-Host ""
    Write-Host "[error]" -ForegroundColor Red -NoNewline
    Write-Host " $ErrorMessage" -ForegroundColor Red

    if (-not $SkipDiscord -and $DiscordToken -and $DiscordOwnerUserId) {
        try {
            $FailureText = [string]::Join([Environment]::NewLine, @(
                "3D Earth Explorer startup failed.",
                $ErrorMessage
            ))
            Send-DiscordNotification `
                -BotToken $DiscordToken `
                -OwnerUserId $DiscordOwnerUserId `
                -Content $FailureText
        }
        catch {
        }
    }

    exit 1
}
