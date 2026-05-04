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
assert_not_contains('db-secret', $browserConfig, 'browser config must not expose database password');
assert_not_contains('server-api-key', $browserConfig, 'browser config must not expose ChangeNOW API key');

$tmpRoot = sys_get_temp_dir() . '/tonbridge-installer-' . bin2hex(random_bytes(4));
mkdir($tmpRoot . '/assets/js', 0777, true);
file_put_contents($tmpRoot . '/0.html', "token: '%%TG_ANALYTICS_TOKEN%%'\nappName: '%%TG_ANALYTICS_APP_NAME%%'\nym(%%YANDEX_METRIKA_ID%%, \"init\")\n");
file_put_contents($tmpRoot . '/index.html', 'https://changenow.io/widget?link_id=00000000000000');
file_put_contents($tmpRoot . '/assets/js/deep-link.js', "return 'https://t.me/TONBridge_robot/app?startapp=' + param;");
file_put_contents($tmpRoot . '/assets/js/social-proof.js', 'https://api.changenow.io/v1/info/stats?link_id=3cc0024a18fd9d');

$changed = tonbridge_installer_apply_static_config($tmpRoot, $config);
sort($changed);
assert_true($changed === ['0.html', 'assets/js/deep-link.js', 'assets/js/social-proof.js', 'index.html'], 'static replacement should report changed deploy files');
assert_contains("token: 'analytics-token'", file_get_contents($tmpRoot . '/0.html'), 'static HTML should get analytics token');
assert_contains('ym(98019798, "init")', file_get_contents($tmpRoot . '/0.html'), 'static HTML should get Yandex ID');
assert_contains('link_id=partner123', file_get_contents($tmpRoot . '/index.html'), 'static HTML should get ChangeNOW link id');
assert_contains('https://t.me/ExampleBridgeBot/app?startapp=', file_get_contents($tmpRoot . '/assets/js/deep-link.js'), 'static JS should get bot username');
assert_contains('link_id=partner123', file_get_contents($tmpRoot . '/assets/js/social-proof.js'), 'static JS should get stats link id');

array_map('unlink', glob($tmpRoot . '/assets/js/*.js'));
rmdir($tmpRoot . '/assets/js');
rmdir($tmpRoot . '/assets');
array_map('unlink', glob($tmpRoot . '/*.html'));
rmdir($tmpRoot);

echo "Installer tests passed.\n";
