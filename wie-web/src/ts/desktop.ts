interface TauriBridge {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
}

declare global {
  interface Window { __TAURI__?: TauriBridge }
}

export interface DesktopGame {
  id: string;
  title: string;
  filename: string;
  carrier: string;
  icon: string | null;
  bytes: number;
}

export async function desktopCatalog(): Promise<DesktopGame[]> {
  return window.__TAURI__ ? window.__TAURI__.core.invoke<DesktopGame[]>("library_catalog") : [];
}

export async function desktopArchive(id: string): Promise<Uint8Array> {
  if (!window.__TAURI__) throw new Error("Windows 앱에서 사용할 수 있는 게임입니다.");
  const data = await window.__TAURI__.core.invoke<ArrayBuffer>("library_read_game", { id });
  return new Uint8Array(data);
}
