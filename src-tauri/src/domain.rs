use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppError { pub code: String, pub message: String }
impl AppError { pub fn new(code: &str, message: impl ToString) -> Self { Self {code:code.into(),message:message.to_string()} } }
pub type Result<T> = std::result::Result<T, AppError>;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase")]
pub struct Pair {pub key:String,pub value:String,pub enabled:bool,pub description:String,pub kind:String,pub secret_ref:Option<String>, pub is_secret:bool}
impl Default for Pair {fn default()->Self{Self{key:String::new(),value:String::new(),enabled:true,description:String::new(),kind:"text".into(),secret_ref:None,is_secret:false}}}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase")]
pub struct RequestSpec {pub id:String,pub name:String,pub method:String,pub url:String,pub params:Vec<Pair>,pub headers:Vec<Pair>,pub auth:Value,pub body:Value,pub settings:Value,pub metadata:Value}
impl Default for RequestSpec {fn default()->Self{Self{id:uuid::Uuid::new_v4().to_string(),name:"Untitled request".into(),method:"GET".into(),url:String::new(),params:vec![],headers:vec![],auth:json!({"type":"inherit"}),body:json!({"mode":"none"}),settings:json!({}),metadata:Value::Null}}}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Item {pub id:String,pub collection_id:String,pub parent_id:Option<String>,pub kind:String,pub name:String,pub order:f64,pub auth:Value,pub request:Option<RequestSpec>,pub metadata:Value}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Collection {pub id:String,pub name:String,pub auth:Value,pub variables:Vec<Pair>,pub metadata:Value}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Environment {pub id:String,pub name:String,pub variables:Vec<Pair>,pub settings:Value,pub metadata:Value}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase")]
pub struct Workspace {pub collections:Vec<Collection>,pub items:Vec<Item>,pub environments:Vec<Environment>,pub globals:Vec<Pair>,pub settings:Value,pub active_environment:Option<String>}
impl Default for Workspace {fn default()->Self {Self{collections:vec![],items:vec![],environments:vec![],globals:vec![],settings:json!({"timeout":30000,"verifyTls":true,"followRedirect":true,"proxy":{"mode":"off"},"historyLimit":1000}),active_environment:None}}}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Response {pub status:u16,pub status_text:String,pub headers:Vec<(String,String)>,pub body:String,pub duration:u128,pub size:usize,pub content_type:String,pub final_url:String,pub redirects:Vec<String>,pub file:String,pub truncated:bool,pub binary:bool}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableValue {pub value:String,pub scope:String,pub secret:bool}
pub type Variables = BTreeMap<String,VariableValue>;
