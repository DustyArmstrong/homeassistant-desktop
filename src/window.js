// window.js

import { shell, BrowserWindow } from "electron";
import { join } from "node:path";
import logger from "electron-log";
import config from "../config.js";
import { forceQuitStatus } from "./menu.js";
import { isWebSocketOpen, initWebSocketHealth, closeWebSocket } from "./networking.js";
import { changePosition, createTray } from "./menu.js";
import { showError, initWindowBounds, clampWinSize, validateBounds } from "./display.js";
import { currentInstance } from "./instance.js";

let winIsReloading = false;
let mainWindowLoaded = false;
let isShowing = false;
let mainWindow;
let isAdjustingBounds = false;
let isFullyInitialized = false;
let isInitializing = false;
let showWindowRetries = 0;
const MAX_SHOW_RETRIES = 10;
let lastPositionChangeTime = 0;
const defaultSize = config.get("windowSize") || [420, 460];

const __dirname = import.meta.dirname;
const indexFile = `file://${__dirname}/../web/index.html`;

export function registerWindowListeners(mainWindow) {
	let readyToShowHandled = false;

	mainWindow.on("ready-to-show", () => {
		if (readyToShowHandled) {
			return;
		}
		readyToShowHandled = true;

		setTimeout(() => {
			isAdjustingBounds = true;
			try {
				const bounds = mainWindow.getBounds();
				logger.info(`WINIT | Window initialized | x=${bounds.x}, y=${bounds.y}, w=${bounds.width}, h=${bounds.height}`);
			} catch (error) {
				logger.error(`WINIT | Window could not be initialized | ${error}`);
			} finally {
				isAdjustingBounds = false;
			}
		}, 10);
	});

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
			logger.error("MAINWIN | unable to load URL, cannot resolve network");
			showError(true);
			return false;
		}
	};

	mainWindow.webContents.on("did-fail-load", async (e, errorCode, validatedURL, errorCodeDescription) => {
		logger.error(`WEBCONT | URL: ${validatedURL} | Code: ${errorCode} | Desc: ${errorCodeDescription}`);
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

	mainWindow.webContents.on("render-process-gone", (_event, detailed) => {
		logger.error("RENDR | " + detailed.reason);
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

	mainWindow.on("resize", (_event) => {
		if (isAdjustingBounds) {
			return;
		}

		if (mainWindow.isFullScreen()) {
			return;
		}

		if (!validateBounds(mainWindow)) {
			isAdjustingBounds = true;
			try {
				mainWindow.setSize(defaultSize[0], defaultSize[1]);
				logger.error("WINSIZE | Corrupt window size reset to defaults");
			} catch (error) {
				logger.error(`WINSIZE | Window size error | ${error}`);
			} finally {
				isAdjustingBounds = false;
			}
			return;
		}

		const currentSize = mainWindow.getSize();

		if (config.get("detachedMode")) {
			config.set("windowSizeDetached", currentSize);
		} else {
			const now = Date.now();
			if (now - lastPositionChangeTime > 200) {
				lastPositionChangeTime = now;
				changePosition(currentSize[0], currentSize[1]);
			}
			config.set("windowSize", currentSize);
		}
	});

	mainWindow.on("move", () => {
		if (isAdjustingBounds) {
			return;
		}

		if (config.get("detachedMode")) {
			config.set("windowPosition", mainWindow.getPosition());
		}
	});

	mainWindow.on("close", (event) => {
		if (!forceQuitStatus()) {
			mainWindow.hide();
			event.preventDefault();
		}
	});

	mainWindow.on("blur", () => {
		if (!config.get("detachedMode") && !mainWindow.isAlwaysOnTop()) {
			mainWindow.hide();
		}
	});

	return tryLoadURL;
}

export async function createMainWindow(show = false) {
	if (isInitializing) {
		logger.warn("MAINWIN | Window is already initializing, skipping...");
		return mainWindow;
	}
	isInitializing = true;

	try {
		const savedSize = config.get("windowSize");
		const savedDetachedSize = config.get("windowSizeDetached");
		const detachedMode = config.get("detachedMode");
		const initialWidth = detachedMode && savedDetachedSize ? savedDetachedSize[0] : (savedSize ? savedSize[0] : 420);
		const initialHeight = detachedMode && savedDetachedSize ? savedDetachedSize[1] : (savedSize ? savedSize[1] : 460);
		const savedPos = config.get("windowPosition");

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
			useContentSize: true,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				preload: join(__dirname, "../web", "preload.cjs"),
			},
		});

		initWindowBounds(mainWindow, initialWidth, initialHeight, savedPos);
		mainWindowLoaded = false;

		const tryLoadURL = registerWindowListeners(mainWindow);

		mainWindow.setAlwaysOnTop(!!config.get("stayOnTop"));
		toggleFullScreen(!!config.get("fullScreen"));

		isAdjustingBounds = true;
		try {
			if (config.get("detachedMode")) {
				if (config.has("windowPosition") && config.has("windowSizeDetached")) {
					const [xPosition, yPosition] = config.get("windowPosition");
					const [width, height] = config.get("windowSizeDetached");
					const clamped = clampWinSize(mainWindow);
					mainWindow.setBounds({ x: xPosition, y: yPosition, width, height });
					if (clamped.clamped) {
						logger.warn(`WINSIZE | Detached bounds clamped | x=${xPosition}, y=${yPosition}, w=${width}, h=${height}`);
					}
				} else {
					config.set("windowPosition", mainWindow.getPosition());
					config.set("windowSizeDetached", mainWindow.getSize());
					logger.info("Window initialized with detached mode defaults");
				}
			} else if (config.has("windowSize")) {
				const [width, height] = config.get("windowSize");
				const clamped = clampWinSize(mainWindow);
				mainWindow.setSize(width, height);
				if (clamped.clamped) {
					logger.warn(`WINSIZE | Bounds clamped | ${width}x${height}`);
				}
			} else {
				config.set("windowSize", mainWindow.getSize());
				logger.info("Window initialized with default size");
			}
		} catch (error) {
			logger.error(`WINIT | Window size calculations failed | ${error}`);
		} finally {
			isAdjustingBounds = false;
		}

		await tryLoadURL();

		createTray();

		isFullyInitialized = true;
		return mainWindow;

	} catch (error) {
		logger.error(`MAINWIN | Error initializing window | ${error}`);
	} finally {
		isInitializing = false;
	}
}

