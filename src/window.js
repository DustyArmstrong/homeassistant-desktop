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
let resizeTimeout = null;
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
				logger.info(`Window initialized | x=${bounds.x}, y=${bounds.y}, w=${bounds.width}, h=${bounds.height}`);
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
			mainWindowLoaded = true;
			return true;
		} catch (error) {
			logger.error(`MAINWIN | failed to load on attempt ${attempt} | ${error}`);
			if (attempt < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
				return tryLoadURL(attempt + 1, maxAttempts);
			}
			logger.error("MAINWIN | unable to load URL, cannot resolve network");
			showError(true, mainWindow);
			return false;
		}
	};

	mainWindow.webContents.on("did-fail-load", async (e, errorCode, validatedURL, errorCodeDescription) => {
		logger.error(`WEBCONT | URL: ${validatedURL} | Code: ${errorCode} | Desc: ${errorCodeDescription}`);
		if (!mainWindowLoaded || winIsReloading) {
			logger.warn("WEBCONT | Window is currently loading...");
			return;
		}
		winIsReloading = true;
		try {
			await tryLoadURL(1);
		} catch (error) {
			logger.error(`WEBCONT | webcontents failed to load | ${error}`);
			showError(true, mainWindow);
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
				logger.info("Renderer rebooted successfully!");
			} catch (error) {
				logger.error(`RENDR | renderer process failed | ${error}`);
				showError(true, mainWindow);
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
		if (isAdjustingBounds || mainWindow.isFullScreen()) {
			return;
		}

		if (!validateBounds(mainWindow)) {
			resetToDefaultBounds();
			return;
		}

		if (process.platform === "linux") {
			if (resizeTimeout) {
				clearTimeout(resizeTimeout);
			}

			resizeTimeout = setTimeout(() => {
				const finalSize = mainWindow.getSize();

				if (config.get("detachedMode")) {
					config.set("windowSizeDetached", finalSize);
				} else {
					config.set("windowSize", finalSize);
					isAdjustingBounds = true;
					try {
						changePosition(finalSize[0], finalSize[1]);
					} catch (error) {
						logger.error(`WINSIZE | Error saving window configuration | ${error}`);
					} finally {
						isAdjustingBounds = false;
					}
				}
				
				logger.info("Window size saved successfully!");
				
				resizeTimeout = null; 
			}, 300);
		}

		if (!config.get("detachedMode")) {
			const currentSize = mainWindow.getSize();
			const now = Date.now();
			if (now - lastPositionChangeTime > 200) {
				lastPositionChangeTime = now;
				changePosition(currentSize[0], currentSize[1]);
			}
		}
	});

	mainWindow.on("move", () => {
		if (isAdjustingBounds) {
			return;
		}
		if (process.platform === "linux") {
			const now = Date.now();
			if (now - lastPositionChangeTime < 800) {
				return;
			}
			lastPositionChangeTime = now;

			const finalPosition = mainWindow.getPosition();
			const currentSize = mainWindow.getSize();
			
			if (config.get("detachedMode")) {
				config.set("windowPosition", finalPosition);
			} else {
				config.set("windowPosition", finalPosition);
				changePosition(currentSize[0], currentSize[1]);
			}
			return;
		}
	});

	mainWindow.on("resized", () => {
		if (isAdjustingBounds || mainWindow.isFullScreen()) {
			return;
		}

		const finalSize = mainWindow.getSize();

		if (config.get("detachedMode")) {
			config.set("windowSizeDetached", finalSize);
		} else {
			config.set("windowSize", finalSize);
			isAdjustingBounds = true; 
			try {
				changePosition(finalSize[0], finalSize[1]);
			} catch (error) {
				logger.error(`WINSIZE | Error saving window configuration | ${error}`);
			} finally {
				isAdjustingBounds = false;
			}
		}
		logger.info("Window size saved!");
	});

	mainWindow.on("moved", () => {
		if (isAdjustingBounds) {
			return; 
		}

		const finalPosition = mainWindow.getPosition();
		const currentSize = mainWindow.getSize();

		if (config.get("detachedMode")) {
			config.set("windowPosition", finalPosition);
		} else {
			isAdjustingBounds = true;
			try {
				changePosition(currentSize[0], currentSize[1]);
			} catch (error) {
				logger.error(`WINSIZE | Error saving window configuration | ${error}`);
			} finally {
				isAdjustingBounds = false;
			}
		}
		logger.info("Window size saved!");
	});

	function resetToDefaultBounds() {
		isAdjustingBounds = true;
		try {
			mainWindow.setSize(defaultSize[0], defaultSize[1]);
			logger.error("WINSIZE | Corrupt window size reset to defaults");
		} catch (error) {
			logger.error(`WINSIZE | Window size error | ${error}`);
		} finally {
			isAdjustingBounds = false;
		}
	}

	mainWindow.on("close", (event) => {
		if (resizeTimeout) {
			clearTimeout(resizeTimeout);
			resizeTimeout = null;
		}
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
			minWidth: 300,
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
					const clamped = clampWinSize(mainWindow, 0.8, 0.8, width, height);
					const { width: finalWidth, height: finalHeight, x: safeX, y: safeY } = clamped;
					mainWindow.setBounds({ x: xPosition, y: yPosition, width: finalWidth, height: finalHeight });
					if (clamped.clamped) {
						logger.warn(`WINSIZE | Detached bounds clamped | x=${safeX}, y=${safeY}, w=${finalWidth}, h=${finalHeight}`);
						config.set("windowSizeDetached", [finalWidth, finalHeight]);
						config.set("windowPosition", [safeX, safeY]);
						mainWindow.setBounds({ x: safeX, y: safeY, width: finalWidth, height: finalHeight });
					}
				} else {
					config.set("windowPosition", mainWindow.getPosition());
					config.set("windowSizeDetached", mainWindow.getSize());
					logger.info("Window initialized with detached mode defaults");
				}
			} else if (config.has("windowSize")) {
				const [width, height] = config.get("windowSize");
				const clamped = clampWinSize(mainWindow, 0.8, 0.8, width, height);
				const { width: finalWidth, height: finalHeight } = clamped;
				mainWindow.setSize(finalWidth, finalHeight);
				if (clamped.clamped) {
					logger.warn(`WINSIZE | Bounds clamped | ${finalWidth}x${finalHeight}`);
					config.set("windowSize", [finalWidth, finalHeight]);
					mainWindow.setSize(finalWidth, finalHeight);
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
		if (!config.get("detachedMode")) {
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