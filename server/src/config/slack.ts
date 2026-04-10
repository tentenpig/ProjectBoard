/**
 * Slack incoming-webhook helper.
 *
 * Reads webhook URL from process.env.SLACK_WEBHOOK_URL.
 * If unset, calls become no-ops (logged once) so non-prod environments
 * without secrets configured don't crash.
 */

let warnedMissing = false;

export interface SlackMessage {
  text: string;
  username?: string;
  icon_emoji?: string;
  channel?: string;
}

export async function sendSlackMessage(message: string | SlackMessage): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    if (!warnedMissing) {
      console.warn('[Slack] SLACK_WEBHOOK_URL not set — notifications disabled');
      warnedMissing = true;
    }
    return false;
  }

  const base = typeof message === 'string' ? { text: message } : message;
  const payload = {
    username: process.env.SLACK_USERNAME || '낚시터',
    icon_emoji: ':fishing_pole_and_fish:',
    ...base,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[Slack] Webhook returned ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Slack] Failed to send message:', err);
    return false;
  }
}
