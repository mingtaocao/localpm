use crate::{domain::*, variables};
use serde_json::Value;
pub fn redact_value(value: &mut Value, vars: &Variables) {
    match value {
        Value::String(s) => *s = variables::redact(s, vars),
        Value::Array(a) => {
            for v in a {
                redact_value(v, vars)
            }
        }
        Value::Object(o) => {
            for (k, v) in o {
                if [
                    "password",
                    "token",
                    "authorization",
                    "cookie",
                    "proxy-authorization",
                ]
                .contains(&k.to_lowercase().as_str())
                {
                    *v = Value::String("[redacted]".into())
                } else {
                    redact_value(v, vars)
                }
            }
        }
        _ => {}
    }
}
pub fn history_snapshot(request: &RequestSpec, vars: &Variables) -> RequestSpec {
    let mut r = request.clone();
    r.metadata = Value::Null;
    r.auth = serde_json::json!({"type":request.auth["type"],"redacted":true});
    for h in &mut r.headers {
        if ["authorization", "cookie", "proxy-authorization"]
            .contains(&h.key.to_lowercase().as_str())
        {
            h.value = "[redacted]".into()
        }
    }
    let mut v = serde_json::to_value(&r).unwrap();
    redact_value(&mut v, vars);
    serde_json::from_value(v).unwrap()
}
pub fn response_preview(body: &str, vars: &Variables) -> String {
    let mut output = if let Ok(mut value) = serde_json::from_str::<Value>(body) {
        redact_value(&mut value, vars);
        value.to_string()
    } else {
        variables::redact(body, vars)
    };
    let mut end = output.len().min(65536);
    while !output.is_char_boundary(end) {
        end -= 1
    }
    output.truncate(end);
    output
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn escaped_secrets_do_not_leak() {
        let secret = "a\"b\\c";
        let vars = [(
            "s".into(),
            VariableValue {
                value: secret.into(),
                scope: "Global".into(),
                secret: true,
            },
        )]
        .into();
        let r = RequestSpec {
            url: format!("https://host/{secret}"),
            body: serde_json::json!({"mode":"raw","raw":secret}),
            ..Default::default()
        };
        let out = history_snapshot(&r, &vars);
        assert!(!out.url.contains(secret));
        assert_eq!(out.body["raw"], "••••••••");
    }
    #[test]
    fn proxy_password_and_auth_redacted() {
        let r = RequestSpec {
            settings: serde_json::json!({"proxy":{"password":"sensitive"}}),
            auth: serde_json::json!({"type":"basic","password":"sensitive"}),
            ..Default::default()
        };
        let out = serde_json::to_string(&history_snapshot(&r, &Variables::new())).unwrap();
        assert!(!out.contains("sensitive"));
    }
}
