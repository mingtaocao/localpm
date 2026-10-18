//! Test-only stdio adapter. Not compiled into the desktop application.
use local_postman_lib::{
    domain::*,
    http::HttpEngine,
    postman,
    service::{ExecutionContext, RequestService},
    storage::Storage,
};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
#[tokio::main]
async fn main() {
    let data = std::path::PathBuf::from(
        std::env::var("LOCAL_POSTMAN_DATA_DIR").expect("isolated data dir required"),
    );
    std::fs::create_dir_all(&data).unwrap();
    let service = RequestService::new(
        Storage::open(&data.join("local-postman.db")).unwrap(),
        HttpEngine::new(data.join("temp")),
    )
    .unwrap();
    for line in io::stdin().lock().lines() {
        let input: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let a = &input["args"];
        let result: Result<Value> = async { match input["cmd"].as_str().unwrap() {
            "app_bootstrap" => Ok(json!({"workspace":service.storage.load()?,"drafts":service.storage.drafts()?,"history":service.storage.history()?})),
            "save_workspace" => Ok(json!(service.save_workspace(serde_json::from_value(a["workspace"].clone()).unwrap())?)),
            "save_draft" => { let r: Option<RequestSpec> = serde_json::from_value(a["request"].clone()).unwrap(); service.save_draft(a["id"].as_str().unwrap(),r)?; Ok(Value::Null) },
            "send_request" => {
                let r: RequestSpec = serde_json::from_value(a["request"].clone()).unwrap();
                let w: Workspace = if a["workspace"].is_object() { serde_json::from_value(a["workspace"].clone()).unwrap() } else { service.storage.load()? };
                let context = ExecutionContext::from_workspace(&w,&r,"manual");
                Ok(json!(service.send(w,r,a["executionId"].as_str().unwrap().into(),context).await?))
            },
            "preview_request" => Ok(service.preview(&serde_json::from_value(a["request"].clone()).unwrap())?),
            "get_history" => Ok(json!(service.storage.history()?)),
            "list_executions" => Ok(json!(service.storage.executions(a["activeOnly"].as_bool().unwrap_or(false))?)),
            "get_execution" => Ok(json!(service.storage.execution(a["id"].as_str().unwrap())?)),
            "cancel_request" => { service.cancel(a["executionId"].as_str().unwrap()); Ok(Value::Null) },
            "mcp_status" => Ok(Value::Null),
            "clear_history" => {service.storage.clear_history()?;Ok(Value::Null)},
            "import_file" => {let text=std::fs::read_to_string(a["path"].as_str().unwrap()).unwrap();Ok(json!(service.import(serde_json::from_str(&text).unwrap())?))},
            "export_file" => {
                let w=service.storage.load()?;
                let output=if a["kind"]=="environment" {postman::export_environment(w.environments.iter().find(|e|e.id==a["id"]).unwrap())} else {postman::export(&w,a["id"].as_str().unwrap())?};
                std::fs::write(a["path"].as_str().unwrap(),output.to_string()).unwrap();Ok(Value::Null)
            },
            _=>Err(AppError::new("UNSUPPORTED_TEST_COMMAND",&input["cmd"]))
        }}.await;
        let out = match result {
            Ok(value) => json!({"id":input["id"],"value":value}),
            Err(error) => json!({"id":input["id"],"error":error}),
        };
        println!("{out}");
        io::stdout().flush().unwrap();
    }
}
