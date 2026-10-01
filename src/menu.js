import { app, dialog, shell, globalShortcut, screen, Menu, Tray } from "electron";
import logger from "electron-log";
import Positioner from "electron-traywindow-positioner";
import config from "../config.js";
import { currentInstance } from './instance.js';
import { getMainWindow, showWindow, createMainWindow, toggleFullScreen } from './window.js'; 
import { registerKeyboardShortcut, unregisterKeyboardShortcut } from "./shortcuts.js";
import { checkForUpdates, closeWebSocket, isWebSocketOpen } from "./networking.js";
import { getAutoStartStatus, modAutoLaunch } from "./power.js";

let tray = undefined;
let forceQuit = false;
let isChangingPosition = false;

const __dirname = import.meta.dirname;
const indexFile = `file://${__dirname}/../web/index.html`;


export function getMenu() {
    const mainWindow = getMainWindow();
    const instancesMenu = [
        {
            label: "Open in Browser",
            enabled: currentInstance(),
            click: async () => {
                await shell.openExternal(currentInstance());
            },
        },
        {
            type: "separator",
        },
    ];

    const allInstances = config.get("allInstances");

    if (allInstances) {
        allInstances.forEach((e) => {
            instancesMenu.push({
                label: e,
                type: "checkbox",
                checked: currentInstance() === e,
                click: async () => {
                    currentInstance(e);
                    await mainWindow.loadURL(e);
                    mainWindow.show();
                },
            });
        });

        instancesMenu.push(
            {
                type: "separator",
            },
            {
                label: "Add another Instance...",
                click: async () => {
                    config.delete("currentInstance");
                    await mainWindow.loadURL(indexFile);
                    mainWindow.show();
                },
            },
            {
                label: "Automatic Switching",
                type: "checkbox",
                enabled: config.has("allInstances") && config.get("allInstances").length > 1,
                checked: config.get("automaticSwitching"),
                click: () => {
                    config.set("automaticSwitching", !config.get("automaticSwitching"));
                },
            }
        );
    } else {
        instancesMenu.push({ label: "Not Connected...", enabled: false });
    }

    return Menu.buildFromTemplate([
        {
            label: "Show/Hide Window",
            visible: process.platform === "linux",
            click: () => {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    showWindow();
                }
            },
        },
        {
            visible: process.platform === "linux",
            type: "separator",
        },
        ...instancesMenu,
        {
            type: "separator",
        },
        {
            label: "Stay on Top",
            type: "checkbox",
            checked: config.get("stayOnTop"),
            click: () => {
                config.set("stayOnTop", !config.get("stayOnTop"));
                mainWindow.setAlwaysOnTop(config.get("stayOnTop"));

                if (mainWindow.isAlwaysOnTop()) {
                    showWindow();
                }
            },
        },
        {
            label: "Start at Login",
            type: "checkbox",
            checked: getAutoStartStatus(),
            click: async (menuItem) => {
                const stateTarget = menuItem.checked;
                try {
                    await modAutoLaunch(stateTarget);
                    menuItem.checked = stateTarget;
                    app.relaunch();
                    app.exit(0);
                } catch (error) {
                    logger.error(`AUTOST | failed to toggle autostart setting | ${error}`);
                    menuItem.checked = !stateTarget;
                }
            },
        },
        {
            label: "Shortcuts",
            submenu: [
                {
                    label: "Select Shortcut",
                    submenu: [
                        {
                            label: "CommandOrControl+Alt+X",
                            type: "radio",
                            checked: config.get("userShortcut") === "CommandOrControl+Alt+X",
                            click: () => {
                                config.set("userShortcut", "CommandOrControl+Alt+X");
                                unregisterKeyboardShortcut();
                                registerKeyboardShortcut();
                            },
                        },
                        {
                            label: "CommandOrControl+Alt+Y",
                            type: "radio",
                            checked: config.get("userShortcut") === "CommandOrControl+Alt+Y",
                            click: () => {
                                config.set("userShortcut", "CommandOrControl+Alt+Y");
                                unregisterKeyboardShortcut();
                                registerKeyboardShortcut();
                            },
                        },
                        {
                            label: "CommandOrControl+Alt+Z",
                            type: "radio",
                            checked: config.get("userShortcut") === "CommandOrControl+Alt+Z",
                            click: () => {
                                config.set("userShortcut", "CommandOrControl+Alt+Z");
                                unregisterKeyboardShortcut();
                                registerKeyboardShortcut();
                            },
                        }
                    ]
                },
                {
                    label: "Enable Shortcut",
                    type: "checkbox",
                    accelerator: config.get("userShortcut"),
                    checked: config.get("shortcutEnabled"),
                    click: () => {
                        const isEnabled = config.get("shortcutEnabled");
                        config.set("shortcutEnabled", !isEnabled);

                        if (!isEnabled) {
                            registerKeyboardShortcut();
                        } else {
                            unregisterKeyboardShortcut();
                        }
                    },
                },
                {
                    label: "F5 Refreshes",
                    type: "checkbox",
                    checked: config.get("f5Refreshes"),
                    click: () => {
                        const isEnabled = config.get("f5Refreshes");
                        config.set("f5Refreshes", !isEnabled);
                    },
                }
            ]
        },
        {
            label: "Appearance",
            submenu: [
                {
                    label: "Tray Icon",
                    submenu: [
                        {
                            label: "White",
                            type: "radio",
                            checked: config.get("userTrayIcon") === (process.platform === 'darwin' ? "IconTemplate.png" : "IconWin.png"),
                            click: () => {
                                if (process.platform === 'darwin') {
                                    changeIcon("IconTemplate.png");
                                } else {
                                    changeIcon("IconWin.png");
                                }
                            }
                        },
                        {
                            label: "Blue",
                            type: "radio",
                            checked: config.get("userTrayIcon") === "IconWinAlt.png",
                            click: () => changeIcon("IconWinAlt.png"),
                        },
                        {
                            label: "Black",
                            type: "radio",
                            checked: config.get("userTrayIcon") === "IconWinBlack.png",
                            click: () => changeIcon("IconWinBlack.png"),
                        },
                    ]
                },
                {
                    label: "Disable Window Frame",
                    type: "checkbox",
                    checked: config.get("disableFrame"),
                    click: async () => {
                        config.set("disableFrame", !config.get("disableFrame"));
                        if (process.platform === "linux") {
                            mainWindow.hide();
                            await createMainWindow(config.get("disableFrame"));
                        } else {
                            app.relaunch({ args: process.argv.slice(1) });
                            app.exit(0);
                        }
                    }
                },
                ...(process.platform === "linux" ? [{            
                    label: "Linux Tray Position",
                    submenu: [
                        {   
                            label: "Top Left",
                            type: "radio",
                            checked: config.get("linuxTrayPosition") === "top-left" || !config.get("linuxTrayPosition"),
                            click: () => {
                                config.set("linuxTrayPosition", "top-left");
                                logger.info("Linux tray position set to: top-left");;
                                const mainWindow = getMainWindow();
                                if (mainWindow && !mainWindow.isDestroyed() && !config.get("detachedMode")) {
                                    const size = mainWindow.getSize();
                                    changePosition(size[0], size[1]);
                                }
                            }
                        },
                        {   
                            label: "Top Right",
                            type: "radio",
                            checked: config.get("linuxTrayPosition") === "top-right",
                            click: () => {
                                config.set("linuxTrayPosition", "top-right");
                                logger.info("Linux tray position set to: top-right");
                                const mainWindow = getMainWindow();
                                if (mainWindow && !mainWindow.isDestroyed() && !config.get("detachedMode")) {
                                    const size = mainWindow.getSize();
                                    changePosition(size[0], size[1]);
                                }
                            }
                        },
                        {   
                            label: "Bottom Left",
                            type: "radio",
                            checked: config.get("linuxTrayPosition") === "bottom-left",
                            click: () => {
                                config.set("linuxTrayPosition", "bottom-left");
                                logger.info("Linux tray position set to: bottom-left");
                                const mainWindow = getMainWindow();
                                if (mainWindow && !mainWindow.isDestroyed() && !config.get("detachedMode")) {
                                    const size = mainWindow.getSize();
                                    changePosition(size[0], size[1]);
                                }
                            }
                        },
                        {   
                            label: "Bottom Right",
                            type: "radio",
                            checked: config.get("linuxTrayPosition") === "bottom-right",
                            click: () => {
                                config.set("linuxTrayPosition", "bottom-right");
                                logger.info("Linux tray position set to: bottom-right");
                                const mainWindow = getMainWindow();
                                if (mainWindow && !mainWindow.isDestroyed() && !config.get("detachedMode")) {
                                    const size = mainWindow.getSize();
                                    changePosition(size[0], size[1]);
                                }
                            }
                        },
                    ]
                }] : []),
            ]
        },
        {
            type: "separator",
        },
        {
            label: "Detached Mode",
            submenu: [
                {
                    label: "Use detached Window",
                    type: "checkbox",
                    checked: config.get("detachedMode"),
                    click: async () => {
                        config.set("detachedMode", !config.get("detachedMode"));
                        mainWindow.hide();
                        await createMainWindow(config.get("detachedMode"));
                    }
                },
            ]
        },
        {
            label: "Use Fullscreen",
            type: "checkbox",
            checked: config.get("fullScreen"),
            click: () => {
                toggleFullScreen();
            },
        },
        {
            label: "Enable Fullscreen Shortcut",
            type: "checkbox",
            accelerator: "CommandOrControl+Alt+Return",
            checked: config.get("shortcutFullscreenEnabled"),
            click: () => {
                const isEnabled = config.get("shortcutFullscreenEnabled");
                config.set("shortcutFullscreenEnabled", !isEnabled);
                if (!isEnabled) {
                    globalShortcut.register("CommandOrControl+Alt+Return", () => {
                        toggleFullScreen();
                    });
                } else {
                    globalShortcut.unregister("CommandOrControl+Alt+Return");
                }
            },
        },
        {
            type: "separator",
        },
        {
            label: `v${app.getVersion()}`,
            enabled: false,
        },
        {
            label: "Check for Updates",
            click: async () => {
                checkForUpdates();
            },
        },
        {
            label: "Enable Update Check on Startup",
            type: "checkbox",
            checked: config.get("autoUpdate"),
            click: async () => {
                config.set("autoUpdate", !config.get("autoUpdate"));
            },
        },
        {
            label: "Enable Automatic Reconnect",
            type: "checkbox",
            checked: config.get("autoReconnect"),
            click: async () => {
                config.set("autoReconnect", !config.get("autoReconnect"));
            },
        },
        {
            label: "Open on github.com",
            click: async () => {
                await shell.openExternal("https://github.com/DustyArmstrong/homeassistant-desktop");
            },
        },
        {
            type: "separator",
        },
        {
            label: "🔄 Restart Application",
            click: () => {
                app.relaunch();
                app.exit(0);
            },
        },
        {
            label: "⚠️ Clear Application Data",
            click: async () => {
                dialog
                    .showMessageBox({
                        type: 'warning',
                        message: "What would you like to reset (actions are irreversible)?",
                        buttons: ["Clear Frontend Cache (Soft)", "Clear All Caches (Hard)", "Reset Window", "Reset Everything!", "Cancel"],
                    })
                    .then(async (res) => {
                        const actions = {
                            0: async () => {
                                logger.info("Frontend cache cleared!");
                                await mainWindow.webContents.session.clearCache();
                            },
                            1: async () => {
                                logger.info("Cache and session storage deleted!");
                                await mainWindow.webContents.session.clearCache();
                                await mainWindow.webContents.session.clearStorageData();
                            },
                            2: async () => {
                                logger.info("Window position and size reset!");
                                config.delete("windowSizeDetached");
                                config.delete("windowSize");
                                config.delete("windowPosition");
                                config.delete("fullScreen");
                                config.delete("detachedMode");
                            },
                            3: async () => {
                                logger.info("All application data reset!");
                                config.clear();
                                await mainWindow.webContents.session.clearCache();
                                await mainWindow.webContents.session.clearStorageData();
                            }
                        };
                        const action = actions[res.response];
                        if (!action) return;
                        try {
                            await action();
                            app.relaunch();
                            app.exit(0);
                        } catch (error) {
                            logger.error(`RES | could not reset application settings | ${error}`);
                        }
                    });
            },
        },
        {
            type: "separator",
        },
        {
            label: "Quit",
            click: () => {
                if (isWebSocketOpen()) {
                    closeWebSocket("user application quit");
                }
                forceQuit = true;
                app.quit();
            },
        },
    ]);
}


