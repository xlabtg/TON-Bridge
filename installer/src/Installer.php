<?php
declare(strict_types=1);

const TONBRIDGE_INSTALLER_VERSION = '1.0.0';

function tonbridge_installer_default_input(): array
{
    return [
        'app_name' => 'TON Bridge',
        'base_url' => '',
        'telegram_bot_username' => '',
        'telegram_mini_app_short_name' => 'app',
        'telegram_bot_token' => '',
        'support_bot_username' => '',
        'admin_telegram_ids' => '',
        'tg_analytics_token' => '',
        'tg_analytics_app_name' => '',
        'yandex_metrika_id' => '',
        'changenow_link_id' => '',
        'changenow_api_key' => '',
        'worker_base_url' => '',
        'sentry_dsn' => '',
        'sentry_environment' => 'production',
        'sentry_traces_sample_rate' => '0.1',
        'mysql_host' => '127.0.0.1',
        'mysql_port' => '3306',
        'mysql_database' => '',
        'mysql_username' => '',
        'mysql_password' => '',
        'mysql_charset' => 'utf8mb4',
        'mysql_table_prefix' => 'tonbridge_',
        'mysql_create_schema' => '1',
        'icon_url' => '',
    ];
}

function tonbridge_installer_environment_checks(string $rootDir): array
{
    $rootDir = rtrim($rootDir, DIRECTORY_SEPARATOR);

    return [
        [
            'label' => 'PHP 8.1+',
            'ok' => version_compare(PHP_VERSION, '8.1.0', '>='),
            'detail' => PHP_VERSION,
            'required' => true,
        ],
        [
            'label' => 'PDO extension',
            'ok' => extension_loaded('pdo'),
            'detail' => extension_loaded('pdo') ? 'available' : 'missing',
            'required' => true,
        ],
        [
            'label' => 'PDO MySQL driver',
            'ok' => extension_loaded('pdo_mysql'),
            'detail' => extension_loaded('pdo_mysql') ? 'available' : 'missing',
            'required' => true,
        ],
        [
            'label' => 'OpenSSL extension',
            'ok' => extension_loaded('openssl'),
            'detail' => extension_loaded('openssl') ? 'available' : 'missing',
            'required' => true,
        ],
        [
            'label' => 'JSON extension',
            'ok' => extension_loaded('json'),
            'detail' => extension_loaded('json') ? 'available' : 'missing',
            'required' => true,
        ],
        [
            'label' => 'Project root writable',
            'ok' => is_writable($rootDir),
            'detail' => $rootDir,
            'required' => true,
        ],
        [
            'label' => 'assets/js writable',
            'ok' => is_dir($rootDir . '/assets/js') && is_writable($rootDir . '/assets/js'),
            'detail' => $rootDir . '/assets/js',
            'required' => true,
        ],
        [
            'label' => 'config directory writable',
            'ok' => is_dir($rootDir . '/config') ? is_writable($rootDir . '/config') : is_writable($rootDir),
            'detail' => $rootDir . '/config',
            'required' => true,
        ],
    ];
}

function tonbridge_installer_requirements_pass(string $rootDir): bool
{
    foreach (tonbridge_installer_environment_checks($rootDir) as $check) {
        if ($check['required'] && !$check['ok']) {
            return false;
        }
    }

    return true;
}

function tonbridge_installer_normalize_input(array $input): array
{
    $defaults = tonbridge_installer_default_input();
    $merged = array_merge($defaults, $input);
    $normalized = [];

    foreach ($defaults as $key => $default) {
        $value = $merged[$key] ?? $default;
        $normalized[$key] = is_string($value) ? trim($value) : $value;
    }

    $normalized['base_url'] = rtrim((string) $normalized['base_url'], '/');
    $normalized['worker_base_url'] = rtrim((string) $normalized['worker_base_url'], '/');
    $normalized['mysql_port'] = (string) (int) $normalized['mysql_port'];
    $normalized['mysql_create_schema'] = !empty($merged['mysql_create_schema']) ? '1' : '0';
    $normalized['admin_telegram_ids'] = tonbridge_installer_normalize_admin_ids((string) $normalized['admin_telegram_ids']);
    $normalized['changenow_link_id'] = tonbridge_installer_normalize_changenow_link_id((string) $normalized['changenow_link_id']);

    return $normalized;
}

