<?php
declare(strict_types=1);

require __DIR__ . '/../installer/src/Installer.php';

function assert_true(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, "Assertion failed: {$message}\n");
        exit(1);
    }
}

function assert_contains(string $needle, string $haystack, string $message): void
{
    assert_true(str_contains($haystack, $needle), $message);
}

function assert_not_contains(string $needle, string $haystack, string $message): void
{
    assert_true(!str_contains($haystack, $needle), $message);
}

function valid_installer_input(): array
{
    return [
        'app_name' => 'TON Bridge',
        'base_url' => 'https://example.com/bridge',
        'telegram_bot_username' => 'ExampleBridgeBot',
        'telegram_mini_app_short_name' => 'app',
        'support_bot_username' => 'ExampleSupportBot',
        'admin_telegram_ids' => '12345, 67890',
        'tg_analytics_token' => 'analytics-token',
        'tg_analytics_app_name' => 'ExampleBridgeBot',
        'yandex_metrika_id' => '98019798',
        'changenow_link_id' => 'partner123',
        'changenow_api_key' => 'server-api-key',
        'worker_base_url' => 'https://worker.example.com',
        'sentry_dsn' => 'https://public@example.ingest.sentry.io/1',
        'sentry_environment' => 'production',
        'sentry_traces_sample_rate' => '0.1',
        'mysql_host' => '127.0.0.1',
        'mysql_port' => '3306',
        'mysql_database' => 'tonbridge',
        'mysql_username' => 'tonbridge_user',
        'mysql_password' => 'db-secret',
        'mysql_charset' => 'utf8mb4',
        'mysql_table_prefix' => 'tb_',
        'mysql_create_schema' => '1',
        'icon_url' => 'https://example.com/icon.png',
    ];
}

[$config, $errors] = tonbridge_installer_validate(valid_installer_input(), false);
assert_true($errors === [], 'valid installer input should pass without a live database test');
assert_true($config['base_url'] === 'https://example.com/bridge', 'base URL should be normalized');
assert_true($config['telegram_bot_username'] === 'ExampleBridgeBot', 'bot username should be preserved');

[$prefixedLinkConfig, $prefixedLinkErrors] = tonbridge_installer_validate([
    ...valid_installer_input(),
    'changenow_link_id' => 'link_id=f300d9f2b6f88e',
], false);
assert_true($prefixedLinkErrors === [], 'ChangeNOW link_id query parameter form should pass validation');
assert_true($prefixedLinkConfig['changenow_link_id'] === 'f300d9f2b6f88e', 'ChangeNOW link_id should be normalized to the partner token');

[$badConfig, $badErrors] = tonbridge_installer_validate([
    ...valid_installer_input(),
    'telegram_bot_username' => 'bad bot name',
    'yandex_metrika_id' => 'not-numeric',
    'mysql_table_prefix' => 'bad-prefix',
], false);
assert_true($badConfig === [], 'invalid input should not return config');
assert_true(isset($badErrors['telegram_bot_username']), 'invalid bot username should be reported');
assert_true(isset($badErrors['yandex_metrika_id']), 'invalid Yandex ID should be reported');
assert_true(isset($badErrors['mysql_table_prefix']), 'invalid MySQL table prefix should be reported');

[$httpConfig, $httpErrors] = tonbridge_installer_validate([
    ...valid_installer_input(),
    'base_url' => 'http://example.com/bridge',
    'icon_url' => 'http://example.com/icon.png',
], false);
assert_true($httpConfig === [], 'public app and icon URLs must use HTTPS');
assert_true(isset($httpErrors['base_url']), 'HTTP app URL should be rejected');
assert_true(isset($httpErrors['icon_url']), 'HTTP icon URL should be rejected');

