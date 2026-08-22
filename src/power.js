import { app, powerMonitor } from "electron";
import logger from "electron-log";
import AutoLaunch from "auto-launch";
import { isWebSocketOpen, closeWebSocket, getResponse, handleUnavailable } from "./networking.js";
import { currentInstance } from './instance.js';
import { reinitMainWindow } from "./window.js";
import { showSleep } from './display.js';

let autostartEnabled = false;
let sleepHandled = false;
let resumeHandled = false;
const autoLauncher = new AutoLaunch({ name: "Home Assistant Desktop" });

powerMonitor.on('suspend', () => {
    if (!sleepHandled) {
        logger.info("Home Assistant going to sleep.");
        if (isWebSocketOpen()) {
            closeWebSocket("Suspending machine");
        }
        showSleep(true);
        sleepHandled = true;
    }
});

powerMonitor.on('resume', async () => {
    if (!resumeHandled) {
        resumeHandled = true;
        logger.info("Power state resumed, attempting to re-connect...");
        const instance = currentInstance();
        try {
            const statusCode = await getResponse(instance, 8000);
            if (statusCode === 200) {
                await reinitMainWindow();
            } else {
                handleUnavailable(statusCode);
            }
        } catch (error) {
            logger.error(`WAKE - ${error.code}`);
            logger.info("WAKE - Application will now restart...");
            app.relaunch();
            app.exit();
        }
    }
});

powerMonitor.on('shutdown', () => {
    logger.info("shutdown initiated, quitting...");
    if (isWebSocketOpen()) {
        closeWebSocket("Shutting down");
    }
    app.quit();
});

export function sleepHandleStatus() {
    return sleepHandled;
}

export function resumeHandleStatus() {
    return resumeHandled;
}

export function setSleepHandledStatus(stateSetting) {
    if (stateSetting === true) {
        sleepHandled = true;
    }
    if (stateSetting === false) {
        sleepHandled = false;
    }
}

export function setResumeHandledStatus(stateSetting) {
    if (stateSetting === true) {
        resumeHandled = true;
    }
    if (stateSetting === false) {
        resumeHandled = false;
    }
}

export function checkAutoStart() {
    autoLauncher
        .isEnabled()
        .then((isEnabled) => {
            autostartEnabled = isEnabled;
        })
        .catch((error) => {
            logger.error(`AUTOST - ${error}`);
        });
}

export function getAutoStartStatus() {
    return autostartEnabled;
}

export function modAutoLaunch(stateSetting) {
    if (stateSetting === true) {
        autoLauncher.disable();
    }
    if (!stateSetting === false) {
        autoLauncher.enable();
    }
}