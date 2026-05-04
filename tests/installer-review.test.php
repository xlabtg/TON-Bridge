<?php
declare(strict_types=1);

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

$_SERVER['REQUEST_METHOD'] = 'POST';
$_GET = ['step' => '2', 'language' => 'en'];
$_POST = [
    'csrf' => 'test-csrf',
    'step' => '5',
    'action' => 'install',
    'language' => 'en',
];
session_id('tonbridge-installer-review-test');
session_start();
$_SESSION = [
    'tonbridge_installer_csrf' => 'test-csrf',
    'tonbridge_installer_language' => 'en',
    'tonbridge_installer_data' => [
        'app_name' => 'TON Bridge',
        'base_url' => 'https://example.com/bridge',
        'telegram_bot_username' => 'TONBridge_robot',
        'telegram_mini_app_short_name' => 'app',
        'tg_analytics_token' => 'analytics-token',
        'tg_analytics_app_name' => 'TONBridge_robot',
        'yandex_metrika_id' => 'not-numeric',
        'changenow_link_id' => 'link_id=f300d9f2b6f88e',
        'changenow_api_key' => 'server-api-key',
        'mysql_host' => 'localhost',
        'mysql_port' => '3306',
        'mysql_database' => 'tonbridge',
        'mysql_username' => 'tonbridge',
        'mysql_password' => 'db-secret',
        'mysql_charset' => 'utf8mb4',
        'mysql_table_prefix' => 'tb_',
        'mysql_create_schema' => '1',
    ],
];

ob_start();
require __DIR__ . '/../installer/index.php';
$installer = ob_get_clean();

assert_contains('Enter a numeric Yandex.Metrika counter ID.', $installer, 'review install should report the intentional validation error');
assert_not_contains('Enter the ChangeNOW partner link_id.', $installer, 'prefixed ChangeNOW link_id should not block review install');
assert_contains('<div>ChangeNOW link_id</div><div>f300d9f2b6f88e</div>', $installer, 'review should display normalized ChangeNOW link_id');
assert_contains('<div>Schema tables</div><div>Create or update</div>', $installer, 'review install should preserve the selected schema action');
assert_true(($_SESSION['tonbridge_installer_data']['mysql_create_schema'] ?? null) === '1', 'review install should not reset schema creation state');
session_destroy();

echo "Installer review tests passed.\n";
