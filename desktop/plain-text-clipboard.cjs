// Read only text, through the same trusted top-level host used by file actions.
// A synchronous reply keeps the user's cursor/selection in the initiating task.
function installPlainTextClipboard(ipcMain, clipboard, trusted) {
  ipcMain.on('baram:clipboard-text', event => {
    try { event.returnValue = trusted(event) ? clipboard.readText() : null; }
    catch { event.returnValue = null; }
  });
}
module.exports = {installPlainTextClipboard};
