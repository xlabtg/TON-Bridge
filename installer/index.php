<?php
declare(strict_types=1);

require __DIR__ . '/src/Installer.php';

session_start();

$rootDir = dirname(__DIR__);
$lockFile = __DIR__ . '/.installed';
$steps = [
    1 => 'Requirements',
    2 => 'Application',
    3 => 'Integrations',
    4 => 'Database',
    5 => 'Review',
];

if (empty($_SESSION['tonbridge_installer_csrf'])) {
    $_SESSION['tonbridge_installer_csrf'] = bin2hex(random_bytes(16));
}

$csrf = $_SESSION['tonbridge_installer_csrf'];
$data = array_merge(
    tonbridge_installer_default_input(),
    $_SESSION['tonbridge_installer_data'] ?? []
);
$step = max(1, min(5, (int) ($_GET['step'] ?? ($_POST['step'] ?? 1))));
$errors = [];
$success = false;
$writtenFiles = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($csrf, (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('Invalid installer session token.');
    }

    $posted = $_POST;
    unset($posted['csrf'], $posted['step'], $posted['action']);
    $posted['mysql_create_schema'] = isset($_POST['mysql_create_schema']) ? '1' : '0';
    $data = array_merge($data, $posted);
    $_SESSION['tonbridge_installer_data'] = $data;

    $action = (string) ($_POST['action'] ?? 'next');
    if ($action === 'back') {
        $step = max(1, $step - 1);
    } elseif ($action === 'install') {
        [$config, $errors] = tonbridge_installer_validate($data, true);
        if ($errors === [] && !tonbridge_installer_requirements_pass($rootDir)) {
            $errors['requirements'] = 'Resolve the required hosting checks before installing.';
        }
        if ($errors === []) {
            try {
                $writtenFiles = tonbridge_installer_install($config, $rootDir);
                unset($_SESSION['tonbridge_installer_data']);
                $success = true;
            } catch (Throwable $e) {
                $errors['install'] = $e->getMessage();
            }
        }
        $step = 5;
    } else {
        $step = min(5, $step + 1);
    }
}

