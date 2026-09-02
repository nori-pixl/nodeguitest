const { app, BrowserWindow } = require('electron')
const path = require('node:path')

function createWindow () {
  // Chromiumのウィンドウを作成
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // 画面（JavaScript）側でNode.jsの機能を使えるようにする設定
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  // 表示するHTMLファイルを読み込む
  win.loadFile('index.html')
}

// アプリが起動したらウィンドウを表示
app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// ウィンドウがすべて閉じられたらアプリを終了（Mac以外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
