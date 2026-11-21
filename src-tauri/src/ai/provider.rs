//! Provider request building and stream-event parsing (pure, no I/O).

use super::AiError;
use super::config::{AiConfig, Provider};
use super::sse::SseEvent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delta {
    Text(String),
    Done,
    Error(String),
}

/// Build the streaming chat request. Anthropic and OpenAI use their fixed
/// URLs (a stored `base_url` is ignored so a key can't be redirected); only
/// `Compatible` uses `base_url`. The key goes in a header and nowhere else.
pub fn build_request(
    c: &AiConfig,
    key: &str,
    system: &str,
    messages: &[Message],
) -> Result<HttpRequest, AiError> {
    let json_header = ("content-type".to_string(), "application/json".to_string());
    match c.provider {
        Provider::Anthropic => Ok(HttpRequest {
            url: "https://api.anthropic.com/v1/messages".into(),
            headers: vec![
                json_header,
                ("x-api-key".into(), key.into()),
                ("anthropic-version".into(), "2023-06-01".into()),
            ],
            body: serde_json::json!({
                "model": c.model,
                "max_tokens": 4096,
                "stream": true,
                "system": system,
                "messages": messages,
            }),
        }),
        Provider::Openai | Provider::Compatible => {
            let url = if c.provider == Provider::Openai {
                "https://api.openai.com/v1/chat/completions".to_string()
            } else {
                let base = c.base_url.as_deref().unwrap_or("").trim();
                if base.is_empty() {
                    return Err(AiError::Invalid("no URL set".into()));
                }
                format!("{}/chat/completions", base.trim_end_matches('/'))
            };
            let mut headers = vec![json_header];
            if !key.is_empty() {
                headers.push(("authorization".into(), format!("Bearer {key}")));
            }
            let mut all = vec![serde_json::json!({"role": "system", "content": system})];
            all.extend(messages.iter().map(|m| serde_json::json!(m)));
            Ok(HttpRequest {
                url,
                headers,
                body: serde_json::json!({
                    "model": c.model,
                    "stream": true,
                    "messages": all,
                }),
            })
        }
    }
}

fn api_error_text(v: &serde_json::Value) -> Option<String> {
    v.get("error")?.get("message")?.as_str().map(str::to_owned)
}

pub fn parse_event(p: Provider, e: &SseEvent) -> Option<Delta> {
    match p {
        Provider::Anthropic => {
            let v: serde_json::Value = serde_json::from_str(&e.data).ok()?;
            let kind = v
                .get("type")
                .and_then(|t| t.as_str())
                .or(e.event.as_deref())?;
            match kind {
                "content_block_delta" => {
                    let d = v.get("delta")?;
                    if d.get("type")?.as_str()? != "text_delta" {
                        return None;
                    }
                    Some(Delta::Text(d.get("text")?.as_str()?.to_owned()))
                }
                "message_stop" => Some(Delta::Done),
                "error" => Some(Delta::Error(
                    api_error_text(&v).unwrap_or_else(|| "stream error".into()),
                )),
                _ => None,
            }
        }
        Provider::Openai | Provider::Compatible => {
            if e.data.trim() == "[DONE]" {
                return Some(Delta::Done);
            }
            let v: serde_json::Value = serde_json::from_str(&e.data).ok()?;
            if let Some(m) = api_error_text(&v) {
                return Some(Delta::Error(m));
            }
            let text = v
                .get("choices")?
                .get(0)?
                .get("delta")?
                .get("content")?
                .as_str()?;
            if text.is_empty() {
                None
            } else {
                Some(Delta::Text(text.to_owned()))
            }
        }
    }
}