function h(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function form_value(array $data, string $name): string
{
    return h((string) ($data[$name] ?? ''));
}

function field_error(array $errors, string $name): string
{
    if (!isset($errors[$name])) {
        return '';
    }

    return '<div class="field-error">' . h((string) $errors[$name]) . '</div>';
}

function text_field(array $data, array $errors, string $name, string $label, string $help = '', string $type = 'text', bool $required = false): void
{
    $requiredAttr = $required ? ' required' : '';
    echo '<label class="field"><span>' . h($label) . '</span>';
    echo '<input type="' . h($type) . '" name="' . h($name) . '" value="' . form_value($data, $name) . '"' . $requiredAttr . '>';
    if ($help !== '') {
        echo '<small>' . h($help) . '</small>';
    }
    echo field_error($errors, $name);
    echo '</label>';
}

function textarea_field(array $data, array $errors, string $name, string $label, string $help = ''): void
{
    echo '<label class="field field-wide"><span>' . h($label) . '</span>';
    echo '<textarea name="' . h($name) . '" rows="3">' . form_value($data, $name) . '</textarea>';
    if ($help !== '') {
        echo '<small>' . h($help) . '</small>';
    }
    echo field_error($errors, $name);
    echo '</label>';
}

function select_field(array $data, array $errors, string $name, string $label, array $options): void
{
    echo '<label class="field"><span>' . h($label) . '</span><select name="' . h($name) . '">';
    foreach ($options as $value => $caption) {
        $selected = ((string) ($data[$name] ?? '') === (string) $value) ? ' selected' : '';
        echo '<option value="' . h((string) $value) . '"' . $selected . '>' . h((string) $caption) . '</option>';
    }
    echo '</select>' . field_error($errors, $name) . '</label>';
}

function step_class(int $current, int $item): string
{
    if ($current === $item) {
        return 'current';
    }
    if ($current > $item) {
        return 'done';
    }
    return '';
}

?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TON-Bridge Installer</title>
    <link rel="icon" type="image/png" href="../assets/img/favicon.png">
    <style>
        :root {
            color-scheme: light;
            --bg: #f5f7fb;
            --panel: #ffffff;
            --ink: #141a23;
            --muted: #607085;
            --line: #dce4ee;
            --primary: #1570ef;
            --danger: #b42318;
            --success: #067647;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: Arial, Helvetica, sans-serif;
            background: var(--bg);
            color: var(--ink);
            line-height: 1.45;
        }
        main {
            width: min(1060px, calc(100% - 32px));
            margin: 32px auto;
        }
        header {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: flex-start;
            margin-bottom: 20px;
        }
        h1 { margin: 0 0 6px; font-size: 28px; }
        h2 { margin: 0 0 14px; font-size: 20px; }
        p { margin: 0 0 14px; color: var(--muted); }
        code {
            background: #edf2f7;
            border-radius: 4px;
            padding: 2px 5px;
        }
        .version {
            color: var(--muted);
            font-size: 13px;
            white-space: nowrap;
        }
        .panel {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 22px;
            box-shadow: 0 10px 30px rgba(16, 24, 40, 0.06);
        }
        .steps {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 8px;
            margin-bottom: 16px;
        }
        .step {
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 10px;
            color: var(--muted);
            background: #fff;
            font-size: 14px;
            text-align: center;
        }
        .step.current {
            color: #fff;
            background: var(--primary);
            border-color: var(--primary);
        }
        .step.done {
            color: var(--success);
            border-color: #a6f4c5;
            background: #ecfdf3;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px;
        }
        .field {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .field-wide { grid-column: 1 / -1; }
        .field span {
            font-weight: 700;
            font-size: 14px;
        }
        .field small {
            color: var(--muted);
            font-size: 12px;
        }
        input, textarea, select {
            width: 100%;
            border: 1px solid #cfd8e3;
            border-radius: 6px;
            padding: 10px 11px;
            font: inherit;
            background: #fff;
            color: var(--ink);
        }
        textarea { resize: vertical; }
        .check-row {
            display: grid;
            grid-template-columns: 24px 1fr auto;
            gap: 10px;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid var(--line);
        }
        .check-row:last-child { border-bottom: 0; }
        .status {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            display: inline-block;
            background: var(--danger);
        }
        .status.ok { background: var(--success); }
        .badge {
            border-radius: 999px;
            padding: 2px 8px;
            font-size: 12px;
            background: #eef4ff;
            color: #175cd3;
        }
        .field-error, .error {
            color: var(--danger);
            font-size: 13px;
        }
        .notice {
            border: 1px solid #fedf89;
            background: #fffaeb;
            border-radius: 8px;
            padding: 12px 14px;
            color: #93370d;
            margin-bottom: 14px;
        }
        .success {
            border: 1px solid #abefc6;
            background: #ecfdf3;
            border-radius: 8px;
            padding: 14px;
            color: #05603a;
            margin-bottom: 16px;
        }
        .actions {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            margin-top: 22px;
        }
        button, .button {
            border: 1px solid var(--primary);
            border-radius: 6px;
            padding: 10px 14px;
            background: var(--primary);
            color: #fff;
            font: inherit;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
        }
        button.secondary {
            background: #fff;
            color: var(--primary);
        }
        button:disabled {
            cursor: not-allowed;
            opacity: 0.5;
        }
        .summary {
            display: grid;
            grid-template-columns: 220px 1fr;
            gap: 8px 16px;
        }
        .summary div:nth-child(odd) {
            color: var(--muted);
        }
        ul.files {
            margin: 8px 0 0;
            padding-left: 20px;
        }
        @media (max-width: 760px) {
            main { width: min(100% - 20px, 1060px); margin: 18px auto; }
            header { display: block; }
            .steps { grid-template-columns: 1fr; }
            .grid, .summary { grid-template-columns: 1fr; }
            .field-wide { grid-column: auto; }
            .check-row { grid-template-columns: 24px 1fr; }
            .check-row .badge { grid-column: 2; width: fit-content; }
        }
    </style>
</head>
<body>
<main>
    <header>
        <div>
            <h1>TON-Bridge Installer</h1>
            <p>Configure the PHP 8.1+ and MySQL hosting deployment from one guided flow.</p>
        </div>
        <div class="version">Installer <?php echo h(TONBRIDGE_INSTALLER_VERSION); ?></div>
    </header>

    <?php if (is_file($lockFile) && !$success): ?>
        <section class="panel">
            <h2>Installation Locked</h2>
            <p>This installer already completed and created <code>installer/.installed</code>.</p>
            <p>For security, remove the installer directory from the hosting account after confirming the app works. To run installation again, delete <code>installer/.installed</code> manually.</p>
        </section>
    <?php else: ?>
        <nav class="steps" aria-label="Installer steps">
            <?php foreach ($steps as $index => $label): ?>
                <div class="step <?php echo h(step_class($step, $index)); ?>"><?php echo h((string) $index . '. ' . $label); ?></div>
            <?php endforeach; ?>
        </nav>

        <section class="panel">
            <?php if ($success): ?>
                <div class="success">
                    <strong>Installation complete.</strong>
                    Configuration files were written and the installer lock was created.
                </div>
                <h2>Next Steps</h2>
                <p>Open the Telegram bot settings in BotFather and point the mini app URL to <code><?php echo h(($data['base_url'] ?? '') . '/index.html'); ?></code>. Then remove the installer directory from the server.</p>
                <p>Written or updated files:</p>
                <ul class="files">
                    <?php foreach ($writtenFiles as $file): ?>
                        <li><code><?php echo h($file); ?></code></li>
                    <?php endforeach; ?>
                </ul>
            <?php else: ?>
                <?php if ($errors !== []): ?>
                    <div class="notice">
                        <?php foreach ($errors as $message): ?>
                            <div><?php echo h((string) $message); ?></div>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>

                <form method="post" novalidate>
                    <input type="hidden" name="csrf" value="<?php echo h($csrf); ?>">
                    <input type="hidden" name="step" value="<?php echo h((string) $step); ?>">

                    <?php if ($step === 1): ?>
                        <h2>Hosting Requirements</h2>
                        <p>The installer writes <code>.env</code>, <code>config/tonbridge.php</code>, <code>assets/js/tonbridge-config.js</code>, and updates static deployment placeholders.</p>
                        <?php $checks = tonbridge_installer_environment_checks($rootDir); ?>
                        <?php foreach ($checks as $check): ?>
                            <div class="check-row">
                                <span class="status <?php echo $check['ok'] ? 'ok' : ''; ?>" aria-hidden="true"></span>
                                <div>
                                    <strong><?php echo h($check['label']); ?></strong>
                                    <div><small><?php echo h($check['detail']); ?></small></div>
                                </div>
                                <span class="badge"><?php echo $check['required'] ? 'required' : 'optional'; ?></span>
                            </div>
                        <?php endforeach; ?>
                    <?php elseif ($step === 2): ?>
                        <h2>Application And Telegram</h2>
                        <div class="grid">
                            <?php text_field($data, $errors, 'app_name', 'Application name', 'Shown in generated manifests.', 'text', true); ?>
                            <?php text_field($data, $errors, 'base_url', 'Public app URL', 'Example: https://example.com/bridge', 'url', true); ?>
                            <?php text_field($data, $errors, 'icon_url', 'Public icon URL', 'Used in tonconnect-manifest.json. Leave blank to use the bundled icon.', 'url'); ?>
                            <?php text_field($data, $errors, 'telegram_bot_username', 'Telegram bot username', 'Without @.', 'text', true); ?>
                            <?php text_field($data, $errors, 'telegram_mini_app_short_name', 'Mini app short name', 'Usually app.', 'text', true); ?>
                            <?php text_field($data, $errors, 'telegram_bot_token', 'Telegram bot token', 'Optional server-side token. It is written only to server config.', 'password'); ?>
                            <?php text_field($data, $errors, 'support_bot_username', 'Support bot username', 'Optional, without @.', 'text'); ?>
                            <?php textarea_field($data, $errors, 'admin_telegram_ids', 'Admin Telegram IDs', 'Comma-separated numeric IDs for the admin page allow-list.'); ?>
                        </div>
                    <?php elseif ($step === 3): ?>
                        <h2>Analytics And Services</h2>
                        <div class="grid">
                            <?php text_field($data, $errors, 'tg_analytics_token', 'Telegram Analytics token', 'Issued by @DataChief_bot for this mini app.', 'password', true); ?>
                            <?php text_field($data, $errors, 'tg_analytics_app_name', 'Telegram Analytics app name', 'Usually the bot username.', 'text', true); ?>
                            <?php text_field($data, $errors, 'yandex_metrika_id', 'Yandex.Metrika counter ID', 'Numbers only.', 'text', true); ?>
                            <?php text_field($data, $errors, 'changenow_link_id', 'ChangeNOW link_id', 'Partner link_id used in widgets and stats.', 'text', true); ?>
                            <?php text_field($data, $errors, 'changenow_api_key', 'ChangeNOW API key', 'Optional server-side key. It is not written to browser config.', 'password'); ?>
                            <?php text_field($data, $errors, 'worker_base_url', 'Worker/backend URL', 'Optional Cloudflare Worker or PHP backend URL.', 'url'); ?>
                            <?php text_field($data, $errors, 'sentry_dsn', 'Sentry DSN', 'Optional browser DSN.', 'url'); ?>
                            <?php text_field($data, $errors, 'sentry_environment', 'Sentry environment', 'Example: production.', 'text'); ?>
                            <?php text_field($data, $errors, 'sentry_traces_sample_rate', 'Sentry traces sample rate', 'Number from 0 to 1.', 'text'); ?>
                        </div>
                    <?php elseif ($step === 4): ?>
                        <h2>MySQL Database</h2>
                        <p>The installer verifies the connection and can create small settings/log tables for this hosting deployment.</p>
                        <div class="grid">
                            <?php text_field($data, $errors, 'mysql_host', 'Host', 'Usually localhost or 127.0.0.1.', 'text', true); ?>
                            <?php text_field($data, $errors, 'mysql_port', 'Port', 'Default MySQL port is 3306.', 'number', true); ?>
                            <?php text_field($data, $errors, 'mysql_database', 'Database name', '', 'text', true); ?>
                            <?php text_field($data, $errors, 'mysql_username', 'Username', '', 'text', true); ?>
                            <?php text_field($data, $errors, 'mysql_password', 'Password', '', 'password'); ?>
                            <?php select_field($data, $errors, 'mysql_charset', 'Character set', ['utf8mb4' => 'utf8mb4', 'utf8' => 'utf8']); ?>
                            <?php text_field($data, $errors, 'mysql_table_prefix', 'Table prefix', 'Example: tonbridge_.', 'text', true); ?>
                            <label class="field">
                                <span>Create installer tables</span>
                                <input type="checkbox" name="mysql_create_schema" value="1" <?php echo !empty($data['mysql_create_schema']) ? 'checked' : ''; ?>>
                                <small>Creates settings and install_log tables using the prefix above.</small>
                            </label>
                        </div>
                        <?php echo field_error($errors, 'database_connection'); ?>
                    <?php else: ?>
                        <h2>Review Configuration</h2>
                        <p>Submitting this step writes server config, public browser config, TonConnect manifest, static placeholders, and the installer lock.</p>
                        <div class="summary">
                            <div>Application</div><div><?php echo h((string) $data['app_name']); ?></div>
                            <div>Base URL</div><div><?php echo h((string) $data['base_url']); ?></div>
                            <div>Telegram bot</div><div>@<?php echo h((string) $data['telegram_bot_username']); ?></div>
                            <div>Mini app short name</div><div><?php echo h((string) $data['telegram_mini_app_short_name']); ?></div>
                            <div>ChangeNOW link_id</div><div><?php echo h((string) $data['changenow_link_id']); ?></div>
                            <div>Yandex.Metrika</div><div><?php echo h((string) $data['yandex_metrika_id']); ?></div>
                            <div>MySQL</div><div><?php echo h((string) $data['mysql_username']); ?>@<?php echo h((string) $data['mysql_host']); ?>:<?php echo h((string) $data['mysql_port']); ?>/<?php echo h((string) $data['mysql_database']); ?></div>
                            <div>Schema tables</div><div><?php echo !empty($data['mysql_create_schema']) ? 'Create or update' : 'Skip'; ?></div>
                        </div>
                    <?php endif; ?>

                    <div class="actions">
                        <button class="secondary" type="submit" name="action" value="back" <?php echo $step === 1 ? 'disabled' : ''; ?>>Back</button>
                        <?php if ($step < 5): ?>
                            <button type="submit" name="action" value="next">Next</button>
                        <?php else: ?>
                            <button type="submit" name="action" value="install">Install</button>
                        <?php endif; ?>
                    </div>
                </form>
            <?php endif; ?>
        </section>
    <?php endif; ?>
</main>
</body>
</html>
