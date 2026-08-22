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

export async function getCurrentToken() {
    const mainWindow = getMainWindow();
    if (!mainWindow) return null;
    try {
        const token = await mainWindow.webContents.executeJavaScript(`
            (() => {
                try {
                    const tokens = JSON.parse(localStorage.getItem("hassTokens"));
                    return tokens ? tokens.access_token : null;
                } catch {
                    return null;
                }
            })()
        `);
        return token;
    } catch (error) {
        logger.error(`Could not fetch token via executeJavaScript: ${error}`);
        return null;
    }
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