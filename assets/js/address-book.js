/**
 * Address book module.
 *
 * Stores the last ADDRESS_BOOK_MAX (default 10, configurable) recipient addresses
 * per chain in Telegram CloudStorage under the key `addressBook:<chain>`.
 *
 * Public API:
 *   initAddressBook(chain, i18n)  – render chips, wire listeners
 *   saveAddress(chain, address)   – validate + persist an observed address
 */
(function (global) {
  'use strict';

  // Read configurable cap from a data attribute or fall back to 10.
  var ADDRESS_BOOK_MAX = (function () {
    var el = document.getElementById('address-book-chips');
    var v = el && parseInt(el.getAttribute('data-max'), 10);
    return v > 0 ? v : 10;
  })();

  // Maximum chips shown in the horizontal list above the iframe.
  var CHIPS_VISIBLE = 5;

  // ── TON address validation ────────────────────────────────────────────────
  // TON addresses: base64url (48 chars) or raw hex (64 chars, optional 0x).
  // We validate the checksum for the user-friendly (base64url) form.
  // Reference: https://docs.ton.org/learn/overviews/addresses#raw-and-user-friendly-addresses

  function base64UrlDecode(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try {
      var bin = atob(s);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (e) {
      return null;
    }
  }

  function crc16(data) {
    var poly = 0x1021;
    var reg = 0;
    var paddedData = new Uint8Array(data.length + 2);
    paddedData.set(data);
    for (var i = 0; i < paddedData.length; i++) {
      var byte = paddedData[i];
      for (var b = 0; b < 8; b++) {
        var topBit = (reg & 0x8000) !== 0;
        reg = (reg << 1) & 0xffff;
        if ((byte & (1 << (7 - b))) !== 0) reg |= 1;
        if (topBit) reg ^= poly;
      }
    }
    return reg;
  }

  function isValidTonAddress(addr) {
    if (!addr || typeof addr !== 'string') return false;
    addr = addr.trim();

    // Raw form: optional 0x + 64 hex chars
    if (/^(0x)?[0-9a-fA-F]{64}$/.test(addr)) return true;

    // User-friendly base64url form (48 chars)
    if (addr.length !== 48) return false;
    var bytes = base64UrlDecode(addr);
    if (!bytes || bytes.length !== 36) return false;

    // Bytes 0-33: [flags, workchain, 32-byte hash]; bytes 34-35: CRC16
    var payload = bytes.slice(0, 34);
    var checksum = (bytes[34] << 8) | bytes[35];
    return crc16(payload) === checksum;
  }

  // ── CloudStorage helpers ──────────────────────────────────────────────────

  var storageKey = function (chain) { return 'addressBook:' + chain; };

  // CloudStorage methods throw `WebAppMethodUnsupported` on Telegram WebApp
  // versions below 6.1. Probe via the documented version check so callers can
  // fall back instead of crashing the page.
  function cloudStorage() {
    var wa = global.Telegram && global.Telegram.WebApp;
    if (!wa || !wa.CloudStorage) return null;
    if (typeof wa.isVersionAtLeast === 'function' && !wa.isVersionAtLeast('6.1')) return null;
    return wa.CloudStorage;
  }

  function loadEntries(chain, callback) {
    var cs = cloudStorage();
    if (!cs) { callback([]); return; }
    try {
      cs.getItem(storageKey(chain), function (err, value) {
        if (err || !value) { callback([]); return; }
        try { callback(JSON.parse(value)); } catch (e) { callback([]); }
      });
    } catch (e) {
      callback([]);
    }
  }

  function saveEntries(chain, entries, callback) {
    var cs = cloudStorage();
    if (!cs) {
      if (callback) callback(null);
      return;
    }
    try {
      cs.setItem(
        storageKey(chain),
        JSON.stringify(entries),
        function (err) { if (callback) callback(err); }
      );
    } catch (e) {
      if (callback) callback(e);
    }
  }

  // ── Entry model ───────────────────────────────────────────────────────────
  // { address: string, label: string, pinned: bool, addedAt: timestamp }

  function makeEntry(address) {
    return { address: address, label: '', pinned: false, addedAt: Date.now() };
  }

  // ── Module state ──────────────────────────────────────────────────────────

  var _chain = '';
  var _i18n = {};
  var _entries = [];
  var _actionTarget = null; // entry currently shown in action sheet

  // ── Public: save an observed address ─────────────────────────────────────

  function saveAddress(chain, address) {
    if (!address) return;
    address = address.trim();
    if (!isValidTonAddress(address)) return;

    loadEntries(chain, function (entries) {
      var idx = entries.findIndex(function (e) { return e.address === address; });
      if (idx !== -1) {
        // Refresh timestamp so it surfaces as recent, preserve label/pin.
        entries[idx].addedAt = Date.now();
        entries.splice(0, 0, entries.splice(idx, 1)[0]);
      } else {
        entries.unshift(makeEntry(address));
        // Trim non-pinned entries beyond cap.
        var pinned = entries.filter(function (e) { return e.pinned; });
        var unpinned = entries.filter(function (e) { return !e.pinned; });
        if (unpinned.length > ADDRESS_BOOK_MAX - pinned.length) {
          unpinned = unpinned.slice(0, ADDRESS_BOOK_MAX - pinned.length);
        }
        entries = pinned.concat(unpinned);
      }
      saveEntries(chain, entries);
      if (chain === _chain) {
        _entries = entries;
        renderChips();
      }
    });
  }

  // ── Chip rendering ────────────────────────────────────────────────────────

  function sortedEntries(entries) {
    var pinned = entries.filter(function (e) { return e.pinned; });
    var unpinned = entries.filter(function (e) { return !e.pinned; });
    return pinned.concat(unpinned);
  }

  function shortAddr(addr) {
    if (addr.length <= 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function renderChips() {
    var container = document.getElementById('address-book-chips');
    if (!container) return;

    var sorted = sortedEntries(_entries);
    var visible = sorted.slice(0, CHIPS_VISIBLE);

    if (visible.length === 0) {
      container.classList.add('address-book-chips-wrap--hidden');
      container.style.display = 'none';
      return;
    }
    container.classList.remove('address-book-chips-wrap--hidden');
    container.style.display = '';

    var html = '<div class="address-book-chip-list">';
    visible.forEach(function (entry) {
      var label = entry.label || shortAddr(entry.address);
      var pin = entry.pinned ? ' <ion-icon name="pin" class="address-book-pin-icon"></ion-icon>' : '';
      html += '<span class="chip chip-outline address-book-chip" data-address="' + escapeAttr(entry.address) + '" title="' + escapeAttr(entry.address) + '">'
        + '<span class="chip-label">' + escapeHtml(label) + pin + '</span>'
        + '</span>';
    });
    html += '</div>';

    container.innerHTML = html;

    // Tap to prefill iframe
    container.querySelectorAll('.address-book-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        prefillIframe(chip.getAttribute('data-address'));
      });

      // Long-press: 600 ms hold opens action sheet
      var holdTimer;
      chip.addEventListener('pointerdown', function () {
        holdTimer = setTimeout(function () {
          openActionSheet(chip.getAttribute('data-address'));
        }, 600);
      });
      chip.addEventListener('pointerup', function () { clearTimeout(holdTimer); });
      chip.addEventListener('pointerleave', function () { clearTimeout(holdTimer); });
      chip.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        openActionSheet(chip.getAttribute('data-address'));
      });
    });
  }

  function prefillIframe(address) {
    if (typeof global.openExchangeWidget === 'function') {
      global.openExchangeWidget();
    }

    setTimeout(function () {
      var iframe = document.getElementById('iframe-widget');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'set-recipient', address: address }, '*');
      }
    }, 0);
  }

  // ── Action sheet ──────────────────────────────────────────────────────────

  function openActionSheet(address) {
    _actionTarget = _entries.find(function (e) { return e.address === address; });
    if (!_actionTarget) return;

    var sheet = document.getElementById('address-book-action-sheet');
    if (!sheet) return;

    var addrEl = sheet.querySelector('.ab-sheet-address');
    if (addrEl) addrEl.textContent = shortAddr(address);

    var pinBtn = sheet.querySelector('[data-ab-action="pin"]');
    if (pinBtn) {
      var pinLabel = pinBtn.querySelector('.in') || pinBtn;
      pinLabel.textContent = _actionTarget.pinned
        ? (_i18n.ab_unpin || 'Unpin')
        : (_i18n.ab_pin || 'Pin');
    }

    var bsOffcanvas = global.bootstrap && global.bootstrap.Offcanvas
      ? global.bootstrap.Offcanvas.getOrCreateInstance(sheet)
      : null;
    if (bsOffcanvas) bsOffcanvas.show();
    else sheet.classList.add('show');
  }

  function closeActionSheet() {
    var sheet = document.getElementById('address-book-action-sheet');
    if (!sheet) return;
    var bsOffcanvas = global.bootstrap && global.bootstrap.Offcanvas
      ? global.bootstrap.Offcanvas.getInstance(sheet)
      : null;
    if (bsOffcanvas) bsOffcanvas.hide();
    else sheet.classList.remove('show');
  }

  function handleEditLabel() {
    if (!_actionTarget) return;
    closeActionSheet();
    var newLabel = prompt(_i18n.ab_edit_label_prompt || 'Enter label:', _actionTarget.label || '');
    if (newLabel === null) return;
    _actionTarget.label = newLabel.trim();
    saveEntries(_chain, _entries, function () { renderChips(); });
  }

  function handlePin() {
    if (!_actionTarget) return;
    _actionTarget.pinned = !_actionTarget.pinned;
    saveEntries(_chain, _entries, function () { renderChips(); });
    closeActionSheet();
  }

  function handleRemove() {
    if (!_actionTarget) return;
    _entries = _entries.filter(function (e) { return e.address !== _actionTarget.address; });
    saveEntries(_chain, _entries, function () { renderChips(); });
    closeActionSheet();
  }

  // ── Escape helpers ────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function initAddressBook(chain, i18n) {
    _chain = chain || 'ton';
    _i18n = i18n || {};

    // Wire action sheet buttons
    var editBtn = document.querySelector('[data-ab-action="edit"]');
    var pinBtn = document.querySelector('[data-ab-action="pin"]');
    var removeBtn = document.querySelector('[data-ab-action="remove"]');
    if (editBtn) editBtn.addEventListener('click', handleEditLabel);
    if (pinBtn) pinBtn.addEventListener('click', handlePin);
    if (removeBtn) removeBtn.addEventListener('click', handleRemove);

    loadEntries(_chain, function (entries) {
      _entries = entries;
      renderChips();
    });

    // Listen for recipient address observed in postMessage events from the iframe
    global.addEventListener('message', function (event) {
      if (!event.data || typeof event.data !== 'object') return;
      var address = event.data.recipientAddress || event.data.toAddress || event.data.address;
      if (address) saveAddress(_chain, address);
    });
  }

  // ── Manage-addresses page rendering ──────────────────────────────────────

  function initManageAddresses(chain, i18n) {
    _chain = chain || 'ton';
    _i18n = i18n || {};

    var list = document.getElementById('address-book-manage-list');
    if (!list) return;

    function renderList() {
      loadEntries(_chain, function (entries) {
        _entries = entries;
        var sorted = sortedEntries(entries);
        if (sorted.length === 0) {
          list.innerHTML = '<li class="ab-empty"><div class="item"><div class="in">' + escapeHtml(_i18n.ab_empty || 'No saved addresses') + '</div></div></li>';
          return;
        }
        var html = '';
        sorted.forEach(function (entry, idx) {
          var label = entry.label || shortAddr(entry.address);
          var pin = entry.pinned ? '<ion-icon name="pin" class="text-primary me-1"></ion-icon>' : '';
          html += '<li>'
            + '<div class="item">'
            + '<div class="in">'
            + '<div>' + pin + '<strong>' + escapeHtml(label) + '</strong><br>'
            + '<small class="text-muted">' + escapeHtml(entry.address) + '</small>'
            + '</div>'
            + '<div class="d-flex gap-2">'
            + '<a href="#" class="btn btn-sm btn-outline-primary ab-edit-btn" data-idx="' + idx + '">' + escapeHtml(_i18n.ab_edit || 'Edit') + '</a>'
            + '<a href="#" class="btn btn-sm btn-outline-danger ab-remove-btn" data-idx="' + idx + '">' + escapeHtml(_i18n.ab_remove || 'Remove') + '</a>'
            + '</div>'
            + '</div>'
            + '</div>'
            + '</li>';
        });
        list.innerHTML = html;

        list.querySelectorAll('.ab-edit-btn').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            var entry = sorted[parseInt(btn.getAttribute('data-idx'), 10)];
            var realEntry = _entries.find(function (x) { return x.address === entry.address; });
            if (!realEntry) return;
            var newLabel = prompt(_i18n.ab_edit_label_prompt || 'Enter label:', realEntry.label || '');
            if (newLabel === null) return;
            realEntry.label = newLabel.trim();
            saveEntries(_chain, _entries, renderList);
          });
        });

        list.querySelectorAll('.ab-remove-btn').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            var entry = sorted[parseInt(btn.getAttribute('data-idx'), 10)];
            _entries = _entries.filter(function (x) { return x.address !== entry.address; });
            saveEntries(_chain, _entries, renderList);
          });
        });
      });
    }

    renderList();
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  global.AddressBook = {
    init: initAddressBook,
    initManage: initManageAddresses,
    save: saveAddress,
    isValidTonAddress: isValidTonAddress,
  };
})(window);
