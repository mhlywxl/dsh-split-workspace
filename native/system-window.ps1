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
            -File system-window.ps1 \
            -UrlB64 <base64 of the authenticated client URL> \
            -WebView2Dir <directory with the WebView2 SDK assets> \
            -LogPath <file to append this attempt's diagnostics to>

    The Host also exports DSV_HELPER_LOG with the same trace path, so the trace
    survives a TEMP path that would break PowerShell's argument parsing.

    The URL is base64 encoded so session identifiers or query values can never
    be reinterpreted by the PowerShell argument parser. It carries the Host
    launch token once; the page then redirects itself to the clean URL and the
    WebView2 profile keeps the cookie for the rest of the window's life.

    Diagnostics: every stage is appended to -LogPath (a temp file the Host
    passes in and reads back when the window fails to open) and mirrored to
    stderr. Console/stderr writes can be lost when the process is started from
    an Electron parent without a console, so the log file is the authoritative
    trace: a failure that writes no stderr still leaves a stage in the log.

    Exit codes: 0 = window closed by the user, 2 = bad arguments,
    3 = WebView2 Runtime missing, 4 = helper assets unusable,
    5 = WebView2 initialization failed, 1 = unexpected failure.
#>

param(
    # Deliberately NOT mandatory: a mandatory parameter + -NonInteractive fails
    # argument binding before any of this script runs, which is exactly the kind
    # of silent startup failure we are trying to make visible.
    [string]$UrlB64 = '',
    [string]$WebView2Dir = '',
    [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'

$script:logPath = $LogPath
$script:form = $null
$script:web = $null
$script:dataDir = $null

function Get-DsvLogPath {
    if (-not [string]::IsNullOrWhiteSpace($script:logPath)) { return $script:logPath }
    # The Host passes -LogPath, but it also exports DSV_HELPER_LOG so the trace
    # file path does not have to survive PowerShell's command-line parsing rules
    # (a profile/TEMP path containing a quote would break argument binding).
    $fromEnv = [string]$env:DSV_HELPER_LOG
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) { return $fromEnv }
    $temp = [string]$env:TEMP
    if ([string]::IsNullOrWhiteSpace($temp)) {
        try { $temp = [System.IO.Path]::GetTempPath() } catch { }
    }
    if ([string]::IsNullOrWhiteSpace($temp)) { return '' }
    return (Join-Path $temp 'dsh-split-workspace-system-window-helper.log')
}

function Write-DsvLog([string]$Message) {
    $line = '[' + (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffzzz') + '] ' + $Message
    try { [Console]::Error.WriteLine('[dsh-split-workspace] ' + $Message) } catch { }
    try {
        $path = Get-DsvLogPath
        if (-not [string]::IsNullOrWhiteSpace($path)) {
            [System.IO.File]::AppendAllText($path, $line + [Environment]::NewLine)
        }
    } catch { }
}

function Write-DsvException([string]$Stage, $ErrorRecord) {
    $text = ''
    try { $text = $ErrorRecord.Exception.ToString() } catch { try { $text = [string]$ErrorRecord } catch { } }
    Write-DsvLog ('exception at ' + $Stage + ': ' + $text)
    try {
        $stack = [string]$ErrorRecord.ScriptStackTrace
        if (-not [string]::IsNullOrWhiteSpace($stack)) { Write-DsvLog ('  stack: ' + $stack) }
    } catch { }
}

function Exit-Dsv([int]$Code, [string]$Why) {
    Write-DsvLog ('exiting code=' + $Code + ' (' + $Why + ')')
    [Environment]::Exit($Code)
}

# Force the form's OS window on screen. The first ShowWindow call of a process
# created with STARTF_USESHOWWINDOW|SW_HIDE is ignored (WinForms' own show is
# turned into SW_HIDE), every later call is honored — so this is the fix for
# "form shown visible=True" with no window on screen.
function Show-DsvWindow($Form) {
    if ($Form -eq $null) { return $false }
    try {
        if (-not $Form.IsHandleCreated) { return $false }
        $handle = $Form.Handle
        $null = [Dsv.Window]::ShowWindow($handle, 5)   # SW_SHOW
        $null = [Dsv.Window]::ShowWindow($handle, 1)   # SW_SHOWNORMAL
        # SetForegroundWindow is routinely denied by the foreground lock when a
        # helper is started from the background, and a window the user cannot
        # find is indistinguishable from a closed one: flash TopMost instead.
        try {
            $Form.TopMost = $true
            $Form.TopMost = $false
        } catch { }
        try { $Form.Activate() } catch { }
        $null = [Dsv.Window]::SetForegroundWindow($handle)
        return $true
    } catch {
        Write-DsvException 'Show-DsvWindow' $_
        return $false
    }
}

# The real on-screen state, as opposed to WinForms' managed Visible property.
function Test-DsvWindowVisible($Form) {
    try {
        if ($Form -eq $null -or -not $Form.IsHandleCreated) { return $false }
        return [Dsv.Window]::IsWindowVisible($Form.Handle)
    } catch {
        return $false
    }
}

# The first trace line must not depend on anything that can fail: it proves
# whether PowerShell even ran this script, which the Host needs to know.
# NOTE: every multi-line expression below keeps its operators at the END of the
# line. PowerShell only continues a line after an opening bracket, a comma, a
# binary operator or a pipe — a line that STARTS with `+` is a parse error, and
# a parse error before the first statement is exactly the silent-startup class
# this script exists to make visible.
Write-DsvLog 'helper enter'
$scriptInfo = @(
    ('script=' + [string]$PSCommandPath)
    ('ps=' + $PSVersionTable.PSVersion.ToString())
    ('edition=' + [string]($PSVersionTable.PSEdition))
    ('apm=' + [string]([System.Threading.Thread]::CurrentThread.GetApartmentState()))
    ('os=' + [System.Environment]::OSVersion.VersionString)
    ('arch=' + [string]$env:PROCESSOR_ARCHITECTURE)
    ('64bit=' + [string]([System.Environment]::Is64BitProcess))
    ('interactive=' + [string]([System.Environment]::UserInteractive))
) -join ' | '
Write-DsvLog ('  ' + $scriptInfo)
try { Write-DsvLog ('  cwd=' + (Get-Location).Path + ' urlb64len=' + ([string]$UrlB64).Length) } catch { }

# Anything that escapes the script body (WinForms message-loop exceptions, a
# thrown .NET exception that PowerShell does not route to its catch) is logged
# here instead of disappearing with the process.
try {
    [AppDomain]::CurrentDomain.add_UnhandledException({
        param($sender, $eventArgs)
        try {
            $exception = 'unknown'
            if ($eventArgs -ne $null -and $eventArgs.ExceptionObject -ne $null) {
                $exception = $eventArgs.ExceptionObject.ToString()
            }
            Write-DsvLog ('UNHANDLED PROCESS EXCEPTION: ' + $exception)
        } catch { }
        try { [Console]::Error.Flush() } catch { }
        try { [Environment]::Exit(1) } catch { }
    })
} catch { }

try {
    # ---- arguments -------------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($UrlB64)) {
        Exit-Dsv 2 'missing -UrlB64'
    }
    try {
        $target = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($UrlB64))
    } catch {
        Write-DsvException 'decode UrlB64' $_
        Exit-Dsv 2 'invalid UrlB64 payload'
    }
    if ([string]::IsNullOrWhiteSpace($target)) {
        Exit-Dsv 2 'empty system window URL'
    }
    Write-DsvLog ('target parsed chars=' + $target.Length)

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

    # Window visibility. The Host starts this helper with windowsHide: true, so
    # CreateProcess carries STARTF_USESHOWWINDOW with SW_HIDE, and Windows
    # applies that value to the process's FIRST ShowWindow call. That call is
    # WinForms showing the main form: the window is created, the managed
    # Visible property is True, WebView2 initializes and navigates, and the
    # user never sees anything (0.14.2). Later ShowWindow calls are honored,
    # which is what Show-DsvWindow relies on.
    try {
        Add-Type -Namespace Dsv -Name Window -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern bool SetForegroundWindow(System.IntPtr hWnd);
'@ | Out-Null
    } catch { }

    # ---- helper assets ---------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($WebView2Dir)) { $WebView2Dir = Join-Path $PSScriptRoot 'webview2' }
    $corePath = Join-Path $WebView2Dir 'Microsoft.Web.WebView2.Core.dll'
    $winFormsPath = Join-Path $WebView2Dir 'Microsoft.Web.WebView2.WinForms.dll'
    $arch = [string]$env:PROCESSOR_ARCHITECTURE
    switch ($arch) {
        'AMD64' { $loaderDir = Join-Path $WebView2Dir 'x64' }
        'ARM64' { $loaderDir = Join-Path $WebView2Dir 'arm64' }
        default { Exit-Dsv 4 ('unsupported processor architecture: ' + $arch) }
    }
    $loaderPath = Join-Path $loaderDir 'WebView2Loader.dll'
    foreach ($path in @($corePath, $winFormsPath, $loaderPath)) {
        if (-not (Test-Path -LiteralPath $path)) { Exit-Dsv 4 ('missing WebView2 asset: ' + $path) }
    }
    Write-DsvLog ('assets found dir=' + $WebView2Dir + ' loader=' + $loaderDir)

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    Write-DsvLog 'WinForms/Drawing assemblies loaded'

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
    catch { Write-DsvException 'load Core.dll' $_; Exit-Dsv 4 ('could not load Microsoft.Web.WebView2.Core.dll: ' + $_.Exception.Message) }
    try { [System.Reflection.Assembly]::LoadFrom($winFormsPath) | Out-Null }
    catch { Write-DsvException 'load WinForms.dll' $_; Exit-Dsv 4 ('could not load Microsoft.Web.WebView2.WinForms.dll: ' + $_.Exception.Message) }
    Write-DsvLog 'WebView2 SDK assemblies loaded'

    # The Evergreen Runtime is installed by Edge on Windows 10/11. Missing
    # runtime is a common, actionable failure: report it with its own code so
    # the client can explain what to install instead of a generic error.
    # (The probe throws WebView2RuntimeNotFoundException when no runtime is
    # installed; the null check covers SDK builds that return null instead.)
    try {
        $runtimeVersion = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::GetAvailableBrowserVersionString()
    } catch {
        Write-DsvException 'probe WebView2 runtime' $_
        Exit-Dsv 3 ('could not probe the WebView2 Runtime: ' + $_.Exception.Message)
    }
    if ([string]::IsNullOrWhiteSpace([string]$runtimeVersion)) {
        Exit-Dsv 3 'Microsoft Edge WebView2 Runtime is not installed'
    }
    Write-DsvLog ('assets ok, WebView2 runtime ' + $runtimeVersion)

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
    Write-DsvLog ('profile dir=' + $script:dataDir)

    [System.Windows.Forms.Application]::EnableVisualStyles()
    [System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)
    # Keep WinForms from showing its stock unhandled-exception dialog: the
    # helper is non-interactive, so such a dialog would hang invisibly instead
    # of surfacing a failure the Host can report. Must be set before the main
    # form is shown / the message loop runs.
    try {
        [System.Windows.Forms.Application]::SetUnhandledExceptionMode(
            [System.Windows.Forms.UnhandledExceptionMode]::CatchException)
    } catch { }

    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $width = [Math]::Min(1320, [Math]::Max(900, [int]($area.Width * 0.78)))
    $height = [Math]::Min(920, [Math]::Max(640, [int]($area.Height * 0.86)))

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'DeepSeek Harness'
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.MinimumSize = New-Object System.Drawing.Size(720, 520)
    $form.ClientSize = New-Object System.Drawing.Size($width, $height)
    $form.BackColor = [System.Drawing.Color]::FromArgb(15, 17, 21)
    $form.ShowInTaskbar = $true
    $script:form = $form
    Write-DsvLog ('form created size=' + [string]$width + 'x' + [string]$height)

    $web = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $web.Dock = [System.Windows.Forms.DockStyle]::Fill
    # DefaultBackgroundColor exists only on the WinForms control (CoreWebView2
    # has no Controller) and must be set before the environment is created.
    try { $web.DefaultBackgroundColor = [System.Drawing.Color]::FromArgb(15, 17, 21) } catch { }
    $script:web = $web
    # The default user data folder is derived from the host executable, i.e.
    # System32\WindowsPowerShell\v1.0, which is not writable: WebView2 fails
    # with "Unable to create user data folder, Access Denied" before it ever
    # creates the window. CreationProperties is the documented way to point a
    # window at a writable per-window folder.
    try {
        $creation = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
        $creation.UserDataFolder = $script:dataDir
        $web.CreationProperties = $creation
        Write-DsvLog ('WebView2 user data folder=' + $script:dataDir)
    } catch {
        Write-DsvException 'WebView2 CreationProperties' $_
    }
    $form.Controls.Add($web)
    Write-DsvLog 'WebView2 control added'

    $web.add_CoreWebView2InitializationCompleted({
        param($sender, $eventArgs)
        try {
            $failed = $true
            if ($eventArgs -ne $null) { $failed = -not $eventArgs.IsSuccess }
            if ($failed) {
                $reason = 'unknown error'
                if ($eventArgs -ne $null -and $eventArgs.InitializationException -ne $null) {
                    $reason = $eventArgs.InitializationException.ToString()
                }
                # No MessageBox: the helper is non-interactive and the Host
                # reports the failure in the app. The log file keeps the reason.
                Write-DsvLog ('WebView2 initialization failed: ' + $reason)
                Write-DsvLog 'exiting code=5 (WebView2 initialization failed)'
                [Environment]::Exit(5)
                return
            }
            Write-DsvLog 'WebView2 initialization completed'
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
                $core.Navigate($target)
                Write-DsvLog 'WebView2 navigation requested'
            } catch {
                Write-DsvException 'WebView2 navigation' $_
                Write-DsvLog 'closing the form after a navigation failure'
                try { $script:form.Close() } catch { }
            }
        } catch {
            Write-DsvException 'CoreWebView2InitializationCompleted handler' $_
        }
    })

    $form.Add_Shown({
        # "visible" is WinForms' managed flag: it is True even when the OS
        # window stayed hidden, so it is only a stage marker. The authoritative
        # state is the "form displayed osVisible=..." line below, which the
        # Host waits for before it tells the user the window opened.
        try { Write-DsvLog ('form shown visible=' + [string]$script:form.Visible + ' handle=' + [string]$script:form.Handle) } catch { }
        $osVisibleBefore = Test-DsvWindowVisible $script:form
        $null = Show-DsvWindow $script:form
        $osVisible = Test-DsvWindowVisible $script:form
        Write-DsvLog ('form displayed osVisible=' + [string]$osVisible + ' beforeForceShow=' + [string]$osVisibleBefore)
        if (-not $osVisible) {
            # Re-showing alone can be ignored after a rejected first show:
            # toggle the form once and try again before giving up.
            try { $script:form.Hide(); $script:form.Show() } catch { }
            $null = Show-DsvWindow $script:form
            Write-DsvLog ('form displayed after retry osVisible=' + [string](Test-DsvWindowVisible $script:form))
        }
        try { $script:form.Activate() } catch { }
        try { $script:web.Focus() | Out-Null } catch { }
        # The WebView2 control needs the form's window handle: initialize it
        # after the window is shown, while the message loop is running.
        try {
            Write-DsvLog 'creating the WebView2 environment'
            $null = $script:web.EnsureCoreWebView2Async()
        } catch {
            Write-DsvException 'EnsureCoreWebView2Async' $_
            # No MessageBox: an invisible modal dialog would hang a
            # non-interactive helper and the Host would report success.
            Write-DsvLog 'exiting code=5 (could not create the WebView2 environment)'
            [Environment]::Exit(5)
        }
    })

    # Message-loop exceptions are normally swallowed by WinForms (it shows a
    # dialog and keeps going); log them so a broken handler is at least visible.
    try {
        [System.Windows.Forms.Application]::add_ThreadException({
            param($sender, $eventArgs)
            try {
                $exception = 'unknown'
                if ($eventArgs -ne $null -and $eventArgs.Exception -ne $null) { $exception = $eventArgs.Exception.ToString() }
                Write-DsvLog ('UNHANDLED UI THREAD EXCEPTION: ' + $exception)
            } catch { }
        })
    } catch { }

    $form.Add_FormClosed({
        try { Write-DsvLog 'form closed' } catch { }
        try { if ($script:web -ne $null) { $script:web.Dispose() } } catch { }
        try {
            if (-not [string]::IsNullOrWhiteSpace($script:dataDir) -and (Test-Path -LiteralPath $script:dataDir)) {
                Remove-Item -LiteralPath $script:dataDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        } catch { }
        [System.Windows.Forms.Application]::Exit()
    })

    Write-DsvLog 'window created, entering the message loop'
    [System.Windows.Forms.Application]::Run($form)
    Write-DsvLog 'message loop returned (window closed)'
    exit 0
} catch {
    Write-DsvException 'top level' $_
    Exit-Dsv 1 ('system window failed: ' + $_.Exception.Message)
}
