// Route document shortcuts before the embedded editor's browser file picker.
function installDocumentShortcuts(webContents, dispatch, platform = process.platform) {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isComposing || input.isAutoRepeat || input.alt) return;
    const primary = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
    if (!primary) return;
    const key = String(input.key || '').toLowerCase();
    const action = key === 'o' && !input.shift ? 'open' : key === 's' ? 'save' : null;
    if (!action) return;
    event.preventDefault();
    dispatch(action);
  });
}
module.exports = { installDocumentShortcuts };
