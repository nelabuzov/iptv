const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

app.on('ready', () => {
	mainWindow = new BrowserWindow({
		icon: path.join(__dirname, '../images', 'logo.ico'),
		show: false,

		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true
		}
	});

	mainWindow.loadFile('index.html');

	mainWindow.setMenu(null);

	mainWindow.once('ready-to-show', () => {
		mainWindow.maximize();
		mainWindow.show();
	});

	mainWindow.on('closed', () => {
		mainWindow = null;
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
	if (mainWindow === null) createWindow();
});
