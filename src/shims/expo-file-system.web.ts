/**
 * Web-only stand-in for the object-based `expo-file-system` API (`File`,
 * `Directory`, `Paths`).
 *
 * The real module has no web implementation and its constructors throw
 * (`this.validatePath is not a function`). FileScanner and the metadata
 * providers build `Directory`/`File` instances at module scope, so merely
 * importing them crashes the web bundle at startup.
 *
 * `metro.config.js` aliases `expo-file-system` to this file on the web
 * platform only; native builds never see it. It exists so the UI can be
 * booted headlessly (e.g. Playwright smoke tests). Nothing is persisted:
 * everything reports "does not exist" and reads come back empty.
 */

const WEB_DOCUMENT_URI = 'file:///web-shim/document/';
const WEB_CACHE_URI = 'file:///web-shim/cache/';

const joinUri = (parts: unknown[]): string =>
  parts
    .map((p) => (typeof p === 'string' ? p : ((p as { uri?: string })?.uri ?? '')))
    .filter(Boolean)
    .join('/')
    .replace(/([^:])\/{2,}/g, '$1/');

class WebFsEntry {
  readonly uri: string;
  readonly exists = false;
  readonly size = 0;

  constructor(...uris: unknown[]) {
    this.uri = joinUri(uris);
  }

  get name(): string {
    return this.uri.split('/').filter(Boolean).pop() ?? '';
  }

  create(): void {}
  delete(): void {}
  copy(): void {}
  move(): void {}
}

export class File extends WebFsEntry {
  get extension(): string {
    const dot = this.name.lastIndexOf('.');
    return dot >= 0 ? this.name.slice(dot) : '';
  }
  text(): Promise<string> {
    return Promise.resolve('');
  }
  textSync(): string {
    return '';
  }
  write(): void {}
}

export class Directory extends WebFsEntry {
  list(): (File | Directory)[] {
    return [];
  }
}

export const Paths = {
  document: new Directory(WEB_DOCUMENT_URI),
  cache: new Directory(WEB_CACHE_URI),
};
