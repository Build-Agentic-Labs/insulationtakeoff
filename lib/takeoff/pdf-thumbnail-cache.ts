'use client';

const DB_NAME = 'ev-takeoff-thumbnail-cache';
const STORE_NAME = 'thumbnails';
const DB_VERSION = 1;
const MAX_CACHE_AGE_MS = 1000 * 60 * 60 * 24 * 14;

interface ThumbnailRecord {
  key: string;
  dataUrl: string;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openThumbnailDb() {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.reject(new Error('IndexedDB is not available.'));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open thumbnail cache.'));
  });

  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return openThumbnailDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = run(transaction.objectStore(STORE_NAME));

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Thumbnail cache request failed.'));
      }),
  );
}

export function makePdfThumbnailCacheKey(cacheScope: string, pageNumber: number, width: number) {
  const widthBucket = Math.max(180, Math.round(width / 40) * 40);
  return `${cacheScope}::p${pageNumber}::w${widthBucket}`;
}

export async function getCachedPdfThumbnail(key: string) {
  try {
    const record = await withStore<ThumbnailRecord | undefined>('readonly', (store) => store.get(key));
    if (!record?.dataUrl) return null;

    if (Date.now() - record.createdAt > MAX_CACHE_AGE_MS) {
      void deleteCachedPdfThumbnail(key);
      return null;
    }

    return record.dataUrl;
  } catch {
    return null;
  }
}

export async function setCachedPdfThumbnail(key: string, dataUrl: string) {
  try {
    await withStore<IDBValidKey>('readwrite', (store) =>
      store.put({
        key,
        dataUrl,
        createdAt: Date.now(),
      } satisfies ThumbnailRecord),
    );
  } catch {
    // Cache failures should never block the takeoff flow.
  }
}

async function deleteCachedPdfThumbnail(key: string) {
  try {
    await withStore<undefined>('readwrite', (store) => store.delete(key) as IDBRequest<undefined>);
  } catch {
    // Ignore cleanup failures.
  }
}
