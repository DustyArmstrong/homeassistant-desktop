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