import { app, dialog, ipcMain, shell, globalShortcut, screen, Menu, Tray, BrowserWindow, powerMonitor } from "electron";
import AutoLaunch from "auto-launch";
import Positioner from "electron-traywindow-positioner";
import Bonjour from "bonjour-service";
import logger from "electron-log";
import config  from "./config.js";
import semver from "semver";
import http from 'http';
import https from 'https';
import axios from 'axios';
import path from 'path';
const bonjour = new Bonjour.Bonjour();

if (config.get("highDPIMode")) {
  app.commandLine.appendSwitch('high-dpi-support', 'true');
}

if (config.get("forceScaling")) {
  app.commandLine.appendSwitch('force-device-scaling-factor', 1);
}

logger.errorHandler.startCatching();
logger.info(`${app.name} started`);
logger.info(`Platform: ${process.platform} ${process.arch}`);

if (process.platform === "darwin") {
  app.dock.hide();
}

const autoLauncher = new AutoLaunch({ name: "Home Assistant Desktop" });

const __dirname = import.meta.dirname;
const indexFile = `file://${__dirname}/web/index.html`;
const errorFile = `file://${__dirname}/web/error.html`;
const sleepFile = `file://${__dirname}/web/sleeping.html`;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });

let initialized = false;
let autostartEnabled = false;
let forceQuit = false;
let resizeEvent = false;
let retryingAvailability = false;
let sleepHandled = false;
let resumeHandled = false;
let winIsReloading = false;
let avIsChecking = false;
let mainWindow;
let tray;
let availabilityCheckerInterval;

function registerKeyboardShortcut() {
  globalShortcut.register(config.get("userShortcut"), () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      if (process.platform === "darwin") {
        app.dock.hide();
      }
    } else {
      showWindow();
    }
  });
}

function unregisterKeyboardShortcut() {
  globalShortcut.unregisterAll();
}

async function checkForUpdates() {
  try {
    const apiResponse = await fetch("https://api.github.com/repos/DustyArmstrong/homeassistant-desktop/releases/latest");
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
      logger.error("UPDT - " + error);
    }
  }

function checkAutoStart() {
  autoLauncher
    .isEnabled()
    .then((isEnabled) => {
      autostartEnabled = isEnabled;
    })
    .catch((error) => {
      logger.error("AUTOST - " + error);
    });
}


async function availabilityCheck() {
  const instance = currentInstance();

  if (!instance) {
      return;
  }

  if (avIsChecking) {
    return;
  }

  avIsChecking = true;

  try {
      const statusCode = await getResponse(instance, 8000);
      if (statusCode !== 200) {
        handleUnavailable(statusCode);
      }
  } catch (error) {
    logger.error("AVCHK - ", error);
    handleUnavailable(error);
  } finally {
    avIsChecking = false;
  }
}

async function getResponse(instance, timeoutMs = 8000) {
  const url = new URL(instance);
  const target = `${url.origin}/auth/providers`;

  try {
    const res = await axios.get(target, {
      timeout: timeoutMs,
      validateStatus: null,
      httpAgent,
      httpsAgent,
    });
    return res.status;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      const timeoutError = new Error('Request timed out');
      throw timeoutError;
    }
    throw {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      url: target
    };
  }
}

function handleUnavailable(reason) {
  logger.error("INSTAV - " + reason);
  if (retryingAvailability) {
    return;
  }
  clearInterval(availabilityCheckerInterval);
  availabilityCheckerInterval = null;
  showError(true);
  if (config.get('autoReconnect') === true) retryAvailabilityCheck();
  if (config.get('automaticSwitching')) checkForAvailableInstance();
}

