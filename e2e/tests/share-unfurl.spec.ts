import { expect, test } from '@playwright/test';
import { createRoom, metaContent, setTriviaCustom, signUpHost } from '../lib/helpers';

// Open Graph share cards (spec 0025), proven end to end against the real stack: the meta tags a
// link crawler would read are served by the real web app, which resolves the room's game from the
// real control-plane preview endpoint. This is the browser-level check the spec-0025 acceptance
// asked for and the unit/integration tests could only approximate.

test.describe('Open Graph share unfurls', () => {
  test('home page unfurls with the wordmark card', async ({ page }) => {
    await page.goto('/');
    expect(await metaContent(page, 'og:image')).toContain('/og.png');
    expect(await metaContent(page, 'twitter:card')).toBe('summary_large_image');
  });

  test('an unknown code falls back to the generic invite card', async ({ page }) => {
    await page.goto('/join?code=ZZZZZ');
    expect(await metaContent(page, 'og:title')).toBe('Join my game');
    expect(await metaContent(page, 'og:image')).toContain('/share-join.png');
    expect(await metaContent(page, 'twitter:card')).toBe('summary_large_image');
  });

  test('a room playing Trivia unfurls the Trivia card', async ({ browser, page }) => {
    // Host a room and start Trivia so the room's selectedGame is 'trivia'.
    await signUpHost(page);
    const code = await createRoom(page);
    await setTriviaCustom(page, { multipleChoice: 0, trueFalse: 0, open: 1 });
    await page.getByRole('button', { name: /start game/i }).click();
    // Once running, the shared viewer shows the first question - the game has truly started.
    await expect(page.getByTestId('question-prompt')).toBeVisible();

    // A crawler is a fresh visitor with no session and no membership: open the share link in a
    // clean context and read the tags it would unfurl.
    const crawler = await browser.newContext();
    const crawlerPage = await crawler.newPage();
    await crawlerPage.goto(`/join?code=${code}`);
    expect(await metaContent(crawlerPage, 'og:title')).toBe('Join my game');
    expect(await metaContent(crawlerPage, 'og:image')).toContain('/share-trivia.png');
    await crawler.close();
  });
});
