// Only the bundled print URL in the main app webContents may open a child.
// Studio uses no-referrer, so Electron cannot identify its initiating frame here.
function isPrintPreviewRequest(details, origin, studioURLs) {
  return details.url === origin + '/studio/print.html'
    && details.frameName === ''
    && !details.features && !details.postBody
    && details.disposition === 'foreground-tab'
    && studioURLs.length > 0
    && (studioURLs.includes(details.referrer?.url)
      || (details.referrer?.url === '' && details.referrer.policy === 'no-referrer'));
}

function installPrintPreview(win, origin, BrowserWindow) {
  let preview;
  win.webContents.setWindowOpenHandler(details => {
    const studioURLs = win.webContents.mainFrame.frames
      .map(frame => frame.url)
      .filter(url => {
        try { const u = new URL(url); return u.origin === origin && u.pathname === '/studio/'; }
        catch { return false; }
      });
    if (win.isDestroyed() || !isPrintPreviewRequest(details, origin, studioURLs)) return {action:'deny'};
    return {
      action:'allow', outlivesOpener:false,
      createWindow(options) {
        if (preview && !preview.isDestroyed()) preview.close();
        const child = new BrowserWindow({
          ...options, parent:win, title:'인쇄 미리보기', width:1000, height:800,
          minWidth:640, minHeight:480, show:false, modal:false, frame:true,
          transparent:false, alwaysOnTop:false, fullscreen:false, kiosk:false,
          focusable:true, closable:true, resizable:true,
          // Retain Chromium's supplied webContents, but no host IPC preload.
          webPreferences:{session:win.webContents.session, contextIsolation:true,
            nodeIntegration:false, nodeIntegrationInSubFrames:false, sandbox:true,
            webSecurity:true, allowRunningInsecureContent:false},
        });
        preview = child;
        child.setMenu(null);
        child.webContents.setWindowOpenHandler(() => ({action:'deny'}));
        const fence = (event, url) => {
          if ((url || event.url) !== origin + '/studio/print.html') event.preventDefault();
        };
        for (const event of ['will-navigate','will-frame-navigate','will-redirect']) child.webContents.on(event,fence);
        child.once('ready-to-show', () => { if (!child.isDestroyed()) child.show(); });
        child.once('closed', () => { if (preview === child) preview = undefined; });
        return child.webContents;
      },
    };
  });
  win.once('closed', () => { if (preview && !preview.isDestroyed()) preview.close(); });
}
module.exports = {isPrintPreviewRequest, installPrintPreview};
