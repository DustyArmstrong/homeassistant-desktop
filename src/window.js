import { shell, BrowserWindow, screen } from "electron";
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
let intendedWidth = defaultSize[0];
let intendedHeight = defaultSize[1];

const __dirname = import.meta.dirname;
const indexFile = `file://${__dirname}/../web/index.html`;

export async function createMainWindow(show = false) {
	if (isInitializing) {
		logger.warn("MAINWIN | Window is already initializing, skipping...");
		return mainWindow;
	}
	isInitializing = true;

	try {
		logger.debug(`createMainWindow: disableFrame=${config.get("disableFrame")}`);
		logger.info("Loading main window...");
		const savedSize = config.get("windowSize");
		const savedDetachedSize = config.get("windowSizeDetached");
		const detachedMode = config.get("detachedMode");
		const initialWidth = detachedMode && savedDetachedSize ? savedDetachedSize[0] : (savedSize ? savedSize[0] : 420);
		const initialHeight = detachedMode && savedDetachedSize ? savedDetachedSize[1] : (savedSize ? savedSize[1] : 460);
		const savedPos = config.get("windowPosition");

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
		let readyToShowHandled = false;
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

		mainWindow.on("ready-to-show", () => {
			if (readyToShowHandled) {
				logger.debug("ready-to-show already handled, skipping duplicate event");
				return;
			}
			readyToShowHandled = true;
			
			setTimeout(() => {
				isAdjustingBounds = true;
				try {
					const bounds = mainWindow.getBounds();
					logger.info(`Ready-to-show bounds: x=${bounds.x}, y=${bounds.y}, w=${bounds.width}, h=${bounds.height}`);
					const displays = screen.getAllDisplays();
					logger.info("Available displays:", displays.map(disp => ({
						id: disp.id,
						bounds: disp.bounds,
						workArea: disp.workArea,
						scaleFactor: disp.scaleFactor

					})));
					//ensureWinVisible(mainWindow);
				} catch (error) {
					logger.error(`SHWIN | Ready to show failed | ${error}`);
				} finally {
					isAdjustingBounds = false;
				}
			}, 10);
		});

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

		mainWindow.webContents.on("render-process-gone", (event, detailed) => {
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

		isAdjustingBounds = true;
		try {
			if (config.get("detachedMode")) {
				if (config.has("windowPosition") && config.has("windowSizeDetached")) {
					const [xPosition, yPosition] = config.get("windowPosition");
					const [width, height] = config.get("windowSizeDetached");

					const clamped = clampWinSize(mainWindow);
					mainWindow.setBounds({x: xPosition, y: yPosition, width, height});
					logger.info(`Restored detached bounds: x=${xPosition}, y=${yPosition}, w=${width}, h=${height}${clamped.clamped ? " (CLAMPED)" : ""}`);
				} else {
					config.set("windowPosition", mainWindow.getPosition());
					config.set("windowSizeDetached", mainWindow.getSize());
					logger.info("Window initialized with detached mode defaults");
				}
			} else if (config.has("windowSize")) {
				const [width, height] = config.get("windowSize");
				await new Promise(resolve => setTimeout(resolve, 50));
				const clamped = clampWinSize(mainWindow);
				mainWindow.setSize(width, height);
				await new Promise(resolve => setTimeout(resolve, 50));
				const actualSize = mainWindow.getSize();
				logger.info(`Restored window size: ${width}x${height}, actual: ${actualSize[0]}x${actualSize[1]}${clamped.clamped ? " (CLAMPED)" : ""}`);
			} else {
				config.set("windowSize", mainWindow.getSize());
				logger.info("Window initialized with default size");
			}
		} catch (error) {
			logger.error(`WINIT | Window size calculations failed | ${error}`);
		} finally {
			isAdjustingBounds = false;
		}

		//ensureWinVisible(mainWindow);

		mainWindow.on("resize", (event) => {
			if (isAdjustingBounds) {
				logger.debug("WINSIZE | Skipping due to active bounds adjustment");
				return;
			}
			
			if (mainWindow.isFullScreen()) {
				return event;
			}

			if (!validateBounds(mainWindow)) {
				isAdjustingBounds = true;
				try {
					mainWindow.setSize(defaultSize[0], defaultSize[1]);
					intendedWidth = defaultSize[0];
					intendedHeight = defaultSize[1];
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

				intendedWidth = currentSize[0];
				intendedHeight = currentSize[1];

				if (process.platform !== "linux") {
					const now = Date.now();
					if (now - lastPositionChangeTime > 200) {
						lastPositionChangeTime = now;
						
						changePosition(intendedWidth, intendedHeight);
					} else {
						logger.debug("WINSIZE | Skipped changePosition due to debounce");
					}
				}
				config.set("windowSize", currentSize);
			}
		});

		mainWindow.on("move", () => {
			if (isAdjustingBounds) {
				logger.debug("WINMV | Skipping due to active bounds adjustment");
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

		mainWindow.setAlwaysOnTop(!!config.get("stayOnTop"));

		toggleFullScreen(!!config.get("fullScreen"));

		isFullyInitialized = true;
		createTray();
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
		logger.debug("SHWIN | Window is already being shown, skipping duplicate call");
        return;
    }
    isShowing = true;

    isAdjustingBounds = true;
    try {
        if (!config.get("detachedMode") && process.platform !== "linux") {
            const now = Date.now();
            if (now - lastPositionChangeTime > 200) {
                lastPositionChangeTime = now;
				logger.debug(`SHOWWIN | Window size before showWindow: ${JSON.stringify(mainWindow.getBounds())}`);
                changePosition();
            } else {
                logger.debug("SHWIN | Skipped changePosition due to debounce");
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

		const bounds = mainWindow.getBounds();
		logger.debug(`Showing window at: x=${bounds.x}, y=${bounds.y}, w=${bounds.width}, h=${bounds.height}`);

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
		logger.debug(`SHOWWIN | Window size after moves: ${JSON.stringify(mainWindow.getBounds())}`);
    }
	
	//ensureWinVisible(mainWindow);
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