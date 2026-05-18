import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export function createSayTtsProvider({
  processLike,
}) {
  return {
    id: 'say',
    label: 'macOS Say',
    kind: 'server',
    requiresApiKey: false,
    supportsVoices: true,
    supportsTimestamps: false,
    defaultVoice: 'Samantha',
    isConfigured({ sayTTSCapability } = {}) {
      return Boolean(sayTTSCapability?.available);
    },
    async synthesize(request) {
      if (processLike.platform !== 'darwin') {
        throw new Error('macOS say command not available on this platform');
      }

      const tempFile = path.join(os.tmpdir(), `say-${crypto.randomUUID()}.m4a`);
      const escapedText = request.text.replace(/'/g, "'\\''").replace(/"/g, '\\"');
      const rate = Number.isFinite(request.providerOptions?.rate)
        ? Math.round(request.providerOptions.rate)
        : Math.round(100 + ((request.speed ?? 1) - 0.5) * 200);
      const cmd = `say -v "${request.voice}" -r ${rate} -o "${tempFile}" --data-format=aac '${escapedText}'`;

      try {
        await execAsync(cmd);
        const audio = await fs.promises.readFile(tempFile);
        return {
          audio,
          contentType: 'audio/mp4',
          provider: this.id,
          voice: request.voice,
        };
      } finally {
        fs.promises.unlink(tempFile).catch(() => {});
      }
    },
  };
}
