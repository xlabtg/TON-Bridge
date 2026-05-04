<?php
declare(strict_types=1);

require_once __DIR__ . '/src/Installer.php';

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

$rootDir = dirname(__DIR__);
$lockFile = __DIR__ . '/.installed';
$steps = [
    1 => 'Requirements',
    2 => 'Application',
    3 => 'Integrations',
    4 => 'Database',
    5 => 'Review',
];
$translations = tonbridge_installer_translations();
$language = tonbridge_installer_language($translations);
$_SESSION['tonbridge_installer_language'] = $language;
$steps = [
    1 => t('step_requirements'),
    2 => t('step_application'),
    3 => t('step_integrations'),
    4 => t('step_database'),
    5 => t('step_review'),
];

if (empty($_SESSION['tonbridge_installer_csrf'])) {
    $_SESSION['tonbridge_installer_csrf'] = bin2hex(random_bytes(16));
}

$csrf = $_SESSION['tonbridge_installer_csrf'];
$data = array_merge(
    tonbridge_installer_default_input(),
    $_SESSION['tonbridge_installer_data'] ?? []
);
$requestedStep = $_SERVER['REQUEST_METHOD'] === 'POST'
    ? ($_POST['step'] ?? ($_GET['step'] ?? 1))
    : ($_GET['step'] ?? 1);
