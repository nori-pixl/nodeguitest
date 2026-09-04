const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
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
   Electron自体のイベントループをブロックしても問題は起きない（ここが重要）。

   文字化け対策: コマンドの標準出力(stdout)をそのまま文字列として受け取る方式は、
   OS・シェルごとの既定文字コード（Windowsのコンソールは既定でUTF-8ではないことが多い）
   に左右されて壊れやすいため、結果は必ず「UTF-8を明示したテキストファイル」に一度書き出し、
   Node側でそのファイルを 'utf8' で読み込む方式に統一している。 */
function psLiteral(str) {
    // PowerShellのシングルクォート文字列として安全な形にエスケープ
    return "'" + String(str).replace(/'/g, "''") + "'";
}

ipcMain.on('sync-prompt', (event, { message, defaultValue }) => {
    const msg = String(message || '');
    const def = String(defaultValue || '');
    let result = null;

    try {
        if (process.platform === 'darwin') {
            // macOS: AppleScript の display dialog を利用し、結果はUTF-8の一時ファイル経由で受け取る
            const tmpFile = path.join(os.tmpdir(), `memo_prompt_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
            const script =
                `set r to text returned of (display dialog ${JSON.stringify(msg)} default answer ${JSON.stringify(def)} with title "メモ帳")\n` +
                `set fh to open for access (POSIX file ${JSON.stringify(tmpFile)}) with write permission\n` +
                `write r to fh as «class utf8»\n` +
                `close access fh`;
            execFileSync('osascript', ['-e', script]);
            if (fs.existsSync(tmpFile)) {
                result = fs.readFileSync(tmpFile, 'utf8');
                fs.unlinkSync(tmpFile);
            }

        } else if (process.platform === 'win32') {
            // Windows: PowerShell + VisualBasic.Interaction.InputBox を利用。
            // スクリプト本体はUTF-16LE→Base64化した -EncodedCommand で渡すことで、
            // 日本語やシングルクォートを含む文字列でもコマンドライン解釈の問題を回避する。
            // 結果はコンソール経由ではなく、明示的にUTF-8で書いたファイルから読み取る。
            const tmpFile = path.join(os.tmpdir(), `memo_prompt_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
            const psScript = [
                'Add-Type -AssemblyName Microsoft.VisualBasic',
                `$result = [Microsoft.VisualBasic.Interaction]::InputBox(${psLiteral(msg)}, 'メモ帳', ${psLiteral(def)})`,
                `[System.IO.File]::WriteAllText(${psLiteral(tmpFile)}, $result, [System.Text.Encoding]::UTF8)`
            ].join('\r\n');
            const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
            execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
            if (fs.existsSync(tmpFile)) {
                result = fs.readFileSync(tmpFile, 'utf8');
                fs.unlinkSync(tmpFile);
                if (result === '') result = null; // キャンセル時はInputBoxが空文字を返す
            }

        } else {
            // Linux: zenity を優先し、無ければ kdialog を試す（GTK/Qtは通常UTF-8ロケールで動くためstdoutでも問題になりにくい）
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
