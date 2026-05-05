import * as LegacyFileSystem from 'expo-file-system/legacy';
const getBaseLogDirectory = () => {
    const fromLegacy = LegacyFileSystem.documentDirectory ?? '';
    return fromLegacy.endsWith('/') ? fromLegacy : `${fromLegacy}/`;
};
const LOG_FILE_PATH = `${getBaseLogDirectory()}smb_debug.log`;
/** Maximum number of log lines kept in memory. */
const MAX_MEMORY_LINES = 600;
/** Rotate (truncate) the on-disk log once it exceeds this size (bytes). */
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
/**
 * Lightweight file-and-memory logger intended for debugging standalone EAS
 * builds where the Metro dev-tools console is unavailable.
 *
 * Usage:
 *   import { logger } from '@/scripts/Logger';
 *   logger.log('MyTag', 'Something happened');
 *   logger.warn('MyTag', 'Unexpected state', value);
 *   logger.error('MyTag', 'Caught error', err);
 *
 * Log file location (Android):
 *   <app-document-dir>/smb_debug.log
 *   Accessible via:  adb shell run-as <package> cat <path>
 *   Or share via the in-app Logs screen (Drawer → Logs).
 */
class Logger {
    static _instance = null;
    _lines = [];
    _diagnostics = {
        path: LOG_FILE_PATH,
        fileExists: false,
        fileSizeBytes: 0,
        hydratedLineCount: 0,
        hadPreviousLogFile: false,
        lastHydrateError: null,
    };
    /** Serialise file writes to avoid concurrent access. */
    _writeQueue = Promise.resolve();
    constructor() {
        // Load persisted logs into memory first so the Logs screen can show previous runs.
        this._writeQueue = this._writeQueue.then(() => this._hydrateFromDisk());
        this._appendToFile(`\n${'='.repeat(60)}\nLogger initialised at ${this._timestamp()}\nLog file: ${LOG_FILE_PATH}\n${'='.repeat(60)}`);
    }
    static getInstance() {
        if (!Logger._instance) {
            Logger._instance = new Logger();
        }
        return Logger._instance;
    }
    // ── Public API ────────────────────────────────────────────────────────────
    log(tag, message, ...extra) {
        this._record('LOG', tag, message, extra);
    }
    warn(tag, message, ...extra) {
        this._record('WARN', tag, message, extra);
    }
    error(tag, message, ...extra) {
        const msg = message instanceof Error
            ? `${message.message}\n  Stack: ${message.stack ?? '(no stack)'}`
            : message;
        this._record('ERROR', tag, msg, extra);
    }
    /** Returns all in-memory log lines as a single string, newest last. */
    getLogs() {
        return this._lines.join('\n');
    }
    /** Returns the in-memory lines array (newest last). */
    getLines() {
        return this._lines;
    }
    /** Path to the persisted log file on disk. */
    getLogFilePath() {
        return LOG_FILE_PATH;
    }
    /** Returns logger file/hydration diagnostics for debugging persistence issues. */
    getDiagnostics() {
        return { ...this._diagnostics };
    }
    /** Clears both the in-memory buffer and the on-disk log file. */
    async clearLogs() {
        this._lines = [];
        this._writeQueue = this._writeQueue.then(async () => {
            try {
                await this._fsWrite('', false);
            }
            catch {
                // Ignore errors during clear
            }
        });
        await this._writeQueue;
    }
    // ── Private helpers ───────────────────────────────────────────────────────
    _timestamp() {
        const d = new Date();
        const pad = (n, w = 2) => String(n).padStart(w, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
            `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    }
    _formatExtra(extra) {
        if (!extra.length)
            return '';
        return ' ' + extra.map((v) => {
            if (v instanceof Error)
                return `[Error: ${v.message}]`;
            try {
                return JSON.stringify(v);
            }
            catch {
                return String(v);
            }
        }).join(' ');
    }
    async _fsGetInfo() {
        const info = await LegacyFileSystem.getInfoAsync(LOG_FILE_PATH);
        const infoAny = info;
        const size = typeof infoAny?.size === 'number' ? infoAny.size : 0;
        return {
            exists: Boolean(infoAny?.exists),
            size,
        };
    }
    async _fsRead() {
        return LegacyFileSystem.readAsStringAsync(LOG_FILE_PATH);
    }
    async _fsWrite(content, append = false) {
        await LegacyFileSystem.writeAsStringAsync(LOG_FILE_PATH, content, append ? { append: true } : undefined);
    }
    async _hydrateFromDisk() {
        try {
            const info = await this._fsGetInfo();
            this._diagnostics.fileExists = info.exists;
            this._diagnostics.fileSizeBytes = info.size;
            this._diagnostics.hadPreviousLogFile = info.exists && info.size > 0;
            if (!info.exists) {
                await this._fsWrite('', false);
                this._diagnostics.fileExists = true;
                this._diagnostics.fileSizeBytes = 0;
                this._lines = [];
                this._diagnostics.hydratedLineCount = 0;
                return;
            }
            const existing = await this._fsRead();
            const persistedLines = existing
                .split(/\r?\n/)
                .filter((line) => line.trim() !== '');
            this._lines = persistedLines.slice(-MAX_MEMORY_LINES);
            this._diagnostics.hydratedLineCount = this._lines.length;
            this._diagnostics.lastHydrateError = null;
        }
        catch (e) {
            const message = e instanceof Error ? `${e.message}` : String(e);
            this._diagnostics.lastHydrateError = message;
            console.warn('[Logger] Failed to hydrate log file', e);
        }
    }
    _record(level, tag, message, extra) {
        const line = `[${this._timestamp()}] [${level.padEnd(5)}] [${tag}] ${message}${this._formatExtra(extra)}`;
        // Mirror to the native console so Metro/Logcat still shows output in dev builds.
        if (level === 'ERROR')
            console.error(line);
        else if (level === 'WARN')
            console.warn(line);
        else
            console.log(line);
        // In-memory buffer with rotation.
        this._lines.push(line);
        if (this._lines.length > MAX_MEMORY_LINES) {
            this._lines.splice(0, this._lines.length - MAX_MEMORY_LINES);
        }
        this._appendToFile(line);
    }
    _appendToFile(content) {
        this._writeQueue = this._writeQueue.then(async () => {
            try {
                // Check file size and rotate if too large.
                try {
                    const info = await this._fsGetInfo();
                    if (info.exists && info.size > MAX_FILE_BYTES) {
                        // Keep the second half of the file to preserve recent logs.
                        const existing = await this._fsRead();
                        const halfway = Math.floor(existing.length / 2);
                        const trimmed = `[...log rotated...]\n${existing.slice(halfway)}`;
                        await this._fsWrite(trimmed, false);
                    }
                }
                catch {
                    // Rotation failure is non-fatal.
                }
                const appendLine = content + '\n';
                await this._fsWrite(appendLine, true);
            }
            catch {
                // File write failure must never crash the app.
            }
        });
    }
}
export const logger = Logger.getInstance();
