//! Fetching the provider's model list for the Model dropdown in Settings.

use super::AiError;
use super::config::Provider;
use super::provider::{HttpRequest, error_message, parse_models};
use std::io::Read;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(15);
const BODY_CAP: u64 = 4 * 1024 * 1024;

/// GETs `req` and returns the model ids. Errors name the provider by
/// `label`; the caller takes the key out of them.
pub fn fetch_models(req: &HttpRequest, p: Provider, label: &str) -> Result<Vec<String>, AiError> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        // As for answers: the key only ever goes to the URL that was set.
        .max_redirects(0)
        .timeout_connect(Some(TIMEOUT))
        .timeout_per_read(Some(TIMEOUT))
        .build()
        .into();
    let mut r = agent.get(&req.url);
    for (k, v) in &req.headers {
        r = r.header(k, v);
    }
    let resp = r
        .call()
        .map_err(|e| AiError::Network(format!("{label}: {e}")))?;
    let status = resp.status().as_u16();
    let mut body = String::new();
    resp.into_body()
        .into_reader()
        .take(BODY_CAP)
        .read_to_string(&mut body)
        .map_err(|e| AiError::Network(format!("{label}: {e}")))?;
    if !(200..300).contains(&status) {
        return Err(AiError::Network(error_message(label, status, &body)));
    }
    parse_models(p, &body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    /// Serves one GET with `response`, and returns the URL to list models at.
    fn serve(response: &'static str) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/models", l.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            loop {
                let mut line = String::new();
                r.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
            }
            let _ = s.write_all(response.as_bytes());
        });
        url
    }

    fn req(url: String) -> HttpRequest {
        HttpRequest {
            url,
            headers: vec![("authorization".into(), "Bearer sk-secret".into())],
            body: serde_json::Value::Null,
        }
    }

    #[test]
    fn lists_models() {
        let url = serve(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nconnection: close\r\n\r\n\
             {\"data\":[{\"id\":\"qwen3:8b\"},{\"id\":\"llama3.2\"}]}",
        );
        let ids = fetch_models(&req(url), Provider::Compatible, "localhost").unwrap();
        assert_eq!(ids, vec!["llama3.2", "qwen3:8b"]);
    }

    #[test]
    fn http_error_uses_provider_text() {
        let url = serve(
            "HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n\
             {\"error\":{\"message\":\"invalid x-api-key\"}}",
        );
        let e = fetch_models(&req(url), Provider::Anthropic, "Anthropic").unwrap_err();
        assert_eq!(e.to_string(), "Anthropic: invalid x-api-key");
    }

    #[test]
    fn redirect_is_not_followed() {
        let url =
            serve("HTTP/1.1 302 Found\r\nlocation: http://evil/\r\nconnection: close\r\n\r\n");
        let e = fetch_models(&req(url), Provider::Openai, "OpenAI").unwrap_err();
        assert_eq!(e.to_string(), "OpenAI: HTTP 302");
    }

    #[test]
    fn refused_connection_is_an_error() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/models", l.local_addr().unwrap());
        drop(l);
        let e = fetch_models(&req(url), Provider::Compatible, "localhost").unwrap_err();
        assert!(matches!(e, AiError::Network(_)));
        assert!(e.to_string().starts_with("localhost: "));
    }
}
