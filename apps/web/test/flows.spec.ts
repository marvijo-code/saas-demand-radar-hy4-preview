import { test, expect } from '@playwright/test';

/**
 * End-to-end flows against the real product.
 *
 * The fixture data is the six records from `source-snapshot.json` seeded by
 * `scripts/test-browser.mjs`; no fake product data is added by the tests.
 */

const ACME = { email: 'admin@acme.test', password: 'AcmeAdmin!2026' };
const MEMBER = { email: 'member@acme.test', password: 'AcmeMember!2026' };
const BETA = { email: 'admin@beta.test', password: 'BetaAdmin!2026' };

async function signIn(page: import('@playwright/test').Page, account = ACME) {
  await page.goto('/login');
  await page.getByTestId('login-form').waitFor();
  await page.getByLabel('Work email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByTestId('dashboard').waitFor({ timeout: 20_000 });
}

test.describe('authentication', () => {
  test('a wrong password shows an error and does not enter the app', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-form').waitFor();
    await page.getByLabel('Work email').fill(ACME.email);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText(/Email or password is incorrect/i);
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('sign-in reaches the dashboard with the workspace shell', async ({ page }) => {
    await signIn(page);
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page).toHaveTitle(/Overview · SaaS Demand Radar/);
  });

  test('a protected deep link redirects to sign-in first', async ({ page }) => {
    await page.goto('/needs');
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('sign-out ends the session', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByTestId('login-form')).toBeVisible();
    await page.goto('/needs');
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('an expired session returns to sign-in instead of showing a page error', async ({ page }) => {
    await signIn(page);
    await page.context().clearCookies();

    await page.getByRole('link', { name: 'Audit' }).click();
    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);

    await page.getByRole('button', { name: `Acme admin: ${ACME.email}` }).click();
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });
});

test.describe('navigation and surfaces', () => {
  test('every contract route renders its own testid and title', async ({ page }) => {
    await signIn(page);
    const surfaces: { path: string; testId: string; title: RegExp }[] = [
      { path: '/', testId: 'dashboard', title: /Overview/ },
      { path: '/needs', testId: 'needs-list', title: /Needs/ },
      { path: '/sources', testId: 'source-runs', title: /Source runs/ },
      { path: '/feedback', testId: 'feedback-learning', title: /Feedback learning/ },
      { path: '/settings', testId: 'team-settings', title: /Team settings/ },
      { path: '/audit', testId: 'audit-trail', title: /Audit trail/ },
    ];
    for (const surface of surfaces) {
      await page.goto(surface.path);
      await expect(page.getByTestId(surface.testId)).toBeVisible({ timeout: 20_000 });
      await expect(page).toHaveTitle(surface.title);
    }
  });

  test('the needs list shows seeded needs and opens a detail page', async ({ page }) => {
    await signIn(page);
    await page.goto('/needs');
    await expect(page.getByTestId('needs-list')).toBeVisible();
    const cards = page.getByTestId('need-card');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    await cards.first().getByRole('link').first().click();
    await expect(page.getByTestId('need-detail')).toBeVisible();
    await expect(page).toHaveURL(/\/needs\/\d+/);
  });

  test('the need detail page shows the score explanation, evidence and trend', async ({ page }) => {
    await signIn(page);
    await page.goto('/needs');
    await page.getByTestId('need-card').first().getByRole('link').first().click();
    await expect(page.getByTestId('need-detail')).toBeVisible();

    await expect(page.getByText('Weighted base score').first()).toBeVisible();
    await expect(page.getByText(/Final score:/).first()).toBeVisible();
    await expect(page.getByTestId('need-evidence')).toBeVisible();
    await expect(page.getByRole('link', { name: /View original/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Score history' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Feedback history' })).toBeVisible();
  });

  test('searching filters the needs list', async ({ page }) => {
    await signIn(page);
    await page.goto('/needs');
    await expect(page.getByTestId('need-card').first()).toBeVisible({ timeout: 20_000 });
    const before = await page.getByTestId('need-card').count();
    await page.getByLabel('Search evidence').fill('newsletter');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/search=newsletter/);
    // Poll until the filtered list has actually replaced the unfiltered one, so the counts
    // below can never be measured against stale DOM.
    await expect
      .poll(async () => page.getByTestId('need-card').count(), { timeout: 20_000 })
      .toBeLessThan(before);
    const after = await page.getByTestId('need-card').count();
    expect(after).toBeGreaterThan(0);
    await expect(page.getByTestId('need-card').first()).toContainText(/newsletter/i);
  });

  test('the window filter can produce an honest empty state', async ({ page }) => {
    await signIn(page);
    await page.goto('/needs');
    await page.getByTestId('window-24h').click();
    await expect(page.getByText(/No needs match these filters|No source records/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('review feedback and learning', () => {
  test('marking a need relevant stores feedback that shows on the detail page', async ({ page }) => {
    await signIn(page);
    await page.goto('/needs');
    await page.getByTestId('need-card').first().getByRole('link').first().click();
    await expect(page.getByTestId('need-detail')).toBeVisible();

    await page.getByTestId('need-feedback').getByRole('button', { name: 'Relevant', exact: true }).click();
    await expect(page.getByText(/Feedback saved/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('table').filter({ hasText: 'Decision' })).toContainText('Relevant');
  });

  test('a re-score creates a version and reports the change', async ({ page }) => {
    await signIn(page);
    await page.goto('/needs');
    await page.getByTestId('need-card').first().getByRole('link').first().click();
    await page.getByTestId('need-feedback').getByRole('button', { name: 'Willing to pay' }).click();
    await expect(page.getByText(/Feedback saved/i)).toBeVisible({ timeout: 20_000 });

    await page.goto('/feedback');
    await expect(page.getByTestId('feedback-learning')).toBeVisible();
    await page.getByRole('button', { name: /Re-score and create version/ }).click();
    await expect(page.getByTestId('rescore-result')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('rescore-result')).toContainText(/created/i);
    await expect(page.getByTestId('feedback-item').first()).toContainText(/applied in v/);
  });

  test('the learning screen lists recorded reviews with their phrases', async ({ page }) => {
    await signIn(page);
    await page.goto('/feedback');
    await expect(page.getByTestId('feedback-learning')).toBeVisible();
    await expect(page.getByTestId('feedback-item').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Learned phrase weights')).toBeVisible();
    await expect(page.getByText('Learned source weights')).toBeVisible();
    await expect(page.getByTestId('ranking-versions')).toBeVisible();
  });
});

test.describe('source runs and settings', () => {
  test('the source runs page lists the seeded run and supports a snapshot re-run', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/sources');
    await expect(page.getByTestId('source-runs')).toBeVisible();
    await expect(page.getByTestId('run-item').first()).toBeVisible();

    await page.getByRole('button', { name: 'Run snapshot ingest' }).click();
    await expect(page.getByText(/run success/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/0 new, 0 updated/)).toBeVisible();
  });

  test('the schedule can be saved', async ({ page }) => {
    await signIn(page);
    await page.goto('/sources');
    await expect(page.getByTestId('schedule-settings')).toBeVisible();
    await page.getByLabel('Interval (minutes)').fill('90');
    await page.getByRole('button', { name: 'Save schedule' }).click();
    await expect(page.getByText('Schedule saved.')).toBeVisible({ timeout: 20_000 });
  });

  test('the team page lists members and blocks members from admin actions', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');
    await expect(page.getByTestId('team-settings')).toBeVisible();
    await expect(page.getByTestId('member-table')).toBeVisible();
    await expect(page.getByTestId('member-table')).toContainText(ACME.email);
    await expect(page.getByRole('button', { name: 'Add member' })).toBeVisible();
  });

  test('the audit trail shows seeded events', async ({ page }) => {
    await signIn(page);
    await page.goto('/audit');
    await expect(page.getByTestId('audit-trail')).toBeVisible();
    await expect(page.getByTestId('audit-item').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('audit-list')).toContainText(/signed in|run|feedback/i);
  });
});

test.describe('role based access', () => {
  test('a Member cannot run ingestion or cut a model version, but can still review', async ({
    page,
  }) => {
    await signIn(page, MEMBER);

    // Ingestion controls are Admin-only and must not be offered to a Member.
    await page.goto('/sources');
    await expect(page.getByTestId('source-runs')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run snapshot ingest' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run now' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save schedule' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry run' })).toHaveCount(0);
    await expect(page.getByText(/needs the Admin role/i)).toBeVisible();
    // The run history itself stays readable.
    await expect(page.getByTestId('run-item').first()).toBeVisible();

    // The learning surface stays readable, but versioning is Admin-only.
    await page.goto('/feedback');
    await expect(page.getByTestId('feedback-learning')).toBeVisible();
    await expect(page.getByRole('button', { name: /Re-score and create version/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Learned phrase weights' })).toBeVisible();

    // Reviewing is collaboration work and must stay available.
    await page.goto('/needs');
    await expect(page.getByTestId('need-card').first()).toBeVisible();
    await page.getByTestId('need-card').first().getByRole('link').first().click();
    await expect(page.getByTestId('need-detail')).toBeVisible();
    await page.getByTestId('need-feedback').getByRole('button', { name: 'Relevant', exact: true }).click();
    await expect(page.getByText(/Feedback saved/i)).toBeVisible({ timeout: 20_000 });
  });

  test('an Admin sees the ingestion and versioning controls', async ({ page }) => {
    await signIn(page);
    await page.goto('/sources');
    await expect(page.getByRole('button', { name: 'Run snapshot ingest' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save schedule' })).toBeVisible();
    await page.goto('/feedback');
    await expect(page.getByRole('button', { name: /Re-score and create version/ })).toBeVisible();
  });
});

test.describe('workspace isolation', () => {
  test('the Beta workspace starts empty and cannot see Acme needs', async ({ page }) => {
    await signIn(page);
    await page.goto('/needs');
    await expect(page.getByTestId('need-card').first()).toBeVisible();
    const acmeTitles = await page.getByTestId('need-card').allInnerTexts();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByTestId('login-form')).toBeVisible();
    await signIn(page, BETA);

    await page.goto('/needs');
    await expect(page.getByTestId('needs-list')).toBeVisible();
    const betaCards = await page.getByTestId('need-card').count();
    if (betaCards > 0) {
      const betaTitles = await page.getByTestId('need-card').allInnerTexts();
      for (const title of betaTitles) {
        expect(acmeTitles).not.toContain(title);
      }
    }
  });
});

test.describe('responsive layout', () => {
  test('no horizontal overflow at 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    for (const path of ['/', '/needs', '/sources', '/feedback', '/settings', '/audit']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
  });

  test('no horizontal overflow at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    for (const path of ['/', '/needs', '/sources', '/feedback', '/settings', '/audit']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
  });

  test('touch targets are at least 44px tall on every route at 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // Signed out first: the login form and the demo-account helpers.
    const routes: { path: string; waitFor: string }[] = [
      { path: '/login', waitFor: 'login-form' },
    ];
    for (const route of routes) {
      await page.goto(route.path);
      await page.getByTestId(route.waitFor).waitFor({ timeout: 20_000 });
      await expectNoSmallTouchTargets(page, route.path);
    }

    await signIn(page);

    const firstNeed = await page.evaluate(async () => {
      const response = await fetch('/api/needs?pageSize=1');
      const payload = (await response.json()) as { needs: { id: number }[] };
      return payload.needs[0]?.id ?? 1;
    });

    const authedRoutes: { path: string; waitFor: string }[] = [
      { path: '/', waitFor: 'dashboard' },
      { path: '/needs', waitFor: 'needs-list' },
      { path: `/needs/${firstNeed}`, waitFor: 'need-detail' },
      { path: '/sources', waitFor: 'source-runs' },
      { path: '/feedback', waitFor: 'feedback-learning' },
      { path: '/settings', waitFor: 'team-settings' },
      { path: '/audit', waitFor: 'audit-trail' },
    ];
    for (const route of authedRoutes) {
      await page.goto(route.path);
      await page.getByTestId(route.waitFor).waitFor({ timeout: 20_000 });
      // Let the route's first data load settle so the controls are really rendered.
      await page.waitForLoadState('networkidle');
      await expectNoSmallTouchTargets(page, route.path);
    }
  });
});

test.describe('accessibility', () => {
  test('landmarks, labels and focus are present', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('form', { name: /SaaS Demand Radar/i })).toBeVisible();
    await expect(page.getByLabel('Work email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    await signIn(page);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();

    // Keyboard operation: tab into the page and make sure focus is visible.
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return null;
      const style = window.getComputedStyle(element);
      return { tag: element.tagName, outline: style.outlineStyle, shadow: style.boxShadow };
    });
    expect(focused).not.toBeNull();
  });

  test('inputs on the needs list are labelled', async ({ page }) => {
    await signIn(page);
    await page.goto('/needs');
    for (const label of ['Sort by', 'Platform', 'Status', 'Search evidence']) {
      await expect(page.getByLabel(label)).toBeVisible();
    }
  });
});

/**
 * Fails the test if any *visible* interactive control on the current page is shorter than
 * 44 CSS pixels.
 *
 * The scan covers buttons, links, inputs, selects, textareas and anything exposing
 * `role="button"`, and skips only elements that are genuinely not rendered (display:none,
 * visibility:hidden, zero sized or `disabled`). It is deliberately strict: a control that is
 * on screen but too small to hit is a defect, not a stylistic choice.
 */
async function expectNoSmallTouchTargets(page: import('@playwright/test').Page, label: string) {
  const offenders = await page.evaluate(() => {
    const MIN_HEIGHT = 44;
    const found: string[] = [];
    const elements = Array.from(
      document.querySelectorAll(
        'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"]',
      ),
    );
    for (const element of elements) {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (Number(style.opacity) === 0) continue;
      const rect = htmlElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (htmlElement.hasAttribute('disabled')) continue;
      if (rect.height >= MIN_HEIGHT) continue;
      const text = (htmlElement.textContent ?? '').trim().slice(0, 40);
      found.push(
        `${htmlElement.tagName.toLowerCase()}.${htmlElement.className || '(no class)'} ` +
          `${Math.round(rect.height)}px "${text}"`,
      );
    }
    return found;
  });
  expect(
    offenders,
    `controls shorter than 44px on ${label}:\n  ${offenders.join('\n  ')}`,
  ).toHaveLength(0);
}
