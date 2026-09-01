# Home Assistant - Desktop

Desktop App (Windows / macOS / Linux) for [Home Assistant](https://www.home-assistant.io/) built with [Electron](https://www.electronjs.org)

![Home Assistant - Desktop](https://raw.githubusercontent.com/DustyArmstrong/homeassistant-desktop/master/media/screenshot.png)

This project is fork from [iprodanovbg/homeassistant-desktop](https://github.com/iprodanovbg/) and [mrvnklm/homeassistant-desktop](https://github.com/mrvnklm/). 

## Project Status

As of August 2025, the previous version of this project produced by [iprodanovbg](https://github.com/iprodanovbg/) has been archived. Given it is unlikely to return to active development, I will continue to maintain my own version here for as long as people wish to use it. I would like to leverage this/a future application to more tightly integrate with Home Assistant itself (device sensors etc.) when I have time. This is highly dependent on my availability, but contributions are welcome. Steps have been made towards that with the new API/websocket integration. 

I hope this project can be of some use to others if you like/liked the app! Issues are open to submit if you have any, though please be aware I may not be able to resolve all issues quickly or comprehensively - I will do my best, but the project is ultimately just something I'm maintaining for my own enjoyment and personal use. 

## Installation

Just download the latest version for your platform from the [release section](https://github.com/DustyArmstrong/homeassistant-desktop/releases/latest) and install!

**Note**: Please see below for more details, particularly with Linux.

## Usage / Features

- hover / click the tray icon to open the app
- supports multiple instances of Home Assistant (including automatic switching)
- automatic instance discovery using bonjour
- automatic reconnection to your instance on connection loss
- automatic sleep and resume handling
- right-click context menu for settings
- choose from multiple system tray icons
- global keyboard shortcut (defaults to Cmd/Ctrl + Alt + X but can be changed) can be enabled to show / hide Home Assistant
- fullscreen mode (Cmd/Ctrl + Alt + Return)
- automatic update checks (if not disabled in context menu)
- clear cache and application data (soft, full, complete)
- refresh from inside the application with F5 (browser refresh ignoring cache)
- websocket token expiry can be set to last indefinitely (Home Assistant > your user > security > 3 dot > Disable token expiration)

## Notes & known issues

- self-signed certificates should now work with the transition to the native Electron `net` module, along with mTLS
- support for Linux distros may vary, app tested on Debian-based flavors, Arch, Fedora (all primarily with X11 under Wayland) but detailed feedback is welcome
- support for Wayland generally still seems a bit limited - the application will still run however a number of Electron's features aren't implemented (e.g. shortcuts, checkbox display)
- if using "detached window" on Windows, instead of dragging, you have to resize it to move it

### Linux Install Notes

#### Linux Window Positioning

Per above, Wayland does not support - at least in any straightforward manner for this particular project - programmatic window positioning. Some users have had success with Remember Window Positions - https://github.com/rxappdev/RememberWindowPositions. This tool allows you to manage your window positions for many applications running under Wayland, not just HA Desktop. 

This section will be updated to reflect any other solutions as needed. At this time, window positioning on Wayland is not something this project can effectively handle within its own scope. 

#### Linux AppImage

The AppImage has been the most stable during testing. Despite this (and despite much effort to try and resolve it), at times the AppImage may not run successfully. This largely depends on the particulars of your environment, along with the version of `FUSE` you have available through your package manager. By default and under the default runtime behavior, the AppImage uses `FUSE` to mount the filesystem. This creates a directory in `/tmp/` with an assigned string e.g. `/tmp/.mount_Home.ABc123/`. 

By far the most common error seen in production is: 

`MAINWIN | (1): Error: ERR_FAILED (-2) loading 'file:///tmp/.mount_Home.ABC123/resources/app.asar/src/../web/index.html'`

This occurs because the `/tmp` directory spawned by `FUSE` is not picked up correctly, likely due to insufficient cleanup or linking by the OS, race conditions in either `FUSE` or the AppImage causing a mismatch, or some other related problem. Various methods have been attempted to resolve this, with mixed success. The best available options are: 

1) Extract the AppImage before running (AppImage renamed in this example)

```
./homeassistantdesktop.AppImage --appimage-extract
cd squashfs-root/
./homeassistant-desktop
```

2) Run and skip `FUSE` mounts

`./homeassistantdesktop.AppImage --appimage-extract-and-run`

The most 

#### Linux .desktop file

A sample working desktop file is provided below. Electron applications seem to play better with X11, but please try your luck with Wayland as well - obviously people mainlining Linux as their daily driver (more power to you) will understand their own distro better than I can (even if I use Linux daily too), but for those that struggle with this, this is the best I can come up with for now. Necessity for this will depend on your distro, as they all have different behavior.

In the below example, the AppImage and PNG have been renamed. This file is named `org.homeassistant.desktop` and should be placed in `~/.local/share/applications`. 

```
[Desktop Entry]
Type=Application
Name=HomeAssistantDesktop
Exec=env GDK_BACKEND=x11 XDG_SESSION_TYPE=x11 /full/path/to/homeassistant.AppImage
Icon=/path/to/icon/home.png
Terminal=false
Categories=Utility;
```

Or with native Wayland: 

```
[Desktop Entry]
Type=Application
Name=HomeAssistantDesktop
Exec=/full/path/to/homeassistant.AppImage --enable-features=UseOzonePlatform --ozone-platform=wayland --enable-features=WaylandWindowDecorations
Icon=/path/to/icon/home.png
Terminal=false
Categories=Utility;
```

The PNG can be obtained by first extracting the AppImage (`./appimage.AppImage --appimage-extract`), and can then be found inside the extracted folder: `./squashfs-root/usr/share/icons/hicolor/1800x1800/apps`. You can change `Terminal=false` to `true` if you want to see console output (handy for viewing the live runtime logs). You may still require some deps depending on your system (e.g. something GTK-related). Depending on the build of Electron, there can be many issues with Electron on Linux.

#### Linux Packages

The `.deb`, `.rpm` and `.pacman` are provided on a "best efforts" basis. I've done as much as I feel I can currently to get this working well, or at least reasonably well, on Linux. I have tested on various flavors (Arch Linux, Fedora, Ubuntu) with mixed success, but overall the `AppImage` appears to run best. Some (like `pacman`) are still in beta with the Electron team, I did not have much success with it - while I do everything I can to provide a decent experience on Linux, much of the build components are down to Electron's design decisions and implementations. 

## Troubleshooting

### Visual issues

If you experience visual issues with your Home Assistant dashboards when using Home Assistant Desktop, in particular if these are not consistent with your external web browser, this is most often caused by cached content. A function is present in the application to remove several layers of cache - in most cases the basic (soft) clear should suffice. You can find this and other options under the **Clear Application Data** menu. Should this fail, a hard clear (includes session storage) is the next best option. The application now features an 'F5' refresh option, which can be found in the menu, and performs a refresh ignoring cache. 

If everything fails, you can manually clear the cache by removing all the content from:

Windows:

`%appdata%\homeassistant-desktop\Cache\*`

Mac:

`/Users/{user}/Library/Application Support/homeassistant-desktop/Cache/*`

Linux (may vary on your system):

`~/.cache`

Additionally, please also clear the cache in your external web browser to confirm the issue only occurs with Home Assistant Desktop.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License and Author

Copyright 2024-2026, [Dusty Armstrong](https://github.com/DustyArmstrong)\
Copyright 2022-2023, [Ivan Prodanov](https://github.com/iprodanovbg)\
Copyright 2020-2021, [Marvin Kelm](https://github.com/mrvnklm)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