$env = tonbridge_installer_build_env($config);
assert_contains('TG_ANALYTICS_TOKEN=analytics-token', $env, 'env should include Telegram Analytics token');
assert_contains('CHANGENOW_LINK_ID=partner123', $env, 'env should include ChangeNOW link id');
assert_contains('DB_PASSWORD=db-secret', $env, 'env should include server-side database password');
assert_true(tonbridge_installer_env_value("quoted \"line\"\nnext") === '"quoted \\"line\\"\\nnext"', 'env values should escape quotes and newlines');

$browserConfig = tonbridge_installer_build_browser_config($config);
assert_contains('"botUsername": "ExampleBridgeBot"', $browserConfig, 'browser config should include bot username');
assert_contains('"changeNowLinkId": "partner123"', $browserConfig, 'browser config should include public ChangeNOW link id');
assert_contains('"adminTelegramIds": [', $browserConfig, 'browser config should include public admin IDs for client-side admin gates');
assert_contains('"12345"', $browserConfig, 'browser config should include normalized admin ID');
assert_not_contains('db-secret', $browserConfig, 'browser config must not expose database password');
assert_not_contains('server-api-key', $browserConfig, 'browser config must not expose ChangeNOW API key');

$tmpRoot = sys_get_temp_dir() . '/tonbridge-installer-' . bin2hex(random_bytes(4));
mkdir($tmpRoot . '/assets/js', 0777, true);
mkdir($tmpRoot . '/admin', 0777, true);
mkdir($tmpRoot . '/dist/admin', 0777, true);
file_put_contents($tmpRoot . '/0.html', "token: '%%TG_ANALYTICS_TOKEN%%'\nappName: '%%TG_ANALYTICS_APP_NAME%%'\nym(%%YANDEX_METRIKA_ID%%, \"init\")\n");
file_put_contents($tmpRoot . '/index.html', 'https://changenow.io/widget?link_id=00000000000000');
file_put_contents($tmpRoot . '/app-settings.html', '<nav data-admin-ids="__ADMIN_TELEGRAM_IDS__"></nav>');
file_put_contents($tmpRoot . '/admin/index.html', '<meta name="admin-ids" content="__ADMIN_TELEGRAM_IDS__">');
file_put_contents($tmpRoot . '/dist/admin/index.html', '<meta name="admin-ids" content="__ADMIN_TELEGRAM_IDS__">');
file_put_contents($tmpRoot . '/assets/js/base.js', "tgAnalyticsToken: '%%TG_ANALYTICS_TOKEN%%'\ntgAnalyticsAppName: '%%TG_ANALYTICS_APP_NAME%%'\nyandexMetrikaId: '%%YANDEX_METRIKA_ID%%'\n");
file_put_contents($tmpRoot . '/assets/js/auth.js', "var DEFAULT_WORKER_URL = 'https://ton-bridge-worker.tonbankcard.workers.dev';\n");
file_put_contents($tmpRoot . '/assets/js/deep-link.js', "return 'https://t.me/TONBridge_robot/app?startapp=' + param;");
file_put_contents($tmpRoot . '/assets/js/referral.js', "var BOT_USERNAME = 'TONBridge_robot';\n");
file_put_contents($tmpRoot . '/assets/js/referral-rewards.js', "var WORKER_BASE = 'https://ton-bridge-worker.tonbankcard.workers.dev';\n");
file_put_contents($tmpRoot . '/assets/js/social-proof.js', 'https://api.changenow.io/v1/info/stats?link_id=3cc0024a18fd9d');

