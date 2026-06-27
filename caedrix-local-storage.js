/**
 * Caedrix AI — Local Folder Storage Module
 * ==========================================
 * Stores user health data (Personal Details, Health Profile, uploaded medical
 * record PDFs, and saved search results) in a folder the USER chooses on
 * their own computer — using the browser's native File System Access API.
 *
 * KEY FACTS / LIMITS (read before changing this file):
 * - Supported in Chrome & Edge only. Safari and Firefox do NOT support the
 *   File System Access API. Always feature-detect with isSupported().
 * - A website cannot silently access a folder. The user must click a button
 *   to pick a folder (one-time), and must click a button to RE-CONFIRM
 *   access each new browser session (this is a browser security rule, not
 *   something we can bypass). We remember the *handle*, not the permission.
 * - A website cannot force a specific path like "Desktop". The user picks
 *   any folder (they're free to create "Desktop/Caedrix Data" themselves).
 * - Data is stored UNENCRYPTED in plain JSON / PDF files on the user's
 *   machine. Nothing is ever sent to the Caedrix server by this module.
 *
 * FOLDER LAYOUT CREATED INSIDE THE USER'S CHOSEN FOLDER:
 *   personal-details.json
 *   health-profile.json
 *   medical-records/      <- uploaded PDFs of medical records
 *   search-history/       <- saved PDF results from past searches
 *
 * USAGE:
 *   await CaedrixStorage.connectFolder();          // one-time picker
 *   await CaedrixStorage.restoreConnection();       // call on every page load
 *   await CaedrixStorage.saveJSON('personal-details.json', {...});
 *   const data = await CaedrixStorage.loadJSON('health-profile.json');
 *   await CaedrixStorage.savePDFToFolder('medical-records', file);
 *   const context = await CaedrixStorage.getLocalHealthContext();
 */