async function retryAvailabilityCheck() {
  if (retryingAvailability) return;
  retryingAvailability = true;
  try {
    const instance = currentInstance();
    let retryCount = 0;
    const maxRetries = 5;

    while (retryCount <= maxRetries) {
      try {
        const statusCode = await getResponse(instance, 8000);
        if (statusCode === 200) {
          logger.info("Automatic reconnection successful!");
          mainWindow.webContents.send('retry-success', "Instance alive, reconnecting.");
          await reinitMainWindow();
          break;
        }
        if (retryCount === maxRetries) {
          logger.error("RETRY - Cannot automatically connect to instance.");
          mainWindow.webContents.send('retry-update', "Unable to connect to instance!");
        } else {
          mainWindow.webContents.send('retry-update', `Trying to reconnect ${retryCount} of ${maxRetries}`);
          logger.info(`Instance unavailable. Retry ${retryCount}...`);
          await new Promise(r => setTimeout(r, 4000));
        }
      } catch (error) {
        logger.error(`Instance was not available during retry ${retryCount}, hard connection failure.`);
        logger.error(error);
        //Fix me when you have more time
        mainWindow.webContents.send('retry-error', `Hard connection failure, instance unavailable (${retryCount}).`);
      }
      retryCount++;
    }
  } finally {
    retryingAvailability = false;
  }
}

function changePosition() {
  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const displayWorkArea = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  }).workArea;
  const taskBarPosition = Positioner.getTaskbarPosition(trayBounds);

  if (taskBarPosition === "top" || taskBarPosition === "bottom") {
    const alignment = {
      x: "center",
      y: taskBarPosition === "top" ? "up" : "down",
    };

    if (trayBounds.x + (trayBounds.width + windowBounds.width) / 2 < displayWorkArea.width) {
      Positioner.position(mainWindow, trayBounds, alignment);
    } else {
      const { y } = Positioner.calculate(mainWindow.getBounds(), trayBounds, alignment);

      mainWindow.setPosition(
        displayWorkArea.width - windowBounds.width + displayWorkArea.x,
        y + (taskBarPosition === "bottom" && displayWorkArea.y),
        false
      );
    }
  } else {
    const alignment = {
      x: taskBarPosition,
      y: "center",
    };

    if (trayBounds.y + (trayBounds.height + windowBounds.height) / 2 < displayWorkArea.height) {
      const { x, y } = Positioner.calculate(mainWindow.getBounds(), trayBounds, alignment);
      mainWindow.setPosition(x + (taskBarPosition === "right" && displayWorkArea.x), y);
    } else {
      const { x } = Positioner.calculate(mainWindow.getBounds(), trayBounds, alignment);
      mainWindow.setPosition(x, displayWorkArea.y + displayWorkArea.height - windowBounds.height, false);
    }
  }
}

async function checkForAvailableInstance() {
  const instances = config.get("allInstances");

  if (instances?.length > 1) {
    bonjour.find({ type: "home-assistant" }, (instance) => {
      if (instance.txt.internal_url && instances.indexOf(instance.txt.internal_url) !== -1) {
        return currentInstance(instance.txt.internal_url);
      }

      if (instance.txt.external_url && instances.indexOf(instance.txt.external_url) !== -1) {
        return currentInstance(instance.txt.external_url);
      }
    });
    let found;
    for (const instance of instances.filter((e) => e.url !== currentInstance())) {
      const statusCode = await getResponse(instance, 8000);
      if (statusCode === 200) {
        found = instance;
      };
      if (found) {
        currentInstance(found);
        break;
      }
    }
  }
}

async function getBonjourResult(instances) {
  return new Promise((resolve) => {
    const foundInstances = [];
    
    bonjour.find({ type: "home-assistant" }, (instance) => {
      if (instance.txt.internal_url && instances.indexOf(instance.txt.internal_url) === -1) {
        foundInstances.push(instance.txt.internal_url);
      }
      if (instance.txt.external_url && instances.indexOf(instance.txt.external_url) === -1) {
        foundInstances.push(instance.txt.external_url);
      }
    });
    setTimeout(() => {
      resolve(foundInstances);
    }, 1500);
  });
}

