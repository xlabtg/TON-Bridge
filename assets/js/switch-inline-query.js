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

// Hide every #send-to-chat-btn when switchInlineQuery is not available
// (outside Telegram or on older SDK versions that don't support inline mode).
function initSendToChatButton() {
    var tg = window.Telegram && window.Telegram.WebApp;
    var available = tg && typeof tg.switchInlineQuery === 'function';
    var buttons = document.querySelectorAll('#send-to-chat-btn');
    for (var i = 0; i < buttons.length; i++) {
        buttons[i].style.display = available ? '' : 'none';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSendToChatButton);
} else {
    initSendToChatButton();
}