const CaedrixStorage = (function () {

  const DB_NAME = 'caedrix_storage';
  const DB_STORE = 'handles';
  const HANDLE_KEY = 'rootFolderHandle';

  let rootHandle = null; // FileSystemDirectoryHandle, once connected

  // ---------- Feature detection ----------

  function isSupported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  // ---------- IndexedDB helpers (to remember the folder handle) ----------

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- Connection lifecycle ----------

  /**
   * Opens the native folder picker. Call this from a button click handler
   * (a user gesture is required by the browser).
   * Returns true if a folder was selected and connected.
   */
  async function connectFolder() {
    if (!isSupported()) {
      throw new Error('NOT_SUPPORTED');
    }
    const handle = await window.showDirectoryPicker({
      id: 'caedrix-health-folder',
      mode: 'readwrite',
      startIn: 'desktop'
    });
    rootHandle = handle;
    await idbSet(HANDLE_KEY, handle);
    await ensureSubfolders();
    return true;
  }

  /**
   * Call this on every page load. It checks IndexedDB for a previously
   * chosen folder. If found, it checks whether we still have permission.
   * If permission needs re-confirming, this returns a status the caller
   * can use to show a "Reconnect Folder" button (re-confirming requires a
   * user gesture, so it cannot be done automatically).
   *
   * Returns one of: 'connected' | 'needs-permission' | 'none' | 'unsupported'
   */
  async function restoreConnection() {
    if (!isSupported()) return 'unsupported';

    const stored = await idbGet(HANDLE_KEY);
    if (!stored) return 'none';

    const opts = { mode: 'readwrite' };
    const perm = await stored.queryPermission(opts);

    if (perm === 'granted') {
      rootHandle = stored;
      await ensureSubfolders();
      return 'connected';
    }
    // 'prompt' or 'denied' — store the handle so reconnectFolder() can use it
    rootHandle = stored;
    return 'needs-permission';
  }

  /**
   * Re-requests permission on the previously chosen folder.
   * Must be called from a user gesture (e.g. button click).
   */
  async function reconnectFolder() {
    if (!rootHandle) {
      const stored = await idbGet(HANDLE_KEY);
      if (!stored) throw new Error('NO_STORED_FOLDER');
      rootHandle = stored;
    }
    const perm = await rootHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('PERMISSION_DENIED');
    await ensureSubfolders();
    return true;
  }

  function isConnected() {
    return rootHandle !== null;
  }

  async function disconnectFolder() {
    rootHandle = null;
    await idbSet(HANDLE_KEY, null);
  }

  async function ensureSubfolders() {
    if (!rootHandle) return;
    await rootHandle.getDirectoryHandle('medical-records', { create: true });
    await rootHandle.getDirectoryHandle('search-history', { create: true });
  }

  // ---------- JSON read/write (personal-details.json, health-profile.json) ----------

  async function saveJSON(filename, dataObj) {
    if (!rootHandle) throw new Error('NOT_CONNECTED');
    const fileHandle = await rootHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(dataObj, null, 2));
    await writable.close();
  }

  async function loadJSON(filename) {
    if (!rootHandle) throw new Error('NOT_CONNECTED');
    try {
      const fileHandle = await rootHandle.getFileHandle(filename, { create: false });
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch (err) {
      if (err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  // ---------- PDF storage (medical-records/, search-history/) ----------

  /**
   * Saves an uploaded medical record PDF (a File object, e.g. from an
   * <input type="file"> change event) into the medical-records subfolder.
   */
  async function savePDFToFolder(subfolder, file) {
    if (!rootHandle) throw new Error('NOT_CONNECTED');
    if (file.type !== 'application/pdf') throw new Error('NOT_A_PDF');
    const dir = await rootHandle.getDirectoryHandle(subfolder, { create: true });
    // Avoid collisions: prefix with timestamp if a file of the same name exists
    let name = file.name;
    try {
      await dir.getFileHandle(name, { create: false });
      name = `${Date.now()}-${name}`;
    } catch (_) { /* doesn't exist yet, fine */ }
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    return name;
  }

  /**
   * Saves a generated search-result PDF (a Blob, typically from jsPDF's
   * .output('blob')) into the search-history subfolder.
   */
  async function saveSearchResultPDF(blob, suggestedName) {
    if (!rootHandle) throw new Error('NOT_CONNECTED');
    const dir = await rootHandle.getDirectoryHandle('search-history', { create: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = suggestedName ? `${stamp}_${suggestedName}.pdf` : `${stamp}_search.pdf`;
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return name;
  }

  /** Lists files in a subfolder ('medical-records' or 'search-history'). */
  async function listFiles(subfolder) {
    if (!rootHandle) throw new Error('NOT_CONNECTED');
    const dir = await rootHandle.getDirectoryHandle(subfolder, { create: true });
    const files = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file') files.push(name);
    }
    return files;
  }

  async function deleteFile(subfolder, filename) {
    if (!rootHandle) throw new Error('NOT_CONNECTED');
    const dir = await rootHandle.getDirectoryHandle(subfolder, { create: true });
    await dir.removeEntry(filename);
  }

  // ---------- Integration point for the future AI/search backend ----------

  /**
   * Assembles everything the search/AI backend would need as context:
   * personal details, health profile, and the list of uploaded medical
   * record filenames (file contents can be fetched individually if the
   * backend needs to read/parse them).
   *
   * THIS IS THE FUNCTION TO CALL FROM YOUR SEARCH FEATURE ONCE BUILT.
   * It currently returns local data only; wire its output into whatever
   * request shape your AI backend expects.
   */
  async function getLocalHealthContext() {
    if (!rootHandle) {
      return { connected: false, personalDetails: null, healthProfile: null, medicalRecordFiles: [] };
    }
    const [personalDetails, healthProfile, medicalRecordFiles] = await Promise.all([
      loadJSON('personal-details.json'),
      loadJSON('health-profile.json'),
      listFiles('medical-records')
    ]);
    return { connected: true, personalDetails, healthProfile, medicalRecordFiles };
  }

  return {
    isSupported,
    connectFolder,
    restoreConnection,
    reconnectFolder,
    isConnected,
    disconnectFolder,
    saveJSON,
    loadJSON,
    savePDFToFolder,
    saveSearchResultPDF,
    listFiles,
    deleteFile,
    getLocalHealthContext
  };

})();
