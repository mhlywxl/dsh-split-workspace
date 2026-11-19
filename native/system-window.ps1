<#
    dsh-split-workspace - native Windows system window (WebView2 host).

    DSH Desktop exposes no plugin-facing BrowserWindow API: the plugin Host is
    Electron running in Node mode (ELECTRON_RUN_AS_NODE=1), and the renderer is
    sandboxed with no window-creation surface. This helper is the Windows
    counterpart of native/system-window.jxa: a WinForms form hosting a WebView2
    control that loads the Host's authenticated web client, so the window is a
    real, independent OS window with no browser chrome.

    Usage (started by the plugin Host, never by the user):
        powershell.exe -NoProfile -NonInteractive -Sta -ExecutionPolicy Bypass \
            -WindowStyle Hidden -File system-window.ps1 \
            -UrlB64 <base64 of the authenticated client URL> \
            -WebView2Dir <directory with the WebView2 SDK assets>

    The URL is base64 encoded so session identifiers or query values can never
    be reinterpreted by the PowerShell argument parser. It carries the Host
    launch token once; the page then redirects itself to the clean URL and the
    WebView2 profile keeps the cookie for the rest of the window's life.

    Exit codes: 0 = window closed by the user, 2 = bad arguments,
    3 = WebView2 Runtime missing, 4 = helper assets unusable,
    5 = WebView2 initialization failed, 1 = unexpected failure.
#>

param(
    [Parameter(Mandatory = $true)][string]$UrlB64,
    [string]$WebView2Dir = ''
)

$ErrorActionPreference = 'Stop'

function Write-DsvError([string]$Message) {
    try { [Console]::Error.WriteLine('[dsh-split-workspace] ' + $Message) } catch { }
}

function Exit-Fail([string]$Message, [int]$Code) {
    Write-DsvError $Message
    [Environment]::Exit($Code)
}

$script:form = $null
$script:web = $null
$script:dataDir = $null

# Progress markers: the Host captures this stream into its log, so a failed
# window can be traced to the stage that broke even when no exception text
# reaches the user.
Write-DsvError ('helper start ps=' + $PSVersionTable.PSVersion.ToString()
    + ' edition=' + [string]$PSVersionTable.PSEdition
    + ' os=' + [System.Environment]::OSVersion.VersionString
    + ' arch=' + [string]$env:PROCESSOR_ARCHITECTURE)

