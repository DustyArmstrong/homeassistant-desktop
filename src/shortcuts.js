import { app, globalShortcut } from "electron";
import config from "../config.js";
import { getMainWindow, showWindow } from './window.js';

export function registerKeyboardShortcut() {
    globalShortcut.register(config.get("userShortcut"), () => {
        const mainWindow = getMainWindow();
        if (mainWindow.isVisible()) {
            mainWindow.hide();
            if (process.platform === "darwin") {
                app.dock.hide();
            }
        } else {
            showWindow();
        }
    });
}

export function unregisterKeyboardShortcut() {
    globalShortcut.unregisterAll();
}