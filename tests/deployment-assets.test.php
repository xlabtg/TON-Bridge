<?php
declare(strict_types=1);

// Regression guard for issue #166: the committed root HTML files are the
// payload that the PHP/MySQL installer deploys. They must already carry the
// fixes shipped to src/ (issues #156-#163) — language routing, the payout
// wallet restore listener, the referral install stats — otherwise the
// installed app behaves like none of those changes were applied.
//
// These checks intentionally inspect the real files in the repository root
// (not synthetic fixtures) so a future src change that forgets to rebuild the
// static distribution fails CI here.

$root = dirname(__DIR__);
$failures = 0;

function deploy_assert(bool $condition, string $message): void
{
    global $failures;
    if (!$condition) {
        $failures++;
        fwrite(STDERR, "Assertion failed: {$message}\n");
    }
}

function deploy_read(string $root, string $relative): string
{
    $path = $root . '/' . $relative;
    $contents = is_file($path) ? file_get_contents($path) : false;
    if ($contents === false) {
        deploy_assert(false, "missing deployment file: {$relative}");
        return '';
    }
    return $contents;
}

// Pages that render the localized bottom navigation must load the language
// router so the chosen language survives navigation and syncs per user via
// Telegram CloudStorage (issue #158).
$bottomNavPages = [
    'index.html', 'index-ru.html',
    'index2.html', 'index2-ru.html',
    'index3.html', 'index3-ru.html',
    'index4.html', 'index4-ru.html',
    'orders.html', 'orders-ru.html',
    'redeem.html', 'redeem-ru.html',
    'referral.html', 'referral-ru.html',
    'app-settings.html', 'app-settings-ru.html',
];

foreach ($bottomNavPages as $page) {
    $html = deploy_read($root, $page);
    deploy_assert(
        str_contains($html, 'assets/js/language-routing.js'),
        "{$page} should load assets/js/language-routing.js so the language preference survives navigation"
    );
}

// Settings pages must wire the payout wallet restore listener and the wallet
// connect runtime (issue #158): without it a wallet stored in CloudStorage
// for the user is not reflected in the UI after switching device/platform.
foreach (['app-settings.html', 'app-settings-ru.html'] as $page) {
    $html = deploy_read($root, $page);
    deploy_assert(
        str_contains($html, "tbc:payout-wallet-loaded"),
        "{$page} should listen for tbc:payout-wallet-loaded to restore the saved payout wallet"
    );
    deploy_assert(
        str_contains($html, 'assets/js/wallet-connect.js'),
        "{$page} should load assets/js/wallet-connect.js"
    );
    deploy_assert(
        str_contains($html, 'assets/js/tonbridge-config.js'),
        "{$page} should load assets/js/tonbridge-config.js so the installer-provided manifest URL is used"
    );
}

// Referral pages must include the install-stats block added in issue #162.
foreach (['referral.html', 'referral-ru.html'] as $page) {
    $html = deploy_read($root, $page);
    deploy_assert(
        str_contains($html, 'id="referral-stats-section"'),
        "{$page} should include the referral install stats section"
    );
    deploy_assert(
        str_contains($html, 'id="referral-installed-count"'),
        "{$page} should include the referral install counter"
    );
}

// No deployment HTML may keep development/test placeholders the installer is
// unable to rewrite. These would otherwise ship a broken analytics config.
$stalePlaceholders = [
    'token: "test"',
    'appName: "test"',
    'mc.yandex.ru/watch/123',
    'var metrikaId = "123"',
];

foreach (glob($root . '/*.html') ?: [] as $path) {
    $html = (string) file_get_contents($path);
    $name = basename($path);
    foreach ($stalePlaceholders as $needle) {
        deploy_assert(
            !str_contains($html, $needle),
            "{$name} must not ship the stale placeholder " . var_export($needle, true)
        );
    }
}

if ($failures > 0) {
    fwrite(STDERR, "deployment-assets.test.php: {$failures} assertion(s) failed\n");
    exit(1);
}

fwrite(STDOUT, "deployment-assets.test.php: all assertions passed\n");