function getMenu() {
  const instancesMenu = [
    {
      label: "Open in Browser",
      enabled: currentInstance(),
      click: async () => {
        await shell.openExternal(currentInstance());
      },
    },
    {
      type: "separator",
    },
  ];

  const allInstances = config.get("allInstances");

  if (allInstances) {
    allInstances.forEach((e) => {
      instancesMenu.push({
        label: e,
        type: "checkbox",
        checked: currentInstance() === e,
        click: async () => {
          currentInstance(e);
          await mainWindow.loadURL(e);
          mainWindow.show();
        },
      });
    });

    instancesMenu.push(
      {
        type: "separator",
      },
      {
        label: "Add another Instance...",
        click: async () => {
          config.delete("currentInstance");
          await mainWindow.loadURL(indexFile);
          mainWindow.show();
        },
      },
      {
        label: "Automatic Switching",
        type: "checkbox",
        enabled: config.has("allInstances") && config.get("allInstances").length > 1,
        checked: config.get("automaticSwitching"),
        click: () => {
          config.set("automaticSwitching", !config.get("automaticSwitching"));
        },
      }
    );
  } else {
    instancesMenu.push({ label: "Not Connected...", enabled: false });
  }

  return Menu.buildFromTemplate([
    {
      label: "Show/Hide Window",
      visible: process.platform === "linux",
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          showWindow();
        }
      },
    },
    {
      visible: process.platform === "linux",
      type: "separator",
    },
    ...instancesMenu,
    {
      type: "separator",
    },
    {
      label: "Hover to Show",
      visible: process.platform !== "linux" && !config.get("detachedMode"),
      enabled: !config.get("detachedMode"),
      type: "checkbox",
      checked: !config.get("disableHover"),
      click: () => {
        config.set("disableHover", !config.get("disableHover"));
      },
    },
    {
      label: "Stay on Top",
      type: "checkbox",
      checked: config.get("stayOnTop"),
      click: () => {
        config.set("stayOnTop", !config.get("stayOnTop"));
        mainWindow.setAlwaysOnTop(config.get("stayOnTop"));

        if (mainWindow.isAlwaysOnTop()) {
          showWindow();
        }
      },
    },
    {
      label: "Start at Login",
      type: "checkbox",
      checked: autostartEnabled,
      click: () => {
        if (autostartEnabled) {
          autoLauncher.disable();
        } else {
          autoLauncher.enable();
        }

        checkAutoStart();
      },
    },
    {
      label: "Shortcuts",
      submenu: [
        {
          label: "Select Shortcut",
          submenu: [
            {
              label: "CommandOrControl+Alt+X",
              type: "radio",
              checked: config.get("userShortcut") === "CommandOrControl+Alt+X",
              click: () => {
                config.set("userShortcut", "CommandOrControl+Alt+X");
                unregisterKeyboardShortcut();
                registerKeyboardShortcut();
              },
            },
            {
              label: "CommandOrControl+Alt+Y",
              type: "radio",
              checked: config.get("userShortcut") === "CommandOrControl+Alt+Y",
              click: () => {
                config.set("userShortcut", "CommandOrControl+Alt+Y");
                unregisterKeyboardShortcut();
                registerKeyboardShortcut();
              },
            },
            {
              label: "CommandOrControl+Alt+Z",
              type: "radio",
              checked: config.get("userShortcut") === "CommandOrControl+Alt+Z",
              click: () => {
                config.set("userShortcut", "CommandOrControl+Alt+Z");
                unregisterKeyboardShortcut();
                registerKeyboardShortcut();
              },
            }
          ]
        },
        {
          label: "Enable Shortcut",
          type: "checkbox",
          accelerator: config.get("userShortcut"),
          checked: config.get("shortcutEnabled"),
          click: () => {
            const isEnabled = config.get("shortcutEnabled");
            config.set("shortcutEnabled", !isEnabled);

            if (!isEnabled) {
              registerKeyboardShortcut();
            } else {
              unregisterKeyboardShortcut();
            }
          },
        }
      ]
    },
    {
      label: "Appearance",
      submenu: [
        {
          label: "Tray Icon",
          submenu: [
            {
              label: "White",
              type: "radio",
              checked: config.get("userTrayIcon") === (process.platform === 'darwin' ? "IconTemplate.png" : "IconWin.png"),
              click: () => {
                if (process.platform === 'darwin') {
                  changeIcon("IconTemplate.png");
                } else {
                  changeIcon("IconWin.png");
                }
              }
            },
            {
              label: "Blue",
              type: "radio",
              checked: config.get("userTrayIcon") === "IconWinAlt.png",
              click: () => changeIcon("IconWinAlt.png"),
            },
            {
              label: "Black",
              type: "radio",
              checked: config.get("userTrayIcon") === "IconWinBlack.png",
              click: () => changeIcon("IconWinBlack.png"),
            },
          ]
        },
        {
          label: "Scaling",
          submenu: [
            {
              label: "Enable high DPI",
              type: "radio",
              checked: config.get("highDPIMode"),
              click: () => {
                config.set("highDPIMode", !config.get("highDPIMode"));
                app.relaunch();
                app.exit();
              }
            },
            {
              label: "Force scaling factor",
              type: "radio",
              checked: config.get("forceScaling"),
              click: () => {
                config.set("forceScaling", !config.get("forceScaling"));
                app.relaunch();
                app.exit();
              }
            }
          ]
        }
      ]
    },
    {
      type: "separator",
    },
    {
      label: "Use detached Window",
      type: "checkbox",
      checked: config.get("detachedMode"),
      click: async () => {
        config.set("detachedMode", !config.get("detachedMode"));
        mainWindow.hide();
        await createMainWindow(config.get("detachedMode"));
      },
    },
    {
      label: "Use Fullscreen",
      type: "checkbox",
      checked: config.get("fullScreen"),
      click: () => {
        toggleFullScreen();
      },
    },
    {
      label: "Enable Fullscreen Shortcut",
      type: "checkbox",
      accelerator: "CommandOrControl+Alt+Return",
      checked: config.get("shortcutFullscreenEnabled"),
      click: () => {
        const isEnabled = config.get("shortcutFullscreenEnabled");
        config.set("shortcutFullscreenEnabled", !isEnabled);
        if (!isEnabled) {
          globalShortcut.register("CommandOrControl+Alt+Return", () => {
            toggleFullScreen();
          });
        } else {
          globalShortcut.unregister("CommandOrControl+Alt+Return");
        }
      },
    },
    {
      type: "separator",
    },
    {
      label: `v${app.getVersion()}`,
      enabled: false,
    },
    {
      label: "Check for Updates",
      click: async () => {
        checkForUpdates();
      },
    },
    {
      label: "Enable Update Check on Startup",
      type: "checkbox",
      checked: config.get("autoUpdate"),
      click: async () => {
        config.set("autoUpdate", !config.get("autoUpdate"));
      },
    },
    {
      label: "Enable Automatic Reconnect",
      type: "checkbox",
      checked: config.get("autoReconnect"),
      click: async () => {
        config.set("autoReconnect", !config.get("autoReconnect"));
      },
    },
    {
      label: "Open on github.com",
      click: async () => {
        await shell.openExternal("https://github.com/DustyArmstrong/homeassistant-desktop");
      },
    },
    {
      type: "separator",
    },
    {
      label: "Restart Application",
      click: () => {
        app.relaunch();
        app.exit();
      },
    },
    {
      label: "⚠️ Reset Application",
      click: () => {
        dialog
          .showMessageBox({
            message: "Are you sure you want to reset Home Assistant Desktop?",
            buttons: ["Reset Everything!", "Reset Windows", "Cancel"],
          })
          .then(async (res) => {
            if (res.response !== 2) {
              if (res.response === 0) {
                config.clear();
                await mainWindow.webContents.session.clearCache();
                await mainWindow.webContents.session.clearStorageData();
              } else {
                config.delete("windowSizeDetached");
                config.delete("windowSize");
                config.delete("windowPosition");
                config.delete("fullScreen");
                config.delete("detachedMode");
              }

              app.relaunch();
              app.exit();
            }
          });
      },
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => {
        forceQuit = true;
        app.quit();
      },
    },
  ]);
}

