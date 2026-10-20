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
