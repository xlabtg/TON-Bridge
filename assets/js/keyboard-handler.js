document.addEventListener('DOMContentLoaded', function() {
    const appCapsule = document.getElementById('appCapsule');
    const exchangeFrame = document.getElementById('exchangeFrameContainer');
    let originalPosition = 0;
    let isKeyboardOpen = false;
    let keyboardHeight = 0;
    let focusAttempts = 0;
    const MAX_FOCUS_ATTEMPTS = 3;

    // Оптимизированный расчет позиции прокрутки
    function calculateScrollPosition() {
        const frameRect = exchangeFrame.getBoundingClientRect();
        const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const optimalPosition = frameRect.top + window.pageYOffset - (viewportHeight * 0.4);
        return Math.max(0, Math.min(optimalPosition, document.documentElement.scrollHeight - viewportHeight));
    }

    // Улучшенная обработка открытия клавиатуры
    function handleKeyboardOpen() {
        if (!isKeyboardOpen || focusAttempts < MAX_FOCUS_ATTEMPTS) {
            isKeyboardOpen = true;
            originalPosition = window.scrollY;
            keyboardHeight = window.innerHeight - (window.visualViewport?.height || window.innerHeight);
            focusAttempts++;

            // Добавляем классы для анимации
            exchangeFrame.classList.add('frame-keyboard-open');
            document.body.classList.add('keyboard-open');

            // Рассчитываем трансформацию на основе высоты клавиатуры
            const translateY = Math.min(-keyboardHeight * 0.9, -300); // Увеличили смещение еще больше
            exchangeFrame.style.transform = `translateY(${translateY}px)`;

            // Принудительная прокрутка вверх
            window.scrollTo({
                top: 0,
                behavior: 'auto'
            });

            // Повторная попытка через небольшую задержку
            setTimeout(() => {
                window.scrollTo({
                    top: 0,
                    behavior: 'auto'
                });
            }, 100);
        }
    }

    // Обработка закрытия клавиатуры
    function handleKeyboardClose() {
        if (isKeyboardOpen) {
            isKeyboardOpen = false;
            focusAttempts = 0;

            exchangeFrame.classList.remove('frame-keyboard-open');
            document.body.classList.remove('keyboard-open');
            exchangeFrame.style.transform = '';

            setTimeout(() => {
                window.scrollTo({
                    top: originalPosition,
                    behavior: 'smooth'
                });
            }, 50);
        }
    }

    // Visual Viewport API
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function() {
            if (window.visualViewport.height < window.innerHeight - 100) {
                handleKeyboardOpen();
            } else {
                handleKeyboardClose();
            }
        });
    }

    // Запасной вариант
    window.addEventListener('resize', function() {
        const heightDiff = window.outerHeight - window.innerHeight;
        if (heightDiff > 100) {
            handleKeyboardOpen();
        } else {
            handleKeyboardClose();
        }
    });

    // События из iframe
    window.addEventListener('message', function(event) {
        if (event.origin === 'https://changenow.io') {
            if (event.data.type === 'inputFocus') {
                setTimeout(handleKeyboardOpen, 50);
            } else if (event.data.type === 'inputBlur') {
                handleKeyboardClose();
            }
        }
    });

    // Обработка ориентации
    window.addEventListener('orientationchange', function() {
        setTimeout(() => {
            if (isKeyboardOpen) {
                handleKeyboardOpen();
            }
        }, 300);
    });

    // Ручная прокрутка
    exchangeFrame.addEventListener('touchstart', function() {
        if (!isKeyboardOpen) {
            handleKeyboardOpen();
        }
    }, { passive: true });

    // Предотвращение прокрутки при открытой клавиатуре
    document.addEventListener('scroll', function(e) {
        if (isKeyboardOpen) {
            window.scrollTo(0, 0);
        }
    }, { passive: false });

    // Обработка фокуса на элементах ввода
    document.addEventListener('focus', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            handleKeyboardOpen();
        }
    }, true);

    // Сохранение позиции прокрутки
    window.addEventListener('beforeunload', function() {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('scrollPosition', window.scrollY.toString());
        }
    });

    // Восстановление позиции прокрутки
    if (typeof localStorage !== 'undefined') {
        const savedPosition = localStorage.getItem('scrollPosition');
        if (savedPosition) {
            window.scrollTo(0, parseInt(savedPosition));
            localStorage.removeItem('scrollPosition');
        }
    }
});