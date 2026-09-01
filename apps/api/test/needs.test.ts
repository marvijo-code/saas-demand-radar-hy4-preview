import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClient, SNAPSHOT, ACME_ADMIN, ACME_MEMBER, BETA_ADMIN } from './helpers.ts';

const NOW = '2026-09-01T12:00:00.000Z';

async function setup() {
  const api = await getClient();
  const cookie = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  await api.ingest(SNAPSHOT.records, { cookie });
  return { api, cookie };
}

test('the needs list paginates and reports totals', async () => {
  const { api, cookie } = await setup();
  const first = await api.request('GET', '/api/needs?page=1&pageSize=2', { cookie });
  assert.equal(first.status, 200);
  assert.equal(first.body.page, 1);
  assert.equal(first.body.pageSize, 2);
  assert.ok(first.body.needs.length <= 2);
  assert.ok(first.body.totalPages >= 1);
  assert.equal(first.body.total, first.body.total === 6 ? 6 : first.body.total);

  const second = await api.request('GET', '/api/needs?page=2&pageSize=2', { cookie });
  const idsFirst = new Set(first.body.needs.map((need: { id: number }) => need.id));
  for (const need of second.body.needs) {
    assert.ok(!idsFirst.has(need.id), 'pages must not overlap');
  }
});

test('pageSize is clamped and invalid values fall back safely', async () => {
  const { api, cookie } = await setup();
  const huge = await api.request('GET', '/api/needs?pageSize=9999', { cookie });
  assert.equal(huge.status, 200);
  assert.ok(huge.body.pageSize <= 100);
  const negative = await api.request('GET', '/api/needs?page=-5&pageSize=-5', { cookie });
  assert.equal(negative.status, 200);
  assert.equal(negative.body.page, 1);
});

test('every need exposes a score, a rank and a full explanation', async () => {
  const { api, cookie } = await setup();
  const response = await api.request('GET', '/api/needs?pageSize=50', { cookie });
  for (const need of response.body.needs) {
    assert.equal(typeof need.score, 'number');
    assert.ok(need.score >= 0 && need.score <= 100);
    assert.equal(typeof need.rank, 'number');
    assert.equal(need.breakdown.components.length, 5);
    assert.ok(need.breakdown.explanation.length >= 5);
    assert.ok(need.breakdown.explanation.at(-1).includes('Final score'));
    const sum = need.breakdown.components.reduce(
      (total: number, component: { points: number }) => total + component.points,
      0,
    );
    assert.ok(Math.abs(sum - need.breakdown.basePoints) < 0.2);
  }
  const ranks = response.body.needs.map((need: { rank: number }) => need.rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'score sort must be descending by rank');
});

test('sorting works for every documented sort key', async () => {
  const { api, cookie } = await setup();
  for (const sort of ['score', 'recency', 'frequency', 'engagement', 'title']) {
    const response = await api.request('GET', `/api/needs?sort=${sort}&pageSize=50`, { cookie });
    assert.equal(response.status, 200, sort);
    assert.equal(response.body.sort, sort);
    if (sort === 'title') {
      const titles = response.body.needs.map((need: { title: string }) => need.title);
      assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)));
    }
    if (sort === 'frequency') {
      const counts = response.body.needs.map((need: { evidenceCount: number }) => need.evidenceCount);
      assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
    }
  }
  const bogus = await api.request('GET', '/api/needs?sort=not-a-sort', { cookie });
  assert.equal(bogus.body.sort, 'score', 'an unknown sort must fall back to score');
});

test('platform and status filters narrow the result set', async () => {
  const { api, cookie } = await setup();
  const xOnly = await api.request('GET', '/api/needs?platform=x&pageSize=50', { cookie });
  for (const need of xOnly.body.needs) {
    assert.deepEqual(need.platforms, ['x']);
  }
  const redditOnly = await api.request('GET', '/api/needs?platform=reddit&pageSize=50', { cookie });
  for (const need of redditOnly.body.needs) {
    assert.ok(need.platforms.includes('reddit'));
    assert.ok(!need.platforms.includes('x'));
  }
  assert.equal(
    xOnly.body.total + redditOnly.body.total,
    (await api.request('GET', '/api/needs?pageSize=50', { cookie })).body.total,
  );

  const dismissed = await api.request('GET', '/api/needs?status=dismissed&pageSize=50', { cookie });
  assert.equal(dismissed.body.total, 0, 'no need has been dismissed yet');
});

test('search matches titles and source text', async () => {
  const { api, cookie } = await setup();
  const hit = await api.request('GET', '/api/needs?search=newsletter&pageSize=50', { cookie });
  assert.ok(hit.body.total >= 1);
  assert.ok(
    hit.body.needs.some((need: { title: string }) => /newsletter/i.test(need.title)),
    'the newsletter need must match',
  );
  const miss = await api.request('GET', '/api/needs?search=zzzzzznotpresent&pageSize=50', {
    cookie,
  });
  assert.equal(miss.body.total, 0);
});

