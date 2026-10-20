pub mod domain;
pub mod http;
pub mod mcp;
pub mod postman;
pub mod scripts;
pub mod security;
pub mod service;
pub mod storage;
pub mod variables;
#[cfg(target_os = "windows")]
pub mod windows_proxy;
use domain::*;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{Emitter, Manager};
struct AppState {
    service: Arc<service::RequestService>,
    mcp: Arc<mcp::McpController>,
}
#[tauri::command]
fn app_bootstrap(state: tauri::State<AppState>) -> Result<Value> {
    Ok(
        json!({"workspace":state.service.storage.load()?,"drafts":state.service.storage.drafts()?,"history":state.service.storage.history()?}),
    )
}
#[tauri::command]
fn save_workspace(state: tauri::State<AppState>, workspace: Workspace) -> Result<Workspace> {
    state.service.save_workspace(workspace)
}
#[tauri::command]
fn save_draft(
    state: tauri::State<AppState>,
    id: String,
    request: Option<RequestSpec>,
) -> Result<()> {
    state.service.save_draft(&id, request)
}
#[tauri::command]
fn preview_request(state: tauri::State<AppState>, request: RequestSpec) -> Result<Value> {
    state.service.preview(&request)
}
#[tauri::command]
async fn send_request(
    state: tauri::State<'_, AppState>,
    request: RequestSpec,
    execution_id: String,
    workspace: Option<Workspace>,
) -> Result<Response> {
    let workspace = match workspace {
        Some(snapshot) => snapshot,
        None => state.service.storage.load()?,
    };
    let context = service::ExecutionContext::from_workspace(&workspace, &request, "manual");
    state.service.reserve_execution(&execution_id)?;
    let token = state.service.execution_token(&execution_id)?;
    let prepared =
        tokio::task::spawn_blocking(move || scripts::prepare(&workspace, &request, &token))
            .await
            .map_err(|e| AppError::new("SCRIPT_ERROR", e))
            .and_then(|result| result);
    let prepared = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            state.service.forget_execution(&execution_id);
            return Err(error);
        }
    };
    state.service.execute(prepared, execution_id, context).await
}
#[tauri::command]
fn cancel_request(state: tauri::State<AppState>, execution_id: String) {
    state.service.cancel(&execution_id)
}
#[tauri::command]
fn mcp_status(state: tauri::State<AppState>) -> Value {
    state.mcp.status()
}
#[tauri::command]
async fn mcp_configure(state: tauri::State<'_, AppState>, config: mcp::McpConfig) -> Result<Value> {
    state.mcp.configure(config).await
}
#[tauri::command]
fn mcp_connection_config(state: tauri::State<AppState>) -> Result<Value> {
    state.mcp.connection_config()
}
#[tauri::command]
fn get_execution(state: tauri::State<AppState>, id: String) -> Result<Option<Value>> {
    state.service.storage.execution(&id)
}
#[tauri::command]
fn list_executions(state: tauri::State<AppState>, active_only: bool) -> Result<Vec<Value>> {
    state.service.storage.executions(active_only)
}
#[tauri::command]
fn get_history(state: tauri::State<AppState>) -> Result<Vec<Value>> {
    state.service.storage.history()
}
#[tauri::command]
fn clear_history(state: tauri::State<AppState>) -> Result<()> {
    state.service.storage.clear_history()
}
#[tauri::command]
fn import_file(state: tauri::State<AppState>, path: String) -> Result<Workspace> {
    let text = std::fs::read_to_string(path)
        .map_err(|_| AppError::new("IMPORT_INVALID_FORMAT", "Cannot read JSON file"))?;
    let value = serde_json::from_str(&text)
        .map_err(|_| AppError::new("IMPORT_INVALID_FORMAT", "Invalid JSON"))?;
    let mut ws = state.service.storage.load()?;
    postman::import(value, &mut ws)?;
    state.service.storage.save(&ws)?;
    Ok(ws)
}
#[tauri::command]
fn export_file(
    state: tauri::State<AppState>,
    id: String,
    kind: String,
    path: String,
) -> Result<()> {
    let ws = state.service.storage.load()?;
    let value = if kind == "environment" {
        postman::export_environment(
            ws.environments
                .iter()
                .find(|e| e.id == id)
                .ok_or_else(|| AppError::new("NOT_FOUND", "Environment not found"))?,
        )
    } else {
        postman::export(&ws, &id)?
    };
    std::fs::write(path, serde_json::to_string_pretty(&value).unwrap())
        .map_err(|_| AppError::new("FILE_WRITE_FAILED", "Cannot export file"))
}
#[tauri::command]
fn get_cookies(state: tauri::State<AppState>) -> Result<Value> {
    let jar = state
        .service
        .http
        .jar
        .lock()
        .map_err(|_| AppError::new("COOKIE_ERROR", "Cookie store locked"))?;
    Ok(Value::Array(
        jar.iter_unexpired()
            .map(|cookie| serde_json::to_value(cookie).unwrap())
            .collect(),
    ))
}
#[tauri::command]
fn clear_cookies(state: tauri::State<AppState>) -> Result<()> {
    let mut jar = state
        .service
        .http
        .jar
        .lock()
        .map_err(|_| AppError::new("COOKIE_ERROR", "Cookie store locked"))?;
    jar.clear();
    state.service.storage.save_cookies(&jar)
}
#[tauri::command]
fn save_response(state: tauri::State<AppState>, source: String, path: String) -> Result<()> {
    let source = std::path::PathBuf::from(source)
        .canonicalize()
        .map_err(|_| AppError::new("FILE_NOT_FOUND", "Response cache unavailable"))?;
    if !source.starts_with(
        state
            .service
            .http
            .temp
            .canonicalize()
            .map_err(|_| AppError::new("FILE_NOT_FOUND", "Cache unavailable"))?,
    ) {
        return Err(AppError::new(
            "INVALID_PATH",
            "Only response cache files can be saved",
        ));
    }
    std::fs::copy(source, path)
        .map_err(|_| AppError::new("FILE_WRITE_FAILED", "Cannot save response"))?;
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = if let Some(p) = std::env::var_os("LOCAL_POSTMAN_DATA_DIR") {
                std::path::PathBuf::from(p)
            } else {
                app.path().data_dir()?.join("LocalPostman")
            };
            std::fs::create_dir_all(&data)?;
            let storage = storage::Storage::open(&data.join("local-postman.db"))
                .map_err(|e| std::io::Error::other(e.message))?;
            let http = http::HttpEngine::new(data.join("temp"));
            let backup_dir = data.join("backups");
            std::fs::create_dir_all(&backup_dir)?;
            let day = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs()
                / 86400;
            let backup = backup_dir.join(format!("{day}.db"));
            if !backup.exists() {
                storage
                    .backup(&backup)
                    .map_err(|e| std::io::Error::other(e.message))?;
            }
            let mut backups: Vec<_> = std::fs::read_dir(&backup_dir)?
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().is_some_and(|x| x == "db"))
                .collect();
            backups.sort_by_key(|e| e.file_name());
            for entry in backups.iter().take(backups.len().saturating_sub(7)) {
                std::fs::remove_file(entry.path())?;
            }
            let handle = app.handle().clone();
            let service = Arc::new(
                service::RequestService::new(storage, http)
                    .map_err(|e| std::io::Error::other(e.message))?
                    .with_emitter(Arc::new(move |event, value| {
                        let _ = handle.emit(event, value);
                    })),
            );
            let mcp = mcp::McpController::new(service.clone());
            let restore = mcp.clone();
            tauri::async_runtime::spawn(async move {
                restore.restore().await;
            });
            app.manage(AppState { service, mcp });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            mcp_status,
            mcp_configure,
            mcp_connection_config,
            get_execution,
            list_executions,
            save_workspace,
            save_draft,
            preview_request,
            send_request,
            cancel_request,
            get_history,
            clear_history,
            import_file,
            export_file,
            save_response,
            get_cookies,
            clear_cookies
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Local Postman")
}
