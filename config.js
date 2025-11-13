//const Store = require('electron-store');
import Store from 'electron-store';

const store = new Store({
  defaults: {
    autoUpdate: true,
    automaticSwitching: true,
    autoReconnect: true,
    detachedMode: false,
    disableHover: false,
    stayOnTop: false,
    fullScreen: false,
    shortcutEnabled: true,
    shortcutFullscreenEnabled: false,
    userShortcut: "CommandOrControl+Alt+X",
    userTrayIcon: "IconWin.png",
    allInstances: [],
  },
});

export default store;