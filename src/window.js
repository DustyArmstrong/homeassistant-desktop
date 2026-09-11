import { shell, BrowserWindow } from "electron";
import { join } from "node:path";
import logger from "electron-log";
import config from "../config.js";
import { forceQuitStatus } from "./menu.js";
import { isWebSocketOpen, initWebSocketHealth, closeWebSocket } from "./networking.js";
import { changePosition, createTray } from "./menu.js";
import { showError } from "./display.js";
import { currentInstance } from "./instance.js";

let initialized = false;
let winIsReloading = false;
let mainWindowLoaded = false;
let isShowing = false;
let mainWindow;

const __dirname = import.meta.dirname;
const indexFile = `file://${__dirname}/../web/index.html`;

export async function createMainWindow(show = false) {
	logger.debug(`createMainWindow: disableFrame=${config.get("disableFrame")}`);
	logger.info("Loading main window...");
	mainWindow = new BrowserWindow({
		width: 420,
		height: 460,
		minWidth: 420,
		minHeight: 460,
		show: false,
		skipTaskbar: !show,
		autoHideMenuBar: true,
		frame: !config.get("disableFrame") && process.platform !== "darwin",
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: join(__dirname, "../web", "preload.cjs"),
		},
	});

	//mainWindow.webContents.openDevTools();
	mainWindowLoaded = false;
	const tryLoadURL = async (attempt = 1, maxAttempts = 5) => {
		try {
			logger.info("Loading index...", attempt);
			await mainWindow.loadURL(indexFile);
			logger.info("Initialized main window");
			mainWindowLoaded = true;
			return true;
		} catch (error) {
			logger.error(`MAINWIN | failed to load on attempt ${attempt} | ${error}`);
			if (attempt < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
				return tryLoadURL(attempt + 1, maxAttempts);
			}
			try {
				logger.error("MAINWIN | unable to load URL, cannot resolve network");
				showError(true);
			} catch (error) {
				logger.error(`MAINWIN | fatal error encountered loading URL | ${error}`);
			}
			return false;
		}
	};
	await tryLoadURL();

	mainWindow.webContents.on("did-fail-load", async (e, errorCode, validatedURL) => {
		logger.error(`WEBCONT | ${validatedURL} | ${errorCode}`);
		if (!mainWindowLoaded || winIsReloading) {
			logger.warn("Window hasn't loaded yet or is already reloading...");
			return;
		}
		winIsReloading = true;
		try {
			await tryLoadURL(1);
		} catch (error) {
			logger.error(`WEBCONT | webcontents failed to load | ${error}`);
			showError(true);
		} finally {
			winIsReloading = false;
		}
	});

	mainWindow.webContents.on("render-process-gone", (event, detailed) => {
		logger.error("RENDR - " + detailed.reason);
		const RELOAD_REASONS = new Set(["crashed", "abnormal-exit", "oom", "launch-failed"]);
		if (RELOAD_REASONS.has(detailed.reason)) {
			try {
				mainWindow.webContents.reload();
				logger.info("Renderer rebooted successfully.");
			} catch (error) {
				logger.error(`RENDR | renderer process failed | ${error}`);
				showError(true);
			}
		}
	});

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});

	mainWindow.webContents.on("did-finish-load", async function () {
		await mainWindow.webContents.insertCSS("::-webkit-scrollbar { display: none; } body { -webkit-user-select: none; }");

		if (config.get("detachedMode") && process.platform === "darwin") {
			await mainWindow.webContents.insertCSS("body { -webkit-app-region: drag; }");
		}
	});

	if (config.get("detachedMode")) {
		if (config.has("windowPosition")) {
			mainWindow.setSize(...config.get("windowSizeDetached"));
		} else {
			config.set("windowPosition", mainWindow.getPosition());
		}

		if (config.has("windowSizeDetached")) {
			mainWindow.setPosition(...config.get("windowPosition"));
		} else {
			config.set("windowSizeDetached", mainWindow.getSize());
		}
	} else if (config.has("windowSize")) {
		mainWindow.setSize(...config.get("windowSize"));
	} else {
		config.set("windowSize", mainWindow.getSize());
	}

	mainWindow.on("resize", (e) => {
		if (mainWindow.isFullScreen()) {
			return e;
		}

		if (config.get("detachedMode")) {
			config.set("windowSizeDetached", mainWindow.getSize());
		} else {
			if (process.platform !== "linux") {
				changePosition();
			}

			config.set("windowSize", mainWindow.getSize());
		}
	});

	mainWindow.on("move", () => {
		if (config.get("detachedMode")) {
			config.set("windowPosition", mainWindow.getPosition());
		}
	});

	mainWindow.on("close", (e) => {
		if (!forceQuitStatus()) {
			mainWindow.hide();
			e.preventDefault();
		}
	});

	mainWindow.on("blur", () => {
		if (!config.get("detachedMode") && !mainWindow.isAlwaysOnTop()) {
			mainWindow.hide();
		}
	});

	mainWindow.setAlwaysOnTop(!!config.get("stayOnTop"));

	if (initialized && (mainWindow.isAlwaysOnTop() || show)) {
		showWindow();
	}

	toggleFullScreen(!!config.get("fullScreen"));

	initialized = true;
	createTray();
	return mainWindow;
}

export async function reinitMainWindow() {
	logger.info("Re-initialized main window");
	if (isWebSocketOpen()) {
		logger.warn("Closing stale websocket...");
		await closeWebSocket("reinitMainWindow");
	}
	mainWindow.destroy();
	mainWindow = null;
	await new Promise(resolve => setTimeout(resolve, 500));
	await createMainWindow(!config.has("currentInstance"));

	await new Promise((resolve) => {
		mainWindow.webContents.once("did-finish-load", resolve);
	});

	await new Promise(resolve => setTimeout(resolve, 500));
	logger.info("Re-initialized availability check");
	await initWebSocketHealth(currentInstance());
}

export function showWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        logger.error("SHWIN | Attempted to show window, but no window was available");
        return;
    }
    if (isShowing) {
        return;
    }
    isShowing = true;


    if (!config.get("detachedMode")) {
        changePosition();
    }

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    if (process.platform === "darwin") {
        mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    setTimeout(() => {
        try {
            if (!mainWindow || mainWindow.isDestroyed()) {
                return;
            }

            mainWindow.show();

            if (process.platform === "win32") {
                mainWindow.focus();
            } else if (process.platform === "darwin") {
                mainWindow.focus();
                mainWindow.setVisibleOnAllWorkspaces(false);
            } else {
                mainWindow.setFocusable(true);
                mainWindow.focus();
            }

            mainWindow.setSkipTaskbar(!config.get("detachedMode"));

        } catch (error) {
            logger.error(`SHWIN | general error | ${error.message}`);
        } finally {
            isShowing = false;
        }
    }, 16); 
}			

export function toggleFullScreen(mode = !mainWindow.isFullScreen()) {
	config.set("fullScreen", mode);
	mainWindow.setFullScreen(mode);

	if (mode) {
		mainWindow.setAlwaysOnTop(true);
	} else {
		mainWindow.setAlwaysOnTop(config.get("stayOnTop"));
	}
}

export function getMainWindow() {
	return mainWindow;
}