/// A one-line message for a failed HTTP response. Uses the provider's own
/// `error.message` when the body has one, else just the status.
pub fn error_message(p: Provider, status: u16, body: &str) -> String {
    let name = match p {
        Provider::Anthropic => "Anthropic",
        Provider::Openai => "OpenAI",
        // The config isn't passed here, so the host can't be named.
        Provider::Compatible => "Endpoint",
    };
    let text = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| api_error_text(&v));
    match text {
        Some(m) => format!("{name}: {m}"),
        None => format!("{name}: HTTP {status}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cfg(provider: Provider, base_url: Option<&str>) -> AiConfig {
        AiConfig {
            provider,
            base_url: base_url.map(str::to_owned),
            model: "m1".into(),
        }
    }

    fn msgs() -> Vec<Message> {
        vec![Message {
            role: Role::User,
            content: "hello".into(),
        }]
    }

    fn header<'a>(r: &'a HttpRequest, name: &str) -> Option<&'a str> {
        r.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    fn ev(event: Option<&str>, data: &str) -> SseEvent {
        SseEvent {
            event: event.map(str::to_owned),
            data: data.into(),
        }
    }

    #[test]
    fn anthropic_request() {
        let r = build_request(&cfg(Provider::Anthropic, None), "k", "sys", &msgs()).unwrap();
        assert_eq!(r.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(header(&r, "x-api-key"), Some("k"));
        assert_eq!(header(&r, "anthropic-version"), Some("2023-06-01"));
        assert_eq!(r.body["system"], "sys");
        assert_eq!(r.body["stream"], true);
        assert_eq!(r.body["max_tokens"], 4096);
        assert_eq!(r.body["model"], "m1");
        assert_eq!(
            r.body["messages"][0],
            json!({"role":"user","content":"hello"})
        );
    }

    #[test]
    fn openai_request_puts_system_first() {
        let r = build_request(&cfg(Provider::Openai, None), "k", "sys", &msgs()).unwrap();
        assert_eq!(r.url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(r.body["messages"][0]["role"], "system");
        assert_eq!(r.body["messages"][0]["content"], "sys");
        assert_eq!(r.body["messages"][1]["role"], "user");
        assert_eq!(r.body["stream"], true);
        assert_eq!(header(&r, "authorization"), Some("Bearer k"));
    }

    #[test]
    fn compatible_no_key_no_auth_header() {
        let c = cfg(Provider::Compatible, Some("http://localhost:11434/v1/"));
        let r = build_request(&c, "", "sys", &msgs()).unwrap();
        assert!(header(&r, "Authorization").is_none());
        assert_eq!(r.url, "http://localhost:11434/v1/chat/completions");
    }

    #[test]
    fn compatible_without_url_is_invalid() {
        for base in [None, Some(""), Some("  ")] {
            let e = build_request(&cfg(Provider::Compatible, base), "", "s", &msgs()).unwrap_err();
            assert!(matches!(e, AiError::Invalid(_)));
        }
    }

    #[test]
    fn non_compatible_ignores_base_url() {
        let a = build_request(
            &cfg(Provider::Anthropic, Some("http://evil")),
            "k",
            "s",
            &msgs(),
        )
        .unwrap();
        assert_eq!(a.url, "https://api.anthropic.com/v1/messages");
        let o = build_request(
            &cfg(Provider::Openai, Some("http://evil")),
            "k",
            "s",
            &msgs(),
        )
        .unwrap();
        assert_eq!(o.url, "https://api.openai.com/v1/chat/completions");
    }

    #[test]
    fn anthropic_deltas() {
        let d = ev(
            Some("content_block_delta"),
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}"#,
        );
        assert_eq!(
            parse_event(Provider::Anthropic, &d),
            Some(Delta::Text("hi".into()))
        );
        let stop = ev(Some("message_stop"), r#"{"type":"message_stop"}"#);
        assert_eq!(parse_event(Provider::Anthropic, &stop), Some(Delta::Done));
        let err = ev(
            Some("error"),
            r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
        );
        assert_eq!(
            parse_event(Provider::Anthropic, &err),
            Some(Delta::Error("Overloaded".into()))
        );
        let ping = ev(Some("ping"), r#"{"type":"ping"}"#);
        assert_eq!(parse_event(Provider::Anthropic, &ping), None);
    }

    #[test]
    fn openai_deltas() {
        let d = ev(None, r#"{"choices":[{"delta":{"content":"hi"}}]}"#);
        assert_eq!(
            parse_event(Provider::Openai, &d),
            Some(Delta::Text("hi".into()))
        );
        assert_eq!(
            parse_event(Provider::Compatible, &ev(None, "[DONE]")),
            Some(Delta::Done)
        );
        let empty = ev(None, r#"{"choices":[{"delta":{"role":"assistant"}}]}"#);
        assert_eq!(parse_event(Provider::Openai, &empty), None);
    }

    #[test]
    fn error_message_uses_provider_text() {
        assert_eq!(
            error_message(
                Provider::Anthropic,
                401,
                r#"{"error":{"message":"invalid x-api-key"}}"#
            ),
            "Anthropic: invalid x-api-key"
        );
        assert_eq!(
            error_message(Provider::Anthropic, 401, "<html>"),
            "Anthropic: HTTP 401"
        );
        assert_eq!(
            error_message(
                Provider::Openai,
                429,
                r#"{"error":{"message":"slow down"}}"#
            ),
            "OpenAI: slow down"
        );
    }
}
