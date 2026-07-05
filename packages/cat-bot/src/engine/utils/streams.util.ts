/**
 * Stream utilities shared across unified commands and platform wrappers.
 * Centralised here so qr.js, say.js, and every platform wrapper avoid reimplementing
 * the same buffer/stream conversion logic.
 */

import type { Readable } from 'stream';
import { PassThrough } from 'stream';
// axios used by urlToStream to download attachment_url[] entries — avoids duplicating network logic in every wrapper
import axios from 'axios';

/**
 * PassThrough stream with the `.path` property that Telegram's Input.fromBuffer()
 * requires for MIME-type detection.
 * The extension in `path` determines the content-type sent to the platform API.
 */
export interface StreamWithPath extends PassThrough {
  path: string;
}

/**
 * Media category derived from a file extension.
 * Platform wrappers use this to select the correct send method for each entry
 * in attachment_url[] (e.g. sendPhoto vs sendVoice vs sendAnimation vs sendDocument).
 */
export type MediaType = 'photo' | 'gif' | 'video' | 'audio' | 'file';

/**
 * Collects all chunks from a Readable and resolves with a single Buffer.
 * Used by qr.js to convert qr-image's Readable into a Buffer for api.sendPhoto.
 */
export function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Converts a Buffer into a PassThrough stream with a `.path` property for
 * MIME-type detection. Attach the filename before returning.
 *
 * @param filename - e.g. "tts_123.mp3" or "qr_456.png"
 */
export function bufferToStream(
  buffer: Buffer,
  filename: string,
): StreamWithPath {
  const stream = new PassThrough() as StreamWithPath;
  stream.path = filename;
  stream.end(buffer);
  return stream;
}

/**
 * Derives a media category from a file path or URL by inspecting its extension.
 * Platform wrappers use this to select the correct send method for each entry in
 * attachment_url[] (e.g. sendPhoto vs sendVoice vs sendAnimation vs sendDocument).
 * The query-string segment is stripped so "image.png?v=1" still resolves to "photo".
 */
export function getMediaTypeFromPath(pathOrUrl = ''): MediaType {
  const ext = pathOrUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'avif', 'heic', 'heif', 'ico', 'tiff', 'tif'].includes(ext)) return 'photo';
  if (ext === 'gif') return 'gif';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', 'mpeg', 'mpg', '3gp', '3g2'].includes(ext)) return 'video';
  if ([
    'mp3', 'aac', 'ogg', 'oga', 'opus', 'weba', 'wma', 'amr', 'ra', 'rm', 'spx', 'mp2', 'ac3', 'eac3',
    'wav', 'flac', 'aiff', 'aif', 'alac', 'ape', 'au', 'dsd',
    'm4a', 'm4b', 'mka', 'mid', 'midi', 'caf', 'dts',
  ].includes(ext)) return 'audio';
  return 'file';
}

/**
 * Downloads a public static URL to a PassThrough stream whose .path matches the
 * original filename so downstream MIME-detection (Telegram Input.fromBuffer)
 * derives the correct content type from the extension.
 *
 * @param url      - Direct media URL (not an HTML embed page)
 * @param filename - Explicit filename override; when omitted the URL tail is used
 */
export async function urlToStream(
  url: string,
  filename?: string,
): Promise<Readable> {
  // Prefer caller-supplied filename so {name, url} attachment objects control the download filename
  const tail =
    filename ?? url.split('/').pop()?.split('?')[0] ?? `file_${Date.now()}.bin`;

  const response = await axios.get<Readable>(url, {
    responseType: 'stream',
    timeout: 15_000,
    // Several free third-party API providers reject requests that don't look
    // like they came from a browser (basic bot-protection / Cloudflare rules)
    // and reply with 403 even though the same URL loads fine in a browser.
    // A standard desktop User-Agent + Accept header is enough to pass that
    // check without impersonating anything beyond "a normal HTTP client".
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'image/*,video/*,audio/*,*/*;q=0.8',
    },
  });

  // Set the path property on the response stream for MIME type detection by platform wrappers
  (response.data as unknown as { path: string }).path = tail;

  return response.data;
}
