import { shell, screen, BrowserWindow } from "electron";
import path from "path";
import logger from "electron-log";
import config from "../config.js";
import { forceQuitStatus } from "./menu.js";
import { isWebSocketOpen, initWebSocketHealth, closeWebSocket } from "./networking.js";
import { changePosition, createTray } from "./menu.js";
import { showError } from "./display.js";
import { currentInstance } from "./instance.js";

let initialized = false;
let resizeEvent = false;
let winIsReloading = false;
let mainWindowLoaded = false;
let mainWindow;

const __dirname = import.meta.dirname;
const indexFile = `file://${__dirname}/../web/index.html`;

export async function createMainWindow(show = false) {
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
			preload: path.join(__dirname, "../web", "preload.cjs"),
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
			logger.error(`MAINWIN - (${attempt}):`, error);
			if (attempt < maxAttempts) {
				await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
				return tryLoadURL(attempt + 1, maxAttempts);
			}
			try {
				logger.error("MAINWIN - Unable to load window, cannot resolve network");
				showError(true);
			} catch (error) {
				logger.error(`MAINWIN - ${error}`);
			}
			return false;
		}
	};
	await tryLoadURL();

	createTray();

	mainWindow.webContents.on("did-fail-load", async (e, errorCode, validatedURL) => {
		logger.error(`WEBCONT - ${validatedURL} (code ${errorCode})`);
		if (!mainWindowLoaded || winIsReloading) {
			logger.info("Window hasn't loaded yet or is already reloading...");
			return;
		}
		winIsReloading = true;
		try {
			await tryLoadURL(1);
		} catch (error) {
			logger.error(`WEBCONT - ${error}`);
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
				logger.error(`RENDR - ${error}`);
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

		if (!config.get("disableHover") || resizeEvent) {
			config.set("disableHover", true);
			resizeEvent = e;
			setTimeout(() => {
				if (resizeEvent === e) {
					config.set("disableHover", false);
					resizeEvent = false;
				}
			}, 600);
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
	return mainWindow;
}

export async function reinitMainWindow() {
	logger.info("Re-initialized main window");
	mainWindow.destroy();
	mainWindow = null;
	await new Promise(resolve => setTimeout(resolve, 1000));
	await createMainWindow(!config.has("currentInstance"));

	await new Promise((resolve) => {
		mainWindow.webContents.once("did-finish-load", resolve);
	});

	if (isWebSocketOpen()) {
		logger.info("Websocket should not be open, killing...");
		await closeWebSocket("reinitMainWindow");
	} else {
		logger.info("Re-initialized availability check");
		await initWebSocketHealth(currentInstance());
	}
}

export function showWindow() {
	if (!config.get("detachedMode")) {
		changePosition();
	}

	if (!mainWindow.isVisible()) {
		mainWindow.setVisibleOnAllWorkspaces(true);
		mainWindow.show();
		mainWindow.focus();
		mainWindow.setVisibleOnAllWorkspaces(false);
		mainWindow.setSkipTaskbar(!config.get("detachedMode"));
	}
}

export function setWindowFocusTimer() {
	setTimeout(() => {
		const mousePos = screen.getCursorScreenPoint();
		const windowPosition = mainWindow.getPosition();
		const windowSize = mainWindow.getSize();

		if (
			!resizeEvent &&
			(!(mousePos.x >= windowPosition[0] && mousePos.x <= windowPosition[0] + windowSize[0]) ||
				!(mousePos.y >= windowPosition[1] && mousePos.y <= windowPosition[1] + windowSize[1]))
		) {
			mainWindow.hide();
		} else {
			setWindowFocusTimer();
		}
	}, 110);
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