try {
    # ---- target ----------------------------------------------------------
    try {
        $target = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($UrlB64))
    } catch {
        Exit-Fail 'invalid UrlB64 payload' 2
    }
    if ([string]::IsNullOrWhiteSpace($target)) { Exit-Fail 'empty system window URL' 2 }

    # ---- DPI awareness (best effort) -------------------------------------
    try {
        Add-Type -Namespace Dsv -Name Dpi -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
'@ | Out-Null
        try { [Dsv.Dpi]::SetProcessDpiAwarenessContext([System.IntPtr]::new(-4)) | Out-Null } catch { }
        try { [Dsv.Dpi]::SetProcessDPIAware() | Out-Null } catch { }
    } catch { }

    # ---- helper assets ---------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($WebView2Dir)) { $WebView2Dir = Join-Path $PSScriptRoot 'webview2' }
    $corePath = Join-Path $WebView2Dir 'Microsoft.Web.WebView2.Core.dll'
    $winFormsPath = Join-Path $WebView2Dir 'Microsoft.Web.WebView2.WinForms.dll'
    $arch = [string]$env:PROCESSOR_ARCHITECTURE
    switch ($arch) {
        'AMD64' { $loaderDir = Join-Path $WebView2Dir 'x64' }
        'ARM64' { $loaderDir = Join-Path $WebView2Dir 'arm64' }
        default { Exit-Fail ('unsupported processor architecture: ' + $arch) 4 }
    }
    $loaderPath = Join-Path $loaderDir 'WebView2Loader.dll'
    foreach ($path in @($corePath, $winFormsPath, $loaderPath)) {
        if (-not (Test-Path -LiteralPath $path)) { Exit-Fail ('missing WebView2 asset: ' + $path) 4 }
    }

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    # WebView2Loader.dll is resolved through DllImport from the Core assembly,
    # so its folder must be on the process DLL search path before any call.
    try {
        Add-Type -Namespace Dsv -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
public static extern bool SetDllDirectory(string path);
'@ | Out-Null
        [Dsv.Native]::SetDllDirectory($loaderDir) | Out-Null
    } catch {
        $env:PATH = $loaderDir + ';' + $env:PATH
    }

    try { [System.Reflection.Assembly]::LoadFrom($corePath) | Out-Null }
    catch { Exit-Fail ('could not load Microsoft.Web.WebView2.Core.dll: ' + $_.Exception.Message) 4 }
    try { [System.Reflection.Assembly]::LoadFrom($winFormsPath) | Out-Null }
    catch { Exit-Fail ('could not load Microsoft.Web.WebView2.WinForms.dll: ' + $_.Exception.Message) 4 }

    # The Evergreen Runtime is installed by Edge on Windows 10/11. Missing
    # runtime is a common, actionable failure: report it with its own code so
    # the client can explain what to install instead of a generic error.
    try {
        $runtimeVersion = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::GetAvailableBrowserVersionString()
        Write-DsvError ('assets ok, WebView2 runtime ' + $runtimeVersion)
    } catch {
        Exit-Fail 'Microsoft Edge WebView2 Runtime is not installed' 3
    }

    # ---- window ----------------------------------------------------------
    # Force-killed helpers (Host close, DSH quit) cannot delete their profile:
    # sweep anything older than a day so profiles never pile up.
    try {
        Get-ChildItem -LiteralPath ([System.IO.Path]::GetTempPath()) -Directory -Filter 'dsh-split-workspace-system-window-*' -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    } catch { }

    $script:dataDir = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-split-workspace-system-window-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:dataDir -Force | Out-Null
    # One browser profile per window: several system windows may be open at
    # once and WebView2 allows only one browser process per data folder.
    $env:WEBVIEW2_USER_DATA_FOLDER = $script:dataDir

    [System.Windows.Forms.Application]::EnableVisualStyles()
    [System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $width = [Math]::Min(1320, [Math]::Max(900, [int]($area.Width * 0.78)))
    $height = [Math]::Min(920, [Math]::Max(640, [int]($area.Height * 0.86)))

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'DeepSeek Harness'
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.MinimumSize = New-Object System.Drawing.Size(720, 520)
    $form.ClientSize = New-Object System.Drawing.Size($width, $height)
    $form.BackColor = [System.Drawing.Color]::FromArgb(15, 17, 21)
    $script:form = $form

    $web = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $web.Dock = [System.Windows.Forms.DockStyle]::Fill
    $script:web = $web
    $form.Controls.Add($web)

    $web.add_CoreWebView2InitializationCompleted({
        param($sender, $eventArgs)
        $failed = $true
        if ($eventArgs -ne $null) { $failed = -not $eventArgs.IsSuccess }
        if ($failed) {
            $reason = 'unknown error'
            if ($eventArgs -ne $null -and $eventArgs.InitializationException -ne $null) {
                $reason = $eventArgs.InitializationException.Message
            }
            Write-DsvError ('WebView2 initialization failed: ' + $reason)
            try {
                [System.Windows.Forms.MessageBox]::Show(
                    'The system window could not start WebView2.' + [Environment]::NewLine + [Environment]::NewLine + $reason,
                    'DeepSeek Harness',
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
            } catch { }
            # Exit non-zero so the Host can report "could not open" instead of
            # leaving the menu in the entered state.
            [Environment]::Exit(5)
            return
        }
        try {
            $core = $sender.CoreWebView2
            # Links that ask for a new window behave like the main DSH window:
            # the request is denied and the URL goes to the default browser.
            $core.add_NewWindowRequested({
                param($s, $e)
                try {
                    $e.Handled = $true
                    $uri = [string]$e.Uri
                    if (-not [string]::IsNullOrWhiteSpace($uri)) { Start-Process -FilePath $uri | Out-Null }
                } catch { }
            })
            $core.add_DocumentTitleChanged({
                param($s, $e)
                try {
                    $title = $s.DocumentTitle
                    if (-not [string]::IsNullOrWhiteSpace($title)) { $script:form.Text = $title }
                } catch { }
            })
            try { $core.Controller.DefaultBackgroundColor = [System.Drawing.Color]::FromArgb(15, 17, 21) } catch { }
            $core.Navigate($target)
        } catch {
            Write-DsvError ('WebView2 navigation failed: ' + $_.Exception.Message)
            try { $script:form.Close() } catch { }
        }
    })

    $form.Add_Shown({
        try { $script:form.Activate() } catch { }
        try { $script:web.Focus() | Out-Null } catch { }
        # The WebView2 control needs the form's window handle: initialize it
        # after the window is shown, while the message loop is running.
        try {
            $null = $script:web.EnsureCoreWebView2Async()
        } catch {
            Write-DsvError ('could not create the WebView2 environment: ' + $_.Exception.Message)
            try {
                [System.Windows.Forms.MessageBox]::Show(
                    'The system window could not create the WebView2 environment.' + [Environment]::NewLine + [Environment]::NewLine + $_.Exception.Message,
                    'DeepSeek Harness',
                    [System.Windows.Forms.MessageBoxButtons]::OK,
                    [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
            } catch { }
            [Environment]::Exit(5)
        }
    })

    $form.Add_FormClosed({
        try { if ($script:web -ne $null) { $script:web.Dispose() } } catch { }
        try {
            if (-not [string]::IsNullOrWhiteSpace($script:dataDir) -and (Test-Path -LiteralPath $script:dataDir)) {
                Remove-Item -LiteralPath $script:dataDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        } catch { }
        [System.Windows.Forms.Application]::Exit()
    })

    Write-DsvError 'window created, entering the message loop'
    [System.Windows.Forms.Application]::Run($form)
    exit 0
} catch {
    Exit-Fail ('system window failed: ' + $_.Exception.Message) 1
}
