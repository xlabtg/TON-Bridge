// shareToStory — show a "Share my bridge" dialog after a successful exchange.
// Called with metadata captured from the widget's success/finish postMessage.
(function () {
    var tg = window.Telegram && window.Telegram.WebApp;

    // Generate a 1080×1920 story card PNG and return a data-URL.
    function buildStoryCard(amount, asset, seconds) {
        var canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        var ctx = canvas.getContext('2d');

        // Background gradient
        var grad = ctx.createLinearGradient(0, 0, 0, 1920);
        grad.addColorStop(0, '#0088cc');
        grad.addColorStop(1, '#004488');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1080, 1920);

        // White card
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        roundRect(ctx, 80, 680, 920, 560, 40);
        ctx.fill();

        // Logo text (fallback if image unavailable)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 64px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TON Bridge', 540, 780);

        // Amount + asset
        ctx.font = 'bold 112px sans-serif';
        ctx.fillText((amount || '?') + ' ' + (asset || ''), 540, 940);

        // Time line
        ctx.font = '52px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        if (seconds != null) {
            ctx.fillText('Done in ' + seconds + ' s', 540, 1040);
        }

        // CTA sticker
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, 290, 1140, 500, 100, 50);
        ctx.fill();
        ctx.fillStyle = '#0088cc';
        ctx.font = 'bold 44px sans-serif';
        ctx.fillText('Try it →', 540, 1202);

        return canvas.toDataURL('image/png');
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // Detect page language: prefer <html lang>, fall back to URL suffix.
    function detectLang() {
        var lang = document.documentElement.lang || '';
        if (lang === 'ru') return 'ru';
        if (window.location.pathname.indexOf('-ru.') !== -1 ||
            window.location.href.indexOf('-ru.') !== -1) return 'ru';
        return 'en';
    }

    // Build the share caption in the current page's language.
    function buildCaption(amount, asset, seconds) {
        var lang = detectLang();
        if (lang === 'ru') {
            return 'Обменял ' + (amount || '?') + ' ' + (asset || '') +
                (seconds != null ? ' за ' + seconds + ' с' : '') +
                ' через @TONBridge_robot';
        }
        return 'Bridged ' + (amount || '?') + ' ' + (asset || '') +
            (seconds != null ? ' in ' + seconds + 's' : '') +
            ' with @TONBridge_robot';
    }

    // Derive referral code: prefer the value cached in localStorage by #6.2,
    // fall back to an empty string so the sticker still works.
    function getReferralCode() {
        try { return localStorage.getItem('tonbridge_ref') || ''; } catch (e) { return ''; }
    }

    function buildStickerUrl(refCode) {
        var base = 'https://t.me/TONBridge_robot/app';
        return refCode ? base + '?startapp=ref_' + refCode : base;
    }

    // Returns true when shareToStory is available (Telegram Bot API >= 7.8).
    function supportsShareToStory() {
        return tg && typeof tg.shareToStory === 'function';
    }

    // Attempt the native shareToStory; fall back to URL-share link.
    function doShare(amount, asset, seconds) {
        var caption = buildCaption(amount, asset, seconds);
        var refCode = getReferralCode();
        var stickerUrl = buildStickerUrl(refCode);

        if (supportsShareToStory()) {
            var mediaUrl = buildStoryCard(amount, asset, seconds);
            tg.shareToStory(mediaUrl, {
                text: caption,
                widget_link: { url: stickerUrl, name: 'Try it →' },
            });
        } else if (tg && tg.openTelegramLink) {
            var shareUrl = 'https://t.me/share/url?url=' +
                encodeURIComponent(stickerUrl) +
                '&text=' + encodeURIComponent(caption);
            tg.openTelegramLink(shareUrl);
        }
    }

    // Show a non-blocking toast-style dialog prompting the user to share.
    function showShareDialog(amount, asset, seconds) {
        if (document.getElementById('share-story-dialog')) return;

        var lang = detectLang();
        var btnLabel = lang === 'ru' ? 'Поделиться историей' : 'Share my bridge';
        var skipLabel = lang === 'ru' ? 'Пропустить' : 'Skip';

        var dialog = document.createElement('div');
        dialog.id = 'share-story-dialog';
        dialog.className = 'toast-box show';
        dialog.style.cssText = [
            'position:fixed',
            'bottom:80px',
            'left:50%',
            'transform:translateX(-50%)',
            'z-index:9999',
            'min-width:280px',
            'max-width:90vw',
            'background:#fff',
            'border-radius:16px',
            'box-shadow:0 4px 24px rgba(0,0,0,0.18)',
            'padding:20px 24px',
            'text-align:center',
        ].join(';');

        var shareBtn = document.createElement('button');
        shareBtn.className = 'btn btn-primary btn-block';
        shareBtn.style.cssText = 'width:100%;margin-bottom:10px;';
        shareBtn.textContent = btnLabel;
        shareBtn.addEventListener('click', function () {
            doShare(amount, asset, seconds);
            remove();
        });

        var skipBtn = document.createElement('button');
        skipBtn.className = 'btn btn-secondary btn-block';
        skipBtn.style.cssText = 'width:100%;';
        skipBtn.textContent = skipLabel;
        skipBtn.addEventListener('click', remove);

        dialog.appendChild(shareBtn);
        dialog.appendChild(skipBtn);
        document.body.appendChild(dialog);

        function remove() {
            if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        }

        // Auto-dismiss after 30 s so it never blocks the user permanently.
        setTimeout(remove, 30000);
    }

    // Listen for the widget's postMessage events.
    window.addEventListener('message', function (event) {
        if (!event.data || typeof event.data !== 'object') return;
        var type = event.data.type;
        if (type !== 'change-now-widget-step' && type !== 'deeplink') return;
        var step = event.data.step || event.data.value || '';
        if (step !== 'success' && step !== 'finish') return;

        // Capture exchange metadata when present in the payload.
        var amount = event.data.amount || event.data.fromAmount || null;
        var asset = event.data.currency || event.data.fromCurrency || null;
        var seconds = event.data.seconds != null ? event.data.seconds : null;

        showShareDialog(amount, asset, seconds);
    });

    // Expose internals for testing.
    window.__shareToStory = {
        detectLang: detectLang,
        buildCaption: buildCaption,
        buildStoryCard: buildStoryCard,
        buildStickerUrl: buildStickerUrl,
        supportsShareToStory: supportsShareToStory,
        doShare: doShare,
        showShareDialog: showShareDialog,
    };
})();
