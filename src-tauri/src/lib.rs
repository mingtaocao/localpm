pub mod domain;
pub mod http;
pub mod postman;
pub mod security;
pub mod storage;
pub mod variables;
use domain::*;
use serde_json::{json, Value};
use tauri::Manager;
struct AppState {
    storage: storage::Storage,
    http: http::HttpEngine,
}
#[tauri::command]
fn app_bootstrap(state: tauri::State<AppState>) -> Result<Value> {
    Ok(
        json!({"workspace":state.storage.load()?,"drafts":state.storage.drafts()?,"history":state.storage.history()?}),
    )
}
fn secure_metadata(metadata: &mut Value, field: &str, pairs: &[Pair]) {
    if let Some(entries) = metadata[field].as_array_mut() {
        for entry in entries {
            if pairs.iter().any(|p| p.is_secret && entry["key"] == p.key) {
                entry["value"] = json!("")
            }
        }
    }
}
fn secure_pairs(pairs: &mut [Pair]) -> Result<()> {
    for p in pairs {
        if p.is_secret && !p.value.is_empty() {
            let r = p
                .secret_ref
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            keyring::Entry::new("LocalPostman", &r)
                .and_then(|e| e.set_password(&p.value))
                .map_err(|_| {
                    AppError::new(
                        "SECRET_STORE_FAILED",
                        "Could not save secret to OS credential store",
                    )
                })?;
            p.secret_ref = Some(r);
            p.value.clear()
        }
    }
    Ok(())
}
fn secure_proxy(settings: &mut Value) -> Result<()> {
    if let Some(address) = settings["proxy"]["url"].as_str() {
        if let Ok(parsed) = url::Url::parse(address) {
            if !parsed.username().is_empty() || parsed.password().is_some() {
                return Err(AppError::new(
                    "INVALID_PROXY",
                    "Use the dedicated proxy username and password fields",
                ));
            }
        }
    }

    if let Some(p) = settings["proxy"]["password"]
        .as_str()
        .filter(|s| !s.is_empty())
    {
        let r = settings["proxy"]["secretRef"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        keyring::Entry::new("LocalPostman", &r)
            .and_then(|e| e.set_password(p))
            .map_err(|_| AppError::new("SECRET_STORE_FAILED", "Could not save proxy password"))?;
        settings["proxy"]["secretRef"] = json!(r);
        settings["proxy"]["credentialVersion"] = json!(uuid::Uuid::new_v4().to_string());
        settings["proxy"]
            .as_object_mut()
            .unwrap()
            .remove("password");
    }
    Ok(())
}
#[tauri::command]
fn save_workspace(state: tauri::State<AppState>, mut workspace: Workspace) -> Result<Workspace> {
    secure_pairs(&mut workspace.globals)?;
    secure_proxy(&mut workspace.settings)?;
    for c in &mut workspace.collections {
        secure_pairs(&mut c.variables)?;
        secure_metadata(&mut c.metadata, "variable", &c.variables);
    }
    for e in &mut workspace.environments {
        secure_pairs(&mut e.variables)?;
        secure_metadata(&mut e.metadata, "values", &e.variables);
        secure_proxy(&mut e.settings)?
    }
    for i in &mut workspace.items {
        if let Some(r) = &mut i.request {
            secure_proxy(&mut r.settings)?
        }
    }
    state.storage.save(&workspace)?;
    Ok(workspace)
}
#[tauri::command]
fn save_draft(
    state: tauri::State<AppState>,
    id: String,
    request: Option<RequestSpec>,
) -> Result<()> {
    let mut request = request;
    if let Some(r) = &mut request {
        secure_proxy(&mut r.settings)?;
    }
    state.storage.draft(&id, request.as_ref())
}
#[tauri::command]
fn preview_request(state: tauri::State<AppState>, request: RequestSpec) -> Result<Value> {
    let p = http::prepare(&state.storage.load()?, &request)?;
    let mut headers = p.headers.clone();
    for (k, v) in &mut headers {
        if ["authorization", "cookie", "proxy-authorization"].contains(&k.to_lowercase().as_str()) {
            *v = "••••••••".into()
        } else {
            *v = variables::redact(v, &p.vars)
        }
    }
    let sources: Value = p
        .vars
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                json!({"scope":v.scope,"value":if v.secret{"••••••••"}else{&v.value}}),
            )
        })
        .collect();
    Ok(
        json!({"url":variables::redact(&p.url,&p.vars),"headers":headers,"body":variables::redact(&p.body.to_string(),&p.vars),"variables":sources,"proxy":p.settings["proxy"]["mode"]}),
    )
}
#[tauri::command]
async fn send_request(
    state: tauri::State<'_, AppState>,
    request: RequestSpec,
    execution_id: String,
) -> Result<Response> {
    let ws = state.storage.load()?;
    let prepared = http::prepare(&ws, &request)?;
    let vars = prepared.vars.clone();
    let result = state.http.execute(prepared, execution_id).await;
    state.storage.save_cookies(
        &*state
            .http
            .jar
            .lock()
            .map_err(|_| AppError::new("COOKIE_ERROR", "Cookie store locked"))?,
    )?;
    let snapshot = security::history_snapshot(&request, &vars);
    let response = match &result {
        Ok(r) => {
            json!({"status":r.status,"duration":r.duration,"size":r.size,"body":security::response_preview(&r.body,&vars)})
        }
        Err(e) => json!({"error":e}),
    };
    state.storage.add_history(
        &snapshot,
        &response,
        ws.settings["historyLimit"].as_i64().unwrap_or(1000),
    )?;
    result
}
#[tauri::command]
fn cancel_request(state: tauri::State<AppState>, execution_id: String) {
    state.http.cancel(&execution_id)
}
#[tauri::command]
fn get_history(state: tauri::State<AppState>) -> Result<Vec<Value>> {
    state.storage.history()
}
#[tauri::command]
fn clear_history(state: tauri::State<AppState>) -> Result<()> {
    state.storage.clear_history()
}
#[tauri::command]
fn import_file(state: tauri::State<AppState>, path: String) -> Result<Workspace> {
    let text = std::fs::read_to_string(path)
        .map_err(|_| AppError::new("IMPORT_INVALID_FORMAT", "Cannot read JSON file"))?;
    let value = serde_json::from_str(&text)
        .map_err(|_| AppError::new("IMPORT_INVALID_FORMAT", "Invalid JSON"))?;
    let mut ws = state.storage.load()?;
    postman::import(value, &mut ws)?;
    state.storage.save(&ws)?;
    Ok(ws)
}
#[tauri::command]
fn export_file(
    state: tauri::State<AppState>,
    id: String,
    kind: String,
    path: String,
) -> Result<()> {
    let ws = state.storage.load()?;
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
        .http
        .jar
        .lock()
        .map_err(|_| AppError::new("COOKIE_ERROR", "Cookie store locked"))?;
    jar.clear();
    state.storage.save_cookies(&jar)
}
#[tauri::command]
fn save_response(state: tauri::State<AppState>, source: String, path: String) -> Result<()> {
    let source = std::path::PathBuf::from(source)
        .canonicalize()
        .map_err(|_| AppError::new("FILE_NOT_FOUND", "Response cache unavailable"))?;
    if !source.starts_with(
        state
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
            *http.jar.lock().unwrap() = storage
                .cookies()
                .map_err(|e| std::io::Error::other(e.message))?;
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
            app.manage(AppState { storage, http });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
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
