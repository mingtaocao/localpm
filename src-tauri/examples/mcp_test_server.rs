//! Isolated UI integration adapter using the production service and MCP server.
//! This example is not bundled into the desktop application.
use local_postman_lib::{
    domain::*,
    http::{self, HttpEngine},
    mcp::{McpConfig, McpController},
    postman,
    service::{ExecutionContext, RequestService},
    storage::Storage,
};
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Write},
    sync::{Arc, Mutex},
};

fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value)
        .map_err(|_| AppError::new("TEST_ARGUMENT_INVALID", "Invalid integration argument"))
}
fn field<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .ok_or_else(|| AppError::new("TEST_ARGUMENT_INVALID", "Missing integration argument"))
}
async fn dispatch(
    service: Arc<RequestService>,
    mcp: Arc<McpController>,
    input: Value,
) -> Result<Value> {
    let args = &input["args"];
    match input["cmd"].as_str().unwrap_or_default() {
        "app_bootstrap" => Ok(
            json!({"workspace":service.storage.load()?,"drafts":service.storage.drafts()?,"history":service.storage.history()?}),
        ),
        "save_workspace" => Ok(json!(
            service.save_workspace(decode(args["workspace"].clone())?)?
        )),
        "save_draft" => {
            service.save_draft(field(args, "id")?, decode(args["request"].clone())?)?;
            Ok(Value::Null)
        }
        "preview_request" => service.preview(&decode(args["request"].clone())?),
        "send_request" => {
            let request: RequestSpec = decode(args["request"].clone())?;
            let workspace = service.storage.load()?;
            let prepared = http::prepare(&workspace, &request)?;
            let id = field(args, "executionId")?.to_owned();
            service.reserve_execution(&id)?;
            Ok(json!(
                service
                    .execute(
                        prepared,
                        id,
                        ExecutionContext::from_workspace(&workspace, &request, "manual")
                    )
                    .await?
            ))
        }
        "cancel_request" | "cancel_execution" => {
            service.cancel(field(args, "executionId")?);
            Ok(Value::Null)
        }
        "get_execution" => Ok(service
            .storage
            .execution(
                args["id"]
                    .as_str()
                    .or_else(|| args["executionId"].as_str())
                    .ok_or_else(|| {
                        AppError::new("TEST_ARGUMENT_INVALID", "Missing execution ID")
                    })?,
            )?
            .unwrap_or(Value::Null)),
        "list_executions" => Ok(json!(service
            .storage
            .executions(args["activeOnly"].as_bool().unwrap_or(false))?)),
        "get_history" => Ok(json!(service.storage.history()?)),
        "clear_history" => {
            service.storage.clear_history()?;
            Ok(Value::Null)
        }
        "mcp_status" => Ok(mcp.status()),
        "mcp_configure" => {
            mcp.configure(decode::<McpConfig>(args["config"].clone())?)
                .await
        }
        "mcp_connection_config" => mcp.connection_config(),
        "import_file" => {
            let text = std::fs::read_to_string(field(args, "path")?)
                .map_err(|_| AppError::new("IMPORT_INVALID_FORMAT", "Cannot read JSON file"))?;
            let mut workspace = service.storage.load()?;
            postman::import(
                decode(
                    serde_json::from_str(&text)
                        .map_err(|_| AppError::new("IMPORT_INVALID_FORMAT", "Invalid JSON"))?,
                )?,
                &mut workspace,
            )?;
            Ok(json!(service.save_workspace(workspace)?))
        }
        "export_file" => {
            let workspace = service.storage.load()?;
            let id = field(args, "id")?;
            let value = if args["kind"] == "environment" {
                postman::export_environment(
                    workspace
                        .environments
                        .iter()
                        .find(|e| e.id == id)
                        .ok_or_else(|| AppError::new("NOT_FOUND", "Environment not found"))?,
                )
            } else {
                postman::export(&workspace, id)?
            };
            std::fs::write(field(args, "path")?, value.to_string())
                .map_err(|_| AppError::new("FILE_WRITE_FAILED", "Cannot export file"))?;
            Ok(Value::Null)
        }
        "save_response" => {
            let source = std::path::PathBuf::from(field(args, "source")?)
                .canonicalize()
                .map_err(|_| AppError::new("FILE_NOT_FOUND", "Response cache unavailable"))?;
            let cache = service
                .http
                .temp
                .canonicalize()
                .map_err(|_| AppError::new("FILE_NOT_FOUND", "Response cache unavailable"))?;
            if !source.starts_with(cache) {
                return Err(AppError::new(
                    "INVALID_PATH",
                    "Only response cache files can be saved",
                ));
            }
            std::fs::copy(source, field(args, "path")?)
                .map_err(|_| AppError::new("FILE_WRITE_FAILED", "Cannot save response"))?;
            Ok(Value::Null)
        }
        "get_cookies" => Ok(json!(service
            .http
            .jar
            .lock()
            .unwrap()
            .iter_unexpired()
            .collect::<Vec<_>>())),
        "clear_cookies" => {
            let mut jar = service.http.jar.lock().unwrap();
            jar.clear();
            service.storage.save_cookies(&jar)?;
            Ok(Value::Null)
        }
        _ => Err(AppError::new(
            "UNSUPPORTED_TEST_COMMAND",
            "Unsupported integration command",
        )),
    }
}
#[tokio::main]
async fn main() {
    let data = std::path::PathBuf::from(
        std::env::var("LOCAL_POSTMAN_DATA_DIR").expect("isolated data dir required"),
    );
    std::fs::create_dir_all(&data).unwrap();
    let output = Arc::new(Mutex::new(io::stdout()));
    let events = output.clone();
    let service = Arc::new(
        RequestService::new(
            Storage::open(&data.join("local-postman.db")).unwrap(),
            HttpEngine::new(data.join("temp")),
        )
        .unwrap()
        .with_emitter(Arc::new(move |event, payload| {
            let mut writer = events.lock().unwrap();
            writeln!(writer, "{}", json!({"event":event,"payload":payload})).unwrap();
            writer.flush().unwrap();
        })),
    );
    let mcp = McpController::new_with_token(service.clone(), "token.localpm.integration".into());
    mcp.restore().await;
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            match line {
                Ok(line) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    while let Some(line) = receiver.recv().await {
        let input: Value = serde_json::from_str(&line).unwrap();
        let service = service.clone();
        let mcp = mcp.clone();
        let output = output.clone();
        tokio::spawn(async move {
            let id = input["id"].clone();
            let result = dispatch(service, mcp, input).await;
            let value = match result {
                Ok(value) => json!({"id":id,"value":value}),
                Err(error) => json!({"id":id,"error":error}),
            };
            let mut writer = output.lock().unwrap();
            writeln!(writer, "{value}").unwrap();
            writer.flush().unwrap();
        });
    }
}
