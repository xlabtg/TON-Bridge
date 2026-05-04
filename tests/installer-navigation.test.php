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
    'step' => '3',
    'action' => 'next',
    'language' => 'en',
    'tg_analytics_token' => 'analytics-token',
    'tg_analytics_app_name' => 'TONBridge_robot',
    'yandex_metrika_id' => '98019798',
    'changenow_link_id' => 'link_id=f300d9f2b6f88e',
    'changenow_api_key' => 'server-api-key',
    'worker_base_url' => '',
    'sentry_dsn' => '',
    'sentry_environment' => 'production',
    'sentry_traces_sample_rate' => '1',
];
session_id('tonbridge-installer-navigation-test');
session_start();
$_SESSION = [
    'tonbridge_installer_csrf' => 'test-csrf',
    'tonbridge_installer_language' => 'en',
    'tonbridge_installer_data' => [
        'app_name' => 'TON Bridge',
        'base_url' => 'https://example.com/bridge',
        'telegram_bot_username' => 'TONBridge_robot',
        'telegram_mini_app_short_name' => 'app',
    ],
];

ob_start();
require __DIR__ . '/../installer/index.php';
$installer = ob_get_clean();

assert_contains('<html lang="en">', $installer, 'installer should keep posted language');
assert_contains('MySQL Database', $installer, 'posted step 3 should advance to the database step even with a stale GET step');
assert_contains('name="step" value="4"', $installer, 'advanced form should carry step 4 forward');
assert_not_contains('Analytics And Services', $installer, 'stale GET step should not leave the installer on integrations');
session_destroy();

echo "Installer navigation tests passed.\n";
