export interface GameStorageIdentity {
  pid: string;
  aid: string;
}

// Opening an absent database must not create an empty save database.
const openExisting = (name: string): Promise<IDBDatabase | undefined> => new Promise((resolve, reject) => {
  const request = indexedDB.open(name);
  let missing = false;
  let blocked = false;
  request.onupgradeneeded = () => { missing = true; request.transaction!.abort(); };
  request.onsuccess = () => {
    if (blocked) request.result.close();
    else resolve(request.result);
  };
  request.onerror = () => missing ? resolve(undefined) : reject(request.error);
  request.onblocked = () => {
    blocked = true;
    reject(new Error("저장공간이 다른 창에서 사용 중입니다. 게임을 종료한 뒤 다시 시도하세요."));
  };
});

const clearStore = async (database: string, store: string, aid?: string): Promise<void> => {
  const db = await openExisting(database);
  if (!db) return;
  try {
    if (!db.objectStoreNames.contains(store)) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, "readwrite");
      const records = transaction.objectStore(store);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("저장 데이터 삭제가 취소되었습니다."));
      transaction.onerror = () => reject(transaction.error);
      if (aid === undefined) records.clear();
      else {
        const cursor = records.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          // Filesystem keys are [AID, path]. Never use a string-prefix match.
          if (Array.isArray(entry.key) && entry.key[0] === aid) entry.delete();
          entry.continue();
        };
      }
    });
  } finally { db.close(); }
};

export const resetGameData = async ({ pid, aid }: GameStorageIdentity): Promise<void> => {
  if (!pid || !aid || pid === "app_library" || pid === "filesystem") {
    throw new Error("이 게임의 저장공간을 안전하게 식별할 수 없습니다.");
  }
  // RMS/WIPI records use PID; writable game files use AID, which can differ.
  // Clear records rather than deleteDatabase: the engine can retain connections.
  await clearStore(`wie_${pid}`, `wie_${pid}`);
  await clearStore("wie_filesystem", "files", aid);
};
