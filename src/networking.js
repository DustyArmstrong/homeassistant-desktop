import { app, dialog, shell, net } from "electron";
import semver from "semver";
import logger from "electron-log";
import config from "../config.js";
import { currentInstance, checkForAvailableInstance } from "./instance.js";
import { getMainWindow, reinitMainWindow } from "./window.js";
import { showError } from "./display.js";
import { getCurrentToken } from "./ipc.js";

let retryingAvailability = false;
let wsConnection = null;
const WS_MAX_RETRIES = 5;
const WS_RETRY_DELAY = 6000;
let wsConnectionClosed = false;

export async function checkForUpdates() {
    try {
        const apiResponse = await net.fetch("https://api.github.com/repos/DustyArmstrong/homeassistant-desktop/releases/latest");
        const apiData = await apiResponse.json();
        const latestVersion = apiData.tag_name;
        const currentVersion = app.getVersion();

        if (semver.gt(latestVersion, currentVersion)) {
            const versionMessage = await dialog.showMessageBox({
                type: "question",
                buttons: ["Download", "Not Now"],
                title: "Update Available",
                message: `A new version of Home Assistant Desktop is available (${currentVersion} --> ${latestVersion})`,
            });
            if (versionMessage.response === 0) {
                await shell.openExternal("https://github.com/DustyArmstrong/homeassistant-desktop/releases/latest");
            }
        }
    } catch (error) {
        logger.error(`UPDT - ${error}`);
    }
}

export async function getResponse(instance, timeoutMs = 8000) {
    const url = new URL(instance);
    const target = `${url.origin}/auth/providers`;

    try {
        const res = await Promise.race([
            net.fetch(target),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Request timed out")), timeoutMs)),
        ]);
        return res.status;
    } catch (error) {
        throw {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            url: target,
        };
    }
}

const WS_STATES = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
};

export function isWebSocketOpen() {
    return wsConnection !== null && wsConnection.readyState === WS_STATES.OPEN;
}

export function closeWebSocket() {
    if (isWebSocketOpen()) {
        wsConnectionClosed = true;
        wsConnection.close(4000);
        wsConnection = null;
        logger.info("Websocket closed by call");
    }
}

export async function initWebSocketHealth(instance) {
    const url = new URL(instance);
    const wsUrl = `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}/api/websocket`;
    const accessToken = await getCurrentToken();

    return new Promise((resolve, reject) => {
        try {
            wsConnection = new net.WebSocket(wsUrl);
            let authTimeout;

            wsConnection.onopen = () => {
                logger.info("Websocket connection established.");

                wsConnection.send(
                    JSON.stringify({
                        type: "auth",
                        access_token: accessToken,
                    }),
                );

                authTimeout = setTimeout(() => {
                    logger.error("Websocket auth timed out!");
                    reject(new Error("Websocket auth timed out!"));
                    handleUnavailable();
                }, 8000);
            };

            wsConnection.onmessage = (event) => {
                const msg = JSON.parse(event.data);

                if (msg.type === "auth_ok") {
                    clearTimeout(authTimeout);
                    logger.info("Websocket authentication successful!");

                    wsConnection.send(
                        JSON.stringify({
                            id: 1,
                            type: "subscribe_events",
                            event_type: "state_changed",
                        }),
                    );

                    resolve(true);
                }

                if (msg.type === "auth_invalid") {
                    const mainWindow = getMainWindow();
                    clearTimeout(authTimeout);
                    mainWindow.webContents.send("retry-update", "Websocket authentication failed, trying to obtain a new token...");
                    handleUnavailable("Websocket authentication failed!");
                }

                if (msg.type === "event" && msg.event?.data?.entity_id === "homeassistant.home_assistant") {
                    logger.info(msg);
                }
            };

            wsConnection.onerror = (error) => {
                clearTimeout(authTimeout);
                handleUnavailable(`Websocket error ${error}`);
            };

            wsConnection.onclose = (event) => {
                clearTimeout(authTimeout);
                if (wsConnectionClosed) {
                    logger.info("Websocket connection closed by user.");
                    wsConnectionClosed = false;
                } else {
                    handleUnavailable(`Websocket closed unexpectedly (Code: ${event.code})`);
                }
                
            };
        } catch (error) {
            logger.error(`WebSocket fatal: ${error}`);
            handleUnavailable(`Websocket fatal: ${error}`);
        }
    });
}

export function handleUnavailable(reason) {
    if (retryingAvailability) {
        return;
    }
    showError(true);
    if (wsConnection) {
        closeWebSocket();
    }
    logger.error(`INSTAV - ${reason}`);
    if (config.get("autoReconnect") === true) retryAvailabilityCheck();
    if (config.get("automaticSwitching")) checkForAvailableInstance();
}

async function retryAvailabilityCheck() {
    if (retryingAvailability) return;
    retryingAvailability = true;

    try {
        const instance = currentInstance();
        let retryCount = 0;
        const mainWindow = getMainWindow();
        if (wsConnection) {
            closeWebSocket();
        }

        while (retryCount <= WS_MAX_RETRIES) {
            try {
                const statusCode = await getResponse(instance, 8000);
                if (statusCode === 200) {
                    logger.info("Connection re-established!");
                    mainWindow.webContents.send("retry-success", "Instance alive, reconnecting...");
                    await reinitMainWindow();
                    break;
                }
                throw new Error(`Status ${statusCode}`);
            } catch (error) {
                await handleRetryAttempt(retryCount, mainWindow, error.message);
                retryCount++;
            }
        }
    } finally {
        retryingAvailability = false;
    }
}

async function handleRetryAttempt(retryCount, mainWindow, errorMessage) {
    logger.error(`WebSocket retry ${retryCount}/${WS_MAX_RETRIES} failed: ${errorMessage}`);

    if (retryCount === WS_MAX_RETRIES) {
        logger.error("RETRY - Cannot automatically connect to instance.");
        mainWindow.webContents.send("retry-update", "Unable to connect to instance!");
    } else {
        mainWindow.webContents.send("retry-update", `Trying to reconnect ${retryCount} of ${WS_MAX_RETRIES}`);
        await new Promise((retry) => setTimeout(retry, WS_RETRY_DELAY));
    }
}

