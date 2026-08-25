import { app, ipcMain } from "electron";
import Bonjour from "bonjour-service";
const bonjour = new Bonjour.Bonjour();
import config from '../config.js';
import logger from "electron-log";
import { currentInstance } from './instance.js';
import { getMainWindow, reinitMainWindow } from "./window.js";
import { initWebSocketHealth } from "./networking.js";

ipcMain.on("get-instances", async (event) => {
    const instances = await getBonjourResult(config.get("allInstances") || []);
    event.reply("receive-instances", instances);
});

ipcMain.on("get-ha-instance", (event, url) => {
    if (url) {
        addInstance(url);
    }

    if (currentInstance()) {
        event.reply("receive-ha-instance", currentInstance());
    }
});

ipcMain.on("reconnect", async () => {
    await reinitMainWindow();
});

ipcMain.on("restart", () => {
    app.relaunch();
    app.exit();
});

ipcMain.on('reload-window', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && config.get("f5Refreshes")) {
        mainWindow.webContents.reloadIgnoringCache();
    }
});

export async function getCurrentToken(maxRetries = 3, delayMs = 500) {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const tokens = await mainWindow.webContents.executeJavaScript(`
                (() => {
                    try {
                        const tokens = JSON.parse(localStorage.getItem("hassTokens"));
                        return tokens ? { access_token: tokens.access_token, expires: tokens.expires } : null;
                    } catch {
                        return null;
                    }
                })()
            `);

            if (tokens) {
                logger.info(`Token retrieved on attempt ${attempt}`);
                return tokens;
            }

            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        } catch (error) {
            logger.error(`Could not fetch token from renderer: ${error}`);
            return null;
        }
    }
    logger.warn(`Token not available after ${maxRetries} attempts (${maxRetries * delayMs}ms)`);
    return null;
}

async function getBonjourResult(instances) {
    return new Promise((resolve) => {
        const foundInstances = [];

        bonjour.find({ type: "home-assistant" }, (instance) => {
            if (instance.txt.internal_url && instances.indexOf(instance.txt.internal_url) === -1) {
                foundInstances.push(instance.txt.internal_url);
            }
            if (instance.txt.external_url && instances.indexOf(instance.txt.external_url) === -1) {
                foundInstances.push(instance.txt.external_url);
            }
        });
        setTimeout(() => {
            resolve(foundInstances);
        }, 1500);
    });
}

function addInstance(url) {
    if (!config.has("allInstances")) {
        config.set("allInstances", []);
    }

    const instances = config.get("allInstances");

    if (instances.find((e) => e === url)) {
        currentInstance(url);

        return;
    }

    if (!instances.length) {
        config.set("disableHover", false);
    }

    instances.push(url);
    config.set("allInstances", instances);
    currentInstance(url);
    initWebSocketHealth(url);
}