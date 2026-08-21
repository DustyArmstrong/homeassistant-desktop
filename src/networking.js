import { app, dialog, shell, net } from "electron";
import semver from "semver";
import WebSocket from 'ws';
import logger from "electron-log";
import config  from "../config.js";
import { currentInstance, checkForAvailableInstance } from './instance.js';
import { getMainWindow, reinitMainWindow } from "./window.js";
import { showError } from "./display.js";

let retryingAvailability = false;
let wsConnection = null;
const WS_MAX_RETRIES = 5;
const WS_RETRY_DELAY = 4000;

export async function checkForUpdates() {
  try {
    const apiResponse = await net.fetch("https://api.github.com/repos/DustyArmstrong/homeassistant-desktop/releases/latest");
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
      logger.error(`UPDT - ${error}`);
    }
  }

export async function getResponse(instance, timeoutMs = 8000) {
  const url = new URL(instance);
  const target = `${url.origin}/auth/providers`;

  try {
    const res = await Promise.race([
      net.fetch(target),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), timeoutMs))
    ]);
    return res.status;
  } catch (error) {
    throw {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      url: target
    };
  }
}

export function isWebSocketOpen() {
  return wsConnection !== null && wsConnection.readyState === wsConnection.OPEN;
}

export function closeWebSocket() {
  if (isWebSocketOpen()) {
    wsConnection.close();
    wsConnection = null;
    logger.info('Websocket closed by request');
  }
}

export async function initWebSocketHealth(instance) {
  const url = new URL(instance);
  const wsUrl = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}/api/websocket`;

  //let auth;
  try {
    //auth = await getHomeAssistantAuth(instance);
  } catch (error) {
    logger.error(`Failed to retrieve Home Assistant auth tokens: ${error}`);
    throw error;
  }

  return new Promise((resolve, reject) => {
    try {
      wsConnection = new WebSocket(wsUrl);
      let authTimeout;

      wsConnection.onopen = () => {
        logger.info('Websocket connection established.');
        
        wsConnection.send(JSON.stringify({
          type: 'auth',
          access_token: 'placeholder for testing'
        }));

        authTimeout = setTimeout(() => {
          logger.error('Websocket auth timed out!');
          reject(new Error('Websocket auth timed out!'));
        }, 5000);
      };

      wsConnection.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'auth_ok') {
          clearTimeout(authTimeout);
          logger.info('Websocket authentication successful!');

          wsConnection.send(JSON.stringify({
            id: 1,
            type: 'subscribe_events',
            event_type: 'state_changed'
          }));

          resolve(true);
        }

        if (msg.type === 'auth_invalid') {
          clearTimeout(authTimeout);
          logger.error('Websocket authentication failed!');
          reject(new Error('Websocket authentication failed!'));
        }

        if (msg.type === 'event' && msg.event?.data?.entity_id === 'homeassistant.home_assistant') {
          //handleRebootDetection(msg.event.data.new_state);
          logger.info(msg);
        }
      };

      wsConnection.onerror = (error) => {
        clearTimeout(authTimeout);
        logger.error(`WebSocket error: ${error}`);
        reject(error);
      };

      wsConnection.onclose = () => {
        logger.info('Websocket connection closed.');
        handleWebSocketDisconnect();
      };
    } catch (error) {
      logger.error(`WebSocket error: ${error}`);
      reject(error);
    }
  });
}

function handleWebSocketDisconnect() {
  logger.warn('Websocket keepalive lost, attempting to re-connect...');
  wsConnection = null;

  handleUnavailable('Websocket closed unexpectedly');
}

export function handleUnavailable(reason) {
  logger.error(`INSTAV - ${reason}`);
  if (retryingAvailability) {
    return;
  }

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
    const mainWindow = getMainWindow();

    while (retryCount <= WS_MAX_RETRIES) {
      try {
        if (wsConnection) {
          wsConnection.close();
          wsConnection = null;
        }

        await initWebSocketHealth(instance);
        logger.info('Connection re-established!');
        mainWindow.webContents.send('retry-success', "Instance alive, reconnecting...");
        await reinitMainWindow();
        break;
      } catch (error) {
        logger.error(`WebSocket retry ${retryCount}/${WS_MAX_RETRIES} failed: ${error.message}`);

        if (retryCount === WS_MAX_RETRIES) {
          logger.error("RETRY - Cannot automatically connect to instance.");
          mainWindow.webContents.send('retry-update', "Unable to connect to instance!");
        } else {
          mainWindow.webContents.send('retry-update', `Trying to reconnect ${retryCount} of ${WS_MAX_RETRIES}`);
          await new Promise(retry => setTimeout(retry, WS_RETRY_DELAY));
        }
        retryCount++;
      }
    }
  } finally {
    retryingAvailability = false;
  }
}