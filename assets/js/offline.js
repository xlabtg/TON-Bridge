// Shows/hides the offline indicator based on navigator.onLine.
(function () {
    var banner = document.getElementById('offline-indicator');
    if (!banner) return;

    function update() {
        if (navigator.onLine) {
            banner.classList.remove('show');
        } else {
            banner.classList.add('show');
        }
    }

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
})();
