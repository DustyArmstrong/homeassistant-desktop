import { app, globalShortcut} from "electron";
//import { createLongLivedTokenAuth } from "home-assistant-js-websocket";
import logger from "electron-log";
import config from "./config.js";
import './src/ipc.js';
import { checkForUpdates, initWebSocketHealth, isWebSocketOpen } from './src/networking.js';
import { getMenu, getMainTray } from './src/menu.js';
import { registerKeyboardShortcut, unregisterKeyboardShortcut } from './src/shortcuts.js';
import { currentInstance } from './src/instance.js';
import { createMainWindow, toggleFullScreen, getMainWindow } from './src/window.js';
import { checkAutoStart, setResumeHandledStatus, setSleepHandledStatus } from "./src/power.js";

logger.errorHandler.startCatching();
logger.info(`${app.name} started`);
logger.info(`Platform: ${process.platform} ${process.arch}`);

if (process.platform === "darwin") {
  app.dock.hide();
}

if (typeof global.location === 'undefined') {
  global.location = {
    href: 'http://home-assistant-desktop',
    origin: 'http://home-assistant-desktop',
    pathname: '/'
  };
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

  app.whenReady().then(async () => {
    checkAutoStart();
    setSleepHandledStatus(false);
    setResumeHandledStatus(false);

    await createMainWindow(!config.has("currentInstance"));

    if (config.get("autoUpdate") === true) {
      checkForUpdates();
    }

    if (process.platform === "linux") {
      const tray = getMainTray();
      tray.setContextMenu(getMenu());
    }

    if (!isWebSocketOpen()) {
      logger.info("Initialized availability check");
      await initWebSocketHealth(currentInstance());
    }

    if (config.get("shortcutEnabled")) {
      registerKeyboardShortcut();
    }

    if (config.get("shortcutFullscreenEnabled")) {
      globalShortcut.register("CommandOrControl+Alt+Return", () => {
        toggleFullScreen();
      });
    }

    if (!config.has("currentInstance")) {
      config.set("disableHover", true);
    }

    if (!config.has("autoUpdate")) {
      config.set("autoUpdate", true);
    }
  });

app.on("will-quit", () => {
  unregisterKeyboardShortcut();
});

app.on("window-all-closed", () => {
  // if (process.platform !== 'darwin') {
  //   app.quit();
  // }
});