function tonbridge_installer_normalize_changenow_link_id(string $value): string
{
    $value = trim($value);
    if ($value === '') {
        return '';
    }

    $query = null;
    $parts = parse_url($value);
    if (is_array($parts) && isset($parts['query'])) {
        $query = $parts['query'];
    } elseif (str_starts_with($value, '?')) {
        $query = ltrim($value, '?');
    } elseif (str_starts_with($value, 'link_id=')) {
        $query = $value;
    }

    if ($query !== null) {
        parse_str($query, $params);
        if (isset($params['link_id']) && is_scalar($params['link_id'])) {
            return trim((string) $params['link_id']);
        }
    }

    return $value;
}

function tonbridge_installer_validate(array $input, bool $testDatabase = true): array
{
    $config = tonbridge_installer_normalize_input($input);
    $errors = [];

    if ($config['app_name'] === '' || tonbridge_installer_strlen($config['app_name']) > 80) {
        $errors['app_name'] = 'Enter an application name up to 80 characters.';
    }

    if (!tonbridge_installer_is_https_url($config['base_url'])) {
        $errors['base_url'] = 'Enter the public HTTPS URL where the mini app will be hosted.';
    }

    if (!tonbridge_installer_is_bot_username($config['telegram_bot_username'])) {
        $errors['telegram_bot_username'] = 'Use a Telegram bot username without @, 5-32 characters.';
    }

    if (!preg_match('/^[A-Za-z0-9_]{1,64}$/', $config['telegram_mini_app_short_name'])) {
        $errors['telegram_mini_app_short_name'] = 'Use only letters, numbers, and underscores.';
    }

    if ($config['support_bot_username'] !== '' && !tonbridge_installer_is_bot_username($config['support_bot_username'])) {
        $errors['support_bot_username'] = 'Use a Telegram bot username without @, 5-32 characters.';
    }

    if ($config['admin_telegram_ids'] !== '' && !preg_match('/^\d+(,\d+)*$/', $config['admin_telegram_ids'])) {
        $errors['admin_telegram_ids'] = 'Use comma-separated numeric Telegram user IDs.';
    }

    if ($config['tg_analytics_token'] === '' || preg_match('/[\s\'"<>]/', $config['tg_analytics_token'])) {
        $errors['tg_analytics_token'] = 'Enter the Telegram Analytics token issued for this app.';
    }

    if ($config['tg_analytics_app_name'] === '' || preg_match('/[\s\'"<>]/', $config['tg_analytics_app_name'])) {
        $errors['tg_analytics_app_name'] = 'Enter the Telegram Analytics app name.';
    }

    if (!preg_match('/^\d+$/', $config['yandex_metrika_id'])) {
        $errors['yandex_metrika_id'] = 'Enter a numeric Yandex.Metrika counter ID.';
    }

    if (!preg_match('/^[A-Za-z0-9_-]{3,128}$/', $config['changenow_link_id'])) {
        $errors['changenow_link_id'] = 'Enter the ChangeNOW partner link_id.';
    }

    if ($config['worker_base_url'] !== '' && !tonbridge_installer_is_http_url($config['worker_base_url'])) {
        $errors['worker_base_url'] = 'Enter a valid Worker/backend URL, or leave it blank.';
    }

    if ($config['sentry_dsn'] !== '' && !tonbridge_installer_is_http_url($config['sentry_dsn'])) {
        $errors['sentry_dsn'] = 'Enter a valid Sentry DSN URL, or leave it blank.';
    }

    if ($config['sentry_traces_sample_rate'] !== '' && !tonbridge_installer_is_rate($config['sentry_traces_sample_rate'])) {
        $errors['sentry_traces_sample_rate'] = 'Use a number between 0 and 1.';
    }

    if ($config['mysql_host'] === '') {
        $errors['mysql_host'] = 'Enter the MySQL host.';
    }

    $port = (int) $config['mysql_port'];
    if ($port < 1 || $port > 65535) {
        $errors['mysql_port'] = 'Enter a valid TCP port.';
    }

    if (!preg_match('/^[A-Za-z0-9_$.-]{1,128}$/', $config['mysql_database'])) {
        $errors['mysql_database'] = 'Enter the MySQL database name.';
    }

    if ($config['mysql_username'] === '') {
        $errors['mysql_username'] = 'Enter the MySQL username.';
    }

    if (!in_array($config['mysql_charset'], ['utf8mb4', 'utf8'], true)) {
        $errors['mysql_charset'] = 'Use utf8mb4 or utf8.';
    }

    if (!preg_match('/^[A-Za-z][A-Za-z0-9_]{0,31}$/', $config['mysql_table_prefix'])) {
        $errors['mysql_table_prefix'] = 'Start with a letter and use only letters, numbers, and underscores.';
    }

    if ($config['icon_url'] !== '' && !tonbridge_installer_is_https_url($config['icon_url'])) {
        $errors['icon_url'] = 'Enter an HTTPS icon URL, or leave it blank.';
    }

    if ($errors === [] && $testDatabase) {
        $dbError = tonbridge_installer_test_database($config);
        if ($dbError !== null) {
            $errors['database_connection'] = $dbError;
        }
    }

    return $errors === [] ? [$config, []] : [[], $errors];
}

