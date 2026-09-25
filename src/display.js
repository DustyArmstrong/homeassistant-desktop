import { screen } from "electron";
import logger from "electron-log";
import { currentInstance } from './instance.js';
import { getMainWindow } from './window.js';

const __dirname = import.meta.dirname;
const errorFile = `file://${__dirname}/../web/error.html`;
const sleepFile = `file://${__dirname}/../web/sleeping.html`;
const indexFile = `file://${__dirname}/../web/index.html`;

export async function showError(isError) {
    const mainWindow = getMainWindow();
    if (!isError && mainWindow.webContents.getURL().includes("error.html")) {
        await mainWindow.loadURL(indexFile);
    }

    if (isError && currentInstance() && !mainWindow.webContents.getURL().includes("error.html")) {
        await mainWindow.loadURL(errorFile);
    }
}

export async function showSleep(isSleeping) {
    const mainWindow = getMainWindow();
    if (!isSleeping && mainWindow.webContents.getURL().includes("sleeping.html")) {
        mainWindow.loadURL(indexFile);
    }
    if (isSleeping && currentInstance() && !mainWindow.webContents.getURL().includes("sleeping.html")) {
        mainWindow.loadURL(sleepFile);
    }
}

export function ensureWinVisible(winInstance) {
    const bounds = winInstance.getBounds();
    const displays = screen.getAllDisplays();

    for (const display of displays) {
        const { x, y, width, height } = display.workArea;
        if (
            bounds.x >= x &&
            bounds.y >= y &&
            bounds.x + bounds.width <= x + width &&
            bounds.y + bounds.height <=y + height
        ) {
            return true;
        }
    }
    
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;
    const newX = workArea.x + Math.floor((workArea.width - bounds.width) / 2);
    const newY = workArea.y + Math.floor((workArea.height - bounds.height) /2);

    logger.warn(`Window bounds ${JSON.stringify(bounds)} are not on-screen. Bounds forced to primary display at coordinates ${newX}, ${newY}`);
    winInstance.setPosition(newX, newY);
    return false;
}

export function initWindowBounds(winInstance, defaultWidth = 420, defaultHeight = 460) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    const initialX = workArea.x + Math.floor((workArea.width - defaultWidth) /2);
    const initialY = workArea.y + Math.floor((workArea.height - defaultHeight) /2);
    winInstance.setPosition(initialX, initialY);

    logger.info(`Window position moved to ${initialX}, ${initialY} on primary display`);
}

export function clampWinSize(winInstance, maxWidthRatio = 1.5, maxHeightRatio = 1.5) {
    const size = winInstance.getSize();
    let [width, height] = size;

    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workArea;

    const maxAllowWidth = Math.floor(workArea.width * maxWidthRatio);
    const maxAllowHeight = Math.floor(workArea.height * maxHeightRatio);

    const minAllowWidth = 420;
    const minAllowHeight = 460;

    const maxWidthCap = 5000;
    const maxHeightCap = 5000;

    let clamped = false;

    if (width > maxWidthCap) {
        logger.error(`WINIT | FATAL | Window width ${width} has exceeded the maximum ceiling allowed!`);
        width = maxAllowWidth;
        clamped = true;
    } else if (width > maxAllowWidth) {
        logger.warn(`WINIT | Window width ${width} exceeds soft width cap ${maxAllowWidth}, clamping...`);
        width = maxAllowWidth;
        clamped = true;
    }

    if (height > maxHeightCap) {
        logger.error(`WINIT | FATAL | Window width ${height} has exceeded the maximum ceiling allowed!`);
        height = maxAllowHeight;
        clamped = true;
    } else if (height > maxAllowHeight) {
        logger.warn(`WINIT | Window width ${height} exceeds soft width cap ${maxAllowHeight}, clamping...`);
        height = maxAllowHeight;
        clamped = true;
    }

    if (width < minAllowWidth) {
        logger.warn(`WINIT | Window width ${width} is below the mimimum operating floor, clamping...`);
        width = minAllowWidth;
        clamped = true;
    }

    if (height < minAllowHeight) {
        logger.warn(`WINIT | Window width ${height} is below the mimimum operating floor, clamping...`);
        height = minAllowHeight;
        clamped = true;
    }

    if (clamped) {
        winInstance.setSize(width, height);
        logger.info(`Window size clamped to ${width}x${height}`);
    }

    return { width, height, clamped};
}

export function validateBounds(winInstance) {
    const size = winInstance.getSize();
    const [width, height] = size;

    if (width > 5000 || height > 5000) {
        logger.error(`WINIT | FATAL | Window size exceeds sensible boundaries, resetting...`);
        return false;
    }
    if (width <= 0 || height <= 0) {
        logger.error(`WINIT | FATAL | Window size is invalid ${width}x${height}!`);
        return false;
    }

    return true;
}