// @ts-ignore
import { getAccessToken } from '@/auth/google';
import { AudioPlayer, createAudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

let player: AudioPlayer | null = null;
let statusInterval: any = null;

export async function setupAudio() {
  return true;
}

function getFileExtension(filename: string): string {
  const match = filename.match(/\.([0-9a-z]+)(?:[\?#]|$)/i);
  return match ? `.${match[1]}` : '.mp3';
}

export async function playDriveAudio(
  fileId: string,
  fileName: string,
  onStatusUpdate: (status: any) => void
): Promise<any> {
  try {
    const token = await getAccessToken();
    if (!token) throw new Error('No hay sesión de Google activa');

    const ext = getFileExtension(fileName);
    const fs = FileSystem as any;
    const cacheDir = fs.cacheDirectory || fs.documentDirectory || '';
    const localUri = `${cacheDir}${fileId}${ext}`;

    const fileInfo = await fs.getInfoAsync(localUri);

    if (!fileInfo.exists) {
      const streamUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      await fs.downloadAsync(streamUrl, localUri, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }

    if (player) {
      try {
        player.pause();
      } catch (e) {}
      player = null;
    }
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
    }

    player = createAudioPlayer(localUri);
    player.play();

    statusInterval = setInterval(() => {
      if (player) {
        const p = player as any;
        const currentTime = p.currentTime || 0;
        const duration = p.duration || 1;
        const isPlaying = p.playing ?? true;

        onStatusUpdate({
          isLoaded: true,
          currentTime,
          duration,
          playing: isPlaying,
          playbackState: currentTime >= duration && duration > 0 ? 'ended' : 'playing',
        });
      }
    }, 500);

    return player;
  } catch (error: any) {
    console.error('Error al reproducir audio:', error);
    throw new Error(error?.message ?? 'Fallo al reproducir el archivo');
  }
}

// ADELANTAR O RETROCEDER AL TOCAR LA BARRA (SEEK)
export function seekAudio(seconds: number) {
  if (player) {
    try {
      (player as any).seekTo(seconds);
    } catch (e) {
      console.log('Error al buscar:', e);
    }
  }
}

export function pauseAudio() {
  if (player) {
    player.pause();
  }
}

export function resumeAudio() {
  if (player) {
    player.play();
  }
}

export function stopAudio() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
  if (player) {
    player.pause();
    player = null;
  }
}