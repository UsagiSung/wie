import { extractAppMetadata } from "@pkg";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleHelp, FolderPlus, Heart, Music2, Settings, Upload, Volume2, X, createIcons } from "lucide";
import { AppLibraryStore, AppMetadata } from "./app_library_store";
import { desktopArchive, desktopCatalog } from "./desktop";
import { SettingsController } from "./settings";
import { GameStorageIdentity, resetGameData } from "./game_data";

type Game = AppMetadata & { nativeId?: string; iconUrl?: string; carrier: string };
type Preferences = { favorites: string[]; played: Record<string, number> };
const PAGE_SIZE = 36;

export const initializeLibrary = async (launchApp: (app: AppMetadata, archive: Uint8Array) => Promise<void>, settings: SettingsController) => {
  const store = await AppLibraryStore.open();
  const grid = document.getElementById("library-pages")!;
  const status = document.getElementById("library-status")!;
  const search = document.getElementById("game-search") as HTMLInputElement;
  const carrier = document.getElementById("carrier-filter") as HTMLSelectElement;
  const sort = document.getElementById("game-sort") as HTMLSelectElement;
  const pager = document.getElementById("page-indicators")!;
  const input = document.getElementById("archive-input") as HTMLInputElement;
  const importDialog = document.getElementById("import-dialog") as HTMLDialogElement;
  const importStatus = document.getElementById("import-status")!;
  const choose = document.getElementById("choose-archive") as HTMLButtonElement;
  const errorDialog = document.getElementById("error-dialog") as HTMLDialogElement;
  const resetDialog = document.getElementById("reset-game-dialog") as HTMLDialogElement;
  const resetConfirm = document.getElementById("reset-game-confirm") as HTMLButtonElement;
  const resetCancel = document.getElementById("reset-game-cancel") as HTMLButtonElement;
  const resetStatus = document.getElementById("reset-game-status")!;
  let resetTarget: { game: Game; identity: GameStorageIdentity } | undefined;
  let resetting = false;
  let resetRequest = 0;
  let preferences: Preferences = { favorites: [], played: {} };
  try {
    const saved = JSON.parse(localStorage.getItem("pocket_preferences") ?? "null") as Preferences | null;
    if (saved && Array.isArray(saved.favorites) && saved.played) preferences = saved;
  } catch { /* A damaged preference must not prevent opening the collection. */ }
  let games: Game[] = [];
  let tab = "all";
  let page = 0;
  let launching = false;
  const urls = new Set<string>();
  const save = () => localStorage.setItem("pocket_preferences", JSON.stringify(preferences));
  const showError = (title: string, error: unknown) => {
    document.getElementById("error-title")!.textContent = title;
    document.getElementById("error-detail")!.textContent = String(error);
    errorDialog.showModal();
  };
  const reload = async () => {
    const local = await store.list();
    const native = await desktopCatalog();
    games = native.map(game => ({ id: game.id, nativeId: game.id, title: game.title, filename: game.filename,
      carrier: game.carrier, iconUrl: game.icon ?? undefined, addedAt: 0 }));
    games.push(...local.map(game => ({ ...game, carrier: /(?:KTF|SKT|LGT)/i.exec(game.filename)?.[0].toUpperCase() ?? "J2ME" })));
  };
  const startGame = async (game: Game) => {
    if (launching) return;
    launching = true;
    status.textContent = `${game.title} 여는 중…`;
    try {
      const archive = game.nativeId ? await desktopArchive(game.nativeId) : await store.getArchive(game.id);
      if (!archive) throw new Error("저장된 게임 파일을 찾을 수 없습니다.");
      preferences.played[game.id] = Date.now();
      save();
      await launchApp(game, archive);
    } catch (error) {
      showError(`${game.title}을(를) 실행할 수 없습니다`, error);
    } finally {
      launching = false;
      render();
    }
  };
  const requestReset = async (game: Game) => {
    const request = ++resetRequest;
    resetTarget = undefined;
    resetConfirm.disabled = true;
    resetStatus.textContent = "저장공간을 확인하고 있습니다…";
    document.getElementById("reset-game-name")!.textContent = game.title;
    resetDialog.showModal();
    try {
      const archive = game.nativeId ? await desktopArchive(game.nativeId) : await store.getArchive(game.id);
      if (!archive) throw new Error("게임 원본을 읽을 수 없어 저장공간을 확인하지 못했습니다.");
      const metadata = extractAppMetadata(game.filename, archive);
      try {
        if (!resetDialog.open || request !== resetRequest) return;
        resetTarget = { game, identity: { pid: metadata.id, aid: metadata.aid } };
        resetConfirm.disabled = false;
        resetStatus.textContent = "";
      } finally { metadata.free(); }
    } catch (error) { if (request === resetRequest) resetStatus.textContent = String(error); }
  };
  resetCancel.addEventListener("click", () => resetDialog.close());
  resetDialog.addEventListener("cancel", event => { if (resetting) event.preventDefault(); });
  resetDialog.addEventListener("close", () => { resetTarget = undefined; resetRequest++; });
  resetConfirm.addEventListener("click", () => {
    if (!resetTarget || resetting) return;
    const target = resetTarget;
    resetting = true;
    resetConfirm.disabled = resetCancel.disabled = true;
    resetStatus.textContent = "저장 데이터를 삭제하고 있습니다…";
    void (async () => {
      try {
        await resetGameData(target.identity);
        delete preferences.played[target.game.id];
        save();
        resetDialog.close();
        render();
        status.textContent = `${target.game.title}의 저장 데이터와 최근 플레이 기록을 삭제했습니다.`;
      } catch (error) {
        resetStatus.textContent = `삭제를 완료하지 못했습니다. 일부 데이터가 삭제되었을 수 있습니다. 다시 시도해 주세요.\n${String(error)}`;
      } finally {
        resetting = false;
        resetConfirm.disabled = resetCancel.disabled = false;
      }
    })();
  });
  const render = () => {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    grid.replaceChildren();
    pager.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase().replace(/\s/g, "");
    let filtered = games.filter(game => game.title.toLocaleLowerCase().replace(/\s/g, "").includes(query)
      && (!carrier.value || game.carrier === carrier.value)
      && (tab !== "favorites" || preferences.favorites.includes(game.id))
      && (tab !== "recent" || preferences.played[game.id]));
    filtered = filtered.sort((a, b) => (sort.value === "recent" || tab === "recent")
      ? (preferences.played[b.id] ?? 0) - (preferences.played[a.id] ?? 0) || a.title.localeCompare(b.title, "ko")
      : a.title.localeCompare(b.title, "ko") || a.carrier.localeCompare(b.carrier));
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    status.textContent = `${filtered.length}개의 게임 · ${page + 1} / ${pages} 페이지`;
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-library";
      empty.textContent = games.length ? "조건에 맞는 게임이 없습니다. 검색어나 필터를 바꿔 보세요." : "첫 게임을 꺼내 볼까요? 게임 추가에서 ZIP 또는 JAR 파일을 선택하세요.";
      grid.append(empty);
    }
    for (const game of filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const card = document.createElement("article");
      card.className = "game-card";
      card.dataset.carrier = game.carrier;
      const button = document.createElement("button");
      button.className = "game-launch";
      button.title = `${game.title} 실행`;
      const art = document.createElement("span");
      art.className = "game-art";
      let iconUrl = game.iconUrl;
      if (game.icon) { iconUrl = URL.createObjectURL(game.icon); urls.add(iconUrl); }
      if (iconUrl) {
        const image = document.createElement("img");
        image.src = iconUrl;
        image.alt = "";
        image.loading = "lazy";
        image.addEventListener("error", () => { art.textContent = Array.from(game.title)[0] ?? "P"; }, { once: true });
        art.append(image);
      } else { art.textContent = Array.from(game.title)[0] ?? "P"; }
      const badge = document.createElement("span");
      badge.className = "carrier-badge";
      badge.textContent = game.carrier;
      const title = document.createElement("span");
      title.className = "game-name";
      title.textContent = game.title;
      const hint = document.createElement("span");
      hint.className = "game-hint";
      hint.textContent = preferences.played[game.id] ? "다시 플레이" : "플레이하기";
      button.append(art, badge, title, hint);
      button.addEventListener("click", () => { void startGame(game); });
      const favorite = document.createElement("button");
      favorite.className = "favorite-button";
      const selected = preferences.favorites.includes(game.id);
      favorite.textContent = selected ? "♥" : "♡";
      favorite.setAttribute("aria-label", `${game.title} 즐겨찾기`);
      favorite.setAttribute("aria-pressed", String(selected));
      favorite.addEventListener("click", () => {
        preferences.favorites = selected ? preferences.favorites.filter(id => id !== game.id) : [...preferences.favorites, game.id];
        save(); render();
      });
      card.append(button, favorite);
      if (tab === "recent") {
        const reset = document.createElement("button");
        reset.className = "reset-game-button";
        reset.textContent = "×";
        reset.title = "게임 데이터 초기화하기";
        reset.setAttribute("aria-label", `${game.title} 게임 데이터 초기화하기`);
        reset.addEventListener("click", () => { void requestReset(game); });
        card.append(reset);
      }
      grid.append(card);
    }
    for (const [label, delta] of [["← 이전", -1], ["다음 →", 1]] as const) {
      const button = document.createElement("button");
      button.className = "secondary-command";
      button.textContent = label;
      button.disabled = delta < 0 ? page === 0 : page === pages - 1;
      button.addEventListener("click", () => { page += delta; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      pager.append(button);
    }
  };
  for (const control of [search, carrier, sort]) control.addEventListener(control === search ? "input" : "change", () => { page = 0; render(); });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-library-tab]")) {
    button.addEventListener("click", () => {
      tab = button.dataset.libraryTab!; page = 0;
      document.querySelectorAll("[data-library-tab]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      render();
    });
  }
  grid.addEventListener("keydown", event => {
    if (!event.key.startsWith("Arrow") || !(event.target instanceof HTMLButtonElement) || !event.target.classList.contains("game-launch")) return;
    const buttons = Array.from(grid.querySelectorAll<HTMLButtonElement>(".game-launch"));
    const columns = Math.max(1, Math.round(grid.clientWidth / (buttons[0]?.parentElement?.getBoundingClientRect().width ?? grid.clientWidth)));
    const offset = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns } as Record<string, number>)[event.key];
    if (offset !== undefined) { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, buttons.indexOf(event.target) + offset))]?.focus(); }
  });
  document.getElementById("menu-add-app")!.addEventListener("click", () => { importStatus.textContent = ""; importDialog.showModal(); });
  document.getElementById("menu-settings")!.addEventListener("click", settings.open);
  document.getElementById("menu-help")!.addEventListener("click", () => (document.getElementById("help-dialog") as HTMLDialogElement).showModal());
  document.getElementById("refresh-library")!.addEventListener("click", () => { void reload().then(render).catch(error => showError("라이브러리를 읽을 수 없습니다", error)); });
  choose.addEventListener("click", () => input.click());
  const importFiles = async (files: File[]) => {
    if (choose.disabled || !files.length) return;
    choose.disabled = true;
    const failures: string[] = [];
    let added = 0;
    try {
      const known = new Set(games.map(game => game.id));
      for (const file of files) {
        importStatus.textContent = `${file.name} 확인 중…`;
        try {
          if (!/\.(zip|jar)$/i.test(file.name)) throw new Error("피처폰 ZIP/JAR 파일만 추가할 수 있습니다. APK는 지원하지 않습니다.");
          const data = new Uint8Array(await file.arrayBuffer());
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data))).map(b => b.toString(16).padStart(2, "0")).join("");
          const id = `import-${hash}`;
          if (known.has(id)) continue;
          const extracted = extractAppMetadata(file.name, data);
          try {
            const metadata: AppMetadata = { id, title: extracted.title, filename: file.name, addedAt: Date.now() };
            if (extracted.icon.length) metadata.icon = new Blob([new Uint8Array(extracted.icon).buffer]);
            await store.add(metadata, data); known.add(id); added++;
          } finally { extracted.free(); }
        } catch (error) { failures.push(`${file.name}: ${String(error)}`); }
      }
      await reload(); render();
      importStatus.textContent = `${added}개 추가 완료${failures.length ? ` · ${failures.length}개 제외\n${failures.slice(0, 8).join("\n")}` : ""}`;
    } finally { choose.disabled = false; input.value = ""; }
  };
  input.addEventListener("change", () => { void importFiles(Array.from(input.files ?? [])); });
  importDialog.addEventListener("dragover", event => { event.preventDefault(); });
  importDialog.addEventListener("drop", event => { event.preventDefault(); void importFiles(Array.from(event.dataTransfer?.files ?? [])); });
  createIcons({ icons: { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleHelp, FolderPlus, Heart, Music2, Settings, Upload, Volume2, X } });
  await reload(); render();
};