$changed = tonbridge_installer_apply_static_config($tmpRoot, $config);
sort($changed);
assert_true($changed === ['0.html', 'admin/index.html', 'app-settings.html', 'assets/js/auth.js', 'assets/js/base.js', 'assets/js/deep-link.js', 'assets/js/referral-rewards.js', 'assets/js/referral.js', 'assets/js/social-proof.js', 'dist/admin/index.html', 'index.html'], 'static replacement should report changed deploy files');
assert_contains("token: 'analytics-token'", file_get_contents($tmpRoot . '/0.html'), 'static HTML should get analytics token');
assert_contains('ym(98019798, "init")', file_get_contents($tmpRoot . '/0.html'), 'static HTML should get Yandex ID');
assert_contains("tgAnalyticsToken: 'analytics-token'", file_get_contents($tmpRoot . '/assets/js/base.js'), 'base.js should get analytics token');
assert_contains("tgAnalyticsAppName: 'ExampleBridgeBot'", file_get_contents($tmpRoot . '/assets/js/base.js'), 'base.js should get analytics app name');
assert_contains("yandexMetrikaId: '98019798'", file_get_contents($tmpRoot . '/assets/js/base.js'), 'base.js should get Yandex ID');
assert_contains('link_id=partner123', file_get_contents($tmpRoot . '/index.html'), 'static HTML should get ChangeNOW link id');
assert_contains('data-admin-ids="12345,67890"', file_get_contents($tmpRoot . '/app-settings.html'), 'static HTML should get installer admin IDs');
assert_contains('content="12345,67890"', file_get_contents($tmpRoot . '/admin/index.html'), 'admin page should get installer admin IDs');
assert_contains('content="12345,67890"', file_get_contents($tmpRoot . '/dist/admin/index.html'), 'dist admin page should get installer admin IDs');
assert_contains('https://t.me/ExampleBridgeBot/app?startapp=', file_get_contents($tmpRoot . '/assets/js/deep-link.js'), 'static JS should get bot username');
assert_contains("var DEFAULT_WORKER_URL = 'https://worker.example.com'", file_get_contents($tmpRoot . '/assets/js/auth.js'), 'auth JS should get worker URL');
assert_contains("var BOT_USERNAME = 'ExampleBridgeBot'", file_get_contents($tmpRoot . '/assets/js/referral.js'), 'referral JS should get bot username');
assert_contains("var WORKER_BASE = 'https://worker.example.com'", file_get_contents($tmpRoot . '/assets/js/referral-rewards.js'), 'referral rewards JS should get worker URL');
assert_contains('link_id=partner123', file_get_contents($tmpRoot . '/assets/js/social-proof.js'), 'static JS should get stats link id');

array_map('unlink', glob($tmpRoot . '/assets/js/*.js'));
rmdir($tmpRoot . '/assets/js');
rmdir($tmpRoot . '/assets');
unlink($tmpRoot . '/admin/index.html');
rmdir($tmpRoot . '/admin');
unlink($tmpRoot . '/dist/admin/index.html');
rmdir($tmpRoot . '/dist/admin');
rmdir($tmpRoot . '/dist');
array_map('unlink', glob($tmpRoot . '/*.html'));
rmdir($tmpRoot);

// Verify that the generic .env.example placeholder values (baked into the pre-built
// HTML/JS distribution) are also replaced by the installer.
$tmpEnvPlaceholders = sys_get_temp_dir() . '/tonbridge-installer-' . bin2hex(random_bytes(4));
mkdir($tmpEnvPlaceholders . '/assets/js', 0777, true);
file_put_contents($tmpEnvPlaceholders . '/index.html', "link_id=your-changenow-link-id-here\n");
file_put_contents($tmpEnvPlaceholders . '/redeem.html', "var metrikaId = \"your-yandex-metrika-id-here\";\ntoken: \"your-tganalytics-jwt-here\"\nappName: \"your-analytics-app-name\"\n");
file_put_contents($tmpEnvPlaceholders . '/assets/js/base.js', "yandexMetrikaId: \"your-yandex-metrika-id-here\",\ntgAnalyticsToken: \"your-tganalytics-jwt-here\",\ntgAnalyticsAppName: \"your-analytics-app-name\"\n");
file_put_contents($tmpEnvPlaceholders . '/assets/js/deep-link.js', "var BOT_USERNAME = 'your-bot-username';\n");
file_put_contents($tmpEnvPlaceholders . '/assets/js/referral.js', "var BOT_USERNAME = 'your-bot-username';\n");

