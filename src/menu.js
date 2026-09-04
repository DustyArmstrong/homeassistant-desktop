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
let debugClick = 0; // Track clicks - DEBUG - REMOVE LATER

const __dirname = import.meta.dirname;
const indexFile = `file://${__dirname}/../web/index.html`;

//HOVER TO SHOW REMOVED COMPLETELY - IT WAS CAUSING A NUMBER OF ISSUES AND ISN'T THAT USEFUL (unless someone says otherwise...)
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
                    label: "Scaling",
                    submenu: [
                        {
                            label: "Enable high DPI",
                            type: "checkbox",
                            checked: config.get("highDPIMode"),
                            click: async () => {
                                config.set("highDPIMode", !config.get("highDPIMode"));
                                app.relaunch();
                                app.exit(0);
                            }
                        },
                        {
                            label: "Force scaling factor",
                            type: "checkbox",
                            checked: config.get("forceScaling"),
                            click: async () => {
                                if (!config.get("scaleFactor")) {
                                    config.set("scaleFactor", "1");
                                }
                                config.set("forceScaling", !config.get("forceScaling"));
                                app.relaunch();
                                app.exit(0);
                            }
                        },
                        {
                            label: "Set scaling factor",
                            click: async () => {
                                dialog
                                    .showMessageBox({
                                        type: "question",
                                        message: "Set a scale factor for the application.",
                                        buttons: ["1", "1.25", "1.5", "1.75", "2"],
                                    })
                                    .then(async (res) => {
                                        const scaleActions = {
                                            0: async () => {
                                                logger.info("Scaling factor set to 1");
                                                config.set("scaleFactor", "1");
                                            },
                                            1: async () => {
                                                logger.info("Scaling factor set to 1.25");
                                                config.set("scaleFactor", "1.25");
                                            },
                                            2: async () => {
                                                logger.info("Scaling factor set to 1.5");
                                                config.set("scaleFactor", "1.5");
                                            },
                                            3: async () => {
                                                logger.info("Scaling factor set to 1.75");
                                                config.set("scaleFactor", "1.75");
                                            },
                                            4: async () => {
                                                logger.info("Scaling factor set to 2");
                                                config.set("scaleFactor", "2");
                                            }
                                        };
                                        const scaleAction = scaleActions[res.response];
                                        if (!scaleAction) return;
                                        try {
                                            await scaleAction();
                                            app.relaunch();
                                            app.exit(0);
                                        } catch (error) {
                                            logger.error(`DISP | could not set scale factor | ${error}`);
                                        }
                                    });
                            }
                        }
                    ]
                },
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
                {
                    label: "Disable Window Frame",
                    type: "checkbox",
                    checked: config.get("disableFrame"),
                    click: async () => {
                        logger.debug(`frame toggle: current=${config.get("disableFrame")}`); // DEBUG LOG - REMOVE LATER
                        config.set("disableFrame", !config.get("disableFrame"));
                        logger.debug(`frame toggle: now set to ${config.get("disableFrame")}`); // DEBUG LOG - REMOVE LATER
                        app.relaunch({ args: process.argv.slice(1) }); // Use documented arguments from Electron themselves
                        logger.debug("frame toggle: relaunch scheduled, exiting app"); // DEBUG LOG - REMOVE LATER
                        app.exit(0);
                    }
                }
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

export function changePosition() {
    const mainWindow = getMainWindow();
    const trayBounds = tray.getBounds();
    const windowBounds = mainWindow.getBounds();
    const displayWorkArea = screen.getDisplayNearestPoint({
        x: trayBounds.x,
        y: trayBounds.y,
    }).workArea;
    const taskBarPosition = Positioner.getTaskbarPosition(trayBounds);

    if (taskBarPosition === "top" || taskBarPosition === "bottom") {
        const alignment = {
            x: "center",
            y: taskBarPosition === "top" ? "up" : "down",
        };

        if (trayBounds.x + (trayBounds.width + windowBounds.width) / 2 < displayWorkArea.width) {
            Positioner.position(mainWindow, trayBounds, alignment);
        } else {
            const { y } = Positioner.calculate(mainWindow.getBounds(), trayBounds, alignment);

            mainWindow.setPosition(
                displayWorkArea.width - windowBounds.width + displayWorkArea.x,
                y + (taskBarPosition === "bottom" && displayWorkArea.y),
                false
            );
        }
    } else {
        const alignment = {
            x: taskBarPosition,
            y: "center",
        };

        if (trayBounds.y + (trayBounds.height + windowBounds.height) / 2 < displayWorkArea.height) {
            const { x, y } = Positioner.calculate(mainWindow.getBounds(), trayBounds, alignment);
            mainWindow.setPosition(x + (taskBarPosition === "right" && displayWorkArea.x), y);
        } else {
            const { x } = Positioner.calculate(mainWindow.getBounds(), trayBounds, alignment);
            mainWindow.setPosition(x, displayWorkArea.y + displayWorkArea.height - windowBounds.height, false);
        }
    }
}

export function createTray() {

    // FIXED: destroyed tray can still pass an instance of Tray, shall we check isDestroyed() instead - yeah!
    if (tray && !tray.isDestroyed()) {
        return;
    }

    logger.info("Initialized Tray menu");
    const iconName = config.get("userTrayIcon");
    tray = new Tray(`${__dirname}/assets/${iconName}`); // legacy code was checking two distinct paths, bit of housekeeping

    tray.on("click", () => {
        // DEBUG - REMOVE LATER
        logger.debug(`tray click #${++debugClick}`);
        const mainWindow = getMainWindow();
        // DEBUG - REMOVE LATER
        logger.debug(`tray click: win=${!!mainWindow} destroyed=${mainWindow?.isDestroyed()} visible=${mainWindow?.isVisible()} minimized=${mainWindow?.isMinimized()}`);


        // FIXED: add guards against a destroyed window, possible race and uncaught errors
        // Could explain the click doing nothing
        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        try {
            // FIXED: Windows always returns true for minimized windows,
            // check for minimized window guard here first
            if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                mainWindow.hide();
                // DEBUG - REMOVE LATER
                logger.debug(`tray click post-hide: visible=${mainWindow.isVisible()}`);

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
        // DEBUG - REMOVE LATER
        logger.debug(`tray right-click: win=${!!mainWindow} destroyed=${mainWindow?.isDestroyed()}`);

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

// Destroy the tray when making changes to avoid doubling up on trays
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