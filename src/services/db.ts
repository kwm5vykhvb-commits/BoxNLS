// Real IndexedDB persistence for downloaded video Blobs with graceful fallbacks
const DB_NAME = 'nlsbox_media_db';
const DB_VERSION = 2;
const STORE_NAME = 'downloaded_blobs';

function isIndexedDBAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined' && window.indexedDB !== null;
  } catch {
    return false;
  }
}

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!isIndexedDBAvailable()) {
      resolve(null);
      return;
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        } catch {
          // ignore upgrade errors
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveVideoBlob(id: string, blob: Blob, fileName: string): Promise<void> {
  try {
    const db = await openDB();
    if (!db) return;

    // Convert to ArrayBuffer for WebKit/Safari compatibility where Blob storage throws "The operation is not supported"
    let buffer: ArrayBuffer | null = null;
    try {
      buffer = await blob.arrayBuffer();
    } catch {
      buffer = null;
    }

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        // Store buffer if available, or blob as fallback
        const record: any = {
          id,
          fileName,
          type: blob.type,
          size: blob.size,
          savedAt: Date.now(),
        };

        if (buffer) {
          record.buffer = buffer;
        } else {
          record.blob = blob;
        }

        const req = store.put(record);

        req.onsuccess = () => resolve();
        req.onerror = () => {
          // Gracefully resolve on error (prevents crashing downloads)
          resolve();
        };

        tx.onabort = () => resolve();
        tx.onerror = () => resolve();
        tx.oncomplete = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // Non-blocking: IndexedDB persistence is strictly optional
  }
}

export async function getVideoBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);

        req.onsuccess = () => {
          try {
            const res = req.result;
            if (!res) {
              resolve(null);
              return;
            }

            if (res.buffer instanceof ArrayBuffer) {
              const reconstructed = new Blob([res.buffer], { type: res.type || 'video/mp4' });
              resolve(reconstructed);
            } else if (res.blob instanceof Blob) {
              resolve(res.blob);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        };

        req.onerror = () => resolve(null);
        tx.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

export async function deleteVideoBlob(id: string): Promise<void> {
  try {
    const db = await openDB();
    if (!db) return;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        tx.onerror = () => resolve();
        tx.oncomplete = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {
    // Ignore error
  }
}