$changedEnv = tonbridge_installer_apply_static_config($tmpEnvPlaceholders, $config);
sort($changedEnv);
assert_true($changedEnv === ['assets/js/base.js', 'assets/js/deep-link.js', 'assets/js/referral.js', 'index.html', 'redeem.html'], 'installer should replace .env.example placeholder values in pre-built files');
assert_contains('link_id=partner123', file_get_contents($tmpEnvPlaceholders . '/index.html'), 'pre-built HTML should get ChangeNOW link id from env placeholder');
assert_contains('var metrikaId = "98019798"', file_get_contents($tmpEnvPlaceholders . '/redeem.html'), 'pre-built HTML should get Yandex ID from env placeholder');
assert_contains('token: "analytics-token"', file_get_contents($tmpEnvPlaceholders . '/redeem.html'), 'pre-built HTML should get analytics token from env placeholder');
assert_contains('appName: "ExampleBridgeBot"', file_get_contents($tmpEnvPlaceholders . '/redeem.html'), 'pre-built HTML should get analytics app name from env placeholder');
assert_contains('yandexMetrikaId: "98019798"', file_get_contents($tmpEnvPlaceholders . '/assets/js/base.js'), 'pre-built base.js should get Yandex ID from env placeholder');
assert_contains('tgAnalyticsToken: "analytics-token"', file_get_contents($tmpEnvPlaceholders . '/assets/js/base.js'), 'pre-built base.js should get analytics token from env placeholder');
assert_contains('tgAnalyticsAppName: "ExampleBridgeBot"', file_get_contents($tmpEnvPlaceholders . '/assets/js/base.js'), 'pre-built base.js should get analytics app name from env placeholder');
assert_contains("var BOT_USERNAME = 'ExampleBridgeBot'", file_get_contents($tmpEnvPlaceholders . '/assets/js/deep-link.js'), 'pre-built JS should get bot username from env placeholder');
assert_contains("var BOT_USERNAME = 'ExampleBridgeBot'", file_get_contents($tmpEnvPlaceholders . '/assets/js/referral.js'), 'pre-built referral JS should get bot username from env placeholder');

array_map('unlink', glob($tmpEnvPlaceholders . '/assets/js/*.js'));
rmdir($tmpEnvPlaceholders . '/assets/js');
rmdir($tmpEnvPlaceholders . '/assets');
array_map('unlink', glob($tmpEnvPlaceholders . '/*.html'));
rmdir($tmpEnvPlaceholders);

