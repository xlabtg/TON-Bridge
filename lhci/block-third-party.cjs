const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);

function shouldBlock(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') {
      return false;
    }
    return !ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

module.exports = async function blockThirdPartyRequests(browser) {
  async function preparePage(page) {
    if (page.__lhciBlocksThirdParty) return;
    page.__lhciBlocksThirdParty = true;

    await page.evaluateOnNewDocument(() => {
      window.__TON_BRIDGE_LHCI = true;
      window.Telegram = {
        WebApp: {
          MainButton: {
            hide() {},
            onClick() {},
            setText() {},
            show() {},
          },
          BackButton: {
            hide() {},
            offClick() {},
            onClick() {},
            show() {},
          },
          colorScheme: 'light',
          expand() {},
          onEvent() {},
          openTelegramLink() {},
          ready() {},
          setHeaderColor() {},
        },
      };
    });

    await page.setRequestInterception(true);
    page.on('request', request => {
      if (shouldBlock(request.url())) {
        return request.abort();
      }
      return request.continue();
    });
  }

  await Promise.all((await browser.pages()).map(preparePage));

  browser.on('targetcreated', async target => {
    try {
      const page = await target.page();
      if (page) await preparePage(page);
    } catch {
      // A target may disappear before Puppeteer can attach to it.
    }
  });
};