export function changePosition(targetWidth, targetHeight) {
    if (isChangingPosition) {
        return;
    }
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!tray || tray.isDestroyed()) return;

    if (!targetWidth || !targetHeight) {
        const storedSize = config.get("windowSize") || [420, 460];
        targetWidth = storedSize[0];
        targetHeight = storedSize[1];
    }

    isChangingPosition = true;
    try {
        const trayPhysicalBounds = tray.getBounds();        
        const displayNearestTray = screen.getDisplayMatching(trayPhysicalBounds);
        const scaleFactor = displayNearestTray.scaleFactor;
        const workAreaLogical = displayNearestTray.workArea;

        let trayLogical;
        let useFallbackTrayPosition = false;

        if (process.platform === "linux" && 
            (trayPhysicalBounds.width === 0 || trayPhysicalBounds.height === 0)) {
            
            useFallbackTrayPosition = true;
            
            const traySize = 24;
            const margin = 8;
            
            const linuxPosition = config.get("linuxTrayPosition") || "bottom-right";
            
            switch (linuxPosition) {
                case "top-left":
                    trayLogical = {
                        x: workAreaLogical.x + margin,
                        y: workAreaLogical.y + margin,
                        width: traySize,
                        height: traySize
                    };
                    break;
                case "top-right":
                    trayLogical = {
                        x: workAreaLogical.x + workAreaLogical.width - traySize - margin,
                        y: workAreaLogical.y + margin,
                        width: traySize,
                        height: traySize
                    };
                    break;
                case "bottom-left":
                    trayLogical = {
                        x: workAreaLogical.x + margin,
                        y: workAreaLogical.y + workAreaLogical.height - traySize - margin,
                        width: traySize,
                        height: traySize
                    };
                    break;
                case "bottom-right":
                default:
                    trayLogical = {
                        x: workAreaLogical.x + workAreaLogical.width - traySize - margin,
                        y: workAreaLogical.y + workAreaLogical.height - traySize - margin,
                        width: traySize,
                        height: traySize
                    };
                    break;
            }
            
        } else {
            trayLogical = {
                x: process.platform === 'win32' || process.platform === 'linux' 
                    ? Math.round(trayPhysicalBounds.x / scaleFactor) 
                    : trayPhysicalBounds.x,
                y: process.platform === 'win32' || process.platform === 'linux' 
                    ? Math.round(trayPhysicalBounds.y / scaleFactor) 
                    : trayPhysicalBounds.y,
                width: process.platform === 'win32' || process.platform === 'linux' 
                    ? Math.round(trayPhysicalBounds.width / scaleFactor) 
                    : trayPhysicalBounds.width,
                height: process.platform === 'win32' || process.platform === 'linux' 
                    ? Math.round(trayPhysicalBounds.height / scaleFactor) 
                    : trayPhysicalBounds.height,
            };
        }

        const taskBarPosition = useFallbackTrayPosition 
            ? (config.get("linuxTrayPosition") === "top-left" || config.get("linuxTrayPosition") === "top-right" ? "top" : "bottom")
            : Positioner.getTaskbarPosition(trayPhysicalBounds);

        let targetX, targetY;

        if (taskBarPosition === "top" || taskBarPosition === "bottom") {
            const spaceToRight = workAreaLogical.x + workAreaLogical.width - trayLogical.x;
            const spaceNeeded = trayLogical.width + targetWidth;

            if (spaceToRight >= spaceNeeded) {
                targetX = trayLogical.x;
                targetY = taskBarPosition === "bottom" 
                    ? workAreaLogical.y + workAreaLogical.height - targetHeight
                    : trayLogical.y;
                
                targetX = Math.max(workAreaLogical.x, Math.min(targetX, workAreaLogical.x + workAreaLogical.width - targetWidth));
                targetY = Math.max(workAreaLogical.y, Math.min(targetY, workAreaLogical.y + workAreaLogical.height - targetHeight));
            } else {
                targetX = workAreaLogical.x + workAreaLogical.width - targetWidth;
                targetY = taskBarPosition === "bottom" 
                    ? workAreaLogical.y + workAreaLogical.height - targetHeight 
                    : workAreaLogical.y;
            }
        } else {
            const spaceBelow = workAreaLogical.y + workAreaLogical.height - trayLogical.y;
            const spaceNeeded = trayLogical.height + targetHeight;

            if (spaceBelow >= spaceNeeded) {
                targetY = trayLogical.y;
                targetX = taskBarPosition === "right" 
                    ? workAreaLogical.x + workAreaLogical.width - targetWidth 
                    : trayLogical.x;
                
                targetX = Math.max(workAreaLogical.x, Math.min(targetX, workAreaLogical.x + workAreaLogical.width - targetWidth));
                targetY = Math.max(workAreaLogical.y, Math.min(targetY, workAreaLogical.y + workAreaLogical.height - targetHeight));
            } else {
                targetX = taskBarPosition === "right" 
                    ? workAreaLogical.x + workAreaLogical.width - targetWidth 
                    : workAreaLogical.x;
                targetY = workAreaLogical.y + workAreaLogical.height - targetHeight;
            }
        }

        mainWindow.setBounds({
            x: Math.round(targetX),
            y: Math.round(targetY),
            width: targetWidth,
            height: targetHeight
        }, false);
        
    } catch (error) {
        logger.error(`CHNGPOS | Positioning error | ${error}`);
    } finally {
        isChangingPosition = false;
    }
}

