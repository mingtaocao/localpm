//! Test-only stdio adapter. Not compiled into the desktop application.
use local_postman_lib::{
    domain::*,
    http::{prepare, HttpEngine},
    postman,
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
    let storage = Storage::open(&data.join("local-postman.db")).unwrap();
    let engine = HttpEngine::new(data.join("temp"));
    for line in io::stdin().lock().lines() {
        let input: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let a = &input["args"];
        let result:Result<Value>=async{match input["cmd"].as_str().unwrap(){"app_bootstrap"=>Ok(json!({"workspace":storage.load()?,"drafts":storage.drafts()?,"history":storage.history()?})),"save_workspace"=>{let ws:Workspace=serde_json::from_value(a["workspace"].clone()).unwrap();storage.save(&ws)?;Ok(json!(ws))},"save_draft"=>{let r:Option<RequestSpec>=serde_json::from_value(a["request"].clone()).unwrap();storage.draft(a["id"].as_str().unwrap(),r.as_ref())?;Ok(Value::Null)},"send_request"=>{let r:RequestSpec=serde_json::from_value(a["request"].clone()).unwrap();let w=storage.load()?;let result=engine.execute(prepare(&w,&r)?,a["executionId"].as_str().unwrap().into()).await?;storage.add_history(&r,&json!({"status":result.status,"duration":result.duration}),1000)?;Ok(json!(result))},"get_history"=>Ok(json!(storage.history()?)),"clear_history"=>{storage.clear_history()?;Ok(Value::Null)},"import_file"=>{let text=std::fs::read_to_string(a["path"].as_str().unwrap()).unwrap();let mut w=storage.load()?;postman::import(serde_json::from_str(&text).unwrap(),&mut w)?;storage.save(&w)?;Ok(json!(w))},"export_file"=>{let w=storage.load()?;let output=if a["kind"]=="environment"{postman::export_environment(w.environments.iter().find(|e|e.id==a["id"]).unwrap())}else{postman::export(&w,a["id"].as_str().unwrap())?};std::fs::write(a["path"].as_str().unwrap(),output.to_string()).unwrap();Ok(Value::Null)},_=>Err(AppError::new("UNSUPPORTED_TEST_COMMAND",&input["cmd"]))}}.await;
        let out = match result {
            Ok(value) => json!({"id":input["id"],"value":value}),
            Err(error) => json!({"id":input["id"],"error":error}),
        };
        println!("{out}");
        io::stdout().flush().unwrap();
    }
}
