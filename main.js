const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { execFileSync } = require('child_process');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        webPreferences: {
            // このアプリはネット上の任意のコンテンツを読み込むわけではなく、
            // 自分で作った index.html を読み込むだけなので nodeIntegration を有効にしている。
            // 外部URLを読み込むアプリに転用する場合は contextIsolation:true + preload に変更すること。
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    Menu.setApplicationMenu(null); // 独自のメニューバー（ファイル/表示/挿入/操作）と重複するため、既定のOSメニューは非表示にする
    mainWindow.loadFile('index.html');

    // 開発中に開きたい場合はコメントを外す
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

/* ================= alert ================= */
ipcMain.on('sync-alert', (event, message) => {
    dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        buttons: ['OK'],
        title: 'メモ帳',
        message: String(message)
    });
    event.returnValue = true;
});

/* ================= confirm ================= */
ipcMain.on('sync-confirm', (event, message) => {
    const result = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['OK', 'キャンセル'],
        defaultId: 0,
        cancelId: 1,
        title: 'メモ帳',
        message: String(message)
    });
    event.returnValue = (result === 0);
});

/* ================= prompt =================
   Electronにはブラウザのprompt()に相当するネイティブAPIが無いため、
   OSごとの標準入力ダイアログをコマンドで同期的に呼び出す。
   execFileSyncはOSの別プロセスの終了を待つだけなので、
   Electron自体のイベントループをブロックしても問題は起きない（ここが重要）。 */
ipcMain.on('sync-prompt', (event, { message, defaultValue }) => {
    const msg = String(message || '');
    const def = String(defaultValue || '');
    let result = null;

    try {
        if (process.platform === 'darwin') {
            // macOS: AppleScript の display dialog を利用
            const script =
                `display dialog ${JSON.stringify(msg)} default answer ${JSON.stringify(def)} with title "メモ帳"`;
            const out = execFileSync('osascript', ['-e', script], { encoding: 'utf8' });
            const m = out.match(/text returned:(.*)$/s);
            result = m ? m[1].trim() : null;

        } else if (process.platform === 'win32') {
            // Windows: PowerShell + VisualBasic.Interaction.InputBox を利用
            const escMsg = msg.replace(/'/g, "''");
            const escDef = def.replace(/'/g, "''");
            const ps =
                `Add-Type -AssemblyName Microsoft.VisualBasic; ` +
                `[Console]::Out.Write([Microsoft.VisualBasic.Interaction]::InputBox('${escMsg}', 'メモ帳', '${escDef}'))`;
            const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
            result = out; // キャンセル時は空文字が返る
            if (result === '') result = null;

        } else {
            // Linux: zenity を優先し、無ければ kdialog を試す
            try {
                const out = execFileSync('zenity', [
                    '--entry', '--title=メモ帳', '--text', msg, '--entry-text', def
                ], { encoding: 'utf8' });
                result = out.trim();
            } catch (e1) {
                const out = execFileSync('kdialog', ['--inputbox', msg, def], { encoding: 'utf8' });
                result = out.trim();
            }
        }
    } catch (err) {
        // ユーザーがキャンセルした場合、コマンドが無い場合などはnullを返す（＝prompt()がキャンセルされた扱い）
        result = null;
    }

    event.returnValue = result;
});
