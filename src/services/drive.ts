// @ts-ignore
import { getAccessToken } from '@/auth/google';
import * as FileSystem from 'expo-file-system/legacy';

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  parentId?: string;
  thumbnailLink?: string;
  modifiedTime?: string;
};

const FOLDER = 'application/vnd.google-apps.folder';

export async function getRootFolders(source: 'my-drive' | 'shared'): Promise<DriveItem[]> {
  const token = await getAccessToken();
  if (!token) throw new Error('No se encontró el token.');

  let query = "trashed = false and mimeType = 'application/vnd.google-apps.folder'";
  if (source === 'my-drive') {
    query += " and 'me' in owners";
  } else {
    query += " and sharedWithMe = true";
  }

  const order = source === 'my-drive' ? '&orderBy=name' : '';
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,mimeType,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100${order}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  const data = await res.json();

  return (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    isFolder: true,
    modifiedTime: f.modifiedTime,
  }));
}

// Carpetas donde ya sabemos que no hay imagen suelta (evita preguntar a Drive cada vez)
const foldersWithoutCover = new Set<string>();

/**
 * Busca una imagen suelta en la carpeta (cover.jpg, folder.png...) y la guarda en caché.
 * Devuelve la ruta local, o undefined si no hay imagen o la descarga falló.
 */
async function getFolderCover(folderId: string, token: string): Promise<string | undefined> {
  if (foldersWithoutCover.has(folderId)) return undefined;

  const fs = FileSystem as any;
  const dir = fs.cacheDirectory || fs.documentDirectory || '';
  const targetPath = `${dir}cover_${folderId}.jpg`;

  try {
    const info = await fs.getInfoAsync(targetPath);

    // Una imagen real pesa más de 1 KB. Si es más chico, es un error de Google
    if (info.exists && (info.size ?? 0) > 1024) return targetPath;
    if (info.exists) await fs.deleteAsync(targetPath, { idempotent: true });

    const q = `trashed = false and '${folderId}' in parents and mimeType contains 'image/'`;
    const listUrl =
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}` +
      `&fields=${encodeURIComponent('files(id,name)')}` +
      `&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return undefined;

    const images: { id: string; name: string }[] = (await res.json()).files ?? [];
    if (images.length === 0) {
      foldersWithoutCover.add(folderId);
      return undefined;
    }

    // Prefiere nombres típicos de carátula; si no hay, usa la primera imagen
    const preferred =
      images.find(f => /^(cover|folder|front|album)/i.test(f.name)) ?? images[0];

    const dl = await fs.downloadAsync(
      `https://www.googleapis.com/drive/v3/files/${preferred.id}?alt=media`,
      targetPath,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (dl.status !== 200) {
      await fs.deleteAsync(targetPath, { idempotent: true });
      return undefined;
    }

    return targetPath;
  } catch (e) {
    return undefined;
  }
}

export async function getFolderContents(folderId: string): Promise<DriveItem[]> {
  const token = await getAccessToken();
  if (!token) throw new Error('No se encontró el token.');

  const query =
    `trashed = false and '${folderId}' in parents and (mimeType = '${FOLDER}' ` +
    `or mimeType contains 'audio/' or mimeType contains 'video/mp4' ` +
    `or name contains '.mp3' or name contains '.mp4' or name contains '.m4a' ` +
    `or name contains '.flac' or name contains '.wav' or name contains '.ogg')`;

  const files: any[] = [];
  let pageToken = '';

  do {
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
      `&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime)')}` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=200` +
      `&orderBy=${encodeURIComponent('folder,name')}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const data = await res.json();

    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);

  // Buscamos la carátula UNA SOLA VEZ para esta carpeta actual si contiene canciones
  const hasSongs = files.some(f => f.mimeType !== FOLDER);
  const folderCover = hasSongs ? await getFolderCover(folderId, token) : undefined;

  // Mapeamos los elementos de forma inmediata sin bloquear con llamadas de red en bucle
  return files.map((f: any) => {
    const isFolder = f.mimeType === FOLDER;
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder,
      parentId: folderId,
      thumbnailLink: !isFolder ? folderCover : undefined, // La carátula se aplica a las canciones de este álbum
      modifiedTime: f.modifiedTime,
    };
  });
}