export async function reinitMainWindow() {
	if (isInitializing) {
		logger.warn("REINIT | Main window is already re-initializing, skipping...");
		return;
	}
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
	if (!isFullyInitialized) {
		if (showWindowRetries >= MAX_SHOW_RETRIES) {
			logger.error("SHWIN | Max retries exceeded, giving up on show");
			showWindowRetries = 0;
			return;
		}
		showWindowRetries++;
		logger.warn(`SHWIN | Window not yet initialized, retrying (${showWindowRetries}/${MAX_SHOW_RETRIES})...`);
		setTimeout(showWindow, 100);
		return;
	}
	showWindowRetries = 0;
	if (!mainWindow || mainWindow.isDestroyed()) {
		logger.error("SHWIN | Attempted to show window, but no main window was available");
		return;
	}
	if (isShowing) {
		return;
	}
	isShowing = true;

	isAdjustingBounds = true;
	try {
		if (!config.get("detachedMode") && process.platform !== "linux") {
			const now = Date.now();
			if (now - lastPositionChangeTime > 200) {
				lastPositionChangeTime = now;
				changePosition();
			}
		}

		if (mainWindow.isMinimized()) {
			mainWindow.restore();
		}

		if (process.platform === "darwin") {
			mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		}

		if (!mainWindow || mainWindow.isDestroyed()) {
			logger.error("SHWIN | Window destroyed during show");
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
		logger.error(`SHWIN | Error attempting to show window | ${error}`);
	} finally {
		isAdjustingBounds = false;
		isShowing = false;
	}
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