async function createMainWindow(show = false) {
  logger.info("Loading main window...");
  mainWindow = new BrowserWindow({
    width: 420,
    height: 460,
    minWidth: 420,
    minHeight: 460,
    show: false,
    skipTaskbar: !show,
    autoHideMenuBar: true,
    frame: config.get("detachedMode") && process.platform !== "darwin",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'web', 'preload.cjs'),
    },
  });

  //mainWindow.webContents.openDevTools();

  const tryLoadURL = async (attempt = 1, maxAttempts = 5) => {
    try {
      logger.info('Loading index...', attempt);
      await mainWindow.loadURL(indexFile);
      logger.info("Initialized main window");
      return true;
    } catch (error) {
      logger.error(`MAINWIN - (${attempt}):`, error);
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        return tryLoadURL(attempt + 1, maxAttempts);
      }
      try {
        logger.error('MAINWIN - Unable to load window, cannot resolve network');
        showError(true);
      } catch (error) {
        logger.error('MAINWIN - ', error);
      }
      return false;
    }
  };
  await tryLoadURL();

  createTray();

  mainWindow.webContents.on('did-fail-load', async (e, errorCode, validatedURL) => {
    logger.error(`WEBCONT - ${validatedURL} (code ${errorCode})`);
    if (winIsReloading) {
      logger.info("Window is currently reloading...");
      return;
    }
    winIsReloading = true;
    try {
      await tryLoadURL(1);
    } catch (error) {
      logger.error("WEBCONT - ", error);
      showError(true);
    } finally {
      winIsReloading = false;
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, detailed) => {
    logger.error("RENDR - " + detailed.reason);
    const RELOAD_REASONS = new Set(['crashed', 'abnormal-exit', 'oom', 'launch-failed']);
    if (RELOAD_REASONS.has(detailed.reason)) {
        try {
          mainWindow.webContents.reload();
          logger.info("Renderer rebooted successfully.");
        } catch (error) {
          logger.error('RENDR - ', error);
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
    if (!forceQuit) {
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
}

async function reinitMainWindow() {
  logger.info("Re-initialized main window");
  mainWindow.destroy();
  mainWindow = null;
  await createMainWindow(!config.has("currentInstance"));

  if (!availabilityCheckerInterval) {
    logger.info("Re-initialized availability check");
    availabilityCheckerInterval = setInterval(availabilityCheck, 3000);
  }
}

function showWindow() {
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

function createTray() {
  if (tray instanceof Tray) {
    return;
  }

  logger.info("Initialized Tray menu");
  const iconName = config.get("userTrayIcon");
  tray = new Tray(
    ["win32", "linux"].includes(process.platform) ? `${__dirname}/assets/${iconName}` : `${__dirname}/assets/${iconName}`
  );

  tray.on("click", () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();

      if (process.platform === "darwin") {
        app.dock.hide();
      }
    } else {
      showWindow();
    }
  });

  tray.on("right-click", () => {
    if (!config.get("detachedMode")) {
      mainWindow.hide();
    }

    tray.popUpContextMenu(getMenu());
  });

  let timer = undefined;

  tray.on("mouse-move", () => {
    if (config.get("detachedMode") || mainWindow.isAlwaysOnTop() || config.get("disableHover")) {
      return;
    }

    if (!mainWindow.isVisible()) {
      showWindow();
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      const mousePos = screen.getCursorScreenPoint();
      const trayBounds = tray.getBounds();

      if (
        !(mousePos.x >= trayBounds.x && mousePos.x <= trayBounds.x + trayBounds.width) ||
        !(mousePos.y >= trayBounds.y && mousePos.y <= trayBounds.y + trayBounds.height)
      ) {
        setWindowFocusTimer();
      }
    }, 100);
  });
}

function changeIcon(iconName) {
  config.set("userTrayIcon", iconName);
  tray.setImage(
    ["win32", "linux"].includes(process.platform) ? `${__dirname}/assets/${iconName}` : `${__dirname}/assets/${iconName}`
  );
  logger.info(`Changed tray icon to ${iconName}`);
}

function setWindowFocusTimer() {
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

function toggleFullScreen(mode = !mainWindow.isFullScreen()) {
  config.set("fullScreen", mode);
  mainWindow.setFullScreen(mode);

  if (mode) {
    mainWindow.setAlwaysOnTop(true);
  } else {
    mainWindow.setAlwaysOnTop(config.get("stayOnTop"));
  }
}

function currentInstance(url = null) {
  if (url) {
    config.set("currentInstance", config.get("allInstances").indexOf(url));
  }

  if (config.has("currentInstance")) {
    return config.get("allInstances")[config.get("currentInstance")];
  }

  return false;
}

function addInstance(url) {
  if (!config.has("allInstances")) {
    config.set("allInstances", []);
  }

  const instances = config.get("allInstances");

  if (instances.find((e) => e === url)) {
    currentInstance(url);

    return;
  }

  if (!instances.length) {
    config.set("disableHover", false);
  }

  instances.push(url);
  config.set("allInstances", instances);
  currentInstance(url);
}

async function showError(isError) {
  if (!isError && mainWindow.webContents.getURL().includes("error.html")) {
    await mainWindow.loadURL(indexFile);
  }

  if (isError && currentInstance() && !mainWindow.webContents.getURL().includes("error.html")) {
    await mainWindow.loadURL(errorFile);
  }
}

async function showSleep(isSleeping) {
  if (!isSleeping && mainWindow.webContents.getURL().includes("sleeping.html")) {
    mainWindow.loadURL(indexFile);
  }

  if (isSleeping && currentInstance() && !mainWindow.webContents.getURL().includes("sleeping.html")) {
    mainWindow.loadURL(sleepFile);
  }
}

powerMonitor.on('suspend', () => {
  if (!sleepHandled) {
    logger.info("Home Assistant going to sleep.");
    showSleep(true);
    clearInterval(availabilityCheckerInterval);
    availabilityCheckerInterval = null;
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
  clearInterval(availabilityCheckerInterval);
  availabilityCheckerInterval = null;
  app.quit();
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

  app.whenReady().then(async () => {
    checkAutoStart();
    sleepHandled = false;
    resumeHandled = false;

    await createMainWindow(!config.has("currentInstance"));

    if (config.get("autoUpdate") === true) {
      checkForUpdates();
    }

    if (process.platform === "linux") {
      tray.setContextMenu(getMenu());
    }

    if (!availabilityCheckerInterval) {
      logger.info("Initialized availability check");
      availabilityCheckerInterval = setInterval(availabilityCheck, 3000);
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

ipcMain.on("get-instances", async (event) => {
  const instances = await getBonjourResult(config.get("allInstances") || []);
  event.reply("receive-instances", instances);
});

ipcMain.on("get-ha-instance", (event, url) => {
  if (url) {
    addInstance(url);
  }

  if (currentInstance()) {
    event.reply("receive-ha-instance", currentInstance());
  }
});

ipcMain.on("reconnect", async () => {
  await reinitMainWindow();
});

ipcMain.on("restart", () => {
  app.relaunch();
  app.exit();
});
