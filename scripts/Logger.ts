import * as FileSystem from 'expo-file-system';

const LOG_FILE_PATH = (FileSystem.documentDirectory ?? '') + 'smb_debug.log';
/** Maximum number of log lines kept in memory. */
const MAX_MEMORY_LINES = 600;
/** Rotate (truncate) the on-disk log once it exceeds this size (bytes). */
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

type LogLevel = 'LOG' | 'WARN' | 'ERROR';

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
    private static _instance: Logger | null = null;

    private _lines: string[] = [];
    /** Serialise file writes to avoid concurrent access. */
    private _writeQueue: Promise<void> = Promise.resolve();

    private constructor() {
        this._appendToFile(`\n${'='.repeat(60)}\nLogger initialised at ${this._timestamp()}\nLog file: ${LOG_FILE_PATH}\n${'='.repeat(60)}`);
    }

    static getInstance(): Logger {
        if (!Logger._instance) {
            Logger._instance = new Logger();
        }
        return Logger._instance;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    log(tag: string, message: string, ...extra: unknown[]): void {
        this._record('LOG', tag, message, extra);
    }

    warn(tag: string, message: string, ...extra: unknown[]): void {
        this._record('WARN', tag, message, extra);
    }

    error(tag: string, message: string | Error, ...extra: unknown[]): void {
        const msg = message instanceof Error
            ? `${message.message}\n  Stack: ${message.stack ?? '(no stack)'}`
            : message;
        this._record('ERROR', tag, msg, extra);
    }

    /** Returns all in-memory log lines as a single string, newest last. */
    getLogs(): string {
        return this._lines.join('\n');
    }

    /** Returns the in-memory lines array (newest last). */
    getLines(): readonly string[] {
        return this._lines;
    }

    /** Path to the persisted log file on disk. */
    getLogFilePath(): string {
        return LOG_FILE_PATH;
    }

    /** Clears both the in-memory buffer and the on-disk log file. */
    async clearLogs(): Promise<void> {
        this._lines = [];
        this._writeQueue = this._writeQueue.then(async () => {
            try {
                await FileSystem.writeAsStringAsync(LOG_FILE_PATH, '', { encoding: FileSystem.EncodingType.UTF8 });
            } catch {
                // Ignore errors during clear
            }
        });
        await this._writeQueue;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private _timestamp(): string {
        const d = new Date();
        const pad = (n: number, w = 2) => String(n).padStart(w, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
               `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    }

    private _formatExtra(extra: unknown[]): string {
        if (!extra.length) return '';
        return ' ' + extra.map((v) => {
            if (v instanceof Error) return `[Error: ${v.message}]`;
            try { return JSON.stringify(v); } catch { return String(v); }
        }).join(' ');
    }

    private _record(level: LogLevel, tag: string, message: string, extra: unknown[]): void {
        const line = `[${this._timestamp()}] [${level.padEnd(5)}] [${tag}] ${message}${this._formatExtra(extra)}`;

        // Mirror to the native console so Metro/Logcat still shows output in dev builds.
        if (level === 'ERROR') console.error(line);
        else if (level === 'WARN') console.warn(line);
        else console.log(line);

        // In-memory buffer with rotation.
        this._lines.push(line);
        if (this._lines.length > MAX_MEMORY_LINES) {
            this._lines.splice(0, this._lines.length - MAX_MEMORY_LINES);
        }

        this._appendToFile(line);
    }

    private _appendToFile(content: string): void {
        this._writeQueue = this._writeQueue.then(async () => {
            try {
                // Check file size and rotate if too large.
                try {
                    const info = await FileSystem.getInfoAsync(LOG_FILE_PATH);
                    if (info.exists && (info as any).size > MAX_FILE_BYTES) {
                        // Keep the second half of the file to preserve recent logs.
                        const existing = await FileSystem.readAsStringAsync(LOG_FILE_PATH, { encoding: FileSystem.EncodingType.UTF8 });
                        const halfway = Math.floor(existing.length / 2);
                        const trimmed = `[...log rotated...]\n${existing.slice(halfway)}`;
                        await FileSystem.writeAsStringAsync(LOG_FILE_PATH, trimmed, { encoding: FileSystem.EncodingType.UTF8 });
                    }
                } catch {
                    // Rotation failure is non-fatal.
                }

                await FileSystem.writeAsStringAsync(
                    LOG_FILE_PATH,
                    content + '\n',
                    { encoding: FileSystem.EncodingType.UTF8, append: true } as any,
                );
            } catch {
                // File write failure must never crash the app.
            }
        });
    }
}

export const logger = Logger.getInstance();
