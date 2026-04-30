// Calls Telegram.WebApp.switchInlineQuery with the given prefill text.
// Falls back to a no-op when running outside Telegram or on older SDK versions.
function sendToChat(query) {
    var tg = window.Telegram && window.Telegram.WebApp;
    if (!tg || typeof tg.switchInlineQuery !== 'function') return;
    tg.switchInlineQuery(query || '', ['users', 'groups', 'channels']);
}
