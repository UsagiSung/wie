use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
struct LibraryGame {
    id: String,
    title: String,
    carrier: String,
    filename: String,
    icon: Option<String>,
    bytes: u64,
}

fn library_root() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let parent = executable.parent().ok_or("프로그램 폴더를 찾을 수 없습니다.")?;
    Ok(parent.join("library"))
}

#[tauri::command]
fn library_catalog() -> Result<Vec<LibraryGame>, String> {
    let path = library_root()?.join("catalog.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&data).map_err(|error| error.to_string())
}

fn valid_game_filename(filename: &str) -> bool {
    let Some((id, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_hexdigit()) && matches!(extension, "zip" | "jar")
}

#[tauri::command]
fn library_read_game(id: String) -> Result<tauri::ipc::Response, String> {
    let game = library_catalog()?
        .into_iter()
        .find(|game| game.id == id)
        .ok_or("라이브러리에서 게임을 찾을 수 없습니다.")?;
    if !valid_game_filename(&game.filename) {
        return Err("잘못된 게임 파일 경로입니다.".into());
    }
    let root = library_root()?.join("files").canonicalize().map_err(|error| error.to_string())?;
    let path = root.join(game.filename).canonicalize().map_err(|error| error.to_string())?;
    if !path.starts_with(&root) {
        return Err("라이브러리 밖의 파일은 읽을 수 없습니다.".into());
    }
    let data = fs::read(path).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(data))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![library_catalog, library_read_game])
        .run(tauri::generate_context!())
        .expect("error while running Pocket Library");
}

#[cfg(test)]
mod tests {
    use super::valid_game_filename;

    #[test]
    fn rejects_paths_and_android_packages() {
        let hash = "a".repeat(64);
        assert!(valid_game_filename(&format!("{hash}.zip")));
        assert!(valid_game_filename(&format!("{hash}.jar")));
        assert!(!valid_game_filename(&format!("../{hash}.zip")));
        assert!(!valid_game_filename(&format!("{hash}.apk")));
        assert!(!valid_game_filename("C:\\private.zip"));
    }
}
