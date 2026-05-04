-- Reference schema for the TON-Bridge hosting installer.
-- The installer creates these tables automatically with the configured prefix.

CREATE TABLE IF NOT EXISTS tonbridge_settings (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    app_name VARCHAR(128) NOT NULL,
    base_url VARCHAR(512) NOT NULL,
    bot_username VARCHAR(64) NOT NULL,
    changenow_link_id VARCHAR(128) NOT NULL,
    yandex_metrika_id VARCHAR(32) NOT NULL,
    worker_base_url VARCHAR(512) NULL,
    public_config_json LONGTEXT NOT NULL,
    installed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tonbridge_install_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    message VARCHAR(512) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
