# TON-Bridge Installer

A step-by-step PHP installer for deploying the TON-Bridge mini app on a
PHP 8.1+ / MySQL hosting account. The installer collects configuration
through a guided UI (English + Russian), validates inputs, tests the
MySQL connection, writes the runtime configuration files, optionally
creates the small settings/log schema, and seals itself with a
`installer/.installed` lock for safety.

> [Русская версия](#русская-версия) ниже.

## Contents

- [What the installer produces](#what-the-installer-produces)
- [Requirements](#requirements)
- [Step-by-step deployment](#step-by-step-deployment)
- [Re-running the installer](#re-running-the-installer)
- [Backups](#backups)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [File layout](#file-layout)

## What the installer produces

When the user clicks **Install** the installer writes / updates:

| File                                  | Purpose                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| `.env`                                | Server-side environment values used by build tooling and PHP backend |
| `config/tonbridge.php`                | Typed PHP config returned by `require`                               |
| `assets/js/tonbridge-config.js`       | Read-only public config consumed by the browser                      |
| `tonconnect-manifest.json`            | TonConnect manifest (URL, name, icon)                                |
| Static HTML/JS placeholders           | Replaces `%%TG_ANALYTICS_TOKEN%%`, `%%YANDEX_METRIKA_ID%%`, etc.     |
| `installer/.installed`                | Lock file that prevents the installer from running twice             |

Server-only secrets such as `TELEGRAM_BOT_TOKEN`, `CHANGENOW_API_KEY`,
and the database password are written only to `.env` and
`config/tonbridge.php`; they never appear in the browser bundle.

## Requirements

- PHP 8.1 or newer
- PHP extensions: `pdo`, `pdo_mysql`, `openssl`, `json` (typically built in)
- MySQL 5.7+ / MariaDB 10.3+ (an empty database + user created in the hosting panel)
- Write access to the document root, the `assets/js/` and `config/` directories
- HTTPS endpoint for the mini app (Telegram requires HTTPS for mini apps)

The first step of the installer runs these checks automatically. If
any required item is missing, the **Install** action is blocked until
the hosting account is fixed.

## Step-by-step deployment

1. **Upload the project** to your hosting account so that `index.html`
   is served from the public folder (for example `/public_html/bridge/`).
2. **Create a MySQL database and a database user** in your hosting
   control panel. Note the host, port (usually `3306`), database name,
   user, and password.
3. Open `https://<your-domain>/<install-path>/installer/` in your
   browser.
4. **Step 1 – Requirements** verifies PHP, extensions, and write access.
5. **Step 2 – Application** captures application name, public HTTPS
   URL, Telegram bot username, mini app short name, optional bot token,
   support bot, and admin Telegram IDs.
6. **Step 3 – Integrations** captures Telegram Analytics token, Yandex
   Metrika counter, ChangeNOW `link_id`, optional ChangeNOW API key,
   optional worker/back-end URL, and Sentry DSN/environment/sample rate.
7. **Step 4 – Database** asks for MySQL host, port, database, user,
   password, character set, table prefix, and whether to create the
   settings/log schema. Click **Test database connection** to verify
   the credentials before continuing.
8. **Step 5 – Review** shows a summary. Click **Install** to write the
   files, run the optional schema migration, and seal the installer.
9. After installation completes, open the public URL and verify the
   mini app loads. Then point BotFather's mini app URL at it.
10. **Remove the `installer/` directory from the hosting account** (or
    leave the `.installed` lock in place) so the installer cannot be
    re-run by unauthorized visitors.

## Re-running the installer

The installer refuses to run again while `installer/.installed`
exists. To re-run intentionally (e.g. moving to a new domain) delete
`installer/.installed` manually, then revisit the installer URL.

Re-running overwrites the four configuration files listed above. The
previous version of each overwritten file is preserved as
`<file>.bak-YYYYmmdd-HHMMSS` next to the original so changes can be
inspected or reverted.

## Backups

Each time the installer writes one of the four configuration files it
first copies the existing file (if any) to a timestamped backup such
as `.env.bak-20260520-013045`. The list of backups is displayed at the
end of a successful install. Delete old backups manually once you no
longer need them.

## Security notes

- `installer/.installed` is denied to web visitors by
  `installer/.htaccess`.
- Directory indexing is disabled in `installer/.htaccess` (`Options
  -Indexes`).
- The installer enforces an HTTPS public URL.
- The MySQL password and Telegram bot token are written only to
  `.env` and `config/tonbridge.php`; both files are chmod'd to `0640`
  by the installer.
- CSRF tokens are bound to the installer session.
- Once the installer finishes, the hosting account should remove the
  whole `installer/` directory.

## Troubleshooting

| Symptom                                            | Likely cause                                  | Fix                                                                                          |
| -------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Step 1 reports `assets/js writable` failing        | Hosting permissions block PHP writes          | Set the directory to `0755` (or `0775` on shared hosts) and rerun the installer              |
| `pdo_mysql extension is missing` on step 1         | PHP build without `pdo_mysql`                 | Enable the extension in the hosting control panel or switch PHP versions                     |
| `Test database connection` returns `Access denied` | Wrong user/password or host                   | Verify the credentials in the hosting database panel; ensure the user is granted the DB      |
| Step 5 errors with `Unable to write file`          | The document root or `config/` is read-only   | Make the directory writable, then click **Back** and **Install** again                       |
| Installer page returns `Invalid session token`     | Browser session expired or cookies disabled   | Re-open the installer URL in a fresh tab with cookies enabled                                |

## File layout

```
installer/
├── .htaccess              # Deny .installed; disable directory indexing
├── README.md              # This file
├── index.php              # UI entry point (renders the step wizard)
├── schema/
│   └── mysql.sql          # Reference schema (the installer creates these tables automatically)
└── src/
    ├── .htaccess          # Deny direct access to PHP source
    └── Installer.php      # Pure functions covered by tests/installer*.test.php
```

The pure functions in `src/Installer.php` are unit-tested in:

- `tests/installer.test.php`           – validation, env/config generation, static replacements
- `tests/installer-navigation.test.php` – multi-step navigation
- `tests/installer-review.test.php`     – review step rendering and schema-flag persistence

Run them locally with:

```bash
php tests/installer.test.php
php tests/installer-navigation.test.php
php tests/installer-review.test.php
```

CI runs all three on every pull request (see `.github/workflows/ci.yml`).

---

## Русская версия

Установщик TON-Bridge — это пошаговый PHP-мастер для развертывания
мини-приложения на PHP 8.1+/MySQL хостинге. Он собирает параметры в
удобном UI (русский + английский), проверяет ввод, тестирует
подключение к MySQL, записывает файлы конфигурации, при необходимости
создает таблицы настроек и журнала, а затем блокирует себя файлом
`installer/.installed` для безопасности.

### Что устанавливается

| Файл                                  | Назначение                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `.env`                                | Серверные переменные окружения для билда и PHP backend                                |
| `config/tonbridge.php`                | Типизированный PHP-конфиг, доступен через `require`                                   |
| `assets/js/tonbridge-config.js`       | Публичный браузерный конфиг (read-only)                                               |
| `tonconnect-manifest.json`            | TonConnect manifest (URL, имя, иконка)                                                |
| Статические HTML/JS плейсхолдеры      | Заменяются `%%TG_ANALYTICS_TOKEN%%`, `%%YANDEX_METRIKA_ID%%` и др.                    |
| `installer/.installed`                | Lock-файл, запрещающий повторный запуск установщика                                   |

Серверные секреты (`TELEGRAM_BOT_TOKEN`, `CHANGENOW_API_KEY`, пароль
БД) сохраняются только в `.env` и `config/tonbridge.php` и никогда не
попадают в браузерный бандл.

### Требования

- PHP 8.1 или новее
- Расширения PHP: `pdo`, `pdo_mysql`, `openssl`, `json`
- MySQL 5.7+ / MariaDB 10.3+ (база и пользователь создаются в панели хостинга)
- Право записи в корне проекта, `assets/js/` и `config/`
- HTTPS-адрес для мини-приложения (требование Telegram)

Шаг 1 установщика автоматически проверяет эти пункты. Пока требования
не выполнены, кнопка **Установить** недоступна.

### Пошаговое развертывание

1. **Загрузите проект** на хостинг так, чтобы `index.html` отдавался
   из публичной папки (например `/public_html/bridge/`).
2. **Создайте базу данных MySQL и пользователя** в панели хостинга.
   Запишите host, port (обычно `3306`), имя базы, пользователя и
   пароль.
3. Откройте `https://<домен>/<путь-к-приложению>/installer/` в браузере.
4. **Шаг 1 — Требования** проверяет PHP, расширения и права записи.
5. **Шаг 2 — Приложение** — название приложения, публичный HTTPS-URL,
   username бота, короткое имя mini app, опционально токен бота, бот
   поддержки и Telegram ID администраторов.
6. **Шаг 3 — Интеграции** — токен Telegram Analytics, ID счетчика
   Yandex.Metrika, ChangeNOW `link_id`, опциональный API key
   ChangeNOW, URL Worker/backend и параметры Sentry.
7. **Шаг 4 — База данных** — host, port, имя базы, пользователь,
   пароль, charset, префикс таблиц и флаг создания таблиц настроек.
   Нажмите **Проверить подключение к базе данных**, чтобы убедиться,
   что реквизиты верны, прежде чем продолжить.
8. **Шаг 5 — Проверка** — сводка введенных параметров. Нажмите
   **Установить**, чтобы записать файлы, выполнить опциональную
   миграцию и заблокировать установщик.
9. После установки откройте публичный URL и убедитесь, что
   мини-приложение работает. Затем укажите этот URL в BotFather.
10. **Удалите каталог `installer/` с хостинга** (или оставьте файл
    `.installed`), чтобы установщик нельзя было запустить повторно.

### Повторный запуск установщика

Установщик отказывается запускаться, пока существует
`installer/.installed`. Чтобы запустить его повторно (например, при
переносе на новый домен), удалите `installer/.installed` вручную и
снова откройте URL установщика.

Повторный запуск перезаписывает четыре файла конфигурации. Прежняя
версия каждого файла сохраняется рядом с оригиналом как
`<файл>.bak-YYYYmmdd-HHMMSS`, чтобы можно было сравнить или
откатить.

### Резервные копии

Перед записью каждого из четырёх файлов конфигурации установщик
копирует прежнюю версию (если она существует) в файл вида
`.env.bak-20260520-013045`. Список созданных копий выводится в конце
успешной установки. Удаляйте старые копии вручную, когда они уже не
нужны.

### Безопасность

- `installer/.installed` запрещён к скачиванию через
  `installer/.htaccess`.
- Листинг каталога отключён (`Options -Indexes`).
- Установщик требует HTTPS для публичного URL.
- Пароль MySQL и токен бота сохраняются только в `.env` и
  `config/tonbridge.php`. Оба файла получают права `0640`.
- CSRF-токен привязан к сессии установщика.
- После завершения установки удалите каталог `installer/` целиком.

### Решение проблем

| Симптом                                                   | Причина                                       | Решение                                                                                          |
| --------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Шаг 1: `assets/js writable` не проходит                   | Хостинг запрещает запись                      | Установите `0755` (или `0775` на shared) и повторите                                            |
| `pdo_mysql extension is missing` на шаге 1                | PHP собран без `pdo_mysql`                    | Включите расширение в панели хостинга или выберите другую версию PHP                            |
| `Test database connection` возвращает `Access denied`     | Неверные реквизиты или host                   | Проверьте реквизиты в панели; убедитесь, что у пользователя есть права на базу                  |
| Шаг 5: ошибка `Unable to write file`                      | Корень или `config/` недоступен для записи    | Сделайте каталог доступным для записи, вернитесь и нажмите **Установить** снова                  |
| Установщик отвечает `Invalid session token`               | Сессия истекла или отключены cookies          | Откройте URL установщика в новой вкладке с включенными cookies                                  |

### Структура каталога

```
installer/
├── .htaccess              # Запрет .installed; отключение листинга
├── README.md              # Этот файл
├── index.php              # UI установщика (мастер по шагам)
├── schema/
│   └── mysql.sql          # Справочная схема таблиц установщика
└── src/
    ├── .htaccess          # Запрет прямого доступа к PHP-исходникам
    └── Installer.php      # Чистые функции, покрытые unit-тестами
```

Запуск тестов локально:

```bash
php tests/installer.test.php
php tests/installer-navigation.test.php
php tests/installer-review.test.php
```

CI запускает все три файла на каждом PR (см. `.github/workflows/ci.yml`).