$step = max(1, min(5, (int) $requestedStep));
$errors = [];
$success = false;
$writtenFiles = [];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!hash_equals($csrf, (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('Invalid installer session token.');
    }

    $posted = $_POST;
    unset($posted['csrf'], $posted['step'], $posted['action'], $posted['language']);
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

function tonbridge_installer_translations(): array
{
    return [
        'en' => [
            'language_name' => 'English',
            'step_requirements' => 'Requirements',
            'step_application' => 'Application',
            'step_integrations' => 'Integrations',
            'step_database' => 'Database',
            'step_review' => 'Review',
            'subtitle' => 'Configure the PHP 8.1+ and MySQL hosting deployment from one guided flow.',
            'language_label' => 'Language',
            'locked_title' => 'Installation Locked',
            'locked_done' => 'This installer already completed and created <code>installer/.installed</code>.',
            'locked_security' => 'For security, remove the installer directory from the hosting account after confirming the app works. To run installation again, delete <code>installer/.installed</code> manually.',
            'success_title' => 'Installation complete.',
            'success_body' => 'Configuration files were written and the installer lock was created.',
            'next_steps' => 'Next Steps',
            'botfather_next' => 'Open the Telegram bot settings in BotFather and point the mini app URL to <code>%s</code>. Then remove the installer directory from the server.',
            'written_files' => 'Written or updated files:',
            'requirements_title' => 'Hosting Requirements',
            'requirements_intro' => 'The installer writes <code>.env</code>, <code>config/tonbridge.php</code>, <code>assets/js/tonbridge-config.js</code>, and updates static deployment placeholders.',
            'required' => 'required',
            'optional' => 'optional',
            'application_title' => 'Application And Telegram',
            'application_help' => 'Use the public HTTPS address where these files are hosted. Telegram usernames are entered without @. Admin IDs are numeric Telegram user IDs, not usernames.',
            'analytics_title' => 'Analytics And Services',
            'analytics_help' => 'Fill values from each provider dashboard. Optional server-side secrets are saved only to server configuration and are not exposed in browser config.',
            'database_title' => 'MySQL Database',
            'database_intro' => 'The installer verifies the connection and can create small settings/log tables for this hosting deployment.',
            'database_help' => 'Create an empty database and user in the hosting control panel first, then paste those connection details here. Leave schema creation enabled for a first install.',
            'review_title' => 'Review Configuration',
            'review_intro' => 'Submitting this step writes server config, public browser config, TonConnect manifest, static placeholders, and the installer lock.',
            'back' => 'Back',
            'next' => 'Next',
            'install' => 'Install',
            'summary_application' => 'Application',
            'summary_base_url' => 'Base URL',
            'summary_telegram_bot' => 'Telegram bot',
            'summary_mini_app' => 'Mini app short name',
            'summary_schema' => 'Schema tables',
            'summary_create' => 'Create or update',
            'summary_skip' => 'Skip',
            'field_app_name' => 'Application name',
            'help_app_name' => 'Shown in generated manifests and Telegram connection metadata.',
            'field_base_url' => 'Public app URL',
            'help_base_url' => 'Full HTTPS folder URL, for example https://example.com/bridge. Do not include /installer.',
            'field_icon_url' => 'Public icon URL',
            'help_icon_url' => 'HTTPS PNG icon for tonconnect-manifest.json. Leave blank to use the bundled icon.',
            'field_bot_username' => 'Telegram bot username',
            'help_bot_username' => 'BotFather username without @, for example ExampleBridgeBot.',
            'field_mini_app' => 'Mini app short name',
            'help_mini_app' => 'BotFather mini app short name, usually app.',
            'field_bot_token' => 'Telegram bot token',
            'help_bot_token' => 'Optional BotFather token. It is written only to server config.',
            'field_support_bot' => 'Support bot username',
            'help_support_bot' => 'Optional support bot username without @.',
            'field_admin_ids' => 'Admin Telegram IDs',
            'help_admin_ids' => 'Comma-separated numeric user IDs allowed to open the admin page.',
            'field_tg_token' => 'Telegram Analytics token',
            'help_tg_token' => 'JWT issued by @DataChief_bot for this mini app.',
            'field_tg_app' => 'Telegram Analytics app name',
            'help_tg_app' => 'Analytics app identifier, usually the bot username.',
            'field_yandex' => 'Yandex.Metrika counter ID',
            'help_yandex' => 'Numeric counter ID from metrika.yandex.ru.',
            'field_changenow_id' => 'ChangeNOW link_id',
            'help_changenow_id' => 'Partner link_id used in exchange widgets and stats requests.',
            'field_changenow_key' => 'ChangeNOW API key',
            'help_changenow_key' => 'Optional server-side API key. It is not written to browser config.',
            'field_worker_url' => 'Worker/backend URL',
            'help_worker_url' => 'Optional Cloudflare Worker or PHP backend URL.',
            'field_sentry_dsn' => 'Sentry DSN',
            'help_sentry_dsn' => 'Optional browser DSN from Sentry project settings.',
            'field_sentry_env' => 'Sentry environment',
            'help_sentry_env' => 'Deployment environment name, for example production.',
            'field_sentry_rate' => 'Sentry traces sample rate',
            'help_sentry_rate' => 'Number from 0 to 1. Use 0 to disable performance traces.',
            'field_mysql_host' => 'Host',
            'help_mysql_host' => 'Usually localhost, 127.0.0.1, or the host from your hosting panel.',
            'field_mysql_port' => 'Port',
            'help_mysql_port' => 'Default MySQL port is 3306.',
            'field_mysql_database' => 'Database name',
            'field_mysql_username' => 'Username',
            'field_mysql_password' => 'Password',
            'field_mysql_charset' => 'Character set',
            'field_mysql_prefix' => 'Table prefix',
            'help_mysql_prefix' => 'Use a unique prefix if the database is shared, for example tonbridge_.',
            'field_create_tables' => 'Create installer tables',
            'help_create_tables' => 'Creates settings and install_log tables using the prefix above.',
        ],
        'ru' => [
            'language_name' => 'Русский',
            'step_requirements' => 'Требования',
            'step_application' => 'Приложение',
            'step_integrations' => 'Интеграции',
            'step_database' => 'База данных',
            'step_review' => 'Проверка',
            'subtitle' => 'Настройте PHP 8.1+ и MySQL хостинг в одном пошаговом мастере.',
            'language_label' => 'Язык',
            'locked_title' => 'Установка заблокирована',
            'locked_done' => 'Установщик уже завершил работу и создал <code>installer/.installed</code>.',
            'locked_security' => 'Для безопасности удалите каталог installer с хостинга после проверки приложения. Чтобы запустить установку снова, вручную удалите <code>installer/.installed</code>.',
            'success_title' => 'Установка завершена.',
            'success_body' => 'Файлы конфигурации записаны, блокировка установщика создана.',
            'next_steps' => 'Следующие шаги',
            'botfather_next' => 'Откройте настройки бота в BotFather и укажите URL мини-приложения <code>%s</code>. Затем удалите каталог installer с сервера.',
            'written_files' => 'Записанные или обновленные файлы:',
            'requirements_title' => 'Требования хостинга',
            'requirements_intro' => 'Установщик записывает <code>.env</code>, <code>config/tonbridge.php</code>, <code>assets/js/tonbridge-config.js</code> и обновляет статические плейсхолдеры деплоя.',
            'required' => 'обязательно',
            'optional' => 'необязательно',
            'application_title' => 'Приложение и Telegram',
            'application_help' => 'Используйте публичный HTTPS адрес, где размещены файлы. Telegram username вводится без @. ID администраторов - это числовые Telegram user ID, а не username.',
            'analytics_title' => 'Аналитика и сервисы',
            'analytics_help' => 'Заполните значения из кабинетов провайдеров. Необязательные серверные секреты сохраняются только в серверную конфигурацию и не попадают в браузерный config.',
            'database_title' => 'База данных MySQL',
            'database_intro' => 'Установщик проверяет подключение и может создать небольшие таблицы настроек и логов для этого деплоя.',
            'database_help' => 'Сначала создайте пустую базу и пользователя в панели хостинга, затем вставьте параметры подключения здесь. Для первой установки оставьте создание таблиц включенным.',
            'review_title' => 'Проверка конфигурации',
            'review_intro' => 'Отправка этого шага записывает серверный config, публичный браузерный config, TonConnect manifest, статические плейсхолдеры и блокировку установщика.',
            'back' => 'Назад',
            'next' => 'Далее',
            'install' => 'Установить',
            'summary_application' => 'Приложение',
            'summary_base_url' => 'Base URL',
            'summary_telegram_bot' => 'Telegram bot',
            'summary_mini_app' => 'Короткое имя mini app',
            'summary_schema' => 'Таблицы схемы',
            'summary_create' => 'Создать или обновить',
            'summary_skip' => 'Пропустить',
            'field_app_name' => 'Название приложения',
            'help_app_name' => 'Показывается в manifest и метаданных подключения Telegram.',
            'field_base_url' => 'Публичный URL приложения',
            'help_base_url' => 'Полный HTTPS URL папки, например https://example.com/bridge. Не добавляйте /installer.',
            'field_icon_url' => 'Публичный URL иконки',
            'help_icon_url' => 'HTTPS PNG иконка для tonconnect-manifest.json. Оставьте пустым, чтобы использовать встроенную иконку.',
            'field_bot_username' => 'Username Telegram бота',
            'help_bot_username' => 'Username из BotFather без @, например ExampleBridgeBot.',
            'field_mini_app' => 'Короткое имя mini app',
            'help_mini_app' => 'Короткое имя мини-приложения из BotFather, обычно app.',
            'field_bot_token' => 'Токен Telegram бота',
            'help_bot_token' => 'Необязательный токен из BotFather. Записывается только в серверный config.',
            'field_support_bot' => 'Username бота поддержки',
            'help_support_bot' => 'Необязательный username бота поддержки без @.',
            'field_admin_ids' => 'Telegram ID администраторов',
            'help_admin_ids' => 'Числовые user ID через запятую для доступа к admin page.',
            'field_tg_token' => 'Токен Telegram Analytics',
            'help_tg_token' => 'JWT, выданный @DataChief_bot для этого mini app.',
            'field_tg_app' => 'Имя приложения Telegram Analytics',
            'help_tg_app' => 'Идентификатор приложения в аналитике, обычно username бота.',
            'field_yandex' => 'ID счетчика Yandex.Metrika',
            'help_yandex' => 'Числовой ID счетчика из metrika.yandex.ru.',
            'field_changenow_id' => 'ChangeNOW link_id',
            'help_changenow_id' => 'Партнерский link_id для exchange widget и stats запросов.',
            'field_changenow_key' => 'ChangeNOW API key',
            'help_changenow_key' => 'Необязательный серверный API key. Не записывается в браузерный config.',
            'field_worker_url' => 'URL Worker/backend',
            'help_worker_url' => 'Необязательный URL Cloudflare Worker или PHP backend.',
            'field_sentry_dsn' => 'Sentry DSN',
            'help_sentry_dsn' => 'Необязательный browser DSN из настроек проекта Sentry.',
            'field_sentry_env' => 'Sentry environment',
            'help_sentry_env' => 'Название окружения деплоя, например production.',
            'field_sentry_rate' => 'Sentry traces sample rate',
            'help_sentry_rate' => 'Число от 0 до 1. Используйте 0, чтобы отключить performance traces.',
            'field_mysql_host' => 'Host',
            'help_mysql_host' => 'Обычно localhost, 127.0.0.1 или host из панели хостинга.',
            'field_mysql_port' => 'Port',
            'help_mysql_port' => 'Стандартный порт MySQL - 3306.',
            'field_mysql_database' => 'Имя базы данных',
            'field_mysql_username' => 'Username',
            'field_mysql_password' => 'Пароль',
            'field_mysql_charset' => 'Кодировка',
            'field_mysql_prefix' => 'Префикс таблиц',
            'help_mysql_prefix' => 'Используйте уникальный префикс, если база общая, например tonbridge_.',
            'field_create_tables' => 'Создать таблицы установщика',
            'help_create_tables' => 'Создает таблицы settings и install_log с указанным выше префиксом.',
        ],
    ];
}

function tonbridge_installer_language(array $translations): string
{
    $candidate = (string) ($_POST['language'] ?? $_GET['language'] ?? $_SESSION['tonbridge_installer_language'] ?? 'en');

    return isset($translations[$candidate]) ? $candidate : 'en';
}

function t(string $key): string
{
    global $translations, $language;

    return $translations[$language][$key] ?? $translations['en'][$key] ?? $key;
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
<html lang="<?php echo h($language); ?>">
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
        .header-tools {
            display: flex;
            flex-direction: column;
            gap: 10px;
            align-items: flex-end;
        }
        .language-form {
            display: flex;
            gap: 8px;
            align-items: center;
            color: var(--muted);
            font-size: 13px;
        }
        .language-form select {
            width: auto;
            min-width: 130px;
            padding: 7px 9px;
            font-size: 13px;
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
        .help-panel {
            border: 1px solid #b2ddff;
            background: #eff8ff;
            border-radius: 8px;
            padding: 12px 14px;
            color: #184e77;
            margin-bottom: 16px;
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
            .header-tools { align-items: flex-start; margin-top: 12px; }
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
            <p><?php echo h(t('subtitle')); ?></p>
        </div>
        <div class="header-tools">
            <div class="version">Installer <?php echo h(TONBRIDGE_INSTALLER_VERSION); ?></div>
            <form class="language-form" method="get">
                <input type="hidden" name="step" value="<?php echo h((string) $step); ?>">
                <label for="installer-language"><?php echo h(t('language_label')); ?></label>
                <select id="installer-language" name="language" onchange="this.form.submit()">
                    <?php foreach ($translations as $code => $messages): ?>
                        <option value="<?php echo h($code); ?>" <?php echo $language === $code ? 'selected' : ''; ?>><?php echo h($messages['language_name']); ?></option>
                    <?php endforeach; ?>
                </select>
            </form>
        </div>
    </header>

    <?php if (is_file($lockFile) && !$success): ?>
        <section class="panel">
            <h2><?php echo h(t('locked_title')); ?></h2>
            <p><?php echo t('locked_done'); ?></p>
            <p><?php echo t('locked_security'); ?></p>
        </section>
    <?php else: ?>
        <nav class="steps" aria-label="<?php echo h(t('step_requirements')); ?>">
            <?php foreach ($steps as $index => $label): ?>
                <div class="step <?php echo h(step_class($step, $index)); ?>"><?php echo h((string) $index . '. ' . $label); ?></div>
            <?php endforeach; ?>
        </nav>

        <section class="panel">
            <?php if ($success): ?>
                <div class="success">
                    <strong><?php echo h(t('success_title')); ?></strong>
                    <?php echo h(t('success_body')); ?>
                </div>
                <h2><?php echo h(t('next_steps')); ?></h2>
                <p><?php echo sprintf(t('botfather_next'), h(($data['base_url'] ?? '') . '/index.html')); ?></p>
                <p><?php echo h(t('written_files')); ?></p>
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
                    <input type="hidden" name="language" value="<?php echo h($language); ?>">

                    <?php if ($step === 1): ?>
                        <h2><?php echo h(t('requirements_title')); ?></h2>
                        <p><?php echo t('requirements_intro'); ?></p>
                        <?php $checks = tonbridge_installer_environment_checks($rootDir); ?>
                        <?php foreach ($checks as $check): ?>
                            <div class="check-row">
                                <span class="status <?php echo $check['ok'] ? 'ok' : ''; ?>" aria-hidden="true"></span>
                                <div>
                                    <strong><?php echo h($check['label']); ?></strong>
                                    <div><small><?php echo h($check['detail']); ?></small></div>
                                </div>
                                <span class="badge"><?php echo h($check['required'] ? t('required') : t('optional')); ?></span>
                            </div>
                        <?php endforeach; ?>
                    <?php elseif ($step === 2): ?>
                        <h2><?php echo h(t('application_title')); ?></h2>
                        <div class="help-panel"><?php echo h(t('application_help')); ?></div>
                        <div class="grid">
                            <?php text_field($data, $errors, 'app_name', t('field_app_name'), t('help_app_name'), 'text', true); ?>
                            <?php text_field($data, $errors, 'base_url', t('field_base_url'), t('help_base_url'), 'url', true); ?>
                            <?php text_field($data, $errors, 'icon_url', t('field_icon_url'), t('help_icon_url'), 'url'); ?>
                            <?php text_field($data, $errors, 'telegram_bot_username', t('field_bot_username'), t('help_bot_username'), 'text', true); ?>
                            <?php text_field($data, $errors, 'telegram_mini_app_short_name', t('field_mini_app'), t('help_mini_app'), 'text', true); ?>
                            <?php text_field($data, $errors, 'telegram_bot_token', t('field_bot_token'), t('help_bot_token'), 'password'); ?>
                            <?php text_field($data, $errors, 'support_bot_username', t('field_support_bot'), t('help_support_bot'), 'text'); ?>
                            <?php textarea_field($data, $errors, 'admin_telegram_ids', t('field_admin_ids'), t('help_admin_ids')); ?>
                        </div>
                    <?php elseif ($step === 3): ?>
                        <h2><?php echo h(t('analytics_title')); ?></h2>
                        <div class="help-panel"><?php echo h(t('analytics_help')); ?></div>
                        <div class="grid">
                            <?php text_field($data, $errors, 'tg_analytics_token', t('field_tg_token'), t('help_tg_token'), 'password', true); ?>
                            <?php text_field($data, $errors, 'tg_analytics_app_name', t('field_tg_app'), t('help_tg_app'), 'text', true); ?>
                            <?php text_field($data, $errors, 'yandex_metrika_id', t('field_yandex'), t('help_yandex'), 'text', true); ?>
                            <?php text_field($data, $errors, 'changenow_link_id', t('field_changenow_id'), t('help_changenow_id'), 'text', true); ?>
                            <?php text_field($data, $errors, 'changenow_api_key', t('field_changenow_key'), t('help_changenow_key'), 'password'); ?>
                            <?php text_field($data, $errors, 'worker_base_url', t('field_worker_url'), t('help_worker_url'), 'url'); ?>
                            <?php text_field($data, $errors, 'sentry_dsn', t('field_sentry_dsn'), t('help_sentry_dsn'), 'url'); ?>
                            <?php text_field($data, $errors, 'sentry_environment', t('field_sentry_env'), t('help_sentry_env'), 'text'); ?>
                            <?php text_field($data, $errors, 'sentry_traces_sample_rate', t('field_sentry_rate'), t('help_sentry_rate'), 'text'); ?>
                        </div>
                    <?php elseif ($step === 4): ?>
                        <h2><?php echo h(t('database_title')); ?></h2>
                        <p><?php echo h(t('database_intro')); ?></p>
                        <div class="help-panel"><?php echo h(t('database_help')); ?></div>
                        <div class="grid">
                            <?php text_field($data, $errors, 'mysql_host', t('field_mysql_host'), t('help_mysql_host'), 'text', true); ?>
                            <?php text_field($data, $errors, 'mysql_port', t('field_mysql_port'), t('help_mysql_port'), 'number', true); ?>
                            <?php text_field($data, $errors, 'mysql_database', t('field_mysql_database'), '', 'text', true); ?>
                            <?php text_field($data, $errors, 'mysql_username', t('field_mysql_username'), '', 'text', true); ?>
                            <?php text_field($data, $errors, 'mysql_password', t('field_mysql_password'), '', 'password'); ?>
                            <?php select_field($data, $errors, 'mysql_charset', t('field_mysql_charset'), ['utf8mb4' => 'utf8mb4', 'utf8' => 'utf8']); ?>
                            <?php text_field($data, $errors, 'mysql_table_prefix', t('field_mysql_prefix'), t('help_mysql_prefix'), 'text', true); ?>
                            <label class="field">
                                <span><?php echo h(t('field_create_tables')); ?></span>
                                <input type="checkbox" name="mysql_create_schema" value="1" <?php echo !empty($data['mysql_create_schema']) ? 'checked' : ''; ?>>
                                <small><?php echo h(t('help_create_tables')); ?></small>
                            </label>
                        </div>
                        <?php echo field_error($errors, 'database_connection'); ?>
                    <?php else: ?>
                        <h2><?php echo h(t('review_title')); ?></h2>
                        <p><?php echo h(t('review_intro')); ?></p>
                        <div class="summary">
                            <div><?php echo h(t('summary_application')); ?></div><div><?php echo h((string) $data['app_name']); ?></div>
                            <div><?php echo h(t('summary_base_url')); ?></div><div><?php echo h((string) $data['base_url']); ?></div>
                            <div><?php echo h(t('summary_telegram_bot')); ?></div><div>@<?php echo h((string) $data['telegram_bot_username']); ?></div>
                            <div><?php echo h(t('summary_mini_app')); ?></div><div><?php echo h((string) $data['telegram_mini_app_short_name']); ?></div>
                            <div>ChangeNOW link_id</div><div><?php echo h((string) $data['changenow_link_id']); ?></div>
                            <div>Yandex.Metrika</div><div><?php echo h((string) $data['yandex_metrika_id']); ?></div>
                            <div>MySQL</div><div><?php echo h((string) $data['mysql_username']); ?>@<?php echo h((string) $data['mysql_host']); ?>:<?php echo h((string) $data['mysql_port']); ?>/<?php echo h((string) $data['mysql_database']); ?></div>
                            <div><?php echo h(t('summary_schema')); ?></div><div><?php echo h(!empty($data['mysql_create_schema']) ? t('summary_create') : t('summary_skip')); ?></div>
                        </div>
                    <?php endif; ?>

                    <div class="actions">
                        <button class="secondary" type="submit" name="action" value="back" <?php echo $step === 1 ? 'disabled' : ''; ?>><?php echo h(t('back')); ?></button>
                        <?php if ($step < 5): ?>
                            <button type="submit" name="action" value="next"><?php echo h(t('next')); ?></button>
                        <?php else: ?>
                            <button type="submit" name="action" value="install"><?php echo h(t('install')); ?></button>
                        <?php endif; ?>
                    </div>
                </form>
            <?php endif; ?>
        </section>
    <?php endif; ?>
</main>
</body>
</html>
