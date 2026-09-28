import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { resetGameData } from "../src/ts/game_data.ts";

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

const seed = (name, store, entries) => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(store);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction(store, "readwrite");
    for (const [key, value] of entries) tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve(db);
    tx.onabort = () => reject(tx.error);
  };
});
const keys = (db, store) => new Promise((resolve, reject) => {
  const request = db.transaction(store).objectStore(store).getAllKeys();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

test("reset clears PID records and exact AID files, preserving other games and archives", async () => {
  const record = await seed("wie_game-pid", "wie_game-pid", [["save1", [1]], ["option2", [2]]]);
  const other = await seed("wie_game-pid2", "wie_game-pid2", [["save1", [3]]]);
  const filesystem = await seed("wie_filesystem", "files", [
    [["game-aid", "save.dat"], [4]], [["game-aid", "settings.dat"], [5]],
    [["game-aid2", "save.dat"], [6]], [["other", "save.dat"], [7]],
  ]);
  const library = await seed("wie_app_library", "archives", [["game", [8]]]);
  try {
    // Deliberately leave the engine-like connections open during the reset.
    await resetGameData({ pid: "game-pid", aid: "game-aid" });
    assert.deepEqual(await keys(record, "wie_game-pid"), []);
    assert.deepEqual(await keys(other, "wie_game-pid2"), ["save1"]);
    assert.deepEqual(await keys(filesystem, "files"), [["game-aid2", "save.dat"], ["other", "save.dat"]]);
    assert.deepEqual(await keys(library, "archives"), ["game"]);
    await resetGameData({ pid: "game-pid", aid: "game-aid" });
  } finally { for (const db of [record, other, filesystem, library]) db.close(); }
});

test("never-played games do not create save databases", async () => {
  await resetGameData({ pid: "absent", aid: "absent" });
  assert.deepEqual(await indexedDB.databases(), []);
});

test("invalid identifiers cannot clear shared infrastructure", async () => {
  const library = await seed("wie_app_library", "wie_app_library", [["keep", 1]]);
  try {
    for (const identity of [{ pid: "app_library", aid: "x" }, { pid: "filesystem", aid: "x" }, { pid: "", aid: "x" }, { pid: "x", aid: "" }]) {
      await assert.rejects(resetGameData(identity), /안전하게 식별/);
    }
    assert.deepEqual(await keys(library, "wie_app_library"), ["keep"]);
  } finally { library.close(); }
});

test("transaction failure rejects instead of reporting deletion success", async () => {
  const db = await seed("wie_failure", "wie_failure", [["save", 1]]);
  const prototype = Object.getPrototypeOf(db);
  const original = prototype.transaction;
  prototype.transaction = function (...args) {
    const tx = original.apply(this, args);
    if (args[1] === "readwrite") queueMicrotask(() => tx.abort());
    return tx;
  };
  try {
    await assert.rejects(resetGameData({ pid: "failure", aid: "failure" }));
    assert.deepEqual(await keys(db, "wie_failure"), ["save"]);
  } finally { prototype.transaction = original; db.close(); }
});
