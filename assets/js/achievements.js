// Achievement / level system — persisted in Telegram.WebApp.CloudStorage.
// Tiers are computed from swap count and/or lifetime USD turnover, whichever
// reaches a threshold first.  On tier-up, a celebration modal is shown with a
// Share CTA wired to Telegram.WebApp.shareToStory (issue #4.2).
(function () {
    var TIERS = [
        {
            id: 'bronze',
            label: 'Bronze',
            emoji: '🥉',
            minSwaps: 1,
            minVolume: 0,
            flair: 'tier-bronze',
        },
        {
            id: 'silver',
            label: 'Silver',
            emoji: '🥈',
            minSwaps: 10,
            minVolume: 0,
            flair: 'tier-silver',
        },
        {
            id: 'gold',
            label: 'Gold',
            emoji: '🥇',
            minSwaps: 100,
            minVolume: 10000,
            flair: 'tier-gold',
        },
        {
            id: 'platinum',
            label: 'Platinum',
            emoji: '💎',
            minSwaps: 1000,
            minVolume: 100000,
            flair: 'tier-platinum',
        },
    ];

    var STORAGE_KEY = 'achievementStats';
    var tg = window.Telegram && window.Telegram.WebApp;

    // CloudStorage methods throw `WebAppMethodUnsupported` on Telegram WebApp
    // versions below 6.1. Treat the API as unavailable in that case so we fall
    // back to localStorage instead of crashing.
    function cloudStorage() {
        if (!tg || !tg.CloudStorage) return null;
        if (typeof tg.isVersionAtLeast === 'function' && !tg.isVersionAtLeast('6.1')) return null;
        return tg.CloudStorage;
    }

    // ---------- helpers ----------

    function computeTier(swaps, volume) {
        var tier = null;
        for (var i = 0; i < TIERS.length; i++) {
            var t = TIERS[i];
            if (swaps >= t.minSwaps || (t.minVolume > 0 && volume >= t.minVolume)) {
                tier = t;
            }
        }
        return tier;
    }

    function loadFromLocal(cb) {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            cb(raw ? JSON.parse(raw) : { swaps: 0, volume: 0, tierId: null });
        } catch (e) {
            cb({ swaps: 0, volume: 0, tierId: null });
        }
    }

    function loadStats(cb) {
        var cs = cloudStorage();
        if (cs) {
            try {
                cs.getItem(STORAGE_KEY, function (err, val) {
                    if (err || !val) return loadFromLocal(cb);
                    try { cb(JSON.parse(val)); } catch (e) { loadFromLocal(cb); }
                });
                return;
            } catch (e) {
                // Synchronous throw on older Telegram clients — fall through.
            }
        }
        loadFromLocal(cb);
    }

    function saveStats(stats, cb) {
        var val = JSON.stringify(stats);
        var cs = cloudStorage();
        if (cs) {
            try {
                cs.setItem(STORAGE_KEY, val, cb || function () {});
                return;
            } catch (e) {
                // Fall through to localStorage.
            }
        }
        try { localStorage.setItem(STORAGE_KEY, val); } catch (e) {}
        if (cb) cb(null);
    }

    // ---------- UI ----------

    function renderBadge(stats) {
        var badge = document.getElementById('tier-badge');
        if (!badge) return;
        var tier = computeTier(stats.swaps, stats.volume);
        if (!tier) {
            badge.textContent = '';
            badge.className = 'tier-badge';
            return;
        }
        badge.textContent = tier.emoji + ' ' + tier.label;
        badge.className = 'tier-badge ' + tier.flair;
    }

    function showCelebration(tier, stats) {
        var modal = document.getElementById('tier-celebration-modal');
        if (!modal) return;

        var icon = modal.querySelector('.tier-celebration-icon');
        var title = modal.querySelector('.tier-celebration-title');
        var sub = modal.querySelector('.tier-celebration-sub');
        if (icon) icon.textContent = tier.emoji;
        if (title) title.textContent = tier.label + ' tier unlocked!';
        if (sub) sub.textContent = getTierUnlockText(tier.id);

        modal.classList.add('show');
        modal.style.display = 'flex';

        var closeBtn = modal.querySelector('.tier-celebration-close');
        if (closeBtn) {
            closeBtn.onclick = function () {
                modal.classList.remove('show');
                modal.style.display = 'none';
            };
        }

        var shareBtn = modal.querySelector('.tier-celebration-share');
        if (shareBtn) {
            shareBtn.onclick = function () {
                if (tg && tg.shareToStory) {
                    tg.shareToStory('assets/img/loading-icon.png', {
                        text: 'I just reached ' + tier.label + ' tier on TON Bridge! 🚀 Try it @TONBridge_robot',
                    });
                } else if (tg && tg.openTelegramLink) {
                    tg.openTelegramLink('https://t.me/share/url?url=https://t.me/TONBridge_robot&text=I+just+reached+' + encodeURIComponent(tier.label) + '+tier+on+TON+Bridge!+%F0%9F%9A%80');
                }
                modal.classList.remove('show');
                modal.style.display = 'none';
            };
        }
    }

    function getTierUnlockText(tierId) {
        var unlocks = {
            bronze: 'Unlocked: Orange profile flair',
            silver: 'Unlocked: Silver flair + Address Book access',
            gold: 'Unlocked: Gold flair + Pro badge + 5% bonus on TBC points',
            platinum: 'Unlocked: Platinum flair + early access to new features',
        };
        return unlocks[tierId] || '';
    }

    // ---------- public API ----------

    function recordSwap(usdAmount) {
        usdAmount = usdAmount || 0;
        loadStats(function (stats) {
            var prevTier = computeTier(stats.swaps, stats.volume);
            stats.swaps = (stats.swaps || 0) + 1;
            stats.volume = (stats.volume || 0) + usdAmount;
            var newTier = computeTier(stats.swaps, stats.volume);

            saveStats(stats, function () {
                renderBadge(stats);

                var tierUp = newTier && (!prevTier || newTier.id !== prevTier.id);
                if (tierUp) {
                    showCelebration(newTier, stats);
                    if (tg && tg.HapticFeedback) {
                        tg.HapticFeedback.notificationOccurred('success');
                    }
                }
            });
        });
    }

    function init() {
        loadStats(function (stats) {
            renderBadge(stats);
        });
    }

    window.Achievements = {
        init: init,
        recordSwap: recordSwap,
        TIERS: TIERS,
        computeTier: computeTier,
        _loadStats: loadStats,
        _saveStats: saveStats,
    };
})();
