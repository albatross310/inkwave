/** Dedicated storage; never opens or modifies Inkwave's document databases or OPFS. */
const NAME = 'inkwave-readalong-v1';
let connection;
function open() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => { for (const n of ['books', 'audio', 'prefs']) r.result.createObjectStore(n, { keyPath: 'id' }); };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); connection = undefined; }; resolve(db); };
    r.onerror = () => { connection = undefined; reject(r.error || new Error('Reader storage could not be opened. Nothing was reset.')); };
    r.onblocked = () => { connection = undefined; reject(new Error('Reader storage is blocked by another tab. Close the older reader and retry.')); };
  });
  return connection;
}
function message(error) { return new Error(error?.name === 'QuotaExceededError' ? 'Device storage is full. Rendering stopped; existing recordings were kept. Export a backup before freeing space.' : `Reader storage failed: ${error?.message || 'unknown error'}. Nothing was reset.`); }
async function transact(store, mode, run) {
  const db = await open();
  return new Promise((resolve, reject) => {
    let value;
    const tx = db.transaction(store, mode);
    tx.oncomplete = () => resolve(value);
    tx.onabort = tx.onerror = () => reject(message(tx.error));
    try { const request = run(tx.objectStore(store)); request.onsuccess = () => { value = request.result; }; request.onerror = () => reject(message(request.error)); }
    catch (e) { tx.abort(); reject(message(e)); }
  });
}
// WebKit can reject Blob/File writes even when IndexedDB itself works. Keep audio
// bytes in a structured-clone primitive, restoring the playback Blob at the edge.
export async function encodeAudioRow(value) {
  const { blob, ...row } = value;
  if (!(blob instanceof Blob)) throw new Error('Reader recording has no readable audio. Nothing was saved.');
  return { ...row, audioBytes: await blob.arrayBuffer(), mime: blob.type || 'audio/mpeg' };
}
export function decodeAudioRow(value) {
  if (!value || value.blob instanceof Blob) return value; // Existing recordings need no migration.
  if (!(value.audioBytes instanceof ArrayBuffer)) throw new Error('Reader recording is unreadable. Nothing was reset.');
  const { audioBytes, mime, ...row } = value;
  return { ...row, blob: new Blob([audioBytes], { type: mime || 'audio/mpeg' }) };
}
export const get = async (store, id) => {
  const value = await transact(store, 'readonly', s => s.get(id));
  return store === 'audio' ? decodeAudioRow(value) : value;
};
export const put = async (store, value) => {
  const stored = store === 'audio' ? await encodeAudioRow(value) : value;
  return transact(store, 'readwrite', s => s.put(stored));
};
export const remove = (store, id) => transact(store, 'readwrite', s => s.delete(id));
export const all = async store => {
  const values = await transact(store, 'readonly', s => s.getAll());
  return store === 'audio' ? values.map(decodeAudioRow) : values;
};
export const keys = store => transact(store, 'readonly', s => s.getAllKeys());
/** Read and insert share one transaction so another tab cannot be overwritten. */
export async function addIfAbsent(storeName, value) {
  const stored = storeName === 'audio' ? await encodeAudioRow(value) : value;
  const db = await open();
  const saved = await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite'), store = tx.objectStore(storeName);
    let result = stored;
    const r = store.get(value.id);
    r.onsuccess = () => { if (r.result) result = r.result; else store.add(stored); };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(message(tx.error));
  });
  return storeName === 'audio' ? decodeAudioRow(saved) : saved;
}
export const addBookIfAbsent = book => addIfAbsent('books', book);
