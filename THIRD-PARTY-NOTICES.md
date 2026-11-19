# Third-party notices

## dsh-split-screen

The pane re-hosting engine in `lib/client.js` is derived from
**dsh-split-screen 1.7.0**:

- https://github.com/YEYEYEYESHIFU/dsh-split-screen
- MIT License, Copyright (c) its authors

It has been adapted and extended for the DeepSeek Harness Desktop shell:

- module id, global diagnostics API, storage keys and log prefix renamed to
  `dsh-split-workspace`;
- pane cap reduced from 6 to 4;
- an Auto / Columns / Rows / Grid layout toolbar with n-ary arrangement;
- pane rename, copy session info and maximize/restore;
- the one-time tip card removed (it intercepted clicks);
- the toolbar is a macOS window drag region.

The upstream MIT license is reproduced in `LICENSE`; the upstream copyright
notice is retained here.

## Microsoft Edge WebView2 SDK

The Windows system window ships the **Microsoft WebView2 SDK 1.0.4314.35**
binaries in `native/webview2/`:

- `Microsoft.Web.WebView2.Core.dll`
- `Microsoft.Web.WebView2.WinForms.dll`
- `x64/WebView2Loader.dll`, `arm64/WebView2Loader.dll`

- Package: https://www.nuget.org/packages/Microsoft.Web.WebView2
- License: BSD-3-Clause, Copyright (C) Microsoft Corporation.

The complete upstream `LICENSE.txt` and `NOTICE.txt` are shipped alongside the
binaries in `native/webview2/`. The WebView2 **Runtime** itself is not
redistributed: it is installed with Microsoft Edge (built into Windows 11 and
present on Windows 10 with a current Edge).
