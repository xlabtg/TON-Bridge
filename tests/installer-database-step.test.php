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

$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET = ['step' => '4', 'language' => 'ru'];
$_POST = [];
session_id('tonbridge-installer-database-step-test');
session_start();
$_SESSION = [
    'tonbridge_installer_data' => [
        'app_name' => 'TON Bridge',
        'base_url' => 'https://example.com/bridge',
        'telegram_bot_username' => 'TONBridge_robot',
        'telegram_mini_app_short_name' => 'app',
        'mysql_host' => '127.0.0.1',
        'mysql_port' => '3306',
        'mysql_database' => 'tonbridge',
        'mysql_username' => 'tonbridge',
        'mysql_password' => 'db-secret',
        'mysql_charset' => 'utf8mb4',
        'mysql_table_prefix' => 'tb_',
        'mysql_create_schema' => '1',
    ],
    'tonbridge_installer_language' => 'ru',
];

ob_start();
require __DIR__ . '/../installer/index.php';
$databaseStep = ob_get_clean();
session_destroy();

assert_contains('<html lang="ru">', $databaseStep, 'database step should render the requested language attribute');
assert_contains('Проверить подключение к базе данных', $databaseStep, 'database step should render the Test connection button (RU)');
assert_contains('name="action" value="test_db"', $databaseStep, 'Test connection button should submit the test_db action');
assert_contains('База данных MySQL', $databaseStep, 'database step should render the localized step title');

echo "Installer database step tests passed.\n";