function tonbridge_installer_install(array $config, string $rootDir): array
{
    $rootDir = rtrim($rootDir, DIRECTORY_SEPARATOR);
    $written = [];
    $backups = [];
    $timestamp = gmdate('Ymd-His');

    tonbridge_installer_ensure_directory($rootDir . '/config');
    tonbridge_installer_ensure_directory($rootDir . '/assets/js');

    $targets = [
        '.env' => tonbridge_installer_build_env($config),
        'config/tonbridge.php' => tonbridge_installer_build_php_config($config),
        'assets/js/tonbridge-config.js' => tonbridge_installer_build_browser_config($config),
        'tonconnect-manifest.json' => tonbridge_installer_build_tonconnect_manifest($config),
    ];

    foreach ($targets as $relative => $contents) {
        $absolute = $rootDir . '/' . $relative;
        $backup = tonbridge_installer_backup_file($absolute, $timestamp);
        if ($backup !== null) {
            $backups[] = tonbridge_installer_relative_path($rootDir, $backup);
        }
        tonbridge_installer_write_file($absolute, $contents);
        $written[] = $relative;
    }

    foreach (tonbridge_installer_apply_static_config($rootDir, $config) as $relative) {
        $written[] = $relative;
    }

    [$serviceWorkerFiles, $serviceWorkerBackups] = tonbridge_installer_refresh_service_workers($rootDir, $config, $timestamp);
    foreach ($serviceWorkerFiles as $relative) {
        $written[] = $relative;
    }
    foreach ($serviceWorkerBackups as $relative) {
        $backups[] = $relative;
    }

    if ($config['mysql_create_schema'] === '1') {
        tonbridge_installer_create_mysql_schema($config);
    }

    $lockPath = __DIR__ . '/../.installed';
    tonbridge_installer_write_file($lockPath, json_encode([
        'installed_at' => gmdate('c'),
        'version' => TONBRIDGE_INSTALLER_VERSION,
        'base_url' => $config['base_url'],
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");

    $written[] = 'installer/.installed';

    $written = array_values(array_unique($written));
    sort($written);
    sort($backups);

    return [$written, $backups];
}

function tonbridge_installer_backup_file(string $absolute, string $timestamp): ?string
{
    if (!is_file($absolute)) {
        return null;
    }

    $backupPath = $absolute . '.bak-' . $timestamp;
    if (!copy($absolute, $backupPath)) {
        throw new RuntimeException("Unable to back up file: {$absolute}");
    }
    @chmod($backupPath, 0640);

    return $backupPath;
}

function tonbridge_installer_build_env(array $config): string
{
    $lines = [
        '# Generated by TON-Bridge installer.',
        '# Do not commit this file.',
        'BASE_URL' => $config['base_url'],
        'TG_ANALYTICS_TOKEN' => $config['tg_analytics_token'],
        'TG_ANALYTICS_APP_NAME' => $config['tg_analytics_app_name'],
        'YANDEX_METRIKA_ID' => $config['yandex_metrika_id'],
        'CHANGENOW_LINK_ID' => $config['changenow_link_id'],
        'BOT_USERNAME' => $config['telegram_bot_username'],
        'ADMIN_TELEGRAM_IDS' => $config['admin_telegram_ids'],
        'SUPPORT_BOT_USERNAME' => $config['support_bot_username'],
        'TELEGRAM_MINI_APP_SHORT_NAME' => $config['telegram_mini_app_short_name'],
        'TELEGRAM_BOT_TOKEN' => $config['telegram_bot_token'] ?? '',
        'CHANGENOW_API_KEY' => $config['changenow_api_key'],
        'WORKER_BASE_URL' => $config['worker_base_url'],
        'SENTRY_DSN' => $config['sentry_dsn'],
        'SENTRY_ENVIRONMENT' => $config['sentry_environment'],
        'SENTRY_TRACES_SAMPLE_RATE' => $config['sentry_traces_sample_rate'],
        'DB_HOST' => $config['mysql_host'],
        'DB_PORT' => $config['mysql_port'],
        'DB_DATABASE' => $config['mysql_database'],
        'DB_USERNAME' => $config['mysql_username'],
        'DB_PASSWORD' => $config['mysql_password'],
        'DB_CHARSET' => $config['mysql_charset'],
        'DB_TABLE_PREFIX' => $config['mysql_table_prefix'],
    ];

    $out = [];
    foreach ($lines as $key => $value) {
        if (is_int($key)) {
            $out[] = (string) $value;
            continue;
        }
        $out[] = $key . '=' . tonbridge_installer_env_value((string) $value);
    }

    return implode("\n", $out) . "\n";
}

function tonbridge_installer_build_php_config(array $config): string
{
    $serverConfig = [
        'app' => [
            'name' => $config['app_name'],
            'base_url' => $config['base_url'],
            'icon_url' => $config['icon_url'],
        ],
        'telegram' => [
            'bot_username' => $config['telegram_bot_username'],
            'mini_app_short_name' => $config['telegram_mini_app_short_name'],
            'bot_token' => $config['telegram_bot_token'] ?? '',
            'support_bot_username' => $config['support_bot_username'],
            'admin_telegram_ids' => $config['admin_telegram_ids'],
        ],
        'analytics' => [
            'telegram_token' => $config['tg_analytics_token'],
            'telegram_app_name' => $config['tg_analytics_app_name'],
            'yandex_metrika_id' => $config['yandex_metrika_id'],
            'sentry_dsn' => $config['sentry_dsn'],
            'sentry_environment' => $config['sentry_environment'],
            'sentry_traces_sample_rate' => $config['sentry_traces_sample_rate'],
        ],
        'changenow' => [
            'link_id' => $config['changenow_link_id'],
            'api_key' => $config['changenow_api_key'],
        ],
        'backend' => [
            'worker_base_url' => $config['worker_base_url'],
        ],
        'database' => [
            'host' => $config['mysql_host'],
            'port' => (int) $config['mysql_port'],
            'database' => $config['mysql_database'],
            'username' => $config['mysql_username'],
            'password' => $config['mysql_password'],
            'charset' => $config['mysql_charset'],
            'table_prefix' => $config['mysql_table_prefix'],
        ],
        'generated_at' => gmdate('c'),
    ];

    return "<?php\n"
        . "declare(strict_types=1);\n\n"
        . "return " . var_export($serverConfig, true) . ";\n";
}

function tonbridge_installer_build_browser_config(array $config): string
{
    return "window.__TON_BRIDGE_CONFIG__ = Object.freeze("
        . json_encode(tonbridge_installer_public_config($config), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        . ");\n";
}

function tonbridge_installer_public_config(array $config): array
{
    return [
        'appName' => $config['app_name'],
        'baseUrl' => $config['base_url'],
        'iconUrl' => $config['icon_url'],
        'botUsername' => $config['telegram_bot_username'],
        'miniAppShortName' => $config['telegram_mini_app_short_name'],
        'supportBotUsername' => $config['support_bot_username'],
        'tgAnalyticsToken' => $config['tg_analytics_token'],
        'tgAnalyticsAppName' => $config['tg_analytics_app_name'],
        'yandexMetrikaId' => $config['yandex_metrika_id'],
        'changeNowLinkId' => $config['changenow_link_id'],
        'changeNowStatsUrl' => 'https://api.changenow.io/v1/info/stats?link_id=' . rawurlencode($config['changenow_link_id']),
        'workerBaseUrl' => $config['worker_base_url'],
        'adminTelegramIds' => $config['admin_telegram_ids'] === ''
            ? []
            : explode(',', $config['admin_telegram_ids']),
        'sentryDsn' => $config['sentry_dsn'],
        'sentryEnvironment' => $config['sentry_environment'],
        'sentryTracesSampleRate' => $config['sentry_traces_sample_rate'],
        'tonConnectManifestUrl' => rtrim($config['base_url'], '/') . '/tonconnect-manifest.json',
    ];
}

function tonbridge_installer_build_tonconnect_manifest(array $config): string
{
    $manifest = [
        'url' => $config['base_url'],
        'name' => $config['app_name'],
        'iconUrl' => $config['icon_url'] !== '' ? $config['icon_url'] : rtrim($config['base_url'], '/') . '/assets/img/icon/512x512.png',
    ];

    return json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
}

function tonbridge_installer_apply_static_config(string $rootDir, array $config): array
{
    $rootDir = rtrim($rootDir, DIRECTORY_SEPARATOR);
    $files = [];

    foreach (['/*.html', '/*/*.html', '/dist/*.html', '/dist/*/*.html', '/assets/js/*.js', '/dist/assets/js/*.js'] as $pattern) {
        foreach (glob($rootDir . $pattern) ?: [] as $file) {
            if (is_file($file) && basename($file) !== 'tonbridge-config.js') {
                $files[] = $file;
            }
        }
    }

    $replacements = tonbridge_installer_static_replacements($config);
    $changed = [];

    foreach (array_values(array_unique($files)) as $file) {
        $source = file_get_contents($file);
        if ($source === false) {
            continue;
        }

        $updated = str_replace(array_keys($replacements), array_values($replacements), $source);
        $updated = preg_replace('/link_id=00000000000000\b/', 'link_id=' . rawurlencode($config['changenow_link_id']), $updated);

        if ($updated !== $source) {
            tonbridge_installer_write_file($file, $updated);
            $changed[] = tonbridge_installer_relative_path($rootDir, $file);
        }
    }

    return $changed;
}

function tonbridge_installer_refresh_service_workers(string $rootDir, array $config, ?string $timestamp = null): array
{
    $rootDir = rtrim($rootDir, DIRECTORY_SEPARATOR);
    $timestamp = $timestamp ?? gmdate('Ymd-His');
    $version = tonbridge_installer_service_worker_version($config, $timestamp);
    $targets = [$rootDir . '/__service-worker.js'];

    if (is_file($rootDir . '/dist/__service-worker.js')) {
        $targets[] = $rootDir . '/dist/__service-worker.js';
    }

    $written = [];
    $backups = [];

    foreach (array_values(array_unique($targets)) as $path) {
        if (!is_file($path)) {
            continue;
        }

        $source = file_get_contents($path);
        if ($source === false) {
            throw new RuntimeException("Unable to read service worker: {$path}");
        }

        $updated = tonbridge_installer_stamp_service_worker(
            $source,
            $version,
            tonbridge_installer_precache_urls(dirname($path))
        );

        if ($updated === $source) {
            continue;
        }

        $backup = tonbridge_installer_backup_file($path, $timestamp);
        if ($backup !== null) {
            $backups[] = tonbridge_installer_relative_path($rootDir, $backup);
        }
        tonbridge_installer_write_file($path, $updated);
        $written[] = tonbridge_installer_relative_path($rootDir, $path);
    }

    $written = array_values(array_unique($written));
    $backups = array_values(array_unique($backups));
    sort($written);
    sort($backups);

    return [$written, $backups];
}

function tonbridge_installer_service_worker_version(array $config, string $timestamp): string
{
    $safeTimestamp = preg_replace('/[^A-Za-z0-9_-]/', '-', $timestamp) ?: gmdate('Ymd-His');
    $hash = substr(hash('sha256', implode('|', [
        $timestamp,
        $config['base_url'] ?? '',
        $config['app_name'] ?? '',
        $config['changenow_link_id'] ?? '',
    ])), 0, 12);

    return 'installer-' . $safeTimestamp . '-' . $hash;
}

function tonbridge_installer_stamp_service_worker(string $source, string $version, array $precacheUrls): string
{
    $versionJson = json_encode($version, JSON_UNESCAPED_SLASHES);
    $precacheJson = json_encode(array_values($precacheUrls), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

    if (!is_string($versionJson) || !is_string($precacheJson)) {
        throw new RuntimeException('Unable to encode service worker cache metadata.');
    }

    $updated = preg_replace_callback(
        '/var SW_VERSION = [^;]+;/',
        static fn(array $matches) => "var SW_VERSION = {$versionJson};",
        $source,
        1,
        $versionCount
    );
    if (!is_string($updated) || $versionCount !== 1) {
        throw new RuntimeException('Unable to update service worker cache version marker.');
    }

    $updated = preg_replace_callback(
        '/var PRECACHE_URLS = (?:\[[\s\S]*?\]|self\.__PRECACHE_URLS\s*\|\|\s*\[\]);/',
        static fn(array $matches) => "var PRECACHE_URLS = {$precacheJson};",
        $updated,
        1,
        $precacheCount
    );
    if (!is_string($updated) || $precacheCount !== 1) {
        throw new RuntimeException('Unable to update service worker precache marker.');
    }

    return $updated;
}

function tonbridge_installer_precache_urls(string $baseDir): array
{
    $baseDir = rtrim($baseDir, DIRECTORY_SEPARATOR);
    if (!is_dir($baseDir)) {
        return [];
    }

    $urls = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($baseDir, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if (!$file instanceof SplFileInfo || !$file->isFile()) {
            continue;
        }

        $path = $file->getPathname();
        $relative = str_replace(DIRECTORY_SEPARATOR, '/', substr($path, strlen($baseDir) + 1));
        if (
            tonbridge_installer_should_skip_precache_path($relative)
            || !tonbridge_installer_should_precache_url($relative)
        ) {
            continue;
        }

        $urls[] = $relative;
    }

    $urls = array_values(array_unique($urls));
    sort($urls);

    return $urls;
}

function tonbridge_installer_should_skip_precache_path(string $url): bool
{
    $firstSegment = explode('/', $url, 2)[0] ?? '';
    if (in_array($firstSegment, [
        'config',
        'dist',
        'docs',
        'installer',
        'lhci',
        'node_modules',
        'schema',
        'scripts',
        'src',
        'tests',
        'worker',
        'workers',
    ], true)) {
        return true;
    }

    foreach (explode('/', $url) as $segment) {
        if ($segment === '' || str_starts_with($segment, '.')) {
            return true;
        }
    }

    return $url === '__service-worker.js'
        || str_contains($url, '.bak-')
        || str_ends_with($url, '.tmp');
}

function tonbridge_installer_should_precache_url(string $url): bool
{
    if ($url === '__manifest.json') {
        return true;
    }

    return str_ends_with($url, '.html')
        || (bool) preg_match('/^assets\/css\/.+\.css$/', $url)
        || (bool) preg_match('/^assets\/js\/.+\.js$/', $url)
        || (bool) preg_match('/^assets\/img\/.+\.(png|jpe?g|svg|webp|ico)$/i', $url)
        || (bool) preg_match('/^assets\/fonts\/.+\.(woff2?|ttf|otf)$/i', $url);
}

function tonbridge_installer_static_replacements(array $config): array
{
    $safeAnalyticsToken = tonbridge_installer_js_single_quote_value($config['tg_analytics_token']);
    $safeAnalyticsApp = tonbridge_installer_js_single_quote_value($config['tg_analytics_app_name']);
    $workerUrl = $config['worker_base_url'] !== '' ? $config['worker_base_url'] : 'https://bridge-worker.tonbankcard.workers.dev';
    $botUsername = $config['telegram_bot_username'];

    return [
        // Double-percent placeholders written by eleventy build into source JS.
        '%%TG_ANALYTICS_TOKEN%%' => $safeAnalyticsToken,
        '%%TG_ANALYTICS_APP_NAME%%' => $safeAnalyticsApp,
        '%%YANDEX_METRIKA_ID%%' => $config['yandex_metrika_id'],
        // Generic .env.example placeholder values baked into the pre-built HTML/JS
        // distribution that ships in the repository.
        'your-tganalytics-jwt-here' => $safeAnalyticsToken,
        'your-analytics-app-name' => $safeAnalyticsApp,
        'your-yandex-metrika-id-here' => $config['yandex_metrika_id'],
        'your-changenow-link-id-here' => $config['changenow_link_id'],
        'your-bot-username' => $botUsername,
        '__ADMIN_TELEGRAM_IDS__' => $config['admin_telegram_ids'],
        // Legacy hardcoded values that may appear in older distributions.
        'TONBridge_robot' => $botUsername,
        '98019798' => $config['yandex_metrika_id'],
        '3cc0024a18fd9d' => $config['changenow_link_id'],
        'https://bridge-worker.tonbankcard.workers.dev' => $workerUrl,
        'https://ton-bridge-worker.tonbankcard.workers.dev' => $workerUrl,
        'eyJhcHBfbmFtZSI6IlRPTkJyaWRnZV9yb2JvdCIsImFwcF91cmwiOiJodHRwczovL3QubWUvVE9OQnJpZGdlX3JvYm90IiwiYXBwX2RvbWFpbiI6Imh0dHBzOi8vdG9uYmFua2NhcmQuY29tL2JyaWRnZS9UTUEvMDAuaHRtbCJ9!PQ40y7Tz3lZti6uDVlApq+BcGxi8tR9WEsH6Hyu+mD0=' => $safeAnalyticsToken,
    ];
}

function tonbridge_installer_test_database(array $config): ?string
{
    if (!extension_loaded('pdo_mysql')) {
        return 'The pdo_mysql extension is not enabled on this hosting account.';
    }

    try {
        $pdo = tonbridge_installer_database_connection($config);
        $pdo->query('SELECT 1');
        return null;
    } catch (Throwable $e) {
        return $e->getMessage();
    }
}

function tonbridge_installer_create_mysql_schema(array $config): void
{
    $pdo = tonbridge_installer_database_connection($config);
    $settingsTable = tonbridge_installer_mysql_identifier($config['mysql_table_prefix'] . 'settings');
    $logTable = tonbridge_installer_mysql_identifier($config['mysql_table_prefix'] . 'install_log');

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS {$settingsTable} (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS {$logTable} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            event_type VARCHAR(64) NOT NULL,
            message VARCHAR(512) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $stmt = $pdo->prepare("
        INSERT INTO {$settingsTable}
            (id, app_name, base_url, bot_username, changenow_link_id, yandex_metrika_id, worker_base_url, public_config_json)
        VALUES
            (1, :app_name, :base_url, :bot_username, :changenow_link_id, :yandex_metrika_id, :worker_base_url, :public_config_json)
        ON DUPLICATE KEY UPDATE
            app_name = VALUES(app_name),
            base_url = VALUES(base_url),
            bot_username = VALUES(bot_username),
            changenow_link_id = VALUES(changenow_link_id),
            yandex_metrika_id = VALUES(yandex_metrika_id),
            worker_base_url = VALUES(worker_base_url),
            public_config_json = VALUES(public_config_json)
    ");

    $stmt->execute([
        ':app_name' => $config['app_name'],
        ':base_url' => $config['base_url'],
        ':bot_username' => $config['telegram_bot_username'],
        ':changenow_link_id' => $config['changenow_link_id'],
        ':yandex_metrika_id' => $config['yandex_metrika_id'],
        ':worker_base_url' => $config['worker_base_url'],
        ':public_config_json' => json_encode(tonbridge_installer_public_config($config), JSON_UNESCAPED_SLASHES),
    ]);

    $log = $pdo->prepare("INSERT INTO {$logTable} (event_type, message) VALUES (:event_type, :message)");
    $log->execute([
        ':event_type' => 'installer_completed',
        ':message' => 'TON-Bridge installer completed successfully.',
    ]);
}

function tonbridge_installer_database_connection(array $config): PDO
{
    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        $config['mysql_host'],
        (int) $config['mysql_port'],
        $config['mysql_database'],
        $config['mysql_charset']
    );

    return new PDO($dsn, $config['mysql_username'], $config['mysql_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function tonbridge_installer_ensure_directory(string $path): void
{
    if (!is_dir($path) && !mkdir($path, 0775, true) && !is_dir($path)) {
        throw new RuntimeException("Unable to create directory: {$path}");
    }
}

function tonbridge_installer_write_file(string $path, string $contents): void
{
    $tmp = $path . '.tmp';
    if (file_put_contents($tmp, $contents, LOCK_EX) === false) {
        throw new RuntimeException("Unable to write temporary file: {$tmp}");
    }
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException("Unable to replace file: {$path}");
    }
    $private = str_ends_with($path, '.env')
        || str_ends_with($path, 'tonbridge.php')
        || str_ends_with($path, '.installed');
    @chmod($path, $private ? 0640 : 0664);
}

function tonbridge_installer_env_value(string $value): string
{
    if ($value === '') {
        return '';
    }

    if (preg_match('/^[A-Za-z0-9_@.\/:+=,!?#%&-]+$/', $value)) {
        return $value;
    }

    return '"' . str_replace(['\\', '"', "\r", "\n"], ['\\\\', '\\"', '\\r', '\\n'], $value) . '"';
}

function tonbridge_installer_js_single_quote_value(string $value): string
{
    return str_replace(
        ["\\", "'", "\r", "\n", '</'],
        ["\\\\", "\\'", '\\r', '\\n', '<\\/'],
        $value
    );
}

function tonbridge_installer_is_http_url(string $value): bool
{
    if ($value === '') {
        return false;
    }

    $parts = parse_url($value);
    if (!is_array($parts)) {
        return false;
    }

    return isset($parts['scheme'], $parts['host'])
        && in_array(strtolower($parts['scheme']), ['http', 'https'], true);
}

function tonbridge_installer_is_https_url(string $value): bool
{
    $parts = parse_url($value);
    if (!is_array($parts)) {
        return false;
    }

    return isset($parts['scheme'], $parts['host'])
        && strtolower($parts['scheme']) === 'https';
}

function tonbridge_installer_is_bot_username(string $value): bool
{
    return (bool) preg_match('/^[A-Za-z0-9_]{5,32}$/', $value);
}

function tonbridge_installer_strlen(string $value): int
{
    return function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
}

function tonbridge_installer_is_rate(string $value): bool
{
    if (!is_numeric($value)) {
        return false;
    }

    $number = (float) $value;
    return $number >= 0 && $number <= 1;
}

function tonbridge_installer_normalize_admin_ids(string $value): string
{
    if ($value === '') {
        return '';
    }

    $parts = preg_split('/[\s,]+/', $value, -1, PREG_SPLIT_NO_EMPTY);
    return implode(',', $parts ?: []);
}

function tonbridge_installer_mysql_identifier(string $identifier): string
{
    if (!preg_match('/^[A-Za-z][A-Za-z0-9_]{0,63}$/', $identifier)) {
        throw new InvalidArgumentException('Unsafe MySQL identifier.');
    }

    return '`' . $identifier . '`';
}

function tonbridge_installer_relative_path(string $rootDir, string $path): string
{
    $rootDir = rtrim(realpath($rootDir) ?: $rootDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    $realPath = realpath($path) ?: $path;
    if (str_starts_with($realPath, $rootDir)) {
        return str_replace(DIRECTORY_SEPARATOR, '/', substr($realPath, strlen($rootDir)));
    }

    return basename($path);
}
