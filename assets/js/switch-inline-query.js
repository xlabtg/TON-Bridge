// Calls Telegram.WebApp.switchInlineQuery with the given prefill text.
// Falls back to a no-op when running outside Telegram or on older SDK versions.
function sendToChat(query) {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || typeof tg.switchInlineQuery !== 'function') return;
    tg.switchInlineQuery(query || '', ['users', 'groups', 'channels']);
}

function sendToChatFromButton(button) {
    var key = button && button.getAttribute('data-send-to-chat-query-key');
    var fallback = button && button.getAttribute('data-send-to-chat-fallback-query');
    var query = fallback || '';

    if (key && window.i18n && typeof i18n.t === 'function') {
        query = i18n.t(key, fallback || '');
    }

    sendToChat(query);
}