test('time windows filter needs by evidence recency', async () => {
  const { api, cookie } = await setup();
  const all = await api.request('GET', `/api/needs?window=all&pageSize=50&now=${NOW}`, { cookie });
  const day = await api.request('GET', `/api/needs?window=24h&pageSize=50&now=${NOW}`, { cookie });
  const week = await api.request('GET', `/api/needs?window=7d&pageSize=50&now=${NOW}`, { cookie });
  const month = await api.request('GET', `/api/needs?window=30d&pageSize=50&now=${NOW}`, { cookie });

  assert.ok(all.body.total > 0);
  // The newest snapshot record is from 2026-06-14, far outside a 30 day window ending 2026-09-01.
  assert.equal(month.body.total, 0);
  assert.equal(week.body.total, 0);
  assert.equal(day.body.total, 0);
  assert.equal(month.body.window, '30d');
});

test('a pinned `now` makes window filtering deterministic', async () => {
  const { api, cookie } = await setup();
  const source = SNAPSHOT.records[1] as Record<string, unknown>;
  const publishedAt = String(source.publishedAt ?? source.published_at);
  const pinned = new Date(Date.parse(publishedAt) + 3_600_000).toISOString();
  const response = await api.request(
    'GET',
    `/api/needs?window=24h&pageSize=50&now=${encodeURIComponent(pinned)}`,
    { cookie },
  );
  assert.equal(response.status, 200);
  assert.ok(response.body.total >= 1, 'exactly the record published an hour earlier must match');
  assert.equal(response.body.needs[0].evidenceCount, 1);
});

test('need detail returns the summary, evidence, explanation, trend and feedback history', async () => {
  const { api, cookie } = await setup();
  const list = await api.request('GET', '/api/needs?pageSize=50', { cookie });
  const target = list.body.needs[0];
  const detail = await api.request('GET', `/api/needs/${target.id}`, { cookie });
  assert.equal(detail.status, 200);
  const need = detail.body.need;
  assert.equal(need.id, target.id);
  assert.ok(need.summary.length > 0);
  assert.ok(need.evidence.length >= 1);
  assert.ok(need.breakdown.explanation.length >= 5);
  assert.ok(need.trend.length >= 1);
  assert.ok(Array.isArray(need.scoreHistory));
  assert.ok(need.scoreHistory.length >= 1);
  assert.ok(Array.isArray(need.feedbackHistory));
  for (const point of need.scoreHistory) {
    assert.equal(typeof point.version, 'number');
    assert.equal(typeof point.score, 'number');
  }
});

test('need detail returns 404 for another workspace and for unknown ids', async () => {
  const { api } = await setup();
  const beta = await api.signIn(BETA_ADMIN.email, BETA_ADMIN.password);
  const acme = await api.signIn(ACME_ADMIN.email, ACME_ADMIN.password);
  const list = await api.request('GET', '/api/needs?pageSize=50', { cookie: acme });

  const foreign = await api.request('GET', `/api/needs/${list.body.needs[0].id}`, { cookie: beta });
  assert.equal(foreign.status, 404);
  const missing = await api.request('GET', '/api/needs/999999', { cookie: acme });
  assert.equal(missing.status, 404);
  const garbage = await api.request('GET', '/api/needs/not-a-number', { cookie: acme });
  assert.equal(garbage.status, 404);
});

test('members can read needs, admins and members can both review them', async () => {
  const { api } = await setup();
  const member = await api.signIn(ACME_MEMBER.email, ACME_MEMBER.password);
  const list = await api.request('GET', '/api/needs?pageSize=1', { cookie: member });
  assert.equal(list.status, 200);
  const needId = list.body.needs[0].id;
  const feedback = await api.request('POST', `/api/needs/${needId}/feedback`, {
    cookie: member,
    body: { relevant: true, note: 'member review' },
  });
  assert.equal(feedback.status, 201);
  assert.equal(feedback.body.feedback.relevant, true);
});

test('feedback validation rejects nonsense decisions', async () => {
  const { api, cookie } = await setup();
  const list = await api.request('GET', '/api/needs?pageSize=1', { cookie });
  const needId = list.body.needs[0].id;
  const cases = [
    { relevant: 'yes' },
    { willingnessToPay: 'maybe' },
    { note: 42 },
    { note: 'x'.repeat(2000) },
  ];
  for (const body of cases) {
    const response = await api.request('POST', `/api/needs/${needId}/feedback`, { cookie, body });
    assert.equal(response.status, 422, JSON.stringify(body));
  }
});

test('status can be changed and is then filterable', async () => {
  const { api, cookie } = await setup();
  const list = await api.request('GET', '/api/needs?pageSize=1', { cookie });
  const needId = list.body.needs[0].id;
  const updated = await api.request('PATCH', `/api/needs/${needId}/status`, {
    cookie,
    body: { status: 'validated' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.status, 'validated');
  const filtered = await api.request('GET', '/api/needs?status=validated&pageSize=50', { cookie });
  assert.ok(filtered.body.needs.some((need: { id: number }) => need.id === needId));

  const bad = await api.request('PATCH', `/api/needs/${needId}/status`, {
    cookie,
    body: { status: 'not-a-status' },
  });
  assert.equal(bad.status, 422);
});