export function createTray() {
    if (tray && !tray.isDestroyed()) {
        return;
    }

    logger.info("Initialized Tray menu");
    let iconName = config.get("userTrayIcon");
    if (process.platform === "darwin" && iconName === "IconWin.png") {
        config.set("userTrayIcon", "IconTemplate.png");
        iconName = "IconTemplate.png";
    }
    tray = new Tray(`${__dirname}/assets/${iconName}`);

    tray.on("click", () => {
        const mainWindow = getMainWindow();

        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        try {
            if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                mainWindow.hide();

                if (process.platform === "darwin") {
                    app.dock.hide();
                }
            } else {
                showWindow();
            }
        } catch (error) {
            logger.error(`TRAY | click handler error | ${error}`);
        }
    });

    tray.on("right-click", () => {
        const mainWindow = getMainWindow();

        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        try {
            if (!config.get("detachedMode")) {
                mainWindow.hide();
            }
            tray.popUpContextMenu(getMenu());
        } catch (error) {
            logger.error(`TRAY | tray right-click handler error | ${error}`);
        }
    });
}

export function destroyTray() {
    if (tray && !tray.isDestroyed()) {
        tray.destroy();
    }
    tray = undefined;
}

function changeIcon(iconName) {
    config.set("userTrayIcon", iconName);
    tray.setImage(
        ["win32", "linux"].includes(process.platform) ? `${__dirname}/assets/${iconName}` : `${__dirname}/assets/${iconName}`
    );
    logger.info(`Changed tray icon to ${iconName}`);
}

export function forceQuitStatus() {
    return forceQuit;
}

export function getMainTray() {
    return tray;
}