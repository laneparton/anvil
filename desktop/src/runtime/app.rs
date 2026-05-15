use super::types::ReviewSessionStore;
use std::sync::Arc;
#[cfg(feature = "e2e-testing")]
use tauri::ipc::CapabilityBuilder;
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
            super::scm::hydrate_review_inbox_row,
            super::session::start_review_session,
            super::session::cancel_review_session,
            super::session::submit_review_session,
            super::agent::open_review_agent,
            super::external::open_external_url,
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

            #[cfg(feature = "e2e-testing")]
            app.add_capability(
                CapabilityBuilder::new("e2e-playwright")
                    .window("main")
                    .permission("playwright:default"),
            )?;

            Ok(())
        });

    #[cfg(feature = "e2e-testing")]
    let builder = builder.plugin(tauri_plugin_playwright::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running Anvil");
}
