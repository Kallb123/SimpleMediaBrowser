import { Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
/** Android Intent flag that grants the receiving app read access to a content URI. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;
/** Maps known video file extensions to their MIME types. */
const MEDIA_MIME_TYPES = {
    '.mkv': 'video/x-matroska',
    '.mp4': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.ts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.webm': 'video/webm',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.3gp': 'video/3gpp',
    '.mp3': 'audio/mpeg',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
};
/**
 * Returns the MIME type for a given filename based on its extension,
 * or 'video/*' as a fallback for unrecognized extensions.
 */
function getMimeType(filename) {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex === -1)
        return 'video/*';
    const ext = filename.substring(dotIndex).toLowerCase();
    return MEDIA_MIME_TYPES[ext] ?? 'video/*';
}
/**
 * Opens a media file in an external player app.
 *
 * On Android, uses an ACTION_VIEW intent with FLAG_GRANT_READ_URI_PERMISSION
 * so the external player (VLC, MX Player, etc.) can read the content:// URI.
 * On iOS, falls back to Linking.openURL.
 *
 * @param contentUri - The SAF content:// URI (or file:// URI on iOS) of the media file.
 * @param filename   - The filename, used to derive the correct MIME type.
 */
export async function openMediaInExternalApp(contentUri, filename) {
    if (Platform.OS === 'android') {
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            type: getMimeType(filename),
            flags: FLAG_GRANT_READ_URI_PERMISSION,
        });
    }
    else {
        await Linking.openURL(contentUri);
    }
}
