import { screen } from "electron";
import logger from "electron-log";
import { currentInstance } from './instance.js';

const __dirname = import.meta.dirname;
const errorFile = `file://${__dirname}/../web/error.html`;
const sleepFile = `file://${__dirname}/../web/sleeping.html`;
const indexFile = `file://${__dirname}/../web/index.html`;

export async function showError(isError, winInstance) {
    if (!winInstance) {
        logger.warn("SHOERR | No main window available");
        return;
    }
    if (!isError && winInstance.webContents.getURL().includes("error.html")) {
        await winInstance.loadURL(indexFile);
    }

    if (isError && currentInstance() && !winInstance.webContents.getURL().includes("error.html")) {
        await winInstance.loadURL(errorFile);
    }
}

export async function showSleep(isSleeping, winInstance) {
    if (!winInstance) {
        logger.warn("SHOSLP | No main window available");
        return;
    }
    
    if (!isSleeping && winInstance.webContents.getURL().includes("sleeping.html")) {
        winInstance.loadURL(indexFile);
    }
    if (isSleeping && currentInstance() && !winInstance.webContents.getURL().includes("sleeping.html")) {
        winInstance.loadURL(sleepFile);
    }
}

export function initWindowBounds(winInstance, defaultWidth = 420, defaultHeight = 460, savedPos) {
    if (!winInstance || winInstance.isDestroyed()) return;

    const primaryDisplay = screen.getPrimaryDisplay();
    const primaryWorkArea = primaryDisplay.workArea;

    const centerFallbackX = primaryWorkArea.x + Math.round((primaryWorkArea.width - defaultWidth) / 2);
    const centerFallbackY = primaryWorkArea.y + Math.round((primaryWorkArea.height - defaultHeight) / 2);

    let targetX = centerFallbackX;
    let targetY = centerFallbackY;

    if (Array.isArray(savedPos) && savedPos.length >= 2) {
        const potentialX = Number(savedPos[0]);
        const potentialY = Number(savedPos[1]);

        if (!isNaN(potentialX) && !isNaN(potentialY)) {

            const displayNearestWindow = screen.getDisplayNearestPoint({ x: potentialX, y: potentialY });
            const bounds = displayNearestWindow.bounds;


            const isVisibleX = (potentialX >= bounds.x) && (potentialX <= bounds.x + bounds.width);
            const isVisibleY = (potentialY >= bounds.y) && (potentialY <= bounds.y + bounds.height);

            if (isVisibleX && isVisibleY) {

                targetX = potentialX;
                targetY = potentialY;;
            } else {
                logger.warn(`WINIT | Saved position (${potentialX}, ${potentialY}) is off-screen. Resetting to primary display center...`);
            }
        } else {
            logger.warn("WINIT | Configured window position contains invalid numbers. Resetting to defaults...");
        }
    } else {
        logger.info("WINIT | No valid saved window position array provided. Centering window...");
    }

    winInstance.setPosition(Math.round(targetX), Math.round(targetY));
    
}

export function clampWinSize(winInstance, maxWidthRatio = 0.8, maxHeightRatio = 0.8, proposedWidth = null, proposedHeight = null) {
    let width, height;
    
    if (Number.isInteger(proposedWidth) && Number.isInteger(proposedHeight)) {
        width = proposedWidth;
        height = proposedHeight;
    } else {
        [width, height] = winInstance.getSize();
    }

    const bounds = winInstance.getBounds();
    const displayNearestWindow = screen.getDisplayMatching(bounds);
    const workArea = displayNearestWindow.workArea;

    const minAllowWidth = 300;
    const minAllowHeight = 460;
    const maxWidthCap = 4000;
    const maxHeightCap = 4000;

    const maxAllowWidth = Math.round(workArea.width * maxWidthRatio);
    const maxAllowHeight = Math.round(workArea.height * maxHeightRatio);

    const safeX = Math.round(workArea.x + (workArea.width - proposedWidth) / 2);
    const safeY = Math.round(workArea.y + (workArea.height - proposedHeight) / 2);

    let clamped = false;

    if (width < minAllowWidth) {
        logger.warn(`WINIT | Window width ${width} below floor ${minAllowWidth}, clamping.`);
        width = minAllowWidth;
        clamped = true;
    }  else if (width > maxAllowWidth) {
        logger.warn(`WINIT | Window width ${width} exceeds soft cap ${maxAllowWidth}, clamping.`);
        width = maxAllowWidth;
        clamped = true;
    }
    else if (width > maxWidthCap) {
        logger.error(`WINIT | FATAL | Window width ${width} exceeded ceiling ${maxWidthCap}, clamping.`);
        width = maxWidthCap;
        clamped = true;
    }

    if (height < minAllowHeight) {
        logger.warn(`WINIT | Window height ${height} below floor ${minAllowHeight}, clamping.`);
        height = minAllowHeight;
        clamped = true;
    }  else if (height > maxAllowHeight) {
        logger.warn(`WINIT | Window height ${height} exceeds soft cap ${maxAllowHeight}, clamping.`);
        height = maxAllowHeight;
        clamped = true;
    }
    else if (height > maxHeightCap) {
        logger.error(`WINIT | FATAL | Window height ${height} exceeded ceiling ${maxHeightCap}, clamping.`);
        height = maxHeightCap;
        clamped = true;
    }

    if (clamped) {
        winInstance.setSize(width, height);
        logger.info(`WINIT | Window size clamped to ${width}x${height} (Scale Factor: ${displayNearestWindow.scaleFactor})`);
    }

    return { width, height, safeX, safeY, clamped };
}


export function validateBounds(winInstance) {
    const size = winInstance.getSize();
    const [width, height] = size;

    if (width > 4000 || height > 4000) {
        logger.error(`WINIT | FATAL | Window size exceeds sensible boundaries, resetting...`);
        return false;
    }
    if (width <= 0 || height <= 0) {
        logger.error(`WINIT | FATAL | Window size is invalid ${width}x${height}!`);
        return false;
    }

    return true;
}