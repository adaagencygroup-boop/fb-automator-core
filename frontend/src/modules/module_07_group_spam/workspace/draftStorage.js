const draftKey = (scope) => `module_07_group_${scope}_draft`;
const MEDIA_DB_NAME = "fb_automator_module_07";
const MEDIA_STORE_NAME = "group_post_draft";
const mediaKey = (scope) => `${scope}_media_files`;

export function readGroupPostDraft(scope = "post") {
  try {
    const raw = sessionStorage.getItem(draftKey(scope));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Không thể đọc bản nháp đăng bài nhóm:", error);
    return null;
  }
}

export function writeGroupPostDraft(draft, scope = "post") {
  try {
    sessionStorage.setItem(draftKey(scope), JSON.stringify(draft));
  } catch (error) {
    console.warn("Không thể lưu bản nháp đăng bài nhóm:", error);
  }
}

export async function clearGroupPostDraft(scope = "post") {
  try {
    sessionStorage.removeItem(draftKey(scope));

    const db = await openMediaDatabase();
    if (!db) return;

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE_NAME, "readwrite");
      transaction.objectStore(MEDIA_STORE_NAME).delete(mediaKey(scope));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (error) {
    console.warn("Unable to clear group post draft:", error);
  }
}

function openMediaDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
        db.createObjectStore(MEDIA_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readGroupPostDraftMedia(scope = "post") {
  try {
    const db = await openMediaDatabase();
    if (!db) return [];

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE_NAME, "readonly");
      const request = transaction.objectStore(MEDIA_STORE_NAME).get(mediaKey(scope));
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.warn("Không thể đọc media của bản nháp đăng bài nhóm:", error);
    return [];
  }
}

export async function writeGroupPostDraftMedia(files, scope = "post") {
  try {
    const db = await openMediaDatabase();
    if (!db) return;

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(MEDIA_STORE_NAME, "readwrite");
      transaction.objectStore(MEDIA_STORE_NAME).put(Array.from(files || []), mediaKey(scope));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (error) {
    console.warn("Không thể lưu media của bản nháp đăng bài nhóm:", error);
  }
}
