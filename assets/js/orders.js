(function () {
    'use strict';

    var STORAGE_KEY = 'orders_cache';
    var POLL_INTERVAL = window.__TEST_POLL_INTERVAL || 10000;
    var PAGE_SIZE = 20;
    var PARTNER_USER_ID_KEY = 'partner_user_id';

    var tg = window.Telegram && window.Telegram.WebApp;
    var orders = [];
    var page = 0;
    var allLoaded = false;
    var pollTimer = null;
    var isLoading = false;

    // Status display config
    var STATUS_CONFIG = {
        'new':        { label: window._i18n && window._i18n.status_new        || 'New',        cls: 'badge bg-secondary' },
        'waiting':    { label: window._i18n && window._i18n.status_waiting    || 'Waiting',    cls: 'badge bg-warning text-dark' },
        'confirming': { label: window._i18n && window._i18n.status_confirming || 'Confirming', cls: 'badge bg-warning text-dark' },
        'exchanging': { label: window._i18n && window._i18n.status_exchanging || 'Exchanging', cls: 'badge bg-info text-dark' },
        'sending':    { label: window._i18n && window._i18n.status_sending    || 'Sending',    cls: 'badge bg-info text-dark' },
        'finished':   { label: window._i18n && window._i18n.status_finished   || 'Finished',   cls: 'badge bg-success' },
        'failed':     { label: window._i18n && window._i18n.status_failed     || 'Failed',     cls: 'badge bg-danger' },
        'refunded':   { label: window._i18n && window._i18n.status_refunded   || 'Refunded',   cls: 'badge bg-secondary' }
    };

    function getPartnerUserId() {
        if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
            return String(tg.initDataUnsafe.user.id);
        }
        return null;
    }

    function saveToCloudStorage(data) {
        if (!tg || !tg.CloudStorage) return;
        try {
            tg.CloudStorage.setItem(STORAGE_KEY, JSON.stringify(data), function (err) {
                if (err) console.warn('CloudStorage write error:', err);
            });
        } catch (e) {
            console.warn('CloudStorage error:', e);
        }
    }

    function loadFromCloudStorage(callback) {
        if (!tg || !tg.CloudStorage) { callback(null); return; }
        try {
            tg.CloudStorage.getItem(STORAGE_KEY, function (err, value) {
                if (err || !value) { callback(null); return; }
                try { callback(JSON.parse(value)); } catch (e) { callback(null); }
            });
        } catch (e) {
            callback(null);
        }
    }

    function fetchOrders(partnerUserId, offset, limit, callback) {
        var url = '/api/orders?partner_user_id=' + encodeURIComponent(partnerUserId) +
                  '&offset=' + offset + '&limit=' + limit;
        fetch(url)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) { callback(null, data); })
            .catch(function (err) { callback(err, null); });
    }

    function renderStatusBadge(status) {
        var cfg = STATUS_CONFIG[status] || { label: status, cls: 'badge bg-secondary' };
        return '<span class="' + cfg.cls + '">' + escapeHtml(cfg.label) + '</span>';
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatTimestamp(ts) {
        if (!ts) return '';
        try {
            var d = new Date(ts);
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return ts; }
    }

    function renderOrder(order) {
        var pair = escapeHtml((order.fromCurrency || '').toUpperCase()) + ' → ' +
                   escapeHtml((order.toCurrency || '').toUpperCase());
        var amountSent = order.amountFrom != null ? escapeHtml(String(order.amountFrom)) : '—';
        var amountReceived = order.amountTo != null ? escapeHtml(String(order.amountTo)) : '—';
        var txId = escapeHtml(order.id || '');
        var ts = formatTimestamp(order.createdAt);

        return '<li class="order-item" data-id="' + txId + '">' +
            '<div class="order-row">' +
                '<span class="order-pair">' + pair + '</span>' +
                renderStatusBadge(order.status) +
            '</div>' +
            '<div class="order-row order-amounts">' +
                '<span class="order-sent">' + amountSent + ' ' + escapeHtml((order.fromCurrency || '').toUpperCase()) + '</span>' +
                '<ion-icon name="arrow-forward-outline" class="order-arrow"></ion-icon>' +
                '<span class="order-received">' + amountReceived + ' ' + escapeHtml((order.toCurrency || '').toUpperCase()) + '</span>' +
            '</div>' +
            '<div class="order-row order-meta">' +
                '<span class="order-time">' + ts + '</span>' +
                '<button class="order-copy-btn btn btn-sm" data-txid="' + txId + '" title="Copy ID">' +
                    '<ion-icon name="copy-outline"></ion-icon>' +
                    '<span class="order-txid-short">' + escapeHtml(txId.slice(0, 8)) + (txId.length > 8 ? '…' : '') + '</span>' +
                '</button>' +
            '</div>' +
        '</li>';
    }

    function renderEmptyState() {
        var msg = (window._i18n && window._i18n.orders_empty) || 'No orders yet. Start a swap on the Bridge or Exchange tab.';
        var btnText = (window._i18n && window._i18n.orders_empty_cta) || 'Go to Bridge';
        var bridgeHref = (window._i18n && window._i18n.orders_bridge_href) || 'index.html';
        return '<div class="orders-empty-state">' +
            '<ion-icon name="receipt-outline" class="orders-empty-icon"></ion-icon>' +
            '<p>' + escapeHtml(msg) + '</p>' +
            '<a href="' + escapeHtml(bridgeHref) + '" class="btn btn-primary">' + escapeHtml(btnText) + '</a>' +
        '</div>';
    }

    function updateOrderInList(updatedOrder) {
        var prevFinished = false;
        orders = orders.map(function (o) {
            if (o.id === updatedOrder.id) {
                prevFinished = (o.status === 'finished');
                return updatedOrder;
            }
            return o;
        });
        if (!prevFinished && updatedOrder.status === 'finished') {
            if (tg && tg.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred('success');
            }
        }
    }

    function applyOrderUpdates(freshOrders) {
        var changed = false;
        freshOrders.forEach(function (fresh) {
            var idx = orders.findIndex(function (o) { return o.id === fresh.id; });
            if (idx >= 0) {
                if (orders[idx].status !== fresh.status) {
                    updateOrderInList(fresh);
                    changed = true;
                    var el = document.querySelector('.order-item[data-id="' + fresh.id + '"]');
                    if (el) {
                        var badgeEl = el.querySelector('.badge');
                        if (badgeEl) {
                            var cfg = STATUS_CONFIG[fresh.status] || { label: fresh.status, cls: 'badge bg-secondary' };
                            badgeEl.className = cfg.cls;
                            badgeEl.textContent = cfg.label;
                        }
                    }
                }
            }
        });
        if (changed) saveToCloudStorage(orders);
    }

    function pollForUpdates(partnerUserId) {
        if (!partnerUserId) return;
        var activeOrders = orders.filter(function (o) {
            return ['new', 'waiting', 'confirming', 'exchanging', 'sending'].indexOf(o.status) >= 0;
        });
        if (activeOrders.length === 0) return;

        var url = '/api/orders?partner_user_id=' + encodeURIComponent(partnerUserId) +
                  '&offset=0&limit=' + Math.min(orders.length, 50);
        fetch(url)
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                if (data && data.orders) applyOrderUpdates(data.orders);
            })
            .catch(function () {});
    }

    function startPolling(partnerUserId) {
        stopPolling();
        if (!partnerUserId) return;
        pollTimer = setInterval(function () { pollForUpdates(partnerUserId); }, POLL_INTERVAL);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function appendOrders(newOrders) {
        var list = document.getElementById('orders-list');
        if (!list) return;
        newOrders.forEach(function (o) {
            orders.push(o);
            list.insertAdjacentHTML('beforeend', renderOrder(o));
        });
        attachCopyHandlers();
    }

    function attachCopyHandlers() {
        var btns = document.querySelectorAll('.order-copy-btn');
        btns.forEach(function (btn) {
            btn.onclick = null;
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                var txid = btn.getAttribute('data-txid');
                if (!txid) return;
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(txid).then(function () {
                        if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
                        showCopiedFeedback(btn);
                    });
                } else {
                    var ta = document.createElement('textarea');
                    ta.value = txid;
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); showCopiedFeedback(btn); } catch (e) {}
                    document.body.removeChild(ta);
                }
            });
        });
    }

    function showCopiedFeedback(btn) {
        btn.classList.add('copied');
        setTimeout(function () { btn.classList.remove('copied'); }, 1500);
    }

    function showLoading(show) {
        var el = document.getElementById('orders-loading');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    function showLoadMoreBtn(show) {
        var el = document.getElementById('orders-load-more');
        if (el) el.style.display = show ? 'block' : 'none';
    }

    function loadPage(partnerUserId, reset) {
        if (isLoading || allLoaded) return;
        isLoading = true;
        showLoading(true);
        showLoadMoreBtn(false);

        var offset = reset ? 0 : page * PAGE_SIZE;

        fetchOrders(partnerUserId, offset, PAGE_SIZE, function (err, data) {
            isLoading = false;
            showLoading(false);

            if (err || !data) {
                showLoadMoreBtn(!allLoaded && orders.length > 0);
                return;
            }

            var newOrders = (data.orders || []);
            if (reset) {
                orders = [];
                page = 0;
                var list = document.getElementById('orders-list');
                if (list) list.innerHTML = '';
            }

            if (newOrders.length < PAGE_SIZE) allLoaded = true;

            if (newOrders.length > 0 || orders.length > 0) {
                document.getElementById('orders-empty')
                    && (document.getElementById('orders-empty').style.display = 'none');
            }

            appendOrders(newOrders);
            page += 1;
            saveToCloudStorage(orders);

            showLoadMoreBtn(!allLoaded && orders.length > 0);
        });
    }

    function initPage() {
        var partnerUserId = getPartnerUserId();

        // Render cached data immediately for non-empty cold start
        loadFromCloudStorage(function (cached) {
            if (cached && cached.length > 0) {
                orders = cached;
                page = Math.ceil(cached.length / PAGE_SIZE);
                var list = document.getElementById('orders-list');
                if (list) {
                    list.innerHTML = cached.map(renderOrder).join('');
                    attachCopyHandlers();
                }
                var emptyEl = document.getElementById('orders-empty');
                if (emptyEl) emptyEl.style.display = 'none';
            }

            if (partnerUserId) {
                loadPage(partnerUserId, true);
                startPolling(partnerUserId);
            } else {
                showLoading(false);
                // No user id — check if there is any cached data, else show empty
                if (!orders.length) {
                    var emptyEl = document.getElementById('orders-empty');
                    if (emptyEl) emptyEl.style.display = 'flex';
                }
            }
        });

        // Infinite scroll
        window.addEventListener('scroll', function () {
            if (allLoaded || isLoading || !partnerUserId) return;
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
                loadPage(partnerUserId, false);
            }
        });

        // Load more button (fallback)
        var loadMoreBtn = document.getElementById('orders-load-more');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', function () {
                if (partnerUserId) loadPage(partnerUserId, false);
            });
        }

        // Pause polling when app is backgrounded
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                if (partnerUserId) startPolling(partnerUserId);
            } else {
                stopPolling();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPage);
    } else {
        initPage();
    }
})();
