/**
 * Telegram — setGroupImage
 *
 * setChatPhoto requires a multipart/form-data upload — the Bot API does NOT
 * accept remote URL strings the way sendPhoto does server-side. For URL inputs,
 * axios downloads to a Buffer first, then a grammY InputFile uploads it cleanly.
 * A raw ClientRequest (Writable) cannot be wrapped by InputFile — it only accepts
 * Buffer-like or Readable-stream sources — making the axios download path mandatory
 * for URLs.
 *
 * ctx.setChatPhoto() reads chat.id internally via grammY's context shortcut,
 * eliminating the chat?.id optional-chain risk.
 */
import type { Readable } from 'stream';
import type { Context } from 'grammy';
import { InputFile } from 'grammy';
import axios from 'axios';

export async function setGroupImage(
  ctx: Context,
  _threadID: string,
  imageSource: Buffer | Readable | string,
): Promise<void> {
  let photo: InputFile;

  if (typeof imageSource === 'string') {
    // setChatPhoto rejects remote URLs — download via axios then upload as Buffer
    const res = await axios.get<ArrayBuffer>(imageSource, {
      responseType: 'arraybuffer',
      timeout: 15_000,
    });
    photo = new InputFile(Buffer.from(res.data), 'photo.jpg');
  } else {
    // Covers both Buffer and Readable stream sources — InputFile accepts either directly
    photo = new InputFile(imageSource, 'photo.jpg');
  }

  await ctx.setChatPhoto(photo);
}
