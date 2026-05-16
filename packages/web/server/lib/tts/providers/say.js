/**
 * macOS `say` command TTS provider adapter.
 *
 * Preserves existing behavior: platform-gated, generates M4A audio via the
 * `say` CLI, and returns it as audio/mp4.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);

/**
 * @param {object} req
 * @param {string} req.text
 * @param {string} [req.voice]
 * @param {number} [req.rate] Words per minute (default 200)
 * @returns {Promise<{audio: Buffer, contentType: string, provider: string, voice: string}>}
 */
export async function generateSay(req) {
  const { text, voice = 'Samantha', rate = 200 } = req;

  if (process.platform !== 'darwin') {
    throw new Error('macOS say command not available on this platform');
  }

  const tempFile = path.join(os.tmpdir(), `say-${Date.now()}.m4a`);
  const escapedText = text.trim().replace(/'/g, "'\\''").replace(/"/g, '\\"');
  const cmd = `say -v "${voice}" -r ${rate} -o "${tempFile}" --data-format=aac '${escapedText}'`;

  console.log('[TTS/say] voice:', voice, 'rate:', rate, 'textLength:', text.length);
  await execAsync(cmd);

  const audioBuffer = await fs.promises.readFile(tempFile);
  fs.promises.unlink(tempFile).catch(() => {});

  return {
    audio: audioBuffer,
    contentType: 'audio/mp4',
    provider: 'say',
    voice,
  };
}
