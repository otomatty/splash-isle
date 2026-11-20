// 新しいブラウザのゲスト枠を、ゲームと同じ画面・操作で開始する。
export async function startGuestGame(page) {
  await page.locator('#btnGuest').click();
  await page.locator('#slotA').click();
  await page.locator('#btnPlay').click();
  for (let i = 0; i < 3; i++) await page.locator('#storyNext').click();
  await page.waitForSelector('#hud', { visible: true, timeout: 120000 });
  await page.waitForSelector('#loading', { hidden: true, timeout: 120000 });
}

// Worker が動いていても手元のセーブだけで検証できるよう、ゲスト用の起動に限り API をオフラインにする。
export async function useOfflineGuest(page) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      void request.respond({ status: 200, contentType: 'text/plain', body: 'Static preview' });
    } else {
      void request.continue();
    }
  });
}
