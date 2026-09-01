import { app, dialog, shell, net } from "electron";
import semver from "semver";
import logger from "electron-log";
import config from "../config.js";
import { currentInstance, checkForAvailableInstance } from "./instance.js";
import { getMainWindow, reinitMainWindow } from "./window.js";
import { showError } from "./display.js";
import { getCurrentToken, waitForToken } from "./ipc.js";

let retryingAvailability = false;
let wsConnection = null;
const WS_MAX_RETRIES = 5;
const WS_RETRY_DELAY = 6000;
let wsClosedIntentional = false;
let wsClosedResolve = null;


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
        logger.error(`UPDT | error getting updates | ${error}`);
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

export function closeWebSocket(source) {
    return new Promise((resolve) => {
        if (!isWebSocketOpen()) {
            resolve();
            return;
        }

        wsClosedResolve = resolve;
        wsClosedIntentional = true;
        wsConnection.close(4000);       
        logger.info(`CLSWSKT | websocket closed | ${source}`);
    });
}

export async function initWebSocketHealth(instance) {
    const url = new URL(instance);
    const wsUrl = `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}/api/websocket`;
    const accessToken = await getCurrentToken();

    if (!accessToken?.expires) {
        const token = await waitForToken(120000, 1000);
        logger.warn("Waiting for authentication with instance...");
        if (token) { 
            logger.info(`Authentication detected, starting websocket for ${url}...`);
            await initWebSocketHealth(url);
            return;
        } else {
            logger.error(`TKNAUTH | authentication issue with ${url}. Please sign in to your Home Assistant instance.`);
            logger.warn("TKNAUTH | application will now exit...");
            if (isWebSocketOpen) {
                closeWebSocket("websocket couldn't authenticate");
            }
            app.quit();
        }
    }

    if (accessToken.expires && accessToken.expires < Date.now()) {
        logger.warn(`TKNAUTH | access token is stale (${new Date(accessToken.expires).toLocaleString()}), refreshing...`);
        handleUnavailable("WEBSKT | token expired");
        return;
    }

    let lastActivityTime = Date.now();
    let authTimeout = null;
    let heartbeatTimer = null;
    let pingTimer = null;
    let msgId = 1;

    return new Promise((resolve, reject) => {
        try {
            wsConnection = new net.WebSocket(wsUrl);
            
            wsClosedIntentional = false;
            wsClosedResolve = null;

            wsConnection.onopen = () => {
                logger.info("Websocket connection established.");
                lastActivityTime = Date.now();

                wsConnection.send(
                    JSON.stringify({
                        type: "auth",
                        access_token: accessToken.access_token,
                    }),
                );

                authTimeout = setTimeout(() => {
                    reject(new Error("Websocket auth timed out!"));
                    handleUnavailable("WEBSKT | websocket auth timed out!");
                }, 8000);
            };

            wsConnection.onmessage = (event) => {
                lastActivityTime = Date.now();
                const msg = JSON.parse(event.data);

                if (msg.type === "auth_ok") {
                    clearTimeout(authTimeout);
                    logger.info("Websocket authentication successful!");

                    heartbeatTimer = setInterval(() => {
                        if (Date.now() - lastActivityTime > 90000) {
                            logger.warn("That dang ol' pinger ain't ponged dang near 60 seconds!");
                            clearInterval(heartbeatTimer);
                            clearInterval(pingTimer);
                            heartbeatTimer = null;
                            pingTimer = null;
                            handleUnavailable("WEBSKT | connection timeout due to inactivity");
                        }
                    }, 15000);

                    pingTimer = setInterval(() => {
                        wsConnection.send(
                            JSON.stringify({
                                id: msgId++,
                                type: "ping",
                            }),
                        );
                    }, 30000);

                    resolve(true);
                }

                if (msg.type === "auth_invalid") {
                    clearTimeout(authTimeout);
                    clearInterval(heartbeatTimer);
                    clearInterval(pingTimer);
                    heartbeatTimer = null;
                    pingTimer = null;
                    authTimeout = null;
                    handleUnavailable("WEBSKT | authentication failed!");
                }
            };

            wsConnection.onerror = (error) => {
                clearTimeout(authTimeout);
                clearInterval(heartbeatTimer);
                clearInterval(pingTimer);
                heartbeatTimer = null;
                pingTimer = null;
                authTimeout = null;
                handleUnavailable(`WEBSKT | general error | ${error}`);
            };

            wsConnection.onclose = (event) => {
                clearTimeout(authTimeout);
                clearInterval(heartbeatTimer);
                clearInterval(pingTimer);
                heartbeatTimer = null;
                pingTimer = null;
                authTimeout = null;
                
                if (wsClosedIntentional) {
                    const savedResolve = wsClosedResolve;
                    wsClosedResolve = null;
                    wsClosedIntentional = false;
                    wsConnection = null;
                    savedResolve(); 
                    logger.info("Websocket connection closed gracefully");
                    return; 
                }

                handleUnavailable(`WEBSKT | websocket closed unexpectedly | Code: ${event.code}`);
                wsConnection = null;
            };
        } catch (error) {
            clearInterval(heartbeatTimer);
            clearInterval(pingTimer);
            heartbeatTimer = null;
            pingTimer = null;
            authTimeout = null;
            handleUnavailable(`WEBSKT | fatal error encountered | ${error}`);
        }
    });
}

export function handleUnavailable(reason) {
    if (retryingAvailability) {
        return;
    }
    showError(true);
    if (wsConnection) {
        closeWebSocket("instance became unavailable");
    }
    logger.error(reason);
    if (reason === "WEBSKT | authentication failed!") {
        return;
    }
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
            closeWebSocket("retrying availability");
        }

        while (retryCount <= WS_MAX_RETRIES) {
            try {
                const statusCode = await getResponse(instance, 8000);
                if (statusCode === 200) {
                    logger.info("Connection re-established!");
                    mainWindow.webContents.send("retry-success", "Instance alive, reconnecting...");
                    retryingAvailability = false;
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
        if (retryingAvailability) {
            retryingAvailability = false;
        }
    }
}

async function handleRetryAttempt(retryCount, mainWindow, errorMessage) {
    logger.error(`RETRY | webSocket retry ${retryCount}/${WS_MAX_RETRIES} failed | ${errorMessage}`);

    if (retryCount === WS_MAX_RETRIES) {
        logger.error("RETRY | cannot automatically connect to instance");
        mainWindow.webContents.send("retry-update", "Unable to connect to instance!");
    } else {
        mainWindow.webContents.send("retry-update", `Trying to reconnect ${retryCount} of ${WS_MAX_RETRIES}`);
        await new Promise((retry) => setTimeout(retry, WS_RETRY_DELAY));
    }
}