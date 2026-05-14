use super::types::ReviewSessionStore;
use std::sync::Arc;
use tauri::Manager;

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(Arc::new(ReviewSessionStore::default()))
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            super::scm::list_github_repos,
            super::scm::list_github_pull_requests,
            super::scm::list_bitbucket_repos,
            super::scm::list_bitbucket_pull_requests,
            super::scm::list_review_inbox,
            super::session::start_review_session,
            super::session::cancel_review_session,
            super::session::submit_review_session,
            super::agent::open_review_agent,
            super::process::configure_app_settings,
            super::process::load_app_settings,
            super::process::save_app_settings,
            super::process::reset_app_settings
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let labels = app.webview_windows().keys().cloned().collect::<Vec<_>>();
                println!("Anvil webview windows after setup: {labels:?}");
            }

            Ok(())
        });

    #[cfg(feature = "e2e-testing")]
    let builder = builder.plugin(tauri_plugin_playwright::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running Anvil");
}
