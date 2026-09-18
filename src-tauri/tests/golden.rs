use local_postman_lib::{domain::*, postman};
use serde_json::Value;
fn check(name: &str) {
    let path = format!(
        "{}/../testdata/postman/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let original: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut w = Workspace::default();
    let id = postman::import(original.clone(), &mut w).unwrap();
    let exported = postman::export(&w, &id).unwrap();
    fn subset(expected: &Value, actual: &Value, path: String) {
        match expected {
            Value::Object(o) => {
                for (k, v) in o {
                    subset(v, &actual[k], format!("{path}.{k}"))
                }
            }
            Value::Array(a) => {
                assert_eq!(a.len(), actual.as_array().unwrap().len(), "{path}");
                for (i, v) in a.iter().enumerate() {
                    subset(v, &actual[i], format!("{path}[{i}]"))
                }
            }
            _ => assert_eq!(expected, actual, "{path}"),
        }
    }
    subset(&original, &exported, name.into());
}
macro_rules! golden {
    ($name:ident,$file:literal) => {
        #[test]
        fn $name() {
            check($file)
        }
    };
}
golden!(basic, "basic");
golden!(folder, "folder");
golden!(variables, "variables");
golden!(headers, "headers");
golden!(params, "params");
golden!(json_body, "json-body");
golden!(form_data, "form-data");
golden!(auth, "auth");
golden!(disabled_items, "disabled-items");
golden!(scripts, "scripts");
#[test]
fn edited_auth_exports_to_postman_attributes() {
    let mut w = Workspace::default();
    let original = serde_json::json!({"info":{"name":"Auth","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[{"name":"R","request":{"method":"GET","url":"https://example.com","auth":{"type":"bearer","bearer":[{"key":"token","value":"old"}]}}}]});
    let id = postman::import(original, &mut w).unwrap();
    w.items[0].request.as_mut().unwrap().auth["token"] = serde_json::json!("edited");
    assert_eq!(
        postman::export(&w, &id).unwrap()["item"][0]["request"]["auth"]["bearer"][0]["value"],
        "edited"
    );
}

#[test]
fn local_none_and_inherit_do_not_export_invalid_postman_modes() {
    let mut w = Workspace::default();
    let cid=postman::import(serde_json::json!({"info":{"name":"Empty","schema":"https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},"item":[{"name":"Folder","item":[{"name":"R","request":{"url":"https://example.com","method":"GET"}}]}]}),&mut w).unwrap();
    let exported = postman::export(&w, &cid).unwrap();
    assert!(exported["item"][0].get("auth").is_none());
    assert!(exported["item"][0]["item"][0]["request"]
        .get("auth")
        .is_none());
    assert!(exported["item"][0]["item"][0]["request"]
        .get("body")
        .is_none());
}