// Verify that fixes from recent app issues are applied to an installed static
// deployment, not only to the source build.
$tmpInstallRoot = sys_get_temp_dir() . '/tonbridge-installer-install-' . bin2hex(random_bytes(4));
mkdir($tmpInstallRoot . '/assets/js', 0777, true);
mkdir($tmpInstallRoot . '/config', 0777, true);
file_put_contents($tmpInstallRoot . '/__service-worker.js', file_get_contents(__DIR__ . '/../__service-worker.js'));
file_put_contents($tmpInstallRoot . '/tonconnect-manifest.json', json_encode([
    'url' => 'https://tonbankcard.com/bridge/TMA/00.html',
    'name' => 'TON Bridge',
    'iconUrl' => 'https://tonbankcard.com/bridge/TMA/00.html/assets/img/icon/512x512.png',
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
file_put_contents($tmpInstallRoot . '/app-settings.html', '<script src="assets/js/tonbridge-config.js"></script><script src="assets/js/auth.js"></script><script src="assets/js/wallet-connect.js"></script>');
file_put_contents($tmpInstallRoot . '/orders.html', '<script defer src="assets/js/language-routing.js"></script>');
file_put_contents($tmpInstallRoot . '/assets/js/auth.js', "var DEFAULT_WORKER_URL = 'https://ton-bridge-worker.tonbankcard.workers.dev';\n");
file_put_contents($tmpInstallRoot . '/assets/js/referral-rewards.js', "var WORKER_BASE = 'https://ton-bridge-worker.tonbankcard.workers.dev';\n");
file_put_contents($tmpInstallRoot . '/assets/js/wallet-connect.js', "return config().tonConnectManifestUrl || (window.location.origin + '/tonconnect-manifest.json');\n");
file_put_contents($tmpInstallRoot . '/assets/js/language-routing.js', "var ROUTES = { orders: { en: 'orders.html', ru: 'orders-ru.html' } };\n");

[$installWritten, $installBackups] = tonbridge_installer_install([
    ...$config,
    'mysql_create_schema' => '0',
], $tmpInstallRoot);
sort($installWritten);
sort($installBackups);
$installedManifest = json_decode((string) file_get_contents($tmpInstallRoot . '/tonconnect-manifest.json'), true);
$installedConfigJs = file_get_contents($tmpInstallRoot . '/assets/js/tonbridge-config.js');

assert_true(in_array('tonconnect-manifest.json', $installWritten, true), 'installer should write TonConnect manifest');
assert_true(in_array('assets/js/tonbridge-config.js', $installWritten, true), 'installer should write browser runtime config');
assert_true(in_array('assets/js/auth.js', $installWritten, true), 'installer should rewrite auth.js for the selected worker');
assert_true(in_array('assets/js/referral-rewards.js', $installWritten, true), 'installer should rewrite referral rewards worker URL');
assert_true($installedManifest['url'] === 'https://example.com/bridge', 'installed TonConnect manifest should use installer base URL');
assert_true($installedManifest['iconUrl'] === 'https://example.com/icon.png', 'installed TonConnect manifest should use installer icon URL');
assert_contains('"tonConnectManifestUrl": "https://example.com/bridge/tonconnect-manifest.json"', $installedConfigJs, 'browser config should point wallet connect to installed manifest URL');
assert_contains('"workerBaseUrl": "https://worker.example.com"', $installedConfigJs, 'browser config should expose installed worker URL');
assert_contains("var DEFAULT_WORKER_URL = 'https://worker.example.com'", file_get_contents($tmpInstallRoot . '/assets/js/auth.js'), 'installed auth.js should not keep placeholder worker URL');
assert_contains("var WORKER_BASE = 'https://worker.example.com'", file_get_contents($tmpInstallRoot . '/assets/js/referral-rewards.js'), 'installed referral rewards should not keep placeholder worker URL');
assert_contains('tonConnectManifestUrl', file_get_contents($tmpInstallRoot . '/assets/js/wallet-connect.js'), 'installed wallet connect JS should read runtime manifest URL');
assert_contains('orders-ru.html', file_get_contents($tmpInstallRoot . '/assets/js/language-routing.js'), 'installed language routing JS should keep localized bottom-nav routes');

unlink($tmpInstallRoot . '/__service-worker.js');
foreach (glob($tmpInstallRoot . '/*.bak-*') ?: [] as $backupFile) {
    unlink($backupFile);
}
unlink($tmpInstallRoot . '/.env');
unlink($tmpInstallRoot . '/tonconnect-manifest.json');
unlink($tmpInstallRoot . '/app-settings.html');
unlink($tmpInstallRoot . '/orders.html');
array_map('unlink', glob($tmpInstallRoot . '/assets/js/*.js'));
unlink($tmpInstallRoot . '/config/tonbridge.php');
rmdir($tmpInstallRoot . '/config');
rmdir($tmpInstallRoot . '/assets/js');
rmdir($tmpInstallRoot . '/assets');
rmdir($tmpInstallRoot);
@unlink(__DIR__ . '/../installer/.installed');

// The installer must invalidate old PWA caches after uploading a new project
// version. Otherwise an existing service worker can keep serving stale CSS/JS.
$tmpSwRoot = sys_get_temp_dir() . '/tonbridge-installer-sw-' . bin2hex(random_bytes(4));
mkdir($tmpSwRoot . '/assets/css', 0777, true);
mkdir($tmpSwRoot . '/assets/js', 0777, true);
mkdir($tmpSwRoot . '/dist', 0777, true);
file_put_contents($tmpSwRoot . '/__service-worker.js', file_get_contents(__DIR__ . '/../__service-worker.js'));
file_put_contents($tmpSwRoot . '/index.html', '<!doctype html><title>TON Bridge</title>');
file_put_contents($tmpSwRoot . '/assets/css/style.css', 'body{}');
file_put_contents($tmpSwRoot . '/assets/js/base.js', 'console.log("base");');
file_put_contents($tmpSwRoot . '/dist/index.html', '<!doctype html><title>dist should not be precached by root SW</title>');

[$swChanged, $swBackups] = tonbridge_installer_refresh_service_workers($tmpSwRoot, $config, '20260522-120000');
sort($swChanged);
sort($swBackups);
$updatedSw = file_get_contents($tmpSwRoot . '/__service-worker.js');
assert_true($swChanged === ['__service-worker.js'], 'installer should refresh the root service worker');
assert_true($swBackups === ['__service-worker.js.bak-20260522-120000'], 'installer should back up the previous service worker');
assert_contains('var SW_VERSION = "installer-20260522-120000-', $updatedSw, 'installer should stamp a non-dev service worker version');
assert_contains('"index.html"', $updatedSw, 'installer service worker should precache root HTML');
assert_contains('"assets/css/style.css"', $updatedSw, 'installer service worker should precache current CSS');
assert_contains('"assets/js/base.js"', $updatedSw, 'installer service worker should precache current JS');
assert_not_contains('"dist/index.html"', $updatedSw, 'root service worker should not precache nested dist output');

unlink($tmpSwRoot . '/__service-worker.js');
unlink($tmpSwRoot . '/__service-worker.js.bak-20260522-120000');
unlink($tmpSwRoot . '/index.html');
unlink($tmpSwRoot . '/assets/css/style.css');
unlink($tmpSwRoot . '/assets/js/base.js');
unlink($tmpSwRoot . '/dist/index.html');
rmdir($tmpSwRoot . '/dist');
rmdir($tmpSwRoot . '/assets/js');
rmdir($tmpSwRoot . '/assets/css');
rmdir($tmpSwRoot . '/assets');
rmdir($tmpSwRoot);

$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET = ['step' => '2', 'language' => 'ru'];
$_POST = [];
$_SESSION = [];
ob_start();
require __DIR__ . '/../installer/index.php';
$russianInstaller = ob_get_clean();
assert_contains('<html lang="ru">', $russianInstaller, 'installer should render Russian language attribute');
assert_contains('Приложение и Telegram', $russianInstaller, 'installer should translate the application step title');
assert_contains('Не добавляйте /installer.', $russianInstaller, 'installer should document how to fill the public app URL');
assert_contains('English', $russianInstaller, 'language selector should include English option text');
assert_contains('Русский', $russianInstaller, 'language selector should include Russian option text');

// Backup logic preserves the previous file when one already exists.
$backupRoot = sys_get_temp_dir() . '/tonbridge-installer-backup-' . bin2hex(random_bytes(4));
mkdir($backupRoot, 0777, true);
$existing = $backupRoot . '/example.txt';
file_put_contents($existing, 'previous-content');
$backupPath = tonbridge_installer_backup_file($existing, '20260520-013045');
assert_true($backupPath !== null && is_file($backupPath), 'backup should be created when the original file exists');
assert_true(file_get_contents($backupPath) === 'previous-content', 'backup should contain the previous file contents');
assert_true(str_ends_with($backupPath, '.bak-20260520-013045'), 'backup filename should encode the timestamp');
$noBackup = tonbridge_installer_backup_file($backupRoot . '/missing.txt', '20260520-013045');
assert_true($noBackup === null, 'backup should be a no-op when the original file is missing');
unlink($existing);
unlink($backupPath);
rmdir($backupRoot);

echo "Installer tests passed.\n";
